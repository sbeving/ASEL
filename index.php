<?php
require_once 'helpers.php';
requireLogin();
$page = $_GET['page'] ?? 'dashboard';
$user = currentUser();
$fid = scopedFranchiseId();
$centralId = getCentralId();
$retailFranchises = getRetailFranchises();

// === RBAC: Check page permission ===
requirePermission($page);

// === Handle POST ===
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    verifyCsrf();
    $action = $_POST['action'] ?? '';
    requirePermission($action);
    
    if ($action === 'vente') {
        $items = json_decode($_POST['items'], true);
        $vfid = can('view_all_franchises') ? $_POST['franchise_id'] : currentFranchise();
        $client_id = $_POST['client_id'] ?: null;
        $type_facture = $_POST['type_facture'] ?? 'ticket';
        $mode_paiement = $_POST['mode_paiement'] ?? 'especes';
        $montant_recu = floatval($_POST['montant_recu'] ?? 0);
        
        // Calculate totals
        $sous_total = 0; $remise_totale = 0;
        foreach ($items as $item) {
            $sous_total += $item['qty'] * $item['prix'];
            $remise_totale += floatval($item['remise'] ?? 0);
        }
        $total_ttc = $sous_total - $remise_totale;
        $monnaie = max(0, $montant_recu - $total_ttc);
        
        // Generate facture number
        $prefix = match($type_facture) { 'facture'=>'FA','devis'=>'DV',default=>'TK' };
        $count = queryOne("SELECT COUNT(*)+1 as n FROM factures WHERE DATE(date_facture)=CURDATE() AND type_facture=?", [$type_facture])['n'];
        $numero = $prefix . '-' . date('Ymd') . '-' . str_pad($count, 4, '0', STR_PAD_LEFT);
        
        // Create facture
        execute("INSERT INTO factures (numero,franchise_id,client_id,type_facture,sous_total,remise_totale,total_ht,tva,total_ttc,mode_paiement,montant_recu,monnaie,utilisateur_id) VALUES (?,?,?,?,?,?,?,0,?,?,?,?,?)",
            [$numero, $vfid, $client_id, $type_facture, $sous_total, $remise_totale, $total_ttc, $total_ttc, $mode_paiement, $montant_recu, round($monnaie,2), $user['id']]);
        $facture_id = db()->lastInsertId();
        
        // Create lines + stock updates
        foreach ($items as $item) {
            $remise_dt = floatval($item['remise'] ?? 0);
            $total = round($item['qty'] * $item['prix'] - $remise_dt, 2);
            if ($total < 0) $total = 0;
            
            execute("INSERT INTO facture_lignes (facture_id,type_ligne,produit_id,designation,quantite,prix_unitaire,remise,total) VALUES (?,?,?,?,?,?,?,?)",
                [$facture_id, 'produit', $item['id'], $item['nom'], $item['qty'], $item['prix'], $remise_dt, $total]);
            // Check stock before selling
            $stock_check = queryOne("SELECT quantite FROM stock WHERE franchise_id=? AND produit_id=?", [$vfid, $item['id']]);
            if (!$stock_check || $stock_check['quantite'] < $item['qty']) {
                $_SESSION['flash'] = ['type'=>'danger','msg'=>'Stock insuffisant pour ' . $item['nom'] . '!'];
                header("Location: index.php?page=pos&fid=$vfid"); exit;
            }
            execute("INSERT INTO ventes (franchise_id,produit_id,quantite,prix_unitaire,prix_total,remise,utilisateur_id,client_id,facture_id,mode_paiement,montant_recu,monnaie) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                [$vfid, $item['id'], $item['qty'], $item['prix'], $total, $remise_dt, $user['id'], $client_id, $facture_id, $mode_paiement, $montant_recu, $monnaie]);
            execute("INSERT INTO mouvements (franchise_id,produit_id,type_mouvement,quantite,prix_unitaire,utilisateur_id) VALUES (?,?,'vente',?,?,?)",
                [$vfid, $item['id'], $item['qty'], $item['prix'], $user['id']]);
            execute("UPDATE stock SET quantite=GREATEST(0,quantite-?) WHERE franchise_id=? AND produit_id=?", [$item['qty'], $vfid, $item['id']]);
        }
        
        // Create echeances if payment by lot
        if ($mode_paiement === 'echeance' && $client_id) {
            $nb_ech = intval($_POST['nb_echeances'] ?? 3);
            $interv = intval($_POST['interv_jours'] ?? 30);
            $prem_date = $_POST['prem_date'] ?: date('Y-m-d', strtotime('+30 days'));
            $montant_par = round($total_ttc / $nb_ech, 2);
            $reste = round($total_ttc - ($montant_par * ($nb_ech - 1)), 2);
            
            for ($i = 0; $i < $nb_ech; $i++) {
                $date_ech = date('Y-m-d', strtotime($prem_date . " + " . ($i * $interv) . " days"));
                $mt = ($i === $nb_ech - 1) ? $reste : $montant_par;
                execute("INSERT INTO echeances (facture_id,franchise_id,client_id,montant,date_echeance,note,utilisateur_id) VALUES (?,?,?,?,?,?,?)",
                    [$facture_id, $vfid, $client_id, $mt, $date_ech, "Lot " . ($i+1) . "/$nb_ech — Facture $numero", $user['id']]);
            }
        }
        
        $_SESSION['flash'] = ['type'=>'success','msg'=>"Vente enregistrée! Facture $numero — <a href='pdf.php?type=facture&id=$facture_id' target='_blank' class='underline font-bold'>📄 Facture PDF</a> | <a href='receipt.php?id=$facture_id' target='_blank' class='underline font-bold'>🧾 Ticket</a>"];
        auditLog('vente', 'facture', $facture_id, ['numero'=>$numero, 'total'=>$total_ttc, 'items'=>count($items)]);
    }
    elseif ($action === 'entree_stock') {
        $efid = can('view_all_franchises') ? $_POST['franchise_id'] : currentFranchise();
        execute("INSERT INTO mouvements (franchise_id,produit_id,type_mouvement,quantite,note,utilisateur_id) VALUES (?,?,'entree',?,?,?)",
            [$efid, $_POST['produit_id'], $_POST['quantite'], $_POST['note'] ?? '', $user['id']]);
        execute("INSERT INTO stock (franchise_id,produit_id,quantite) VALUES (?,?,?) ON DUPLICATE KEY UPDATE quantite=quantite+VALUES(quantite)",
            [$efid, $_POST['produit_id'], $_POST['quantite']]);
        $_SESSION['flash'] = ['type'=>'success','msg'=>'Stock ajouté!'];
        auditLog('entree_stock', 'produit', $_POST['produit_id'], ['quantite'=>$_POST['quantite'], 'franchise'=>$efid]);
    }
    elseif ($action === 'transfert') {
        // Prevent transfer to same franchise
        if ($_POST['source'] == $_POST['dest']) {
            $_SESSION['flash'] = ['type'=>'danger','msg'=>'Impossible de transférer vers la même franchise!'];
            header("Location: index.php?page=transferts"); exit;
        }
        execute("INSERT INTO transferts (franchise_source,franchise_dest,produit_id,quantite,demandeur_id,note) VALUES (?,?,?,?,?,?)",
            [$_POST['source'], $_POST['dest'], $_POST['produit_id'], $_POST['quantite'], $user['id'], $_POST['note'] ?? '']);
        $_SESSION['flash'] = ['type'=>'success','msg'=>'Transfert demandé!'];
        auditLog('transfert_demande', 'produit', $_POST['produit_id'], ['source'=>$_POST['source'], 'dest'=>$_POST['dest'], 'qte'=>$_POST['quantite']]);
    }
    elseif ($action === 'transfert_valider') {
        $t = queryOne("SELECT * FROM transferts WHERE id=?", [$_POST['tid']]);
        if ($t) {
            $statut = $_POST['decision'] === 'accept' ? 'accepte' : 'rejete';
            execute("UPDATE transferts SET statut=?,validateur_id=?,date_validation=NOW() WHERE id=?", [$statut, $user['id'], $_POST['tid']]);
            if ($statut === 'accepte') {
                execute("UPDATE stock SET quantite=GREATEST(0,quantite-?) WHERE franchise_id=? AND produit_id=?", [$t['quantite'], $t['franchise_source'], $t['produit_id']]);
                execute("INSERT INTO stock (franchise_id,produit_id,quantite) VALUES (?,?,?) ON DUPLICATE KEY UPDATE quantite=quantite+VALUES(quantite)", [$t['franchise_dest'], $t['produit_id'], $t['quantite']]);
            }
        }
        $_SESSION['flash'] = ['type'=>'success','msg'=>'Transfert traité!'];
    }
    elseif ($action === 'retour') {
        $rfid = can('view_all_franchises') ? $_POST['franchise_id'] : currentFranchise();
        execute("INSERT INTO retours (franchise_id,produit_id,quantite,type_retour,raison,utilisateur_id) VALUES (?,?,?,?,?,?)",
            [$rfid, $_POST['produit_id'], $_POST['quantite'], $_POST['type_retour'], $_POST['raison'] ?? '', $user['id']]);
        if ($_POST['type_retour'] === 'retour')
            execute("INSERT INTO stock (franchise_id,produit_id,quantite) VALUES (?,?,?) ON DUPLICATE KEY UPDATE quantite=quantite+VALUES(quantite)", [$rfid, $_POST['produit_id'], $_POST['quantite']]);
        $_SESSION['flash'] = ['type'=>'success','msg'=>'Retour enregistré!'];
        auditLog('retour', 'produit', $_POST['produit_id'], ['type'=>$_POST['type_retour'], 'qte'=>$_POST['quantite'], 'franchise'=>$rfid]);
    }
    elseif ($action === 'cloture_submit') {
        $cfid = can('view_all_franchises') ? $_POST['franchise_id'] : currentFranchise();
        $sys = queryOne("SELECT COALESCE(SUM(prix_total),0) as t, COALESCE(SUM(quantite),0) as a FROM ventes WHERE franchise_id=? AND date_vente=?", [$cfid, $_POST['date_cloture']]);
        execute("INSERT INTO clotures (franchise_id,date_cloture,total_ventes_declare,total_articles_declare,total_ventes_systeme,total_articles_systeme,commentaire,utilisateur_id) VALUES (?,?,?,?,?,?,?,?)",
            [$cfid, $_POST['date_cloture'], $_POST['total_declare'], $_POST['articles_declare'], $sys['t'], $sys['a'], $_POST['commentaire'] ?? '', $user['id']]);
        $_SESSION['flash'] = ['type'=>'success','msg'=>'Clôture soumise!'];
        auditLog('cloture_submit', 'franchise', $cfid, ['date'=>$_POST['date_cloture'], 'declare'=>$_POST['total_declare'], 'systeme'=>$sys['t']]);
    }
    elseif ($action === 'add_produit') {
        execute("INSERT INTO produits (nom,categorie_id,prix_achat,prix_vente,reference,code_barre,marque,seuil_alerte) VALUES (?,?,?,?,?,?,?,?)",
            [$_POST['nom'], $_POST['categorie_id'], $_POST['prix_achat'], $_POST['prix_vente'], $_POST['reference'] ?? '', $_POST['code_barre'] ?? '', $_POST['marque'] ?? '', $_POST['seuil'] ?? 3]);
        $pid = db()->lastInsertId();
        foreach (query("SELECT id FROM franchises WHERE actif=1") as $f) execute("INSERT IGNORE INTO stock (franchise_id,produit_id,quantite) VALUES (?,?,0)", [$f['id'], $pid]);
        $_SESSION['flash'] = ['type'=>'success','msg'=>'Produit ajouté!'];
        auditLog('add_produit', 'produit', $pid, ['nom'=>$_POST['nom'], 'prix_vente'=>$_POST['prix_vente']]);
    }
    elseif ($action === 'edit_produit') {
        execute("UPDATE produits SET nom=?,categorie_id=?,prix_achat=?,prix_vente=?,reference=?,code_barre=?,marque=?,seuil_alerte=? WHERE id=?",
            [$_POST['nom'], $_POST['categorie_id'], $_POST['prix_achat'], $_POST['prix_vente'], $_POST['reference'] ?? '', $_POST['code_barre'] ?? '', $_POST['marque'] ?? '', $_POST['seuil'] ?? 3, $_POST['produit_id']]);
        $_SESSION['flash'] = ['type'=>'success','msg'=>'Produit mis à jour!'];
        auditLog('edit_produit', 'produit', $_POST['produit_id'], ['nom'=>$_POST['nom'], 'prix_vente'=>$_POST['prix_vente']]);
    }
    elseif ($action === 'demande_produit') {
        $dfid = can('view_all_franchises') ? $_POST['franchise_id'] : currentFranchise();
        execute("INSERT INTO demandes_produits (franchise_id,produit_id,nom_produit,quantite,urgence,note,demandeur_id) VALUES (?,?,?,?,?,?,?)",
            [$dfid, $_POST['produit_id'] ?: null, $_POST['nom_produit'] ?? '', $_POST['quantite'], $_POST['urgence'] ?? 'normal', $_POST['note'] ?? '', $user['id']]);
        $_SESSION['flash'] = ['type'=>'success','msg'=>'Demande envoyée!'];
        auditLog('demande_produit', 'franchise', $dfid, ['produit'=>$_POST['produit_id'], 'qte'=>$_POST['quantite'], 'urgence'=>$_POST['urgence']??'normal']);
    }
    elseif ($action === 'traiter_demande') {
        execute("UPDATE demandes_produits SET statut=?,gestionnaire_id=?,reponse=?,date_traitement=NOW() WHERE id=?",
            [$_POST['decision'], $user['id'], $_POST['reponse'] ?? '', $_POST['demande_id']]);
        if ($_POST['decision'] === 'livre') {
            $dem = queryOne("SELECT * FROM demandes_produits WHERE id=?", [$_POST['demande_id']]);
            if ($dem && $dem['produit_id']) {
                execute("INSERT INTO stock (franchise_id,produit_id,quantite) VALUES (?,?,?) ON DUPLICATE KEY UPDATE quantite=quantite+VALUES(quantite)", [$dem['franchise_id'], $dem['produit_id'], $dem['quantite']]);
                execute("INSERT INTO mouvements (franchise_id,produit_id,type_mouvement,quantite,note,utilisateur_id) VALUES (?,?,'dispatch_in',?,?,?)", [$dem['franchise_id'], $dem['produit_id'], $dem['quantite'], 'Demande #'.$dem['id'], $user['id']]);
                // Deduct from Stock Central
                $cid = getCentralId();
                if ($cid) {
                    execute("UPDATE stock SET quantite=GREATEST(0,quantite-?) WHERE franchise_id=? AND produit_id=?", [$dem['quantite'], $cid, $dem['produit_id']]);
                    execute("INSERT INTO mouvements (franchise_id,produit_id,type_mouvement,quantite,note,utilisateur_id) VALUES (?,?,'dispatch_out',?,?,?)", [$cid, $dem['produit_id'], $dem['quantite'], 'Dispatch → Demande #'.$dem['id'], $user['id']]);
                }
            }
        }
        $_SESSION['flash'] = ['type'=>'success','msg'=>'Demande traitée!'];
        auditLog('traiter_demande', 'demande', $_POST['demande_id'], ['decision'=>$_POST['decision']]);
    }
    elseif ($action === 'add_user') {
        $pw = password_hash($_POST['password'], PASSWORD_DEFAULT);
        execute("INSERT INTO utilisateurs (nom_utilisateur,mot_de_passe,nom_complet,role,franchise_id) VALUES (?,?,?,?,?)",
            [$_POST['username'], $pw, $_POST['nom_complet'], $_POST['role'], $_POST['franchise_id'] ?: null]);
        $_SESSION['flash'] = ['type'=>'success','msg'=>'Utilisateur créé!'];
        auditLog('add_user', 'utilisateur', db()->lastInsertId(), ['username'=>$_POST['username'], 'role'=>$_POST['role']]);
    }
    elseif ($action === 'edit_user') {
        execute("UPDATE utilisateurs SET nom_complet=?,role=?,franchise_id=?,actif=? WHERE id=?",
            [$_POST['nom_complet'], $_POST['role'], $_POST['franchise_id'] ?: null, $_POST['actif'] ?? 1, $_POST['user_id']]);
        if (!empty($_POST['new_password']))
            execute("UPDATE utilisateurs SET mot_de_passe=? WHERE id=?", [password_hash($_POST['new_password'], PASSWORD_DEFAULT), $_POST['user_id']]);
        $_SESSION['flash'] = ['type'=>'success','msg'=>'Utilisateur mis à jour!'];
        auditLog('edit_user', 'utilisateur', $_POST['user_id'], ['nom'=>$_POST['nom_complet'], 'role'=>$_POST['role'], 'actif'=>$_POST['actif']??1]);
    }
    elseif ($action === 'add_client') {
        $cfid = can('view_all_franchises') ? ($_POST['franchise_id'] ?? null) : currentFranchise();
        execute("INSERT INTO clients (nom,prenom,telephone,email,type_client,entreprise,matricule_fiscal,franchise_id) VALUES (?,?,?,?,?,?,?,?)",
            [$_POST['nom'], $_POST['prenom'] ?? '', $_POST['telephone'] ?? '', $_POST['email'] ?? '', $_POST['type_client'] ?? 'passager', $_POST['entreprise'] ?? '', $_POST['matricule_fiscal'] ?? '', $cfid]);
        $_SESSION['flash'] = ['type'=>'success','msg'=>'Client ajouté!'];
        auditLog('add_client', 'client', db()->lastInsertId(), ['nom'=>$_POST['nom'], 'type'=>$_POST['type_client']??'passager']);
    }
    elseif ($action === 'add_service') {
        execute("INSERT INTO services (nom,categorie_service,prix,description,duree_minutes) VALUES (?,?,?,?,?)",
            [$_POST['nom'], $_POST['categorie_service'], $_POST['prix'], $_POST['description'] ?? '', $_POST['duree_minutes'] ?? 15]);
        $_SESSION['flash'] = ['type'=>'success','msg'=>'Service ajouté!'];
        auditLog('add_service', 'service', db()->lastInsertId(), ['nom'=>$_POST['nom'], 'prix'=>$_POST['prix']]);
    }
    elseif ($action === 'edit_service') {
        execute("UPDATE services SET nom=?,categorie_service=?,prix=?,description=?,duree_minutes=?,actif=? WHERE id=?",
            [$_POST['nom'], $_POST['categorie_service'], $_POST['prix'], $_POST['description'] ?? '', $_POST['duree_minutes'] ?? 15, $_POST['actif'] ?? 1, $_POST['service_id']]);
        $_SESSION['flash'] = ['type'=>'success','msg'=>'Service mis à jour!'];
        auditLog('edit_service', 'service', $_POST['service_id'], ['nom'=>$_POST['nom']]);
    }
    elseif ($action === 'add_asel_product') {
        execute("INSERT INTO produits_asel (nom,type_produit,operateur,valeur_nominale,prix_vente,commission) VALUES (?,?,'ASEL',?,?,?)",
            [$_POST['nom'], $_POST['type_produit'], $_POST['valeur_nominale'], $_POST['prix_vente'], $_POST['commission'] ?? 0]);
        $_SESSION['flash'] = ['type'=>'success','msg'=>'Produit ASEL ajouté!'];
        auditLog('add_asel_product', 'produit_asel', db()->lastInsertId(), ['nom'=>$_POST['nom']]);
    }
    elseif ($action === 'edit_asel_product') {
        execute("UPDATE produits_asel SET nom=?,type_produit=?,valeur_nominale=?,prix_vente=?,commission=?,actif=? WHERE id=?",
            [$_POST['nom'], $_POST['type_produit'], $_POST['valeur_nominale'], $_POST['prix_vente'], $_POST['commission'] ?? 0, $_POST['actif'] ?? 1, $_POST['produit_id']]);
        $_SESSION['flash'] = ['type'=>'success','msg'=>'Produit ASEL mis à jour!'];
        auditLog('edit_asel_product', 'produit_asel', $_POST['produit_id'], ['nom'=>$_POST['nom']]);
    }
    elseif ($action === 'pay_echeance') {
        execute("UPDATE echeances SET statut='payee',date_paiement=NOW(),mode_paiement='especes' WHERE id=?", [$_POST['echeance_id']]);
        $_SESSION['flash'] = ['type'=>'success','msg'=>'Échéance encaissée!'];
        auditLog('pay_echeance', 'echeance', $_POST['echeance_id']);
    }
    elseif ($action === 'create_echeance') {
        execute("INSERT INTO echeances (facture_id,franchise_id,client_id,montant,date_echeance,note,utilisateur_id) VALUES (?,?,?,?,?,?,?)",
            [$_POST['facture_id'], $_POST['franchise_id'], $_POST['client_id'], $_POST['montant'], $_POST['date_echeance'], $_POST['note'] ?? '', $user['id']]);
        $_SESSION['flash'] = ['type'=>'success','msg'=>'Échéance créée!'];
    }
    elseif ($action === 'submit_inventaire') {
        $inv_fid = $_POST['franchise_id'];
        $mois = $_POST['mois'];
        execute("INSERT INTO inventaires (franchise_id,mois,statut,utilisateur_id,date_soumission,commentaire) VALUES (?,?,'soumis',?,NOW(),?)",
            [$inv_fid, $mois, $user['id'], $_POST['commentaire'] ?? '']);
        $inv_id = db()->lastInsertId();
        $pids = $_POST['produit_ids'] ?? [];
        $qsys = $_POST['qte_systeme'] ?? [];
        $qphy = $_POST['qte_physique'] ?? [];
        $ecarts = 0; $val_ecarts = 0;
        for ($i=0; $i<count($pids); $i++) {
            $ecart = intval($qphy[$i]) - intval($qsys[$i]);
            execute("INSERT INTO inventaire_lignes (inventaire_id,produit_id,quantite_systeme,quantite_physique,ecart) VALUES (?,?,?,?,?)",
                [$inv_id, $pids[$i], $qsys[$i], $qphy[$i], $ecart]);
            if ($ecart != 0) { $ecarts++; $val_ecarts += abs($ecart); }
        }
        execute("UPDATE inventaires SET ecarts_count=?,ecarts_valeur=? WHERE id=?", [$ecarts, $val_ecarts, $inv_id]);
        // Notify admin
        execute("INSERT INTO notifications (role_cible,titre,message,type_notif,lien) VALUES ('admin',?,?,?,?)",
            ["📋 Inventaire soumis", shortF(queryOne("SELECT nom FROM franchises WHERE id=?",[$inv_fid])['nom']??'')." — $mois: $ecarts écart(s)", $ecarts>0?'warning':'success', "index.php?page=inventaire&fid=$inv_fid"]);
        $_SESSION['flash'] = ['type'=>'success','msg'=>"Inventaire soumis! $ecarts écart(s) trouvé(s)."];
    }
    elseif ($action === 'toggle_produit' && isAdmin()) {
        $p = queryOne("SELECT actif FROM produits WHERE id=?", [$_POST['produit_id']]);
        if ($p) {
            $new = $p['actif'] ? 0 : 1;
            execute("UPDATE produits SET actif=? WHERE id=?", [$new, $_POST['produit_id']]);
            $_SESSION['flash'] = ['type'=>'success','msg'=> $new ? 'Produit réactivé!' : 'Produit désactivé!'];
        }
    }
    elseif ($action === 'create_echeances_lot') {
        // Create multiple installments for a client boutique
        $facture_id = intval($_POST['facture_id']);
        $client_id = intval($_POST['client_id']);
        $franchise_id = can('view_all_franchises') ? intval($_POST['franchise_id']) : currentFranchise();
        $nb_echeances = intval($_POST['nb_echeances']);
        $montant_total = floatval($_POST['montant_total']);
        $premiere_date = $_POST['premiere_date'];
        $intervalle_jours = intval($_POST['intervalle_jours'] ?? 30);
        
        $montant_par_echeance = round($montant_total / $nb_echeances, 2);
        $reste = round($montant_total - ($montant_par_echeance * ($nb_echeances - 1)), 2);
        
        for ($i = 0; $i < $nb_echeances; $i++) {
            $date_ech = date('Y-m-d', strtotime($premiere_date . " + " . ($i * $intervalle_jours) . " days"));
            $montant = ($i === $nb_echeances - 1) ? $reste : $montant_par_echeance;
            execute("INSERT INTO echeances (facture_id,franchise_id,client_id,montant,date_echeance,note,utilisateur_id) VALUES (?,?,?,?,?,?,?)",
                [$facture_id, $franchise_id, $client_id, $montant, $date_ech, "Lot " . ($i+1) . "/$nb_echeances", $user['id']]);
        }
        // Notify
        $client = queryOne("SELECT nom FROM clients WHERE id=?", [$client_id]);
        execute("INSERT INTO notifications (franchise_id,titre,message,type_notif,lien) VALUES (?,?,?,?,?)",
            [$franchise_id, "📅 $nb_echeances échéances créées", "Client: " . ($client['nom']??'') . " — Total: $montant_total DT", 'info', 'index.php?page=echeances']);
        $_SESSION['flash'] = ['type'=>'success','msg'=>"$nb_echeances échéances créées pour " . ($client['nom']??'client') . "!"];
    }
    elseif ($action === 'edit_client') {
        execute("UPDATE clients SET nom=?,prenom=?,telephone=?,email=?,type_client=?,entreprise=?,matricule_fiscal=?,actif=? WHERE id=?",
            [$_POST['nom'], $_POST['prenom']??'', $_POST['telephone']??'', $_POST['email']??'', $_POST['type_client']??'passager', $_POST['entreprise']??'', $_POST['matricule_fiscal']??'', $_POST['actif']??1, $_POST['client_id']]);
        $_SESSION['flash'] = ['type'=>'success','msg'=>'Client mis à jour!'];
        auditLog('edit_client', 'client', $_POST['client_id'], ['nom'=>$_POST['nom']]);
    }
    elseif ($action === 'cancel_facture' && isAdmin()) {
        $fac = queryOne("SELECT * FROM factures WHERE id=?", [$_POST['facture_id']]);
        if ($fac && $fac['statut'] !== 'annulee') {
            execute("UPDATE factures SET statut='annulee' WHERE id=?", [$_POST['facture_id']]);
            // Reverse stock
            $lignes = query("SELECT * FROM facture_lignes WHERE facture_id=? AND type_ligne='produit'", [$_POST['facture_id']]);
            foreach ($lignes as $l) {
                if ($l['produit_id']) {
                    execute("UPDATE stock SET quantite=quantite+? WHERE franchise_id=? AND produit_id=?", [$l['quantite'], $fac['franchise_id'], $l['produit_id']]);
                    execute("INSERT INTO mouvements (franchise_id,produit_id,type_mouvement,quantite,note,utilisateur_id) VALUES (?,?,'ajustement',?,?,?)",
                        [$fac['franchise_id'], $l['produit_id'], $l['quantite'], 'Annulation facture '.$fac['numero'], $user['id']]);
                }
            }
            // Cancel related echeances
            execute("UPDATE echeances SET statut='payee',note=CONCAT(IFNULL(note,''),' [Annulée]') WHERE facture_id=? AND statut='en_attente'", [$_POST['facture_id']]);
        }
        $_SESSION['flash'] = ['type'=>'success','msg'=>'Facture annulée! Stock restauré.'];
        auditLog('cancel_facture', 'facture', $_POST['facture_id'], ['numero'=>$fac['numero']]);
    }
    elseif ($action === 'validate_cloture' && isAdmin()) {
        execute("UPDATE clotures SET valide=1,validateur_id=?,date_validation=NOW() WHERE id=?", [$user['id'], $_POST['cloture_id']]);
        $_SESSION['flash'] = ['type'=>'success','msg'=>'Clôture validée!'];
        auditLog('validate_cloture', 'cloture', $_POST['cloture_id']);
    }
    elseif ($action === 'validate_inventaire' && isAdmin()) {
        execute("UPDATE inventaires SET statut='valide',validateur_id=?,date_validation=NOW() WHERE id=?", [$user['id'], $_POST['inventaire_id']]);
        // Apply corrections to stock
        $inv = queryOne("SELECT * FROM inventaires WHERE id=?", [$_POST['inventaire_id']]);
        if ($inv) {
            $lignes = query("SELECT * FROM inventaire_lignes WHERE inventaire_id=? AND ecart!=0", [$inv['id']]);
            foreach ($lignes as $l) {
                execute("UPDATE stock SET quantite=? WHERE franchise_id=? AND produit_id=?", [$l['quantite_physique'], $inv['franchise_id'], $l['produit_id']]);
                execute("INSERT INTO mouvements (franchise_id,produit_id,type_mouvement,quantite,note,utilisateur_id) VALUES (?,?,'ajustement',?,?,?)",
                    [$inv['franchise_id'], $l['produit_id'], $l['ecart'], 'Inventaire '.$inv['mois'], $user['id']]);
            }
        }
        $_SESSION['flash'] = ['type'=>'success','msg'=>'Inventaire validé! Stock ajusté.'];
        auditLog('validate_inventaire', 'inventaire', $_POST['inventaire_id']);
    }
    elseif ($action === 'add_category' && isAdmin()) {
        execute("INSERT INTO categories (nom,description) VALUES (?,?)", [$_POST['nom'], $_POST['description']??'']);
        $_SESSION['flash'] = ['type'=>'success','msg'=>'Catégorie ajoutée!'];
        auditLog('add_category', 'categorie', null, ['nom'=>$_POST['nom']]);
    }
    elseif ($action === 'update_franchise_location' && isAdmin()) {
        execute("UPDATE franchises SET latitude=?, longitude=? WHERE id=?", [
            floatval($_POST['latitude']), floatval($_POST['longitude']), intval($_POST['franchise_id'])
        ]);
        $_SESSION['flash'] = ['type'=>'success','msg'=>'Coordonnées mises à jour!'];
        auditLog('update_location', 'franchise', $_POST['franchise_id'], ['lat'=>$_POST['latitude'], 'lng'=>$_POST['longitude']]);
    }
    elseif ($action === 'add_franchise' && isAdmin()) {
        execute("INSERT INTO franchises (nom, adresse, telephone, responsable, type_franchise, horaires) VALUES (?,?,?,?,'point_de_vente',?)",
            [$_POST['nom'], $_POST['adresse'] ?? '', $_POST['telephone'] ?? '', $_POST['responsable'] ?? '', $_POST['horaires'] ?? 'Lun-Sam: 09:00-19:00']);
        $new_fid = db()->lastInsertId();
        // Create stock rows for all products
        foreach (query("SELECT id FROM produits WHERE actif=1") as $p) {
            execute("INSERT IGNORE INTO stock (franchise_id,produit_id,quantite) VALUES (?,?,0)", [$new_fid, $p['id']]);
        }
        $_SESSION['flash'] = ['type'=>'success','msg'=>'Franchise ajoutée!'];
        auditLog('add_franchise', 'franchise', $new_fid, ['nom'=>$_POST['nom']]);
    }
    elseif ($action === 'edit_franchise' && isAdmin()) {
        execute("UPDATE franchises SET nom=?, adresse=?, telephone=?, responsable=?, horaires=?, actif=? WHERE id=?",
            [$_POST['nom'], $_POST['adresse'] ?? '', $_POST['telephone'] ?? '', $_POST['responsable'] ?? '', $_POST['horaires'] ?? '', $_POST['actif'] ?? 1, $_POST['franchise_id']]);
        $_SESSION['flash'] = ['type'=>'success','msg'=>'Franchise mise à jour!'];
        auditLog('edit_franchise', 'franchise', $_POST['franchise_id'], ['nom'=>$_POST['nom']]);
    }
    elseif ($action === 'delete_franchise' && isAdmin()) {
        $fcheck = queryOne("SELECT type_franchise FROM franchises WHERE id=?", [$_POST['franchise_id']]);
        if ($fcheck && $fcheck['type_franchise'] === 'central') {
            $_SESSION['flash'] = ['type'=>'danger','msg'=>'Impossible de supprimer le Stock Central!'];
        } else {
            // Check if franchise has sales or stock
            $has_data = queryOne("SELECT (SELECT COUNT(*) FROM ventes WHERE franchise_id=?) + (SELECT COALESCE(SUM(quantite),0) FROM stock WHERE franchise_id=?) as total", [$_POST['franchise_id'], $_POST['franchise_id']]);
            if ($has_data && $has_data['total'] > 0) {
                // Soft delete — just deactivate
                execute("UPDATE franchises SET actif=0 WHERE id=?", [$_POST['franchise_id']]);
                $_SESSION['flash'] = ['type'=>'success','msg'=>'Franchise désactivée (données existantes conservées).'];
            } else {
                // Hard delete — no data linked
                execute("DELETE FROM stock WHERE franchise_id=?", [$_POST['franchise_id']]);
                execute("DELETE FROM franchises WHERE id=?", [$_POST['franchise_id']]);
                $_SESSION['flash'] = ['type'=>'success','msg'=>'Franchise supprimée!'];
            }
            auditLog('delete_franchise', 'franchise', $_POST['franchise_id']);
        }
    }
    elseif ($action === 'dispatch_stock' && isAdminOrGest()) {
        // Dispatch from Stock Central to a franchise
        $cid = getCentralId();
        $dest_fid = intval($_POST['franchise_id']);
        $pid = intval($_POST['produit_id']);
        $qty = intval($_POST['quantite']);
        $note = $_POST['note'] ?? '';
        
        // Check central stock
        $cs = queryOne("SELECT quantite FROM stock WHERE franchise_id=? AND produit_id=?", [$cid, $pid]);
        if (!$cs || $cs['quantite'] < $qty) {
            $_SESSION['flash'] = ['type'=>'danger','msg'=>'Stock Central insuffisant! Disponible: '.($cs['quantite']??0)];
            header("Location: index.php?page=stock_central"); exit;
        }
        
        // Deduct from central
        execute("UPDATE stock SET quantite=quantite-? WHERE franchise_id=? AND produit_id=?", [$qty, $cid, $pid]);
        execute("INSERT INTO mouvements (franchise_id,produit_id,type_mouvement,quantite,note,utilisateur_id) VALUES (?,?,'dispatch_out',?,?,?)", [$cid, $pid, $qty, "Dispatch → franchise #$dest_fid".($note?" — $note":''), $user['id']]);
        
        // Add to destination franchise
        execute("INSERT INTO stock (franchise_id,produit_id,quantite) VALUES (?,?,?) ON DUPLICATE KEY UPDATE quantite=quantite+VALUES(quantite)", [$dest_fid, $pid, $qty]);
        execute("INSERT INTO mouvements (franchise_id,produit_id,type_mouvement,quantite,note,utilisateur_id) VALUES (?,?,'dispatch_in',?,?,?)", [$dest_fid, $pid, $qty, "Dispatch depuis Stock Central".($note?" — $note":''), $user['id']]);
        
        // Record as transfert
        execute("INSERT INTO transferts (franchise_source,franchise_dest,produit_id,quantite,type_transfert,statut,demandeur_id,validateur_id,date_validation,note) VALUES (?,?,?,?,'dispatch','accepte',?,?,NOW(),?)", [$cid, $dest_fid, $pid, $qty, $user['id'], $user['id'], $note]);
        
        $pnom = queryOne("SELECT nom FROM produits WHERE id=?", [$pid])['nom'] ?? '';
        $fname = queryOne("SELECT nom FROM franchises WHERE id=?", [$dest_fid])['nom'] ?? '';
        $_SESSION['flash'] = ['type'=>'success','msg'=>"Dispatché $qty × $pnom vers ".shortF($fname)."!"];
        auditLog('dispatch_stock', 'produit', $pid, ['qte'=>$qty, 'dest'=>$dest_fid, 'dest_nom'=>$fname]);
        $page = 'stock_central';
    }
    
    header("Location: index.php?page=$page" . ($fid ? "&fid=$fid" : "")); exit;
}

// === Load data ===
$franchises = getRetailFranchises();
$allFranchises = query("SELECT * FROM franchises WHERE actif=1 ORDER BY nom");
$categories = query("SELECT * FROM categories ORDER BY nom");
$produits = query("SELECT p.*,c.nom as cat_nom FROM produits p JOIN categories c ON p.categorie_id=c.id WHERE p.actif=1 ORDER BY c.nom,p.nom");
$flash = $_SESSION['flash'] ?? null; unset($_SESSION['flash']);
$csrf = csrfToken();
?>
<!DOCTYPE html>
<html lang="fr" class="h-full">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>ASEL Mobile — Gestion de Stock & Point de Vente</title>
    <meta name="description" content="ASEL Mobile - Système de gestion de stock, point de vente et facturation pour franchises de téléphonie mobile en Tunisie">
    <meta name="author" content="ASEL Mobile">
    <meta name="robots" content="noindex, nofollow">
    <meta name="theme-color" content="#2AABE2">
    <link rel="manifest" href="manifest.json">
    <link rel="apple-touch-icon" sizes="180x180" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>📱</text></svg>">
    <script src="https://cdn.tailwindcss.com"></script>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css" rel="stylesheet">
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
    <script>tailwind.config={theme:{extend:{colors:{asel:'#2AABE2','asel-dark':'#1B3A5C','asel-light':'#F0F8FF'},fontFamily:{sans:['Inter','sans-serif']}}}}</script>
    <script src="https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
    <link href="https://cdn.jsdelivr.net/npm/tom-select@2.3.1/dist/css/tom-select.min.css" rel="stylesheet">
    <script src="https://cdn.jsdelivr.net/npm/tom-select@2.3.1/dist/js/tom-select.complete.min.js"></script>
    <style>
    /* Tom Select ASEL theme */
    .ts-wrapper .ts-control { border: 2px solid #e5e7eb; border-radius: 0.75rem; padding: 8px 12px; font-size: 0.875rem; min-height: 42px; }
    .ts-wrapper.focus .ts-control { border-color: #2AABE2; box-shadow: 0 0 0 3px rgba(42,171,226,0.15); }
    .ts-wrapper .ts-dropdown { border: 2px solid #e5e7eb; border-radius: 0.75rem; margin-top: 4px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
    .ts-wrapper .ts-dropdown .option.active { background: #2AABE2; color: white; }
    .ts-wrapper .ts-dropdown .option:hover { background: #F0F8FF; }
    .ts-wrapper .ts-dropdown .option { padding: 8px 12px; font-size: 0.875rem; }
    /* Better form inputs */
    .form-input { border: 2px solid #e5e7eb; border-radius: 0.75rem; padding: 10px 14px; font-size: 0.875rem; width: 100%; transition: border-color 0.2s, box-shadow 0.2s; }
    .form-input:focus { border-color: #2AABE2; box-shadow: 0 0 0 3px rgba(42,171,226,0.15); outline: none; }
    .form-label { display: block; font-size: 0.75rem; font-weight: 700; color: #374151; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.5px; }
    /* Card form */
    .form-card { background: white; border-radius: 1rem; box-shadow: 0 1px 4px rgba(0,0,0,0.06); padding: 1.5rem; }
    .form-card h3 { font-size: 1rem; font-weight: 800; color: #1B3A5C; margin-bottom: 1rem; display: flex; align-items: center; gap: 0.5rem; }
    .form-row { display: grid; gap: 1rem; margin-bottom: 1rem; }
    .form-row-2 { grid-template-columns: 1fr 1fr; }
    .form-row-3 { grid-template-columns: 1fr 1fr 1fr; }
    .form-row-4 { grid-template-columns: 1fr 1fr 1fr 1fr; }
    @media (max-width: 640px) { .form-row-2,.form-row-3,.form-row-4 { grid-template-columns: 1fr; } }
    .btn-submit { background: #2AABE2; color: white; border: none; border-radius: 0.75rem; padding: 12px 24px; font-weight: 700; font-size: 0.875rem; cursor: pointer; width: 100%; transition: all 0.2s; }
    .btn-submit:hover { background: #1B3A5C; transform: translateY(-1px); }
    .btn-submit:active { transform: translateY(0); }
    </style>
    <script>
    // Session timeout: auto-logout after 30 min inactivity
    let sessionTimer;
    function resetTimer(){clearTimeout(sessionTimer);sessionTimer=setTimeout(()=>{alert('Session expirée. Reconnexion requise.');location.href='logout.php';},30*60*1000);}
    document.addEventListener('mousemove',resetTimer);document.addEventListener('keypress',resetTimer);resetTimer();
    </script>
    <style>
    @keyframes pulse-asel { 0%,100%{opacity:1} 50%{opacity:0.5} }
    .loading { animation: pulse-asel 1.5s infinite; }
    .fade-in { animation: fadeIn 0.3s ease-in; }
    @keyframes fadeIn { from{opacity:0;transform:translateY(5px)} to{opacity:1;transform:translateY(0)} }
    /* Smooth page transitions */
    .main > div { animation: fadeIn 0.2s ease-in; }
    /* Better scrollbar */
    ::-webkit-scrollbar { width:6px; }
    ::-webkit-scrollbar-thumb { background:#2AABE2; border-radius:3px; }
    ::-webkit-scrollbar-track { background:#f1f1f1; }
    /* Print hide sidebar */
    @media print { .sidebar, nav, .no-print { display:none!important; } .main, main { margin:0!important; padding:0!important; } }
    /* Hover card effect */
    .hover-lift { transition: transform 0.2s, box-shadow 0.2s; }
    .hover-lift:hover { transform: translateY(-2px); box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
    /* Badge animation */
    @keyframes badge-bounce { 0%,100%{transform:scale(1)} 50%{transform:scale(1.2)} }
    .badge-animate { animation: badge-bounce 0.5s ease; }
    </style>
</head>
<body class="h-full bg-gray-50 font-sans">

<?php
// Count notifications for current user
$notif_where = [];
$notif_params = [];
if (currentFranchise()) { $notif_where[] = "(franchise_id=? OR franchise_id IS NULL)"; $notif_params[] = currentFranchise(); }
if (userRole()) { $notif_where[] = "(role_cible=? OR role_cible IS NULL)"; $notif_params[] = userRole(); }
$notif_where[] = "(utilisateur_id=? OR utilisateur_id IS NULL)"; $notif_params[] = $user['id'];
$notif_sql = "SELECT COUNT(*) as c FROM notifications WHERE lu=0 AND (" . implode(' OR ', $notif_where) . ")";
$notif_count = queryOne($notif_sql, $notif_params)['c'] ?? 0;
$notifs = query("SELECT * FROM notifications WHERE lu=0 AND (" . implode(' OR ', $notif_where) . ") ORDER BY date_creation DESC LIMIT 10", $notif_params);
?>

<!-- Mobile nav toggle -->
<div class="lg:hidden fixed top-0 left-0 right-0 z-50 bg-asel text-white px-4 py-3 flex items-center justify-between shadow-lg">
    <div class="font-black text-lg tracking-wider"><span class="bg-gradient-to-r from-red-400 via-yellow-300 to-green-400 bg-clip-text text-transparent">A</span>SEL</div>
    <div class="flex items-center gap-3">
        <?php if ($notif_count > 0): ?>
        <a href="?page=notifications" class="relative">
            <i class="bi bi-bell text-xl"></i>
            <span class="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] rounded-full w-4 h-4 flex items-center justify-center font-bold"><?=min($notif_count,9)?></span>
        </a>
        <?php endif; ?>
        <button onclick="document.getElementById('sidebar').classList.toggle('-translate-x-full')" class="p-1"><i class="bi bi-list text-2xl"></i></button>
    </div>
</div>

<!-- Sidebar -->
<aside id="sidebar" class="fixed inset-y-0 left-0 z-40 w-64 bg-asel-dark text-white transform -translate-x-full lg:translate-x-0 transition-transform duration-200 ease-in-out overflow-y-auto">
    <!-- Logo -->
    <div class="px-6 py-6 border-b border-white/10">
        <div class="text-2xl font-black tracking-wider"><span class="bg-gradient-to-r from-red-400 via-yellow-300 via-green-400 to-blue-400 bg-clip-text text-transparent">A</span>SEL MOBILE</div>
    </div>
    
    <!-- User -->
    <div class="px-6 py-4 border-b border-white/10 flex items-center justify-between">
        <div>
            <div class="font-semibold text-sm"><?= htmlspecialchars($user['nom_complet']) ?></div>
            <div class="mt-1"><?= roleBadge($user['role']) ?></div>
        </div>
        <?php if ($notif_count > 0): ?>
        <a href="?page=notifications" class="relative" title="<?=$notif_count?> notification(s)">
            <i class="bi bi-bell-fill text-yellow-300 text-xl"></i>
            <span class="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] rounded-full w-5 h-5 flex items-center justify-center font-bold"><?=min($notif_count,99)?></span>
        </a>
        <?php endif; ?>
    </div>
    
    <!-- Nav -->
    <nav class="py-4 space-y-1">
        <?php
        $nav = [
            ['dashboard', 'bi-speedometer2', 'Tableau de bord'],
            ['pos', 'bi-cart3', 'Point de vente'],
            ['stock', 'bi-box-seam', 'Stock'],
            ['---', '', 'OPÉRATIONS'],
            ['stock_central', 'bi-building', 'Stock Central'],
            ['entree', 'bi-box-arrow-in-down', 'Entrée stock'],
            ['transferts', 'bi-arrow-left-right', 'Transferts'],
            ['demandes', 'bi-megaphone', 'Demandes'],
            ['retours', 'bi-arrow-counterclockwise', 'Retours'],
            ['cloture', 'bi-calendar-check', 'Clôture'],
            ['echeances', 'bi-credit-card', 'Échéances'],
            ['inventaire', 'bi-clipboard-check', 'Inventaire'],
            ['---', '', 'CLIENTS & SERVICES'],
            ['clients', 'bi-person-lines-fill', 'Clients'],
            ['services', 'bi-wrench-adjustable', 'Services'],
            ['recharges', 'bi-phone', 'Recharges & SIM'],
            ['factures', 'bi-file-earmark-text', 'Factures'],
            ['---', '', 'RAPPORTS'],
            ['ventes', 'bi-receipt', 'Ventes'],
            ['rapports', 'bi-graph-up', 'Rapports'],
            ['---', '', 'ADMIN'],
            ['produits', 'bi-tags', 'Produits'],
            ['gestion_services', 'bi-gear', 'Gérer services'],
            ['gestion_asel', 'bi-sim', 'Gérer offres ASEL'],
            ['franchises_mgmt', 'bi-shop', 'Franchises'],
            ['franchise_locations', 'bi-geo-alt', 'Coordonnées'],
            ['audit_log', 'bi-journal-text', 'Journal d\'audit'],
            ['users', 'bi-people', 'Utilisateurs'],
            ['mon_compte', 'bi-person-gear', 'Mon compte'],
        ];
        foreach ($nav as $idx => $item):
            if ($item[0] === '---'):
                // Check if any item in this section is accessible
                $section_has_items = false;
                for ($si = $idx + 1; $si < count($nav); $si++) {
                    if ($nav[$si][0] === '---') break;
                    if (can($nav[$si][0])) { $section_has_items = true; break; }
                }
                if ($section_has_items):
        ?>
                <div class="px-6 pt-4 pb-1 text-[10px] font-bold text-white/40 tracking-[0.2em]"><?= $item[2] ?></div>
        <?php endif; continue; endif;
            if (!can($item[0])) continue;
            $active = $page === $item[0];
        ?>
        <a href="?page=<?=$item[0]?>" class="flex items-center gap-3 px-6 py-2.5 text-sm transition-all <?= $active ? 'bg-white/15 text-white border-l-4 border-asel' : 'text-white/60 hover:text-white hover:bg-white/5' ?>" onclick="document.getElementById('sidebar').classList.add('-translate-x-full')">
            <i class="bi <?=$item[1]?> text-base w-5 text-center"></i>
            <span><?=$item[2]?></span>
            <?php
            // Badge for pending items
            if ($item[0] === 'demandes' && isAdminOrGest()):
                $pend = queryOne("SELECT COUNT(*) as c FROM demandes_produits WHERE statut='en_attente'");
                if ($pend['c'] > 0): ?>
                <span class="ml-auto bg-red-500 text-white text-xs rounded-full px-2 py-0.5"><?=$pend['c']?></span>
            <?php endif; endif;
            if ($item[0] === 'transferts' && isAdminOrGest()):
                $tp = queryOne("SELECT COUNT(*) as c FROM transferts WHERE statut='en_attente'");
                if ($tp['c'] > 0): ?>
                <span class="ml-auto bg-yellow-500 text-gray-800 text-xs rounded-full px-2 py-0.5"><?=$tp['c']?></span>
            <?php endif; endif; ?>
        </a>
        <?php endforeach; ?>
    </nav>
    
    <!-- Logout -->
    <div class="px-6 py-4 border-t border-white/10 mt-auto">
        <a href="logout.php" class="flex items-center gap-2 text-red-300 hover:text-red-100 text-sm"><i class="bi bi-box-arrow-right"></i> Déconnexion</a>
    </div>
</aside>

<!-- Backdrop for mobile -->
<div class="lg:hidden fixed inset-0 bg-black/50 z-30 hidden" id="backdrop" onclick="document.getElementById('sidebar').classList.add('-translate-x-full');this.classList.add('hidden')"></div>

<!-- Main content -->
<main class="lg:ml-64 pt-14 lg:pt-0 min-h-screen">
    <div class="p-4 lg:p-6 max-w-7xl mx-auto">
    
    <?php if ($flash): ?>
    <div class="mb-4 p-4 rounded-xl flex items-center gap-3 <?=$flash['type']==='success'?'bg-green-50 text-green-800 border border-green-200':'bg-red-50 text-red-800 border border-red-200'?>">
        <i class="bi <?=$flash['type']==='success'?'bi-check-circle-fill':'bi-exclamation-circle-fill'?> text-lg"></i>
        <span class="text-sm font-medium"><?=$flash['msg']?></span>
    </div>
    <?php endif; ?>
    
    <?php // Franchise selector for admin/gestionnaire
    if (can('view_all_franchises') && in_array($page, ['dashboard','stock','ventes','pos','entree','cloture','retours'])): ?>
    <div class="mb-4 inline-flex items-center gap-2 bg-white rounded-full pl-4 pr-2 py-1 shadow-sm border">
        <i class="bi bi-shop text-gray-400"></i>
        <select class="text-sm font-semibold text-asel-dark border-0 bg-transparent focus:ring-0 pr-8" onchange="location='?page=<?=$page?>&fid='+this.value">
            <option value="">Toutes les franchises</option>
            <?php foreach ($franchises as $f): ?>
                <option value="<?=$f['id']?>" <?=$fid==$f['id']?'selected':''?>><?= shortF($f['nom']) ?></option>
            <?php endforeach; ?>
        </select>
    </div>
    <?php endif; ?>

<?php
// =====================================================
// DASHBOARD
// =====================================================
if ($page === 'dashboard'):
    $wf = $fid ? "AND franchise_id=".intval($fid) : "";
    $st = queryOne("SELECT COALESCE(SUM(s.quantite),0) as total, COALESCE(SUM(s.quantite*p.prix_vente),0) as valeur FROM stock s JOIN produits p ON s.produit_id=p.id WHERE 1=1 ".($fid?"AND s.franchise_id=".intval($fid):""));
    $vj = queryOne("SELECT COALESCE(SUM(prix_total),0) as t, COUNT(*) as n FROM ventes WHERE date_vente=CURDATE() $wf");
    $vm = queryOne("SELECT COALESCE(SUM(prix_total),0) as t FROM ventes WHERE MONTH(date_vente)=MONTH(CURDATE()) AND YEAR(date_vente)=YEAR(CURDATE()) $wf");
    $alertes = query("SELECT s.*,p.nom as pnom,p.seuil_alerte,p.marque,f.nom as fnom FROM stock s JOIN produits p ON s.produit_id=p.id JOIN franchises f ON s.franchise_id=f.id WHERE s.quantite<=p.seuil_alerte AND p.actif=1 ".($fid?"AND s.franchise_id=".intval($fid):"")." ORDER BY s.quantite LIMIT 15");
?>

<h1 class="text-2xl font-bold text-asel-dark mb-6 flex items-center gap-2"><i class="bi bi-speedometer2 text-asel"></i> Tableau de bord</h1>

<!-- KPIs -->
<div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
    <div class="bg-white rounded-xl p-5 shadow-sm border-l-4 border-asel hover-lift">
        <div class="text-xs font-semibold text-gray-400 uppercase tracking-wider">Stock total</div>
        <div class="text-2xl font-black text-asel-dark mt-1"><?=number_format($st['total'])?></div>
        <div class="text-xs text-gray-400">unités</div>
    </div>
    <div class="bg-white rounded-xl p-5 shadow-sm border-l-4 border-emerald-500 hover-lift">
        <div class="text-xs font-semibold text-gray-400 uppercase tracking-wider">Valeur stock</div>
        <div class="text-2xl font-black text-asel-dark mt-1"><?=number_format($st['valeur'])?></div>
        <div class="text-xs text-gray-400">DT</div>
    </div>
    <div class="bg-white rounded-xl p-5 shadow-sm border-l-4 border-amber-500 hover-lift">
        <div class="text-xs font-semibold text-gray-400 uppercase tracking-wider">Ventes aujourd'hui</div>
        <div class="text-2xl font-black text-asel-dark mt-1"><?=number_format($vj['t'])?></div>
        <div class="text-xs text-gray-400"><?=$vj['n']?> transaction(s)</div>
    </div>
    <div class="bg-white rounded-xl p-5 shadow-sm border-l-4 border-purple-500 hover-lift">
        <div class="text-xs font-semibold text-gray-400 uppercase tracking-wider">Ventes du mois</div>
        <div class="text-2xl font-black text-asel-dark mt-1"><?=number_format($vm['t'])?></div>
        <div class="text-xs text-gray-400">DT</div>
    </div>
</div>

<!-- Alerts -->
<?php if (count($alertes)): ?>
<div class="bg-white rounded-xl shadow-sm overflow-hidden mb-6">
    <div class="bg-amber-50 border-b border-amber-200 px-4 py-3 flex items-center gap-2 text-amber-800 font-semibold text-sm">
        <i class="bi bi-exclamation-triangle-fill"></i> <?=count($alertes)?> produit(s) en stock bas
    </div>
    <div class="overflow-x-auto">
        <table class="w-full text-sm">
            <thead class="bg-gray-50"><tr class="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider"><th class="px-4 py-3">Franchise</th><th class="px-4 py-3">Produit</th><th class="px-4 py-3">Qté</th><th class="px-4 py-3">Seuil</th></tr></thead>
            <tbody class="divide-y divide-gray-100">
            <?php foreach ($alertes as $a): ?>
                <tr class="<?=$a['quantite']<=0?'bg-red-50':'bg-amber-50/30'?>">
                    <td class="px-4 py-2 text-xs"><?=shortF($a['fnom'])?></td>
                    <td class="px-4 py-2 font-medium"><?=htmlspecialchars($a['pnom'])?></td>
                    <td class="px-4 py-2"><span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold <?=$a['quantite']<=0?'bg-red-100 text-red-800':'bg-amber-100 text-amber-800'?>"><?=$a['quantite']?></span></td>
                    <td class="px-4 py-2 text-gray-400"><?=$a['seuil_alerte']?></td>
                </tr>
            <?php endforeach; ?>
            </tbody>
        </table>
    </div>
</div>
<?php endif; ?>

<!-- Charts -->
<div class="grid lg:grid-cols-2 gap-4 mb-6">
    <div class="bg-white rounded-xl shadow-sm p-4">
        <h3 class="font-semibold text-sm text-asel-dark mb-3"><i class="bi bi-graph-up text-asel"></i> Tendance des ventes (30j)</h3>
        <canvas id="chartSales" height="200"></canvas>
    </div>
    <div class="bg-white rounded-xl shadow-sm p-4">
        <div class="grid grid-cols-2 gap-4">
            <div>
                <h3 class="font-semibold text-sm text-asel-dark mb-3"><i class="bi bi-pie-chart text-asel"></i> Par catégorie</h3>
                <canvas id="chartCats" height="180"></canvas>
            </div>
            <div>
                <h3 class="font-semibold text-sm text-asel-dark mb-3"><i class="bi bi-trophy text-asel"></i> Top produits</h3>
                <canvas id="chartTop" height="180"></canvas>
            </div>
        </div>
    </div>
</div>

<script>
// Auto-refresh quick stats every 60s
setInterval(()=>{
    fetch('api.php?action=quick_stats<?=$fid?"&fid=$fid":""?>').then(r=>r.json()).then(d=>{
        // Could update KPI cards here if needed
    });
}, 60000);

// Load charts via AJAX
fetch('api.php?action=chart_sales&days=30<?=$fid?"&fid=$fid":""?>').then(r=>r.json()).then(data=>{
    new Chart(document.getElementById('chartSales'),{type:'line',data:{labels:data.map(d=>d.date.substring(5)),datasets:[{label:'CA (DT)',data:data.map(d=>d.total),borderColor:'#2AABE2',backgroundColor:'rgba(42,171,226,0.1)',fill:true,tension:0.3}]},options:{responsive:true,plugins:{legend:{display:false}},scales:{y:{beginAtZero:true}}}});
});
fetch('api.php?action=chart_categories<?=$fid?"&fid=$fid":""?>').then(r=>r.json()).then(data=>{
    if(data.length) new Chart(document.getElementById('chartCats'),{type:'doughnut',data:{labels:data.map(d=>d.categorie),datasets:[{data:data.map(d=>d.total),backgroundColor:['#2AABE2','#E63946','#FFD700','#28A745','#FF8C00','#6f42c1','#20c997','#fd7e14']}]},options:{responsive:true,plugins:{legend:{position:'bottom',labels:{font:{size:10}}}}}});
});
fetch('api.php?action=chart_top_products<?=$fid?"&fid=$fid":""?>').then(r=>r.json()).then(data=>{
    if(data.length) new Chart(document.getElementById('chartTop'),{type:'bar',data:{labels:data.map(d=>d.produit.substring(0,15)),datasets:[{label:'CA',data:data.map(d=>d.ca),backgroundColor:'#2AABE2'}]},options:{responsive:true,indexAxis:'y',plugins:{legend:{display:false}},scales:{x:{beginAtZero:true}}}});
});
</script>

<!-- Recent sales -->
<div class="bg-white rounded-xl shadow-sm overflow-hidden">
    <div class="px-4 py-3 border-b font-semibold text-sm text-asel-dark flex items-center gap-2"><i class="bi bi-clock-history text-asel"></i> Dernières ventes</div>
    <div class="overflow-x-auto">
        <table class="w-full text-sm">
            <thead class="bg-gray-50"><tr class="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider"><th class="px-4 py-3">Date</th><th class="px-4 py-3">Franchise</th><th class="px-4 py-3">Produit</th><th class="px-4 py-3">Qté</th><th class="px-4 py-3">Total</th></tr></thead>
            <tbody class="divide-y divide-gray-100">
            <?php foreach (query("SELECT v.*,p.nom as pnom,f.nom as fnom FROM ventes v JOIN produits p ON v.produit_id=p.id JOIN franchises f ON v.franchise_id=f.id WHERE 1=1 $wf ORDER BY v.date_creation DESC LIMIT 10") as $v): ?>
                <tr class="hover:bg-gray-50"><td class="px-4 py-2 text-xs text-gray-400"><?=date('d/m H:i',strtotime($v['date_creation']))?></td><td class="px-4 py-2 text-xs"><?=shortF($v['fnom'])?></td><td class="px-4 py-2"><?=htmlspecialchars($v['pnom'])?></td><td class="px-4 py-2"><?=$v['quantite']?></td><td class="px-4 py-2 font-bold"><?=number_format($v['prix_total'],1)?> DT</td></tr>
            <?php endforeach; ?>
            </tbody>
        </table>
    </div>
</div>

<?php
// =====================================================
// POS — Kept compact, refer to earlier version pattern
// =====================================================
elseif ($page === 'pos'):
    $pos_fid = $fid ?: currentFranchise();
    if (!$pos_fid && can('view_all_franchises')): ?>
<div class="flex justify-between items-center mb-6">
    <h1 class="text-2xl font-bold text-asel-dark flex items-center gap-2"><i class="bi bi-cart3 text-asel"></i> Point de vente</h1>
    <div class="text-xs text-gray-400 hidden lg:block">
        <kbd class="bg-gray-100 px-1.5 py-0.5 rounded text-gray-600">F2</kbd> Scanner &nbsp;
        <kbd class="bg-gray-100 px-1.5 py-0.5 rounded text-gray-600">F8</kbd> Valider &nbsp;
        <kbd class="bg-gray-100 px-1.5 py-0.5 rounded text-gray-600">Esc</kbd> Vider
    </div>
</div>
<div class="bg-white rounded-xl shadow-sm p-8 max-w-md mx-auto text-center">
    <i class="bi bi-shop text-5xl text-asel/30"></i>
    <h3 class="font-bold text-asel-dark mt-4 mb-2">Choisissez une franchise</h3>
    <p class="text-sm text-gray-400 mb-4">Sélectionnez la franchise pour commencer les ventes</p>
    <div class="space-y-2">
    <?php foreach ($franchises as $f): ?>
        <a href="?page=pos&fid=<?=$f['id']?>" class="block bg-asel hover:bg-asel-dark text-white font-semibold py-3 rounded-xl transition-all"><?= shortF($f['nom']) ?></a>
    <?php endforeach; ?>
    </div>
</div>
<?php return; endif;
    $stock = query("SELECT s.*,p.nom as pnom,p.prix_vente,p.reference,p.code_barre,p.marque,c.nom as cnom FROM stock s JOIN produits p ON s.produit_id=p.id JOIN categories c ON p.categorie_id=c.id WHERE s.franchise_id=? AND s.quantite>0 AND p.actif=1 ORDER BY c.nom,p.nom", [$pos_fid]);
?>

<h1 class="text-2xl font-bold text-asel-dark mb-6 flex items-center gap-2"><i class="bi bi-cart3 text-asel"></i> Point de vente</h1>

<div class="grid lg:grid-cols-5 gap-4">
    <!-- Products (3 cols) -->
    <div class="lg:col-span-3 space-y-3">
        <!-- Barcode -->
        <div class="bg-white rounded-xl p-4 shadow-sm">
            <div class="flex gap-2">
                <div class="relative flex-1">
                    <i class="bi bi-upc-scan absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"></i>
                    <input type="text" id="barcodeInput" class="w-full pl-10 pr-4 py-3 border-2 border-dashed border-asel/30 rounded-xl bg-asel-light/30 text-center font-mono text-lg focus:border-asel focus:ring-2 focus:ring-asel/20 outline-none" placeholder="Scanner code-barres..." autofocus onkeypress="if(event.key==='Enter'){scanBarcode(this.value);this.value='';event.preventDefault();}">
                </div>
                <button onclick="toggleCamera()" id="btnCamera" class="px-4 bg-asel text-white rounded-xl hover:bg-asel-dark transition-colors"><i class="bi bi-camera text-xl" id="cameraIcon"></i></button>
            </div>
            <div id="barcodeResult" class="mt-2 text-sm"></div>
            <div id="cameraZone" style="display:none" class="mt-3"><div id="reader" class="rounded-lg overflow-hidden"></div><p class="text-xs text-gray-400 text-center mt-1">Pointez vers le code-barres</p></div>
        </div>
        
        <!-- Search -->
        <div class="relative">
            <i class="bi bi-search absolute left-4 top-1/2 -translate-y-1/2 text-gray-400"></i>
            <input type="text" id="searchProd" class="w-full pl-11 pr-4 py-3 bg-white border border-gray-200 rounded-xl shadow-sm focus:border-asel focus:ring-2 focus:ring-asel/20 outline-none text-sm" placeholder="Rechercher (nom, marque, réf.)..." oninput="filterProducts()">
        </div>
        
        <!-- Category pills -->
        <div class="flex gap-2 flex-wrap">
            <button class="px-3 py-1.5 rounded-full text-xs font-semibold bg-asel text-white" onclick="filterCat('')" id="cat-all">Tous</button>
            <?php $cats_used = array_unique(array_column($stock, 'cnom')); sort($cats_used); foreach ($cats_used as $cat): ?>
                <button class="px-3 py-1.5 rounded-full text-xs font-semibold bg-white text-gray-600 border hover:bg-asel hover:text-white transition-colors" onclick="filterCat('<?=$cat?>')" data-cat="<?=$cat?>"><?=$cat?></button>
            <?php endforeach; ?>
        </div>
        
        <!-- Product list -->
        <div class="space-y-1 max-h-[50vh] overflow-y-auto" id="prodGrid">
            <?php foreach ($stock as $s): ?>
            <div class="bg-white rounded-lg p-3 flex items-center justify-between cursor-pointer hover:bg-asel-light/50 hover:border-asel border border-transparent transition-all"
                 data-search="<?=strtolower($s['pnom'].' '.$s['reference'].' '.$s['code_barre'].' '.$s['marque'])?>"
                 data-cat="<?=$s['cnom']?>" data-barcode="<?=$s['code_barre']?>"
                 onclick="addToCart(<?=$s['produit_id']?>,'<?=addslashes($s['pnom'])?>',<?=$s['prix_vente']?>,<?=$s['quantite']?>)">
                <div>
                    <div class="font-semibold text-sm text-asel-dark"><?=htmlspecialchars($s['pnom'])?></div>
                    <div class="text-xs text-gray-400"><?=$s['marque']?> · <?=$s['reference']?></div>
                </div>
                <div class="text-right shrink-0">
                    <div class="font-bold text-asel"><?=number_format($s['prix_vente'],1)?> DT</div>
                    <div class="text-xs text-gray-400">Stock: <?=$s['quantite']?></div>
                </div>
            </div>
            <?php endforeach; ?>
        </div>
    </div>
    
    <!-- Cart (2 cols) -->
    <div class="lg:col-span-2">
        <div class="bg-white rounded-xl shadow-sm sticky top-4 overflow-hidden">
            <div class="bg-asel-dark text-white px-4 py-3 font-bold text-sm flex items-center gap-2">
                <i class="bi bi-cart3"></i> Panier <span id="cartCount" class="bg-white/20 text-xs rounded-full px-2 py-0.5 ml-auto">0</span>
            </div>
            <div id="cartBody" class="p-4 min-h-[200px] max-h-[40vh] overflow-y-auto">
                <p class="text-center text-gray-300 py-8 text-sm">🛒 Scannez ou cliquez</p>
            </div>
            <div class="p-4 border-t bg-gray-50">
                <div class="flex justify-between items-center mb-3">
                    <span class="font-bold text-lg text-asel-dark">TOTAL</span>
                    <span class="text-2xl font-black text-asel" id="cartTotal">0 DT</span>
                </div>
                <!-- Client -->
                <select id="clientSelect" class="ts-select w-full text-sm mb-2" data-placeholder="🔍 Rechercher un client..." onchange="document.getElementById('formClientId').value=this.value;toggleEcheance()">
                    <option value="" data-type="passager">🚶 Client passager</option>
                    <?php $pos_clients=query("SELECT * FROM clients WHERE actif=1 ORDER BY type_client,nom"); foreach($pos_clients as $pc): $ico=match($pc['type_client']){'boutique'=>'🏪','entreprise'=>'🏢',default=>'👤'}; ?>
                    <option value="<?=$pc['id']?>" data-type="<?=$pc['type_client']?>"><?=$ico?> <?=htmlspecialchars($pc['nom'].' '.($pc['prenom']??''))?></option>
                    <?php endforeach; ?>
                </select>
                <!-- Type + Paiement -->
                <div class="grid grid-cols-2 gap-2 mb-2">
                    <select id="typeFacture" class="border-2 border-gray-200 rounded-lg px-2 py-1.5 text-xs" onchange="document.getElementById('formTypeFacture').value=this.value">
                        <option value="ticket">🧾 Ticket</option><option value="facture">📄 Facture</option><option value="devis">📝 Devis</option>
                    </select>
                    <select id="modePaiement" class="border-2 border-gray-200 rounded-lg px-2 py-1.5 text-xs" onchange="document.getElementById('formModePaiement').value=this.value;toggleEcheance()">
                        <option value="especes">💵 Espèces</option><option value="carte">💳 Carte</option><option value="virement">🏦 Virement</option><option value="cheque">📋 Chèque</option><option value="echeance">📅 Par lot</option>
                    </select>
                </div>
                <!-- Montant reçu -->
                <div id="montantRecuDiv" class="mb-2 flex gap-2 items-center">
                    <input type="number" id="montantRecu" step="0.5" class="flex-1 border-2 border-gray-200 rounded-lg px-3 py-1.5 text-xs" placeholder="Montant reçu" oninput="calcMonnaie()">
                    <span class="text-xs font-bold text-green-600" id="monnaieDisplay"></span>
                </div>
                <!-- Echeance -->
                <div id="echeanceDiv" class="mb-2 hidden bg-yellow-50 rounded-lg p-2 text-xs">
                    <div class="grid grid-cols-3 gap-1">
                        <div><label class="font-bold">Nb lots</label><input type="number" id="nbEch" min="2" max="24" value="3" class="w-full border rounded px-1 py-1 text-xs"></div>
                        <div><label class="font-bold">Jours</label><input type="number" id="intervJ" min="7" max="90" value="30" class="w-full border rounded px-1 py-1 text-xs"></div>
                        <div><label class="font-bold">1ère date</label><input type="date" id="premD" class="w-full border rounded px-1 py-1 text-xs" value="<?=date('Y-m-d',strtotime('+30 days'))?>"></div>
                    </div>
                </div>
                <form method="POST" id="saleForm">
                    <input type="hidden" name="_csrf" value="<?=$csrf?>">
                    <input type="hidden" name="action" value="vente">
                    <input type="hidden" name="franchise_id" value="<?=$pos_fid?>">
                    <input type="hidden" name="items" id="cartItems" value="[]">
                    <input type="hidden" name="client_id" id="formClientId" value="">
                    <input type="hidden" name="type_facture" id="formTypeFacture" value="ticket">
                    <input type="hidden" name="mode_paiement" id="formModePaiement" value="especes">
                    <input type="hidden" name="montant_recu" id="formMontantRecu" value="0">
                    <input type="hidden" name="nb_echeances" id="formNbEch" value="3">
                    <input type="hidden" name="interv_jours" id="formIntervJ" value="30">
                    <input type="hidden" name="prem_date" id="formPremD" value="">
                    <button type="submit" class="w-full bg-asel hover:bg-asel-dark text-white font-bold py-3 rounded-xl transition-all disabled:opacity-40 disabled:cursor-not-allowed" id="btnVente" disabled onclick="prepareSubmit()">
                        <i class="bi bi-check-circle"></i> VALIDER
                    </button>
                </form>
                <button class="w-full mt-2 text-xs text-gray-400 hover:text-red-500 py-1" onclick="clearCart()">🗑️ Vider</button>
            </div>
        </div>
    </div>
</div>

<script>
let cart=[];
function addToCart(id,nom,prix,max){const e=cart.find(c=>c.id===id);if(e){if(e.qty<max)e.qty++}else cart.push({id,nom,prix,qty:1,maxQty:max,remise:0});renderCart();}
function scanBarcode(code){if(!code)return;const el=document.querySelector(`[data-barcode="${code}"]`);if(el){el.click();document.getElementById('barcodeResult').innerHTML='<span class="text-green-600"><i class="bi bi-check-circle"></i> Trouvé!</span>'}else{document.getElementById('barcodeResult').innerHTML='<span class="text-red-500"><i class="bi bi-x-circle"></i> Non trouvé</span>'}setTimeout(()=>document.getElementById('barcodeResult').innerHTML='',2000);}
function removeFromCart(i){cart.splice(i,1);renderCart();}
function clearCart(){cart=[];renderCart();}
function updateQty(i,v){cart[i].qty=Math.min(Math.max(1,parseInt(v)||1),cart[i].maxQty);renderCart();}
function updateRemise(i,v){cart[i].remise=Math.max(0,parseFloat(v)||0);renderCart();}
function renderCart(){const b=document.getElementById('cartBody');document.getElementById('cartCount').textContent=cart.length;if(!cart.length){b.innerHTML='<p class="text-center text-gray-300 py-8 text-sm">🛒 Scannez ou cliquez</p>';document.getElementById('cartTotal').textContent='0 DT';document.getElementById('btnVente').disabled=true;return;}let h='<div class="space-y-2">',t=0;cart.forEach((c,i)=>{const l=c.qty*c.prix-c.remise;const lineTotal=Math.max(0,l);t+=lineTotal;h+=`<div class="flex items-center gap-2 pb-2 border-b border-gray-100"><div class="flex-1 min-w-0"><div class="text-sm font-medium truncate">${c.nom}</div><div class="text-xs text-gray-400">${c.prix} DT × ${c.qty}</div></div><input type="number" value="${c.qty}" min="1" max="${c.maxQty}" class="w-12 text-center text-sm border rounded-lg py-1" onchange="updateQty(${i},this.value)"><div class="flex items-center gap-1"><span class="text-xs text-gray-400">-</span><input type="number" value="${c.remise}" min="0" step="0.5" class="w-16 text-center text-xs border rounded-lg py-1" onchange="updateRemise(${i},this.value)" placeholder="Remise"><span class="text-xs text-gray-400">DT</span></div><div class="text-sm font-bold w-16 text-right">${lineTotal.toFixed(1)}</div><button class="text-red-400 hover:text-red-600 p-1" onclick="removeFromCart(${i})"><i class="bi bi-trash text-sm"></i></button></div>`;});h+='</div>';b.innerHTML=h;document.getElementById('cartTotal').textContent=t.toFixed(1)+' DT';document.getElementById('cartItems').value=JSON.stringify(cart);document.getElementById('btnVente').disabled=false;}
function filterProducts(){const q=document.getElementById('searchProd').value.toLowerCase();document.querySelectorAll('#prodGrid > div').forEach(el=>{el.style.display=el.dataset.search.includes(q)?'':'none'});}
function filterCat(cat){document.querySelectorAll('#prodGrid > div').forEach(el=>{el.style.display=(!cat||el.dataset.cat===cat)?'':'none'});document.querySelectorAll('[data-cat]').forEach(b=>{b.className='px-3 py-1.5 rounded-full text-xs font-semibold bg-white text-gray-600 border hover:bg-asel hover:text-white transition-colors'});if(cat){const btn=document.querySelector(`[data-cat="${cat}"]`);if(btn)btn.className='px-3 py-1.5 rounded-full text-xs font-semibold bg-asel text-white';document.getElementById('cat-all').className='px-3 py-1.5 rounded-full text-xs font-semibold bg-white text-gray-600 border'}else{document.getElementById('cat-all').className='px-3 py-1.5 rounded-full text-xs font-semibold bg-asel text-white'}}
function toggleEcheance(){const mp=document.getElementById('modePaiement').value;const mr=document.getElementById('montantRecuDiv');const ed=document.getElementById('echeanceDiv');if(mp==='echeance'){mr.classList.add('hidden');ed.classList.remove('hidden');}else{mr.classList.remove('hidden');ed.classList.add('hidden');}}
function calcMonnaie(){const recu=parseFloat(document.getElementById('montantRecu').value)||0;const total=parseFloat(document.getElementById('cartTotal').textContent)||0;const monnaie=recu-total;document.getElementById('monnaieDisplay').textContent=monnaie>0?'Monnaie: '+monnaie.toFixed(1)+' DT':'';}
function prepareSubmit(){document.getElementById('formMontantRecu').value=document.getElementById('montantRecu').value||'0';document.getElementById('formNbEch').value=document.getElementById('nbEch')?.value||'3';document.getElementById('formIntervJ').value=document.getElementById('intervJ')?.value||'30';document.getElementById('formPremD').value=document.getElementById('premD')?.value||'';}
document.addEventListener('keydown',e=>{
    const bi=document.getElementById('barcodeInput');
    if(e.key==='F2'){e.preventDefault();if(bi)bi.focus();return;}
    if(e.key==='F8'){e.preventDefault();const btn=document.getElementById('btnVente');if(btn&&!btn.disabled){prepareSubmit();document.getElementById('saleForm').submit();}return;}
    if(e.key==='Escape'&&cart.length){e.preventDefault();clearCart();return;}
    if(bi&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName))bi.focus();
});
let html5QrcodeScanner=null,cameraActive=false;
function toggleCamera(){const z=document.getElementById('cameraZone'),ic=document.getElementById('cameraIcon');if(cameraActive){if(html5QrcodeScanner){html5QrcodeScanner.stop().then(()=>{html5QrcodeScanner.clear();html5QrcodeScanner=null}).catch(e=>{})}z.style.display='none';ic.className='bi bi-camera';cameraActive=false}else{z.style.display='block';ic.className='bi bi-camera-video-off';cameraActive=true;html5QrcodeScanner=new Html5Qrcode("reader");html5QrcodeScanner.start({facingMode:"environment"},{fps:10,qrbox:{width:250,height:100},aspectRatio:2.0},(t)=>{scanBarcode(t);html5QrcodeScanner.pause(true);setTimeout(()=>{if(cameraActive&&html5QrcodeScanner)try{html5QrcodeScanner.resume()}catch(e){}},1500)},(e)=>{}).catch(e=>{document.getElementById('barcodeResult').innerHTML='<span class="text-red-500">Caméra non disponible</span>';z.style.display='none';ic.className='bi bi-camera';cameraActive=false})}}
</script>

<?php
// =====================================================
// STOCK
// =====================================================
elseif ($page === 'stock'):
    if (!$fid && can('view_all_franchises')): ?>
<h1 class="text-2xl font-bold text-asel-dark mb-6 flex items-center gap-2"><i class="bi bi-box-seam text-asel"></i> Stock</h1>
<div class="bg-white rounded-xl shadow-sm p-8 max-w-md mx-auto text-center">
    <i class="bi bi-shop text-5xl text-asel/30"></i>
    <h3 class="font-bold text-asel-dark mt-4 mb-2">Choisissez une franchise</h3>
    <div class="space-y-2 mt-4">
    <?php foreach ($franchises as $f): ?>
        <a href="?page=stock&fid=<?=$f['id']?>" class="block bg-asel hover:bg-asel-dark text-white font-semibold py-3 rounded-xl transition-all"><?= shortF($f['nom']) ?></a>
    <?php endforeach; ?>
    </div>
</div>
<?php return; endif;
    $stock = query("SELECT s.*,p.nom as pnom,p.prix_vente,p.prix_achat,p.reference,p.marque,c.nom as cnom,f.nom as fnom FROM stock s JOIN produits p ON s.produit_id=p.id JOIN categories c ON p.categorie_id=c.id JOIN franchises f ON s.franchise_id=f.id WHERE p.actif=1 ".($fid?"AND s.franchise_id=".intval($fid):"")." ORDER BY f.nom,c.nom,p.nom");
?>
<div class="flex justify-between items-center mb-6">
    <h1 class="text-2xl font-bold text-asel-dark flex items-center gap-2"><i class="bi bi-box-seam text-asel"></i> État du stock</h1>
    <a href="api.php?action=export_stock<?=$fid?"&fid=$fid":""?>" class="bg-white border-2 border-asel text-asel font-semibold px-4 py-2 rounded-xl text-sm hover:bg-asel hover:text-white transition-colors"><i class="bi bi-download"></i> Export CSV</a>
</div>
<div class="bg-white rounded-xl shadow-sm overflow-hidden">
    <div class="overflow-x-auto">
        <table class="w-full text-sm">
            <thead><tr class="bg-asel-dark text-white text-xs uppercase tracking-wider"><th class="px-3 py-3 text-left">Franchise</th><th class="px-3 py-3 text-left">Catégorie</th><th class="px-3 py-3 text-left">Produit</th><th class="px-3 py-3 text-left hidden sm:table-cell">Marque</th><th class="px-3 py-3 text-center">Qté</th><th class="px-3 py-3 text-right">P.V.</th><th class="px-3 py-3 text-right hidden sm:table-cell">Valeur</th><?php if(isAdmin()):?><th class="px-3 py-3"></th><?php endif;?></tr></thead>
            <tbody class="divide-y divide-gray-100"><?php $tq=0;$tv=0; foreach ($stock as $s): $v=$s['quantite']*$s['prix_vente'];$tq+=$s['quantite'];$tv+=$v; ?>
                <tr class="hover:bg-gray-50 <?=$s['quantite']<=0?'bg-red-50/50':($s['quantite']<=3?'bg-amber-50/30':'')?>">
                    <td class="px-3 py-2 text-xs text-gray-500"><?=shortF($s['fnom'])?></td>
                    <td class="px-3 py-2 text-xs"><?=$s['cnom']?></td>
                    <td class="px-3 py-2 font-medium"><?=htmlspecialchars($s['pnom'])?></td>
                    <td class="px-3 py-2 text-xs text-gray-400 hidden sm:table-cell"><?=$s['marque']?></td>
                    <td class="px-3 py-2 text-center"><span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold <?=$s['quantite']<=0?'bg-red-100 text-red-800':($s['quantite']<=3?'bg-amber-100 text-amber-800':'bg-green-100 text-green-800')?>"><?=$s['quantite']?></span></td>
                    <td class="px-3 py-2 text-right"><?=number_format($s['prix_vente'],1)?></td>
                    <td class="px-3 py-2 text-right font-medium hidden sm:table-cell"><?=number_format($v,0)?></td>
                    <?php if(isAdmin()):?><td class="px-3 py-2">
                        <?php if($s['quantite'] <= 0): ?>
                        <form method="POST" class="inline" onsubmit="return confirm('Désactiver ce produit?')"><input type="hidden" name="_csrf" value="<?=$csrf?>"><input type="hidden" name="action" value="toggle_produit"><input type="hidden" name="produit_id" value="<?=$s['produit_id']?>">
                        <button class="text-red-500 hover:text-red-700 text-xs" title="Désactiver ce produit (hors stock)"><i class="bi bi-eye-slash"></i></button></form>
                        <?php endif; ?>
                    </td><?php endif;?>
                </tr>
            <?php endforeach; ?></tbody>
            <tfoot><tr class="bg-asel-dark text-white font-bold"><td colspan="4" class="px-3 py-3">TOTAL</td><td class="px-3 py-3 text-center"><?=number_format($tq)?></td><td class="px-3 py-3"></td><td class="px-3 py-3 text-right hidden sm:table-cell"><?=number_format($tv)?> DT</td><?php if(isAdmin()):?><td></td><?php endif;?></tr></tfoot>
        </table>
    </div>
</div>

<?php
// =====================================================
// ENTREE STOCK
// =====================================================
elseif ($page === 'entree'):
    $e_fid = $fid ?: currentFranchise();
    if (!$e_fid && can('view_all_franchises')): ?>
<h1 class="text-2xl font-bold text-asel-dark mb-6 flex items-center gap-2"><i class="bi bi-box-arrow-in-down text-asel"></i> Entrée de stock</h1>
<div class="bg-white rounded-xl shadow-sm p-8 max-w-md mx-auto text-center">
    <i class="bi bi-shop text-5xl text-asel/30"></i>
    <h3 class="font-bold text-asel-dark mt-4 mb-2">Choisissez une franchise</h3>
    <div class="space-y-2 mt-4"><?php foreach ($franchises as $f): ?>
        <a href="?page=entree&fid=<?=$f['id']?>" class="block bg-asel hover:bg-asel-dark text-white font-semibold py-3 rounded-xl transition-all"><?=shortF($f['nom'])?></a>
    <?php endforeach; ?></div>
</div>
<?php return; endif;
?>
<h1 class="text-2xl font-bold text-asel-dark mb-6 flex items-center gap-2"><i class="bi bi-box-arrow-in-down text-asel"></i> Entrée de stock</h1>
<div class="form-card max-w-lg">
    <h3><i class="bi bi-box-arrow-in-down text-asel"></i> Nouvelle entrée de stock</h3>
    <form method="POST">
        <input type="hidden" name="_csrf" value="<?=$csrf?>"><input type="hidden" name="action" value="entree_stock">
        <?php if (can('view_all_franchises')): ?>
        <div class="mb-4"><label class="form-label">Franchise</label><select name="franchise_id" class="form-input"><?php foreach ($franchises as $f): ?><option value="<?=$f['id']?>" <?=$e_fid==$f['id']?'selected':''?>><?=shortF($f['nom'])?></option><?php endforeach; ?></select></div>
        <?php else: ?><input type="hidden" name="franchise_id" value="<?=$e_fid?>"><?php endif; ?>
        <div class="mb-4"><label class="form-label">Produit</label><select name="produit_id" class="ts-select w-full" data-placeholder="🔍 Rechercher un produit..."><?php foreach ($produits as $p): ?><option value="<?=$p['id']?>"><?=$p['nom']?> (<?=$p['cat_nom']?>)</option><?php endforeach; ?></select></div>
        <div class="form-row form-row-2">
            <div><label class="form-label">Quantité</label><input type="number" name="quantite" min="1" value="1" required class="form-input"></div>
            <div><label class="form-label">Note</label><input type="text" name="note" class="form-input" placeholder="Optionnel..."></div>
        </div>
        <button type="submit" class="btn-submit"><i class="bi bi-check-circle"></i> Enregistrer l'entrée</button>
    </form>
</div>

<?php
// =====================================================
// DEMANDES
// =====================================================
elseif ($page === 'demandes'):
    $is_franchise = (userRole() === 'franchise');
    $can_treat = isAdminOrGest();
    $demandes = query("SELECT d.*,p.nom as pnom,f.nom as fnom,u.nom_complet as demandeur FROM demandes_produits d LEFT JOIN produits p ON d.produit_id=p.id JOIN franchises f ON d.franchise_id=f.id LEFT JOIN utilisateurs u ON d.demandeur_id=u.id ".($is_franchise?"WHERE d.franchise_id=".intval(currentFranchise()):"")." ORDER BY FIELD(d.statut,'en_attente','en_cours','livre','rejete'), d.date_demande DESC LIMIT 50");
?>
<h1 class="text-2xl font-bold text-asel-dark mb-6 flex items-center gap-2"><i class="bi bi-megaphone text-asel"></i> Demandes de produits</h1>

<?php if ($is_franchise): ?>
<div class="form-card max-w-lg mb-6">
    <h3><i class="bi bi-megaphone text-asel"></i> Nouvelle demande au stock central</h3>
    <form method="POST">
        <input type="hidden" name="_csrf" value="<?=$csrf?>"><input type="hidden" name="action" value="demande_produit"><input type="hidden" name="franchise_id" value="<?=currentFranchise()?>">
        <div><label class="text-sm font-semibold text-gray-700">Produit existant</label><select name="produit_id" class="ts-select w-full" data-placeholder="🔍 Rechercher un produit..."><option value="">— Ou écrire ci-dessous —</option><?php foreach ($produits as $p): ?><option value="<?=$p['id']?>"><?=$p['nom']?> (<?=$p['cat_nom']?>)</option><?php endforeach; ?></select></div>
        <div><label class="text-sm font-semibold text-gray-700">Ou nouveau produit</label><input name="nom_produit" class="w-full border-2 border-gray-200 rounded-xl px-4 py-2.5 focus:border-asel outline-none text-sm" placeholder="Nom du produit"></div>
        <div class="grid grid-cols-2 gap-3">
            <div><label class="text-sm font-semibold text-gray-700">Quantité</label><input name="quantite" type="number" min="1" value="1" required class="w-full border-2 border-gray-200 rounded-xl px-4 py-2.5 outline-none text-sm"></div>
            <div><label class="text-sm font-semibold text-gray-700">Urgence</label><select name="urgence" class="w-full border-2 border-gray-200 rounded-xl px-4 py-2.5 outline-none text-sm"><option value="normal">🟢 Normal</option><option value="urgent">🟡 Urgent</option><option value="critique">🔴 Critique</option></select></div>
        </div>
        <div><input name="note" class="w-full border-2 border-gray-200 rounded-xl px-4 py-2.5 outline-none text-sm" placeholder="Détails..."></div>
        <div class="mt-4"><button type="submit" class="btn-submit"><i class="bi bi-send"></i> Envoyer la demande</button></div>
    </form>
</div>
<?php endif; ?>

<div class="bg-white rounded-xl shadow-sm overflow-hidden">
    <div class="overflow-x-auto"><table class="w-full text-sm">
        <thead><tr class="bg-asel-dark text-white text-xs uppercase tracking-wider"><th class="px-3 py-3 text-left">Date</th><th class="px-3 py-3 text-left">Franchise</th><th class="px-3 py-3 text-left">Produit</th><th class="px-3 py-3">Qté</th><th class="px-3 py-3">Urgence</th><th class="px-3 py-3">Statut</th><?php if($can_treat):?><th class="px-3 py-3">Action</th><?php endif;?></tr></thead>
        <tbody class="divide-y divide-gray-100"><?php foreach ($demandes as $d): $ub=['normal'=>'bg-green-100 text-green-800','urgent'=>'bg-yellow-100 text-yellow-800','critique'=>'bg-red-100 text-red-800']; $sb=['en_attente'=>'bg-gray-100 text-gray-800','en_cours'=>'bg-blue-100 text-blue-800','livre'=>'bg-green-100 text-green-800','rejete'=>'bg-red-100 text-red-800']; ?>
            <tr class="hover:bg-gray-50"><td class="px-3 py-2 text-xs text-gray-400"><?=date('d/m H:i',strtotime($d['date_demande']))?></td><td class="px-3 py-2 text-xs"><?=shortF($d['fnom'])?></td><td class="px-3 py-2 font-medium"><?=$d['pnom']?:$d['nom_produit']?:'—'?></td><td class="px-3 py-2 text-center"><?=$d['quantite']?></td>
            <td class="px-3 py-2 text-center"><span class="inline-flex px-2 py-0.5 rounded text-xs font-medium <?=$ub[$d['urgence']]??''?>"><?=$d['urgence']?></span></td>
            <td class="px-3 py-2 text-center"><span class="inline-flex px-2 py-0.5 rounded text-xs font-medium <?=$sb[$d['statut']]??''?>"><?=$d['statut']?></span></td>
            <?php if($can_treat):?><td class="px-3 py-2"><?php if($d['statut']==='en_attente'):?>
                <form method="POST" class="flex gap-1"><input type="hidden" name="_csrf" value="<?=$csrf?>"><input type="hidden" name="action" value="traiter_demande"><input type="hidden" name="demande_id" value="<?=$d['id']?>"><input name="reponse" class="border rounded px-2 py-1 text-xs w-20" placeholder="Note">
                <button name="decision" value="livre" class="bg-green-500 text-white px-2 py-1 rounded text-xs" title="Livré">📦</button>
                <button name="decision" value="en_cours" class="bg-blue-500 text-white px-2 py-1 rounded text-xs" title="En cours">⏳</button>
                <button name="decision" value="rejete" class="bg-red-500 text-white px-2 py-1 rounded text-xs" title="Rejeté">❌</button></form>
            <?php else:?>—<?php endif;?></td><?php endif;?></tr>
        <?php endforeach; ?></tbody>
    </table></div>
</div>

<?php
// =====================================================
// VENTES
// =====================================================
elseif ($page === 'ventes'):
    $d1=$_GET['d1']??date('Y-m-01');$d2=$_GET['d2']??date('Y-m-d');
    $ventes=query("SELECT v.*,p.nom as pnom,f.nom as fnom,u.nom_complet as vendeur FROM ventes v JOIN produits p ON v.produit_id=p.id JOIN franchises f ON v.franchise_id=f.id LEFT JOIN utilisateurs u ON v.utilisateur_id=u.id WHERE v.date_vente BETWEEN ? AND ? ".($fid?"AND v.franchise_id=".intval($fid):"")." ORDER BY v.date_creation DESC LIMIT 200",[$d1,$d2]);
    $tca=array_sum(array_column($ventes,'prix_total'));$tart=array_sum(array_column($ventes,'quantite'));
?>
<div class="flex justify-between items-center mb-6">
    <h1 class="text-2xl font-bold text-asel-dark flex items-center gap-2"><i class="bi bi-receipt text-asel"></i> Historique des ventes</h1>
    <a href="api.php?action=export_ventes&d1=<?=$d1?>&d2=<?=$d2?><?=$fid?"&fid=$fid":""?>" class="bg-white border-2 border-asel text-asel font-semibold px-4 py-2 rounded-xl text-sm hover:bg-asel hover:text-white transition-colors"><i class="bi bi-download"></i> Export CSV</a>
</div>
<form class="flex flex-wrap gap-2 mb-4"><input type="hidden" name="page" value="ventes"><input type="date" name="d1" value="<?=$d1?>" class="border-2 border-gray-200 rounded-xl px-3 py-2 text-sm"><input type="date" name="d2" value="<?=$d2?>" class="border-2 border-gray-200 rounded-xl px-3 py-2 text-sm"><button class="bg-asel text-white px-4 py-2 rounded-xl text-sm font-semibold">Filtrer</button></form>
<div class="grid grid-cols-3 gap-4 mb-4">
    <div class="bg-white rounded-xl p-4 shadow-sm border-l-4 border-asel"><div class="text-xs text-gray-400 uppercase font-semibold">CA</div><div class="text-xl font-black text-asel-dark"><?=number_format($tca)?> DT</div></div>
    <div class="bg-white rounded-xl p-4 shadow-sm border-l-4 border-emerald-500"><div class="text-xs text-gray-400 uppercase font-semibold">Articles</div><div class="text-xl font-black text-asel-dark"><?=number_format($tart)?></div></div>
    <div class="bg-white rounded-xl p-4 shadow-sm border-l-4 border-purple-500"><div class="text-xs text-gray-400 uppercase font-semibold">Transactions</div><div class="text-xl font-black text-asel-dark"><?=count($ventes)?></div></div>
</div>
<div class="bg-white rounded-xl shadow-sm overflow-hidden"><div class="overflow-x-auto"><table class="w-full text-sm">
    <thead><tr class="bg-asel-dark text-white text-xs uppercase tracking-wider"><th class="px-3 py-3 text-left">Date</th><th class="px-3 py-3 text-left">Franchise</th><th class="px-3 py-3 text-left">Produit</th><th class="px-3 py-3">Qté</th><th class="px-3 py-3 text-right">Total</th><th class="px-3 py-3 text-left hidden sm:table-cell">Vendeur</th></tr></thead>
    <tbody class="divide-y divide-gray-100"><?php foreach($ventes as $v):?><tr class="hover:bg-gray-50"><td class="px-3 py-2 text-xs text-gray-400"><?=date('d/m H:i',strtotime($v['date_creation']))?></td><td class="px-3 py-2 text-xs"><?=shortF($v['fnom'])?></td><td class="px-3 py-2"><?=htmlspecialchars($v['pnom'])?></td><td class="px-3 py-2 text-center"><?=$v['quantite']?></td><td class="px-3 py-2 text-right font-bold"><?=number_format($v['prix_total'],1)?></td><td class="px-3 py-2 text-xs text-gray-400 hidden sm:table-cell"><?=$v['vendeur']?></td></tr><?php endforeach;?></tbody>
</table></div></div>

<?php
// =====================================================
// TRANSFERTS / RETOURS / CLOTURE / RAPPORTS / PRODUITS / FRANCHISES / USERS
// Same pattern — keeping compact for file size. Let me include remaining pages:
// =====================================================
elseif ($page === 'transferts'): $transferts=query("SELECT t.*,p.nom as pnom,fs.nom as src,fd.nom as dst FROM transferts t JOIN produits p ON t.produit_id=p.id JOIN franchises fs ON t.franchise_source=fs.id JOIN franchises fd ON t.franchise_dest=fd.id ORDER BY t.date_demande DESC LIMIT 50"); ?>
<h1 class="text-2xl font-bold text-asel-dark mb-6 flex items-center gap-2"><i class="bi bi-arrow-left-right text-asel"></i> Transferts</h1>
<div class="grid lg:grid-cols-2 gap-6">
<div class="form-card"><h3><i class="bi bi-arrow-left-right text-asel"></i> Demander un transfert</h3>
<form method="POST"><input type="hidden" name="_csrf" value="<?=$csrf?>"><input type="hidden" name="action" value="transfert">
<div><label class="text-sm font-semibold">De</label><select name="source" class="w-full border-2 rounded-xl px-4 py-2.5 text-sm"><?php foreach($franchises as $f):?><option value="<?=$f['id']?>"><?=shortF($f['nom'])?></option><?php endforeach;?></select></div>
<div><label class="text-sm font-semibold">Vers</label><select name="dest" class="w-full border-2 rounded-xl px-4 py-2.5 text-sm"><?php foreach($franchises as $f):?><option value="<?=$f['id']?>"><?=shortF($f['nom'])?></option><?php endforeach;?></select></div>
<div><label class="text-sm font-semibold">Produit</label><select name="produit_id" class="ts-select w-full" data-placeholder="🔍 Produit..."><?php foreach($produits as $p):?><option value="<?=$p['id']?>"><?=$p['nom']?> (<?=$p['cat_nom']?>)</option><?php endforeach;?></select></div>
<div class="grid grid-cols-2 gap-3"><div><label class="text-sm font-semibold">Qté</label><input name="quantite" type="number" min="1" value="1" class="w-full border-2 rounded-xl px-4 py-2.5 text-sm"></div><div><label class="text-sm font-semibold">Note</label><input name="note" class="w-full border-2 rounded-xl px-4 py-2.5 text-sm"></div></div>
<div class="mt-4"><button type="submit" class="btn-submit"><i class="bi bi-send"></i> Envoyer la demande</button></div></form></div>
<div class="bg-white rounded-xl shadow-sm overflow-hidden"><div class="px-4 py-3 border-b font-semibold text-sm">Historique</div><div class="overflow-x-auto"><table class="w-full text-sm"><thead><tr class="bg-gray-50 text-xs"><th class="px-3 py-2 text-left">Produit</th><th class="px-3 py-2 text-left">Trajet</th><th class="px-3 py-2">Qté</th><th class="px-3 py-2">Statut</th><?php if(isAdminOrGest()):?><th class="px-3 py-2">Act.</th><?php endif;?></tr></thead>
<tbody class="divide-y"><?php foreach($transferts as $t):$sb=['en_attente'=>'bg-gray-100','accepte'=>'bg-green-100 text-green-800','rejete'=>'bg-red-100 text-red-800'];?><tr class="hover:bg-gray-50"><td class="px-3 py-2 font-medium"><?=htmlspecialchars($t['pnom'])?></td><td class="px-3 py-2 text-xs"><?=shortF($t['src'])?> → <?=shortF($t['dst'])?></td><td class="px-3 py-2 text-center"><?=$t['quantite']?></td><td class="px-3 py-2 text-center"><span class="inline-flex px-2 py-0.5 rounded text-xs font-medium <?=$sb[$t['statut']]??''?>"><?=$t['statut']?></span></td>
<?php if(isAdminOrGest()):?><td class="px-3 py-2"><?php if($t['statut']==='en_attente'):?><form method="POST" class="flex gap-1"><input type="hidden" name="_csrf" value="<?=$csrf?>"><input type="hidden" name="action" value="transfert_valider"><input type="hidden" name="tid" value="<?=$t['id']?>"><button name="decision" value="accept" class="bg-green-500 text-white px-2 py-1 rounded text-xs">✅</button><button name="decision" value="reject" class="bg-red-500 text-white px-2 py-1 rounded text-xs">❌</button></form><?php endif;?></td><?php endif;?></tr><?php endforeach;?></tbody></table></div></div></div>

<?php elseif ($page === 'retours'): $r_fid=$fid?:(currentFranchise()?:($franchises[0]['id']??1)); ?>
<h1 class="text-2xl font-bold text-asel-dark mb-6 flex items-center gap-2"><i class="bi bi-arrow-counterclockwise text-asel"></i> Retours</h1>
<div class="form-card max-w-lg"><h3><i class="bi bi-arrow-counterclockwise text-amber-500"></i> Nouveau retour / échange</h3><form method="POST"><input type="hidden" name="_csrf" value="<?=$csrf?>"><input type="hidden" name="action" value="retour"><input type="hidden" name="franchise_id" value="<?=$r_fid?>">
<div><label class="text-sm font-semibold">Produit</label><select name="produit_id" class="ts-select w-full" data-placeholder="🔍 Produit..."><?php foreach($produits as $p):?><option value="<?=$p['id']?>"><?=$p['nom']?> (<?=$p['cat_nom']?>)</option><?php endforeach;?></select></div>
<div class="grid grid-cols-2 gap-3"><div><label class="text-sm font-semibold">Qté</label><input name="quantite" type="number" min="1" value="1" class="w-full border-2 rounded-xl px-4 py-2.5 text-sm"></div><div><label class="text-sm font-semibold">Type</label><select name="type_retour" class="w-full border-2 rounded-xl px-4 py-2.5 text-sm"><option value="retour">↩️ Retour</option><option value="echange">🔄 Échange</option></select></div></div>
<div><input name="raison" class="w-full border-2 rounded-xl px-4 py-2.5 text-sm" placeholder="Raison..."></div>
<div class="mt-4"><button type="submit" class="btn-submit" style="background:#f59e0b"><i class="bi bi-arrow-counterclockwise"></i> Enregistrer le retour</button></div></form></div>

<?php elseif ($page === 'cloture'): $cl_fid=$fid?:(currentFranchise()?:($franchises[0]['id']??1)); ?>
<h1 class="text-2xl font-bold text-asel-dark mb-6 flex items-center gap-2"><i class="bi bi-calendar-check text-asel"></i> Clôture journalière</h1>
<div class="form-card max-w-lg"><h3><i class="bi bi-calendar-check text-asel"></i> Clôture du jour</h3><form method="POST"><input type="hidden" name="_csrf" value="<?=$csrf?>"><input type="hidden" name="action" value="cloture_submit"><input type="hidden" name="franchise_id" value="<?=$cl_fid?>">
<div><label class="text-sm font-semibold">Date</label><input type="date" name="date_cloture" value="<?=date('Y-m-d')?>" class="w-full border-2 rounded-xl px-4 py-2.5 text-sm"></div>
<div class="grid grid-cols-2 gap-3"><div><label class="text-sm font-semibold">Total ventes (DT)</label><input name="total_declare" type="number" step="0.01" class="w-full border-2 rounded-xl px-4 py-2.5 text-sm" required></div><div><label class="text-sm font-semibold">Nb articles</label><input name="articles_declare" type="number" class="w-full border-2 rounded-xl px-4 py-2.5 text-sm" required></div></div>
<div><textarea name="commentaire" class="w-full border-2 rounded-xl px-4 py-2.5 text-sm" rows="2" placeholder="Commentaire..."></textarea></div>
<button type="submit" class="w-full bg-asel text-white font-bold py-2.5 rounded-xl">📅 Soumettre</button></form></div>

<?php elseif ($page === 'rapports' && can('rapports')): $d1=$_GET['d1']??date('Y-m-01');$d2=$_GET['d2']??date('Y-m-d'); $by_f=query("SELECT f.nom,COALESCE(SUM(v.prix_total),0) as ca,COALESCE(SUM(v.quantite),0) as art FROM franchises f LEFT JOIN ventes v ON f.id=v.franchise_id AND v.date_vente BETWEEN ? AND ? WHERE f.actif=1 GROUP BY f.id,f.nom",[$d1,$d2]); $top=query("SELECT p.nom,p.marque,SUM(v.quantite) as qty,SUM(v.prix_total) as ca FROM ventes v JOIN produits p ON v.produit_id=p.id WHERE v.date_vente BETWEEN ? AND ? GROUP BY p.id ORDER BY ca DESC LIMIT 10",[$d1,$d2]); ?>
<h1 class="text-2xl font-bold text-asel-dark mb-6 flex items-center gap-2"><i class="bi bi-graph-up text-asel"></i> Rapports</h1>
<form class="flex flex-wrap gap-2 mb-4"><input type="hidden" name="page" value="rapports"><input type="date" name="d1" value="<?=$d1?>" class="form-input"><input type="date" name="d2" value="<?=$d2?>" class="form-input"><button class="bg-asel text-white px-4 py-2 rounded-xl text-sm font-semibold">Afficher</button></form>
<div class="grid sm:grid-cols-2 gap-4 mb-6"><?php foreach($by_f as $f):?><div class="bg-white rounded-xl p-5 shadow-sm border-l-4 border-asel"><h3 class="font-bold text-asel-dark"><?=shortF($f['nom'])?></h3><div class="text-2xl font-black text-asel mt-1"><?=number_format($f['ca'])?> DT</div><div class="text-xs text-gray-400"><?=number_format($f['art'])?> articles</div></div><?php endforeach;?></div>
<?php if($top):?><div class="bg-white rounded-xl shadow-sm overflow-hidden"><div class="px-4 py-3 border-b font-semibold text-sm">🏆 Top produits</div><div class="overflow-x-auto"><table class="w-full text-sm"><thead><tr class="bg-gray-50 text-xs"><th class="px-3 py-2 text-left">Produit</th><th class="px-3 py-2">Qté</th><th class="px-3 py-2 text-right">CA</th></tr></thead><tbody class="divide-y"><?php foreach($top as $t):?><tr><td class="px-3 py-2 font-medium"><?=$t['nom']?></td><td class="px-3 py-2 text-center"><?=$t['qty']?></td><td class="px-3 py-2 text-right font-bold"><?=number_format($t['ca'])?> DT</td></tr><?php endforeach;?></tbody></table></div></div><?php endif;?>

<?php elseif ($page === 'produits' && can('produits')): ?>
<div class="flex justify-between items-center mb-6">
    <h1 class="text-2xl font-bold text-asel-dark flex items-center gap-2"><i class="bi bi-tags text-asel"></i> Produits</h1>
    <a href="api.php?action=export_produits" class="bg-white border-2 border-asel text-asel font-semibold px-4 py-2 rounded-xl text-sm hover:bg-asel hover:text-white transition-colors"><i class="bi bi-download"></i> Export CSV</a>
</div>
<!-- Quick add category -->
<div class="bg-white rounded-xl shadow-sm p-3 mb-3">
    <form method="POST" class="flex gap-2 items-center"><input type="hidden" name="_csrf" value="<?=$csrf?>"><input type="hidden" name="action" value="add_category">
    <span class="text-xs font-bold text-gray-500">📂 Catégorie:</span>
    <input name="nom" class="border-2 rounded-lg px-3 py-1.5 text-sm flex-1" placeholder="Nouvelle catégorie" required>
    <input name="description" class="border-2 rounded-lg px-3 py-1.5 text-sm flex-1" placeholder="Description">
    <button class="bg-gray-600 text-white px-3 py-1.5 rounded-lg text-sm font-bold">+</button>
    </form>
</div>
<div class="bg-white rounded-xl shadow-sm p-4 mb-4"><h3 class="font-bold text-sm mb-3">➕ Ajouter un produit</h3><form method="POST" class="flex flex-wrap gap-2"><input type="hidden" name="_csrf" value="<?=$csrf?>"><input type="hidden" name="action" value="add_produit">
<input name="nom" class="border-2 rounded-lg px-3 py-2 text-sm flex-1 min-w-[150px]" placeholder="Nom" required>
<select name="categorie_id" class="form-input"><?php foreach($categories as $c):?><option value="<?=$c['id']?>"><?=$c['nom']?></option><?php endforeach;?></select>
<input name="marque" class="form-input w-24" placeholder="Marque">
<input name="prix_achat" type="number" step="0.01" class="form-input w-20" placeholder="PA" required>
<input name="prix_vente" type="number" step="0.01" class="form-input w-20" placeholder="PV" required>
<input name="reference" class="form-input w-24" placeholder="Réf.">
<input name="code_barre" class="form-input w-32" placeholder="Code-barres" id="add_barcode"><button type="button" onclick="openScanner('add_barcode')" class="bg-asel text-white px-3 py-2 rounded-lg text-sm" title="Scanner"><i class="bi bi-camera"></i></button>
<button type="button" onclick="openScanner('add_barcode')" class="bg-asel text-white px-3 py-2 rounded-lg text-sm" title="Scanner"><i class="bi bi-camera"></i></button>
<button class="btn-submit" style="width:auto;padding:10px 20px">+ Ajouter</button></form></div>
<div class="bg-white rounded-xl shadow-sm overflow-hidden"><div class="overflow-x-auto"><table class="w-full text-sm"><thead><tr class="bg-asel-dark text-white text-xs uppercase tracking-wider"><th class="px-3 py-3 text-left">Produit</th><th class="px-3 py-3 text-left hidden sm:table-cell">Cat.</th><th class="px-3 py-3 text-left hidden md:table-cell">Marque</th><th class="px-3 py-3 hidden md:table-cell">Code-barres</th><th class="px-3 py-3 text-right">PA</th><th class="px-3 py-3 text-right">PV</th><th class="px-3 py-3 text-center">Marge</th><th class="px-3 py-3">Edit</th></tr></thead>
<tbody class="divide-y"><?php foreach($produits as $p):$m=$p['prix_vente']>0?(($p['prix_vente']-$p['prix_achat'])/$p['prix_vente']*100):0;?>
<tr class="hover:bg-gray-50"><td class="px-3 py-2 font-medium"><?=htmlspecialchars($p['nom'])?></td><td class="px-3 py-2 text-xs hidden sm:table-cell"><?=$p['cat_nom']?></td><td class="px-3 py-2 text-xs hidden md:table-cell"><?=$p['marque']?></td><td class="px-3 py-2 text-xs font-mono hidden md:table-cell"><?=$p['code_barre']?:'-'?></td><td class="px-3 py-2 text-right"><?=number_format($p['prix_achat'],1)?></td><td class="px-3 py-2 text-right"><?=number_format($p['prix_vente'],1)?></td><td class="px-3 py-2 text-center"><span class="inline-flex px-2 py-0.5 rounded text-xs font-bold <?=$m>=30?'bg-green-100 text-green-800':($m>=15?'bg-yellow-100 text-yellow-800':'bg-red-100 text-red-800')?>"><?=number_format($m,0)?>%</span></td>
<td class="px-3 py-2 flex gap-1">
    <button onclick="document.getElementById('ep<?=$p['id']?>').classList.toggle('hidden')" class="text-asel hover:text-asel-dark" title="Modifier"><i class="bi bi-pencil"></i></button>
    <?php if($p['code_barre']): ?><a href="api.php?action=barcode_label&code=<?=urlencode($p['code_barre'])?>&name=<?=urlencode($p['nom'])?>&price=<?=$p['prix_vente']?>" target="_blank" class="text-gray-400 hover:text-gray-600" title="Étiquette code-barres"><i class="bi bi-upc"></i></a><?php endif; ?>
</td></tr>
<tr id="ep<?=$p['id']?>" class="hidden bg-blue-50"><td colspan="8" class="px-4 py-3"><form method="POST" class="flex flex-wrap gap-2 items-end"><input type="hidden" name="_csrf" value="<?=$csrf?>"><input type="hidden" name="action" value="edit_produit"><input type="hidden" name="produit_id" value="<?=$p['id']?>">
<div><label class="text-xs font-bold">Nom</label><input name="nom" value="<?=htmlspecialchars($p['nom'])?>" class="border rounded px-2 py-1 text-sm w-40"></div>
<div><label class="text-xs font-bold">Cat.</label><select name="categorie_id" class="border rounded px-2 py-1 text-sm"><?php foreach($categories as $c):?><option value="<?=$c['id']?>" <?=$p['categorie_id']==$c['id']?'selected':''?>><?=$c['nom']?></option><?php endforeach;?></select></div>
<div><label class="text-xs font-bold">Marque</label><input name="marque" value="<?=$p['marque']?>" class="border rounded px-2 py-1 text-sm w-20"></div>
<div><label class="text-xs font-bold">Réf.</label><input name="reference" value="<?=$p['reference']?>" class="border rounded px-2 py-1 text-sm w-24"></div>
<div><label class="text-xs font-bold">📷 Code-barres</label><div class="flex gap-1"><input name="code_barre" value="<?=$p['code_barre']?>" class="border rounded px-2 py-1 text-sm w-28 font-mono" id="eb_<?=$p['id']?>"><button type="button" onclick="openScanner('eb_<?=$p['id']?>')" class="bg-asel text-white px-2 py-1 rounded text-xs"><i class="bi bi-camera"></i></button></div></div>
<div><label class="text-xs font-bold">PA</label><input name="prix_achat" type="number" step="0.01" value="<?=$p['prix_achat']?>" class="border rounded px-2 py-1 text-sm w-20"></div>
<div><label class="text-xs font-bold">PV</label><input name="prix_vente" type="number" step="0.01" value="<?=$p['prix_vente']?>" class="border rounded px-2 py-1 text-sm w-20"></div>
<div><label class="text-xs font-bold">Seuil</label><input name="seuil" type="number" value="<?=$p['seuil_alerte']?>" class="border rounded px-2 py-1 text-sm w-14"></div>
<button class="bg-asel text-white px-3 py-1 rounded text-sm font-bold">💾</button></form></td></tr>
<?php endforeach;?></tbody></table></div></div>

<?php elseif ($page === 'franchises_mgmt' && can('franchises_mgmt')):
    $all_fr = query("SELECT * FROM franchises ORDER BY type_franchise DESC, actif DESC, nom");
?>
<h1 class="text-2xl font-bold text-asel-dark mb-6 flex items-center gap-2"><i class="bi bi-shop text-asel"></i> Gestion des franchises</h1>

<?php if (isAdmin()): ?>
<!-- Add franchise -->
<div class="form-card mb-6">
    <h3><i class="bi bi-plus-circle text-asel"></i> Ajouter une franchise</h3>
    <form method="POST" class="space-y-3">
        <input type="hidden" name="_csrf" value="<?=$csrf?>">
        <input type="hidden" name="action" value="add_franchise">
        <div class="form-row form-row-2">
            <div><label class="form-label">Nom *</label><input name="nom" class="form-input" placeholder="Ex: ASEL Mobile — Centre Ville" required></div>
            <div><label class="form-label">Adresse</label><input name="adresse" class="form-input" placeholder="Adresse complète"></div>
        </div>
        <div class="form-row form-row-3">
            <div><label class="form-label">Téléphone</label><input name="telephone" class="form-input" placeholder="+216 XX XXX XXX"></div>
            <div><label class="form-label">Responsable</label><input name="responsable" class="form-input" placeholder="Nom du gérant"></div>
            <div><label class="form-label">Horaires</label><input name="horaires" class="form-input" value="Lun-Sam: 09:00-19:00" placeholder="Lun-Sam: 09:00-19:00"></div>
        </div>
        <button type="submit" class="btn-submit"><i class="bi bi-plus-circle"></i> Ajouter la franchise</button>
    </form>
</div>
<?php endif; ?>

<!-- Franchise cards -->
<div class="grid sm:grid-cols-2 gap-4">
    <?php foreach ($all_fr as $f):
        if ($f['type_franchise'] === 'central') continue; // Skip Stock Central display here
        $fs = queryOne("SELECT COALESCE(SUM(s.quantite),0) as t, COALESCE(SUM(s.quantite*p.prix_vente),0) as v FROM stock s JOIN produits p ON s.produit_id=p.id WHERE s.franchise_id=?", [$f['id']]);
        $fv = queryOne("SELECT COALESCE(SUM(prix_total),0) as ca FROM ventes WHERE franchise_id=? AND MONTH(date_vente)=MONTH(CURDATE())", [$f['id']]);
        $user_count = queryOne("SELECT COUNT(*) as c FROM utilisateurs WHERE franchise_id=? AND actif=1", [$f['id']]);
    ?>
    <div class="bg-white rounded-xl shadow-sm p-5 <?=$f['actif']?'':'opacity-50 border-2 border-dashed border-gray-300'?>">
        <div class="flex items-start justify-between mb-3">
            <div>
                <h3 class="font-bold text-asel-dark text-lg flex items-center gap-2">
                    <i class="bi bi-shop text-asel"></i> <?=shortF($f['nom'])?>
                </h3>
                <div class="text-xs text-gray-400 mt-1 space-y-0.5">
                    <?php if ($f['adresse']): ?><p><i class="bi bi-geo-alt"></i> <?=$f['adresse']?></p><?php endif; ?>
                    <?php if ($f['telephone']): ?><p><i class="bi bi-telephone"></i> <?=$f['telephone']?></p><?php endif; ?>
                    <?php if ($f['responsable']): ?><p><i class="bi bi-person"></i> <?=$f['responsable']?></p><?php endif; ?>
                    <?php if ($f['horaires'] ?? ''): ?><p><i class="bi bi-clock"></i> <?=$f['horaires']?></p><?php endif; ?>
                </div>
                <?php if (!$f['actif']): ?>
                <span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800 mt-2">Désactivée</span>
                <?php endif; ?>
            </div>
            <?php if (isAdmin()): ?>
            <div class="flex gap-1 shrink-0">
                <button onclick="document.getElementById('ef<?=$f['id']?>').classList.toggle('hidden')" class="text-asel hover:text-asel-dark p-1" title="Modifier"><i class="bi bi-pencil"></i></button>
                <form method="POST" class="inline" onsubmit="return confirm('Supprimer cette franchise? Si des données existent, elle sera désactivée.')">
                    <input type="hidden" name="_csrf" value="<?=$csrf?>">
                    <input type="hidden" name="action" value="delete_franchise">
                    <input type="hidden" name="franchise_id" value="<?=$f['id']?>">
                    <button class="text-red-400 hover:text-red-600 p-1" title="Supprimer"><i class="bi bi-trash"></i></button>
                </form>
            </div>
            <?php endif; ?>
        </div>
        
        <!-- Stats -->
        <div class="grid grid-cols-3 gap-2 text-center">
            <div class="bg-gray-50 rounded-lg p-2">
                <div class="text-lg font-black text-asel-dark"><?=number_format($fs['t'])?></div>
                <div class="text-[10px] text-gray-400">articles</div>
            </div>
            <div class="bg-gray-50 rounded-lg p-2">
                <div class="text-lg font-black text-asel-dark"><?=number_format($fs['v'])?></div>
                <div class="text-[10px] text-gray-400">DT stock</div>
            </div>
            <div class="bg-gray-50 rounded-lg p-2">
                <div class="text-lg font-black text-asel"><?=number_format($fv['ca'])?></div>
                <div class="text-[10px] text-gray-400">DT/mois</div>
            </div>
        </div>
        <div class="text-xs text-gray-400 mt-2"><i class="bi bi-people"></i> <?=$user_count['c']?> employé(s) · Coord: <?=$f['latitude']?($f['latitude'].', '.$f['longitude']):'<span class="text-red-400">non défini</span>'?></div>
        
        <?php if (isAdmin()): ?>
        <!-- Edit form (hidden) -->
        <div id="ef<?=$f['id']?>" class="hidden mt-4 pt-4 border-t border-gray-100">
            <form method="POST" class="space-y-2">
                <input type="hidden" name="_csrf" value="<?=$csrf?>">
                <input type="hidden" name="action" value="edit_franchise">
                <input type="hidden" name="franchise_id" value="<?=$f['id']?>">
                <div class="grid grid-cols-2 gap-2">
                    <div><label class="text-xs font-bold text-gray-500">Nom</label><input name="nom" value="<?=htmlspecialchars($f['nom'])?>" class="w-full border-2 border-gray-200 rounded-lg px-3 py-1.5 text-sm"></div>
                    <div><label class="text-xs font-bold text-gray-500">Adresse</label><input name="adresse" value="<?=htmlspecialchars($f['adresse'])?>" class="w-full border-2 border-gray-200 rounded-lg px-3 py-1.5 text-sm"></div>
                </div>
                <div class="grid grid-cols-3 gap-2">
                    <div><label class="text-xs font-bold text-gray-500">Tél</label><input name="telephone" value="<?=$f['telephone']?>" class="w-full border-2 border-gray-200 rounded-lg px-3 py-1.5 text-sm"></div>
                    <div><label class="text-xs font-bold text-gray-500">Responsable</label><input name="responsable" value="<?=htmlspecialchars($f['responsable'])?>" class="w-full border-2 border-gray-200 rounded-lg px-3 py-1.5 text-sm"></div>
                    <div><label class="text-xs font-bold text-gray-500">Horaires</label><input name="horaires" value="<?=htmlspecialchars($f['horaires']??'')?>" class="w-full border-2 border-gray-200 rounded-lg px-3 py-1.5 text-sm"></div>
                </div>
                <div class="flex gap-2 items-center">
                    <select name="actif" class="border-2 border-gray-200 rounded-lg px-3 py-1.5 text-sm">
                        <option value="1" <?=$f['actif']?'selected':''?>>Active</option>
                        <option value="0" <?=!$f['actif']?'selected':''?>>Désactivée</option>
                    </select>
                    <button class="bg-asel text-white px-4 py-1.5 rounded-lg text-sm font-bold flex-1"><i class="bi bi-check-circle"></i> Enregistrer</button>
                </div>
            </form>
        </div>
        <?php endif; ?>
    </div>
    <?php endforeach; ?>
</div>

<?php elseif ($page === 'users' && can('users')): $users=query("SELECT u.*,f.nom as fnom FROM utilisateurs u LEFT JOIN franchises f ON u.franchise_id=f.id ORDER BY u.role,u.nom_complet"); ?>
<h1 class="text-2xl font-bold text-asel-dark mb-6 flex items-center gap-2"><i class="bi bi-people text-asel"></i> Utilisateurs</h1>
<div class="bg-white rounded-xl shadow-sm p-4 mb-4"><h3 class="font-bold text-sm mb-3">➕ Ajouter</h3><form method="POST" class="flex flex-wrap gap-2"><input type="hidden" name="_csrf" value="<?=$csrf?>"><input type="hidden" name="action" value="add_user">
<input name="username" class="form-input" placeholder="Login" required>
<input name="password" type="password" class="form-input" placeholder="Mot de passe" required>
<input name="nom_complet" class="form-input" placeholder="Nom complet" required>
<select name="role" class="form-input"><option value="franchise">Franchise</option><option value="gestionnaire">Gestionnaire</option><option value="admin">Admin</option><option value="viewer">Viewer</option></select>
<select name="franchise_id" class="form-input"><option value="">— Aucune —</option><?php foreach($franchises as $f):?><option value="<?=$f['id']?>"><?=shortF($f['nom'])?></option><?php endforeach;?></select>
<button class="btn-submit" style="width:auto;padding:10px 20px">+ Ajouter</button></form></div>
<div class="bg-white rounded-xl shadow-sm overflow-hidden"><div class="overflow-x-auto"><table class="w-full text-sm"><thead><tr class="bg-asel-dark text-white text-xs uppercase tracking-wider"><th class="px-3 py-3 text-left">Login</th><th class="px-3 py-3 text-left">Nom</th><th class="px-3 py-3">Rôle</th><th class="px-3 py-3 text-left hidden sm:table-cell">Franchise</th><th class="px-3 py-3">Statut</th><th class="px-3 py-3">Edit</th></tr></thead>
<tbody class="divide-y"><?php foreach($users as $u):?>
<tr class="hover:bg-gray-50"><td class="px-3 py-2 font-mono text-sm"><?=htmlspecialchars($u['nom_utilisateur'])?></td><td class="px-3 py-2 font-medium"><?=htmlspecialchars($u['nom_complet'])?></td><td class="px-3 py-2 text-center"><?=roleBadge($u['role'])?></td><td class="px-3 py-2 text-xs hidden sm:table-cell"><?=$u['fnom']?shortF($u['fnom']):'—'?></td><td class="px-3 py-2 text-center"><?=$u['actif']?'🟢':'🔴'?></td>
<td class="px-3 py-2"><button onclick="document.getElementById('eu<?=$u['id']?>').classList.toggle('hidden')" class="text-asel hover:text-asel-dark"><i class="bi bi-pencil"></i></button></td></tr>
<tr id="eu<?=$u['id']?>" class="hidden bg-blue-50"><td colspan="6" class="px-4 py-3"><form method="POST" class="flex flex-wrap gap-2 items-end"><input type="hidden" name="_csrf" value="<?=$csrf?>"><input type="hidden" name="action" value="edit_user"><input type="hidden" name="user_id" value="<?=$u['id']?>">
<div><label class="text-xs font-bold">Nom</label><input name="nom_complet" value="<?=htmlspecialchars($u['nom_complet'])?>" class="border rounded px-2 py-1 text-sm w-32"></div>
<div><label class="text-xs font-bold">Rôle</label><select name="role" class="border rounded px-2 py-1 text-sm"><option value="franchise" <?=$u['role']==='franchise'?'selected':''?>>Franchise</option><option value="gestionnaire" <?=$u['role']==='gestionnaire'?'selected':''?>>Gestionnaire</option><option value="admin" <?=$u['role']==='admin'?'selected':''?>>Admin</option><option value="viewer" <?=$u['role']==='viewer'?'selected':''?>>Viewer</option></select></div>
<div><label class="text-xs font-bold">Franchise</label><select name="franchise_id" class="border rounded px-2 py-1 text-sm"><option value="">—</option><?php foreach($franchises as $f):?><option value="<?=$f['id']?>" <?=$u['franchise_id']==$f['id']?'selected':''?>><?=shortF($f['nom'])?></option><?php endforeach;?></select></div>
<div><label class="text-xs font-bold">Nouveau mdp</label><input name="new_password" type="password" class="border rounded px-2 py-1 text-sm w-24" placeholder="(vide=garder)"></div>
<div><label class="text-xs font-bold">Actif</label><select name="actif" class="border rounded px-2 py-1 text-sm"><option value="1" <?=$u['actif']?'selected':''?>>Oui</option><option value="0" <?=!$u['actif']?'selected':''?>>Non</option></select></div>
<button class="bg-asel text-white px-3 py-1 rounded text-sm font-bold">💾</button></form></td></tr>
<?php endforeach;?></tbody></table></div></div>

<?php
// =====================================================
// CLIENTS
// =====================================================
elseif ($page === 'clients'):
    // Handle add client
    if ($_SERVER['REQUEST_METHOD'] === 'POST' && ($_POST['action'] ?? '') === 'add_client') {
        // Already handled above
    }
    $clients = query("SELECT c.*,f.nom as fnom FROM clients c LEFT JOIN franchises f ON c.franchise_id=f.id ORDER BY c.date_creation DESC LIMIT 100");
?>
<div class="flex justify-between items-center mb-6">
    <h1 class="text-2xl font-bold text-asel-dark flex items-center gap-2"><i class="bi bi-person-lines-fill text-asel"></i> Gestion des clients</h1>
    <a href="api.php?action=export_clients" class="bg-white border-2 border-asel text-asel font-semibold px-4 py-2 rounded-xl text-sm hover:bg-asel hover:text-white transition-colors"><i class="bi bi-download"></i> Export CSV</a>
</div>

<div class="form-card mb-4">
    <h3><i class="bi bi-person-plus text-asel"></i> Nouveau client</h3>
    <form method="POST">
        <input type="hidden" name="_csrf" value="<?=$csrf?>"><input type="hidden" name="action" value="add_client">
        <div class="form-row form-row-3">
            <div><label class="form-label">Nom *</label><input name="nom" class="form-input" placeholder="Nom de famille" required></div>
            <div><label class="form-label">Prénom</label><input name="prenom" class="form-input" placeholder="Prénom"></div>
            <div><label class="form-label">Type de client</label>
                <select name="type_client" class="form-input" onchange="toggleEntreprise(this.value)">
                    <option value="passager">🚶 Passager</option>
                    <option value="boutique">🏪 Client boutique</option>
                    <option value="entreprise">🏢 Entreprise</option>
                </select>
            </div>
        </div>
        <div class="form-row form-row-2">
            <div><label class="form-label">📞 Téléphone</label><input name="telephone" class="form-input" placeholder="+216 XX XXX XXX" type="tel"></div>
            <div><label class="form-label">✉️ Email</label><input name="email" class="form-input" placeholder="email@exemple.com" type="email"></div>
        </div>
        <div class="form-row form-row-2" id="entrepriseFields" style="display:none">
            <div><label class="form-label">🏢 Nom entreprise</label><input name="entreprise" class="form-input" placeholder="Nom de l'entreprise"></div>
            <div><label class="form-label">📋 Matricule fiscal</label><input name="matricule_fiscal" class="form-input" placeholder="0000000/X/X/X/000"></div>
        </div>
        <div><label class="form-label">📝 Adresse</label><input name="adresse" class="form-input" placeholder="Adresse complète"></div>
        <div class="mt-4"><button type="submit" class="btn-submit"><i class="bi bi-check-circle"></i> Ajouter le client</button></div>
    </form>
    <script>function toggleEntreprise(v){document.getElementById('entrepriseFields').style.display=(v==='entreprise'||v==='boutique')?'grid':'none';}</script>
</div>

<div class="bg-white rounded-xl shadow-sm overflow-hidden">
    <div class="overflow-x-auto"><table class="w-full text-sm">
        <thead><tr class="bg-asel-dark text-white text-xs uppercase tracking-wider"><th class="px-3 py-3">Nom</th><th class="px-3 py-3 hidden sm:table-cell">Tél</th><th class="px-3 py-3">Type</th><th class="px-3 py-3 hidden md:table-cell">Entreprise</th><th class="px-3 py-3 hidden md:table-cell">MF</th><th class="px-3 py-3">Date</th><th class="px-3 py-3">Edit</th></tr></thead>
        <tbody class="divide-y"><?php foreach ($clients as $c): $tb=['passager'=>'bg-gray-100','boutique'=>'bg-blue-100 text-blue-800','entreprise'=>'bg-purple-100 text-purple-800']; ?>
            <tr class="hover:bg-gray-50">
                <td class="px-3 py-2 font-medium"><?=htmlspecialchars($c['nom'].' '.($c['prenom']??''))?></td>
                <td class="px-3 py-2 hidden sm:table-cell"><?=$c['telephone']?></td>
                <td class="px-3 py-2"><span class="inline-flex px-2 py-0.5 rounded text-xs font-medium <?=$tb[$c['type_client']]??''?>"><?=$c['type_client']?></span></td>
                <td class="px-3 py-2 text-xs hidden md:table-cell"><?=$c['entreprise']?></td>
                <td class="px-3 py-2 text-xs font-mono hidden md:table-cell"><?=$c['matricule_fiscal']?></td>
                <td class="px-3 py-2 text-xs text-gray-400"><?=date('d/m/Y',strtotime($c['date_creation']))?></td>
                <td class="px-3 py-2"><button onclick="document.getElementById('ec<?=$c['id']?>').classList.toggle('hidden')" class="text-asel"><i class="bi bi-pencil"></i></button></td>
            </tr>
            <tr id="ec<?=$c['id']?>" class="hidden bg-blue-50"><td colspan="7" class="px-4 py-3">
                <form method="POST" class="flex flex-wrap gap-2 items-end"><input type="hidden" name="_csrf" value="<?=$csrf?>"><input type="hidden" name="action" value="edit_client"><input type="hidden" name="client_id" value="<?=$c['id']?>">
                <div><label class="text-xs font-bold">Nom</label><input name="nom" value="<?=htmlspecialchars($c['nom'])?>" class="border rounded px-2 py-1 text-sm w-28"></div>
                <div><label class="text-xs font-bold">Prénom</label><input name="prenom" value="<?=htmlspecialchars($c['prenom']??'')?>" class="border rounded px-2 py-1 text-sm w-28"></div>
                <div><label class="text-xs font-bold">Tél</label><input name="telephone" value="<?=$c['telephone']?>" class="border rounded px-2 py-1 text-sm w-28"></div>
                <div><label class="text-xs font-bold">Email</label><input name="email" value="<?=$c['email']?>" class="border rounded px-2 py-1 text-sm w-36"></div>
                <div><label class="text-xs font-bold">Type</label><select name="type_client" class="border rounded px-2 py-1 text-sm"><option value="passager" <?=$c['type_client']==='passager'?'selected':''?>>Passager</option><option value="boutique" <?=$c['type_client']==='boutique'?'selected':''?>>Boutique</option><option value="entreprise" <?=$c['type_client']==='entreprise'?'selected':''?>>Entreprise</option></select></div>
                <div><label class="text-xs font-bold">Entreprise</label><input name="entreprise" value="<?=htmlspecialchars($c['entreprise']??'')?>" class="border rounded px-2 py-1 text-sm w-28"></div>
                <div><label class="text-xs font-bold">MF</label><input name="matricule_fiscal" value="<?=$c['matricule_fiscal']?>" class="border rounded px-2 py-1 text-sm w-28"></div>
                <div><label class="text-xs font-bold">Actif</label><select name="actif" class="border rounded px-2 py-1 text-sm"><option value="1" <?=$c['actif']?'selected':''?>>Oui</option><option value="0" <?=!$c['actif']?'selected':''?>>Non</option></select></div>
                <button class="bg-asel text-white px-3 py-1 rounded text-sm font-bold">💾</button></form>
            </td></tr>
        <?php endforeach; ?></tbody>
    </table></div>
</div>

<?php
// =====================================================
// SERVICES
// =====================================================
elseif ($page === 'services'):
    $services = query("SELECT * FROM services WHERE actif=1 ORDER BY categorie_service,nom");
    $prestations = query("SELECT p.*,s.nom as snom,f.nom as fnom,u.nom_complet as technicien FROM prestations p JOIN services s ON p.service_id=s.id JOIN franchises f ON p.franchise_id=f.id LEFT JOIN utilisateurs u ON p.utilisateur_id=u.id ORDER BY p.date_prestation DESC LIMIT 30");
?>
<h1 class="text-2xl font-bold text-asel-dark mb-6 flex items-center gap-2"><i class="bi bi-wrench-adjustable text-asel"></i> Services techniques</h1>

<!-- Service catalog -->
<div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-6">
    <?php foreach ($services as $s): $cat_icon=['technique'=>'🔧','compte'=>'👤','autre'=>'📋']; ?>
    <div class="bg-white rounded-xl p-4 shadow-sm border-l-4 <?=$s['categorie_service']==='technique'?'border-orange-400':($s['categorie_service']==='compte'?'border-blue-400':'border-gray-400')?>">
        <div class="flex justify-between items-start">
            <div>
                <h3 class="font-bold text-sm text-asel-dark"><?=$cat_icon[$s['categorie_service']]??'📋'?> <?=htmlspecialchars($s['nom'])?></h3>
                <p class="text-xs text-gray-400 mt-1"><?=$s['description']?></p>
                <p class="text-xs text-gray-400">⏱ ~<?=$s['duree_minutes']?> min</p>
            </div>
            <div class="text-right">
                <div class="text-lg font-black text-asel"><?=$s['prix'] > 0 ? number_format($s['prix'],0).' DT' : 'Sur devis'?></div>
            </div>
        </div>
    </div>
    <?php endforeach; ?>
</div>

<!-- Recent prestations -->
<?php if ($prestations): ?>
<div class="bg-white rounded-xl shadow-sm overflow-hidden">
    <div class="px-4 py-3 border-b font-semibold text-sm">📋 Prestations récentes</div>
    <div class="overflow-x-auto"><table class="w-full text-sm">
        <thead><tr class="bg-gray-50 text-xs"><th class="px-3 py-2 text-left">Date</th><th class="px-3 py-2 text-left">Service</th><th class="px-3 py-2">Franchise</th><th class="px-3 py-2 text-right">Prix</th><th class="px-3 py-2">Technicien</th></tr></thead>
        <tbody class="divide-y"><?php foreach ($prestations as $p): ?>
            <tr><td class="px-3 py-2 text-xs text-gray-400"><?=date('d/m H:i',strtotime($p['date_prestation']))?></td><td class="px-3 py-2 font-medium"><?=$p['snom']?></td><td class="px-3 py-2 text-xs"><?=shortF($p['fnom'])?></td><td class="px-3 py-2 text-right font-bold"><?=number_format($p['prix_facture'],0)?> DT</td><td class="px-3 py-2 text-xs"><?=$p['technicien']?></td></tr>
        <?php endforeach; ?></tbody>
    </table></div>
</div>
<?php endif; ?>

<?php
// =====================================================
// RECHARGES & SIM
// =====================================================
elseif ($page === 'recharges'):
    $recharges = query("SELECT * FROM produits_asel WHERE actif=1 ORDER BY type_produit,valeur_nominale");
    $types = ['carte_sim'=>'📱 Cartes SIM ASEL','recharge_solde'=>'💳 Recharges Solde ASEL','recharge_internet'=>'🌐 Forfaits Internet ASEL'];
?>
<h1 class="text-2xl font-bold text-asel-dark mb-6 flex items-center gap-2"><i class="bi bi-phone text-asel"></i> Produits ASEL Mobile</h1>

<?php foreach ($types as $type => $label): $items = array_filter($recharges, fn($r) => $r['type_produit'] === $type); if (!$items) continue; ?>
<h2 class="text-lg font-bold text-asel-dark mt-4 mb-3"><?=$label?></h2>
<div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mb-4">
    <?php foreach ($items as $r): ?>
    <div class="rounded-xl p-4 border-2 text-center bg-cyan-50 border-asel/30 hover:border-asel hover:shadow-md transition-all">
        <div class="text-xs font-bold text-asel uppercase tracking-wider">ASEL MOBILE</div>
        <div class="text-3xl font-black text-asel-dark mt-2"><?=number_format($r['prix_vente'],1)?> <span class="text-sm">DT</span></div>
        <div class="text-xs text-gray-500 mt-1"><?=htmlspecialchars($r['nom'])?></div>
        <div class="text-xs text-green-600 font-semibold mt-2">Commission: <?=number_format($r['commission'],2)?> DT</div>
    </div>
    <?php endforeach; ?>
</div>
<?php endforeach; ?>

<?php
// =====================================================
// FACTURES
// =====================================================
elseif ($page === 'factures'):
    $where_f = $fid ? "AND f.franchise_id=".intval($fid) : "";
    $factures = query("SELECT f.*,fr.nom as fnom,c.nom as client_nom,c.prenom as client_prenom,u.nom_complet as vendeur FROM factures f JOIN franchises fr ON f.franchise_id=fr.id LEFT JOIN clients c ON f.client_id=c.id LEFT JOIN utilisateurs u ON f.utilisateur_id=u.id WHERE 1=1 $where_f ORDER BY f.date_facture DESC LIMIT 50");
?>
<h1 class="text-2xl font-bold text-asel-dark mb-6 flex items-center gap-2"><i class="bi bi-file-earmark-text text-asel"></i> Factures</h1>

<!-- PDF Report buttons -->
<div class="flex flex-wrap gap-2 mb-4">
    <a href="pdf.php?type=rapport_jour&date=<?=date('Y-m-d')?><?=$fid?"&fid=$fid":''?>" target="_blank" class="bg-white border-2 border-asel text-asel font-semibold px-4 py-2 rounded-xl text-sm hover:bg-asel hover:text-white transition-colors">
        📄 Rapport du jour (PDF)
    </a>
    <a href="pdf.php?type=rapport_mois&mois=<?=date('Y-m')?><?=$fid?"&fid=$fid":''?>" target="_blank" class="bg-white border-2 border-asel text-asel font-semibold px-4 py-2 rounded-xl text-sm hover:bg-asel hover:text-white transition-colors">
        📊 Rapport du mois (PDF)
    </a>
    <a href="map.php" target="_blank" class="bg-white border-2 border-green-500 text-green-600 font-semibold px-4 py-2 rounded-xl text-sm hover:bg-green-500 hover:text-white transition-colors">
        🗺️ Carte des franchises
    </a>
</div>

<div class="bg-white rounded-xl shadow-sm overflow-hidden">
    <div class="overflow-x-auto"><table class="w-full text-sm">
        <thead><tr class="bg-asel-dark text-white text-xs uppercase tracking-wider"><th class="px-3 py-3">N°</th><th class="px-3 py-3">Date</th><th class="px-3 py-3 hidden sm:table-cell">Franchise</th><th class="px-3 py-3">Client</th><th class="px-3 py-3">Type</th><th class="px-3 py-3 text-right">Total</th><th class="px-3 py-3">Statut</th><th class="px-3 py-3">PDF</th></tr></thead>
        <tbody class="divide-y"><?php foreach ($factures as $f): $type_b=['ticket'=>'bg-gray-100','facture'=>'bg-blue-100 text-blue-800','devis'=>'bg-yellow-100 text-yellow-800']; $stat_b=['payee'=>'bg-green-100 text-green-800','en_attente'=>'bg-yellow-100 text-yellow-800','annulee'=>'bg-red-100 text-red-800']; ?>
            <tr class="hover:bg-gray-50">
                <td class="px-3 py-2 font-mono text-xs font-bold"><?=$f['numero']?></td>
                <td class="px-3 py-2 text-xs"><?=date('d/m/Y H:i',strtotime($f['date_facture']))?></td>
                <td class="px-3 py-2 text-xs hidden sm:table-cell"><?=shortF($f['fnom'])?></td>
                <td class="px-3 py-2"><?=$f['client_nom'] ? htmlspecialchars($f['client_nom'].' '.($f['client_prenom']??'')) : '<span class="text-gray-400">Passager</span>'?></td>
                <td class="px-3 py-2"><span class="inline-flex px-2 py-0.5 rounded text-xs font-medium <?=$type_b[$f['type_facture']]??''?>"><?=$f['type_facture']?></span></td>
                <td class="px-3 py-2 text-right font-bold"><?=number_format($f['total_ttc'],2)?> DT</td>
                <td class="px-3 py-2"><span class="inline-flex px-2 py-0.5 rounded text-xs font-medium <?=$stat_b[$f['statut']]??''?>"><?=$f['statut']?></span></td>
                <td class="px-3 py-2 flex gap-1">
                    <a href="pdf.php?type=facture&id=<?=$f['id']?>" target="_blank" class="text-asel hover:text-asel-dark"><i class="bi bi-file-pdf text-lg"></i></a>
                    <?php if(isAdmin() && $f['statut']==='payee'): ?>
                    <form method="POST" class="inline" onsubmit="return confirm('Annuler cette facture? Le stock sera restauré.')"><input type="hidden" name="_csrf" value="<?=$csrf?>"><input type="hidden" name="action" value="cancel_facture"><input type="hidden" name="facture_id" value="<?=$f['id']?>">
                    <button class="text-red-400 hover:text-red-600" title="Annuler"><i class="bi bi-x-circle"></i></button></form>
                    <?php endif; ?>
                </td>
            </tr>
        <?php endforeach; ?></tbody>
    </table></div>
</div>

<?php
    // Retours history
    $retours_list = query("SELECT r.*,p.nom as pnom,f.nom as fnom,u.nom_complet as technicien FROM retours r JOIN produits p ON r.produit_id=p.id JOIN franchises f ON r.franchise_id=f.id LEFT JOIN utilisateurs u ON r.utilisateur_id=u.id " . ($fid ? "WHERE r.franchise_id=".intval($fid) : "") . " ORDER BY r.date_retour DESC LIMIT 30");
    if ($retours_list): ?>
<div class="bg-white rounded-xl shadow-sm overflow-hidden mt-4">
    <div class="px-4 py-3 border-b font-semibold text-sm">📋 Historique des retours</div>
    <div class="overflow-x-auto"><table class="w-full text-sm">
        <thead><tr class="bg-gray-50 text-xs"><th class="px-3 py-2 text-left">Date</th><th class="px-3 py-2 text-left">Franchise</th><th class="px-3 py-2 text-left">Produit</th><th class="px-3 py-2">Qté</th><th class="px-3 py-2">Type</th><th class="px-3 py-2 text-left">Raison</th><th class="px-3 py-2">Par</th></tr></thead>
        <tbody class="divide-y"><?php foreach ($retours_list as $r): ?>
            <tr class="hover:bg-gray-50"><td class="px-3 py-2 text-xs text-gray-400"><?=date('d/m H:i',strtotime($r['date_retour']))?></td><td class="px-3 py-2 text-xs"><?=shortF($r['fnom'])?></td><td class="px-3 py-2 font-medium"><?=htmlspecialchars($r['pnom'])?></td><td class="px-3 py-2 text-center"><?=$r['quantite']?></td>
            <td class="px-3 py-2 text-center"><span class="inline-flex px-2 py-0.5 rounded text-xs font-medium <?=$r['type_retour']==='retour'?'bg-green-100 text-green-800':'bg-blue-100 text-blue-800'?>"><?=$r['type_retour']?></span></td>
            <td class="px-3 py-2 text-xs"><?=$r['raison']?></td><td class="px-3 py-2 text-xs"><?=$r['technicien']?></td></tr>
        <?php endforeach; ?></tbody>
    </table></div>
</div>
<?php endif; ?>
<?php endif; ?>

<!-- ECHEANCES -->
<?php if ($page === 'echeances' && can('echeances')):
    $e_fid = $fid ?: currentFranchise();
    $where_ef = $e_fid ? "AND e.franchise_id=".intval($e_fid) : "";
    $echeances = query("SELECT e.*,f.numero as facture_num,c.nom as client_nom,c.prenom as client_prenom,c.telephone as client_tel,fr.nom as fnom
        FROM echeances e JOIN factures f ON e.facture_id=f.id JOIN clients c ON e.client_id=c.id JOIN franchises fr ON e.franchise_id=fr.id WHERE 1=1 $where_ef ORDER BY e.date_echeance ASC");
    $en_attente = array_filter($echeances, fn($e) => $e['statut']==='en_attente');
    $en_retard = array_filter($echeances, fn($e) => $e['statut']==='en_retard');
?>
<h1 class="text-2xl font-bold text-asel-dark mb-6 flex items-center gap-2"><i class="bi bi-credit-card text-asel"></i> Échéances de paiement</h1>

<!-- Créer échéances par lot -->
<div class="bg-white rounded-xl shadow-sm p-4 mb-4">
    <h3 class="font-bold text-sm mb-3">📅 Créer un paiement par lot (client boutique)</h3>
    <form method="POST" class="flex flex-wrap gap-2 items-end">
        <input type="hidden" name="_csrf" value="<?=$csrf?>"><input type="hidden" name="action" value="create_echeances_lot">
        <?php if (can('view_all_franchises')): ?>
        <div><label class="text-xs font-bold">Franchise</label><select name="franchise_id" class="form-input"><?php foreach ($franchises as $f): ?><option value="<?=$f['id']?>"><?=shortF($f['nom'])?></option><?php endforeach; ?></select></div>
        <?php else: ?><input type="hidden" name="franchise_id" value="<?=currentFranchise()?>"><?php endif; ?>
        <div><label class="text-xs font-bold">Client boutique</label>
            <select name="client_id" class="form-input" required>
                <option value="">Choisir...</option>
                <?php $clients_boutique = query("SELECT * FROM clients WHERE type_client IN ('boutique','entreprise') AND actif=1 ORDER BY nom"); foreach ($clients_boutique as $cb): ?>
                <option value="<?=$cb['id']?>"><?=htmlspecialchars($cb['nom'].' '.($cb['prenom']??''))?> (<?=$cb['type_client']?>)</option>
                <?php endforeach; ?>
            </select>
        </div>
        <div><label class="text-xs font-bold">N° facture</label><input name="facture_id" type="number" class="form-input w-20" required placeholder="ID"></div>
        <div><label class="text-xs font-bold">Montant total (DT)</label><input name="montant_total" type="number" step="0.01" class="form-input w-28" required></div>
        <div><label class="text-xs font-bold">Nb échéances</label><input name="nb_echeances" type="number" min="2" max="24" value="3" class="form-input w-20" required></div>
        <div><label class="text-xs font-bold">1ère échéance</label><input name="premiere_date" type="date" class="form-input" value="<?=date('Y-m-d',strtotime('+30 days'))?>" required></div>
        <div><label class="text-xs font-bold">Intervalle (jours)</label><input name="intervalle_jours" type="number" min="7" max="90" value="30" class="form-input w-20"></div>
        <button class="bg-asel text-white px-4 py-2 rounded-lg text-sm font-bold">📅 Créer les échéances</button>
    </form>
</div>

<?php if (count($en_retard)): ?>
<div class="bg-red-50 border border-red-200 rounded-xl p-4 mb-4 flex items-center gap-3">
    <i class="bi bi-exclamation-triangle-fill text-red-500 text-xl"></i>
    <div><strong class="text-red-800"><?=count($en_retard)?> échéance(s) en retard!</strong><span class="text-red-600 text-sm"> — Contactez les clients</span></div>
</div>
<?php endif; ?>

<div class="bg-white rounded-xl shadow-sm overflow-hidden">
    <div class="overflow-x-auto"><table class="w-full text-sm">
        <thead><tr class="bg-asel-dark text-white text-xs uppercase"><th class="px-3 py-3">Client</th><th class="px-3 py-3 hidden sm:table-cell">Tél</th><th class="px-3 py-3">Facture</th><th class="px-3 py-3 text-right">Montant</th><th class="px-3 py-3">Échéance</th><th class="px-3 py-3">Statut</th><th class="px-3 py-3">Action</th></tr></thead>
        <tbody class="divide-y"><?php foreach ($echeances as $e): $sb=['en_attente'=>'bg-yellow-100 text-yellow-800','payee'=>'bg-green-100 text-green-800','en_retard'=>'bg-red-100 text-red-800']; ?>
            <tr class="hover:bg-gray-50 <?=$e['statut']==='en_retard'?'bg-red-50/50':''?>">
                <td class="px-3 py-2 font-medium"><?=htmlspecialchars($e['client_nom'].' '.($e['client_prenom']??''))?></td>
                <td class="px-3 py-2 hidden sm:table-cell"><a href="tel:<?=$e['client_tel']?>" class="text-asel"><?=$e['client_tel']?></a></td>
                <td class="px-3 py-2 text-xs font-mono"><?=$e['facture_num']?></td>
                <td class="px-3 py-2 text-right font-bold"><?=number_format($e['montant'],1)?> DT</td>
                <td class="px-3 py-2 text-sm"><?=date('d/m/Y',strtotime($e['date_echeance']))?></td>
                <td class="px-3 py-2"><span class="inline-flex px-2 py-0.5 rounded text-xs font-medium <?=$sb[$e['statut']]??''?>"><?=$e['statut']?></span></td>
                <td class="px-3 py-2">
                    <?php if ($e['statut']!=='payee'): ?>
                    <form method="POST" class="inline"><input type="hidden" name="_csrf" value="<?=$csrf?>"><input type="hidden" name="action" value="pay_echeance"><input type="hidden" name="echeance_id" value="<?=$e['id']?>">
                    <button class="bg-green-500 text-white px-2 py-1 rounded text-xs font-bold">💰 Encaisser</button></form>
                    <?php else: ?>✅<?php endif; ?>
                </td>
            </tr>
        <?php endforeach; ?></tbody>
    </table></div>
</div>
<?php if (empty($echeances)): ?>
<div class="bg-white rounded-xl shadow-sm p-8 text-center">
    <i class="bi bi-credit-card text-5xl text-gray-200"></i>
    <p class="text-gray-400 mt-3">Aucune échéance en cours</p>
</div>
<?php endif; ?>
<?php endif; ?>

<!-- INVENTAIRE -->
<?php if ($page === 'inventaire' && can('inventaire')):
    $inv_fid = $fid ?: currentFranchise();
    if (!$inv_fid && can('view_all_franchises')): ?>
<h1 class="text-2xl font-bold text-asel-dark mb-6 flex items-center gap-2"><i class="bi bi-clipboard-check text-asel"></i> Inventaire mensuel</h1>
<div class="bg-white rounded-xl shadow-sm p-8 max-w-md mx-auto text-center">
    <i class="bi bi-shop text-5xl text-asel/30"></i>
    <h3 class="font-bold text-asel-dark mt-4 mb-2">Choisissez une franchise</h3>
    <div class="space-y-2 mt-4"><?php foreach ($franchises as $f): ?>
        <a href="?page=inventaire&fid=<?=$f['id']?>" class="block bg-asel hover:bg-asel-dark text-white font-semibold py-3 rounded-xl transition-all"><?=shortF($f['nom'])?></a>
    <?php endforeach; ?></div>
</div>
<?php return; endif;
    $mois_actuel = date('Y-m');
    $inv_existant = queryOne("SELECT * FROM inventaires WHERE franchise_id=? AND mois=?", [$inv_fid, $mois_actuel]);
    $stock_actuel = query("SELECT s.*,p.nom as pnom,p.reference,c.nom as cnom FROM stock s JOIN produits p ON s.produit_id=p.id JOIN categories c ON p.categorie_id=c.id WHERE s.franchise_id=? AND p.actif=1 ORDER BY c.nom,p.nom", [$inv_fid]);
    $franchise_nom = queryOne("SELECT nom FROM franchises WHERE id=?", [$inv_fid])['nom'] ?? '';
?>
<h1 class="text-2xl font-bold text-asel-dark mb-6 flex items-center gap-2"><i class="bi bi-clipboard-check text-asel"></i> Inventaire — <?=shortF($franchise_nom)?></h1>
<p class="text-sm text-gray-500 mb-4">Mois: <strong><?=$mois_actuel?></strong> — Vérifiez que le stock physique correspond au stock système.</p>

<?php if ($inv_existant): ?>
<div class="bg-green-50 border border-green-200 rounded-xl p-4 mb-4">
    <p class="text-green-800 font-semibold">✅ Inventaire déjà soumis pour ce mois (statut: <?=$inv_existant['statut']?>)</p>
</div>
<?php else: ?>
<form method="POST" id="inventaireForm">
    <input type="hidden" name="_csrf" value="<?=$csrf?>">
    <input type="hidden" name="action" value="submit_inventaire">
    <input type="hidden" name="franchise_id" value="<?=$inv_fid?>">
    <input type="hidden" name="mois" value="<?=$mois_actuel?>">
    
    <div class="bg-white rounded-xl shadow-sm overflow-hidden mb-4">
        <div class="overflow-x-auto"><table class="w-full text-sm">
            <thead><tr class="bg-asel-dark text-white text-xs uppercase"><th class="px-3 py-3 text-left">Produit</th><th class="px-3 py-3 hidden sm:table-cell">Cat.</th><th class="px-3 py-3 text-center">Stock système</th><th class="px-3 py-3 text-center">Stock physique</th><th class="px-3 py-3 text-center">Écart</th></tr></thead>
            <tbody class="divide-y"><?php foreach ($stock_actuel as $i => $s): ?>
                <tr class="hover:bg-gray-50" id="inv_row_<?=$i?>">
                    <td class="px-3 py-2 font-medium"><?=htmlspecialchars($s['pnom'])?><br><span class="text-xs text-gray-400"><?=$s['reference']?></span></td>
                    <td class="px-3 py-2 text-xs hidden sm:table-cell"><?=$s['cnom']?></td>
                    <td class="px-3 py-2 text-center font-bold"><?=$s['quantite']?></td>
                    <td class="px-3 py-2 text-center">
                        <input type="hidden" name="produit_ids[]" value="<?=$s['produit_id']?>">
                        <input type="hidden" name="qte_systeme[]" value="<?=$s['quantite']?>">
                        <input type="number" name="qte_physique[]" class="w-16 text-center border-2 rounded-lg py-1 text-sm font-bold" value="<?=$s['quantite']?>" min="0" onchange="calcEcart(<?=$i?>,<?=$s['quantite']?>,this.value)">
                    </td>
                    <td class="px-3 py-2 text-center" id="ecart_<?=$i?>"><span class="text-green-600 font-bold">0</span></td>
                </tr>
            <?php endforeach; ?></tbody>
        </table></div>
    </div>
    
    <div class="flex flex-wrap gap-2 items-center">
        <textarea name="commentaire" class="flex-1 border-2 rounded-xl px-4 py-2 text-sm min-w-[200px]" placeholder="Commentaire sur l'inventaire..."></textarea>
        <button type="submit" class="bg-asel text-white font-bold px-6 py-3 rounded-xl"><i class="bi bi-check-circle"></i> Soumettre l'inventaire</button>
    </div>
</form>

<script>
function calcEcart(idx, sys, phys) {
    const ecart = parseInt(phys) - sys;
    const el = document.getElementById('ecart_' + idx);
    if (ecart === 0) el.innerHTML = '<span class="text-green-600 font-bold">0</span>';
    else if (ecart > 0) el.innerHTML = '<span class="text-blue-600 font-bold">+' + ecart + '</span>';
    else el.innerHTML = '<span class="text-red-600 font-bold">' + ecart + '</span>';
    
    // Highlight row
    const row = document.getElementById('inv_row_' + idx);
    row.className = ecart !== 0 ? 'bg-red-50' : 'hover:bg-gray-50';
}
</script>
<?php endif; ?>
<?php endif; ?>

<!-- NOTIFICATIONS -->
<?php if ($page === 'notifications'):
    // Mark all as read
    $notif_params_mark = $notif_params;
    execute("UPDATE notifications SET lu=1 WHERE lu=0 AND (" . implode(' OR ', $notif_where) . ")", $notif_params_mark);
    $all_notifs = query("SELECT * FROM notifications WHERE (" . implode(' OR ', $notif_where) . ") ORDER BY date_creation DESC LIMIT 50", $notif_params);
?>
<h1 class="text-2xl font-bold text-asel-dark mb-6 flex items-center gap-2"><i class="bi bi-bell text-asel"></i> Notifications</h1>
<div class="space-y-2">
    <?php foreach ($all_notifs as $n): $type_c=['info'=>'border-blue-300 bg-blue-50','warning'=>'border-yellow-300 bg-yellow-50','danger'=>'border-red-300 bg-red-50','success'=>'border-green-300 bg-green-50']; ?>
    <div class="rounded-xl border-l-4 p-4 <?=$type_c[$n['type_notif']]??'border-gray-300 bg-gray-50'?>">
        <div class="flex justify-between items-start">
            <div>
                <h3 class="font-bold text-sm text-asel-dark"><?=htmlspecialchars($n['titre'])?></h3>
                <p class="text-sm text-gray-600 mt-1"><?=htmlspecialchars($n['message'])?></p>
            </div>
            <span class="text-xs text-gray-400 shrink-0"><?=date('d/m H:i',strtotime($n['date_creation']))?></span>
        </div>
        <?php if ($n['lien']): ?><a href="<?=$n['lien']?>" class="text-asel text-xs font-semibold mt-1 inline-block hover:underline">Voir →</a><?php endif; ?>
    </div>
    <?php endforeach; ?>
    <?php if (empty($all_notifs)): ?>
    <div class="text-center text-gray-400 py-12"><i class="bi bi-bell text-4xl"></i><p class="mt-2">Aucune notification</p></div>
    <?php endif; ?>
</div>
<?php endif; ?>

<!-- MON COMPTE -->
<?php if ($page === 'mon_compte'): ?>
<h1 class="text-2xl font-bold text-asel-dark mb-6 flex items-center gap-2"><i class="bi bi-person-gear text-asel"></i> Mon compte</h1>

<div class="grid lg:grid-cols-2 gap-6">
    <!-- Infos -->
    <div class="bg-white rounded-xl shadow-sm p-6">
        <h3 class="font-bold text-asel-dark mb-4"><i class="bi bi-person"></i> Mes informations</h3>
        <div class="space-y-3 text-sm">
            <div class="flex justify-between py-2 border-b"><span class="text-gray-500">Nom</span><span class="font-semibold"><?=htmlspecialchars($user['nom_complet'])?></span></div>
            <div class="flex justify-between py-2 border-b"><span class="text-gray-500">Login</span><span class="font-mono"><?=htmlspecialchars($user['nom_utilisateur'])?></span></div>
            <div class="flex justify-between py-2 border-b"><span class="text-gray-500">Rôle</span><span><?=roleBadge($user['role'])?></span></div>
            <?php if($user['franchise_id']): $mf = queryOne("SELECT nom FROM franchises WHERE id=?",[$user['franchise_id']]); ?>
            <div class="flex justify-between py-2 border-b"><span class="text-gray-500">Franchise</span><span class="font-semibold"><?=shortF($mf['nom']??'')?></span></div>
            <?php endif; ?>
            <div class="flex justify-between py-2"><span class="text-gray-500">Membre depuis</span><span><?=date('d/m/Y',strtotime($user['date_creation']))?></span></div>
        </div>
    </div>
    
    <!-- Change password -->
    <div class="bg-white rounded-xl shadow-sm p-6">
        <h3 class="font-bold text-asel-dark mb-4"><i class="bi bi-shield-lock"></i> Changer mon mot de passe</h3>
        <div id="pwForm">
            <div class="space-y-3">
                <div><label class="text-sm font-semibold text-gray-700">Mot de passe actuel</label><input type="password" id="pw_current" class="w-full border-2 rounded-xl px-4 py-2.5 text-sm mt-1"></div>
                <div><label class="text-sm font-semibold text-gray-700">Nouveau mot de passe</label><input type="password" id="pw_new" class="w-full border-2 rounded-xl px-4 py-2.5 text-sm mt-1"></div>
                <div><label class="text-sm font-semibold text-gray-700">Confirmer</label><input type="password" id="pw_confirm" class="w-full border-2 rounded-xl px-4 py-2.5 text-sm mt-1"></div>
                <div id="pw_msg"></div>
                <button onclick="changePassword()" class="w-full bg-asel text-white font-bold py-2.5 rounded-xl"><i class="bi bi-check-circle"></i> Changer</button>
            </div>
        </div>
        <script>
        function changePassword(){
            const c=document.getElementById('pw_current').value;
            const n=document.getElementById('pw_new').value;
            const co=document.getElementById('pw_confirm').value;
            const msg=document.getElementById('pw_msg');
            if(!c||!n){msg.innerHTML='<p class="text-red-500 text-sm">Remplissez tous les champs</p>';return;}
            if(n!==co){msg.innerHTML='<p class="text-red-500 text-sm">Les mots de passe ne correspondent pas</p>';return;}
            if(n.length<6){msg.innerHTML='<p class="text-red-500 text-sm">Minimum 6 caractères</p>';return;}
            fetch('api.php',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'action=change_password&current='+encodeURIComponent(c)+'&new='+encodeURIComponent(n)})
            .then(r=>r.json()).then(d=>{
                if(d.success)msg.innerHTML='<p class="text-green-600 text-sm font-bold">✅ '+d.msg+'</p>';
                else msg.innerHTML='<p class="text-red-500 text-sm">❌ '+d.error+'</p>';
            });
        }
        </script>
    </div>
</div>

<!-- Activity log -->
<div class="bg-white rounded-xl shadow-sm overflow-hidden mt-6">
    <div class="px-4 py-3 border-b font-semibold text-sm"><i class="bi bi-clock-history text-asel"></i> Mon activité récente</div>
    <div id="activityLog" class="p-4 text-sm text-gray-500">Chargement...</div>
    <script>
    fetch('api.php?action=my_audit_log&limit=20').then(r=>r.json()).then(data=>{
        const el=document.getElementById('activityLog');
        if(!data.length){el.innerHTML='<p class="text-center text-gray-300">Aucune activité</p>';return;}
        const colors={'vente':'bg-green-100 text-green-800','entree_stock':'bg-blue-100 text-blue-800','login':'bg-purple-100 text-purple-800','dispatch_stock':'bg-indigo-100 text-indigo-800','retour':'bg-orange-100 text-orange-800','transfert_demande':'bg-yellow-100 text-yellow-800','add_produit':'bg-cyan-100 text-cyan-800','edit_produit':'bg-cyan-100 text-cyan-800','add_client':'bg-pink-100 text-pink-800'};
        el.innerHTML=data.map(m=>{
            const c=colors[m.action]||'bg-gray-100';
            return '<div class="py-2 border-b border-gray-100 flex justify-between"><div><span class="inline-flex px-2 py-0.5 rounded text-xs font-medium '+c+'">'+m.action+'</span> '+(m.cible?'<strong>'+m.cible+(m.cible_id?' #'+m.cible_id:'')+'</strong>':'')+'</div><span class="text-xs text-gray-400">'+m.date_creation.substring(5,16)+'</span></div>';
        }).join('');
    }).catch(()=>{document.getElementById('activityLog').innerHTML='<p class="text-center text-gray-300">Erreur de chargement</p>';});
    </script>
</div>
<?php endif; ?>

<!-- ADMIN: GESTION SERVICES -->
<?php if ($page === 'gestion_services' && can('gestion_services')):
    $services = query("SELECT * FROM services ORDER BY actif DESC, categorie_service, nom");
?>
<h1 class="text-2xl font-bold text-asel-dark mb-6 flex items-center gap-2"><i class="bi bi-gear text-asel"></i> Gérer les services</h1>
<div class="bg-white rounded-xl shadow-sm p-4 mb-4"><h3 class="font-bold text-sm mb-3">➕ Ajouter un service</h3>
<form method="POST" class="flex flex-wrap gap-2"><input type="hidden" name="_csrf" value="<?=$csrf?>"><input type="hidden" name="action" value="add_service">
<input name="nom" class="border-2 rounded-lg px-3 py-2 text-sm flex-1 min-w-[200px]" placeholder="Nom *" required>
<select name="categorie_service" class="form-input"><option value="technique">🔧 Technique</option><option value="compte">👤 Compte</option><option value="autre">📋 Autre</option></select>
<input name="prix" type="number" step="0.5" class="form-input w-24" placeholder="Prix" required>
<input name="duree_minutes" type="number" class="form-input w-24" placeholder="Durée min" value="15">
<input name="description" class="border-2 rounded-lg px-3 py-2 text-sm flex-1 min-w-[150px]" placeholder="Description">
<button class="btn-submit" style="width:auto;padding:10px 20px">+ Ajouter</button></form></div>
<div class="bg-white rounded-xl shadow-sm overflow-hidden"><div class="overflow-x-auto"><table class="w-full text-sm">
<thead><tr class="bg-asel-dark text-white text-xs uppercase"><th class="px-3 py-3 text-left">Service</th><th class="px-3 py-3">Cat.</th><th class="px-3 py-3 text-right">Prix</th><th class="px-3 py-3 hidden sm:table-cell">Durée</th><th class="px-3 py-3">Actif</th><th class="px-3 py-3">Edit</th></tr></thead>
<tbody class="divide-y"><?php foreach ($services as $s): $cb=['technique'=>'bg-orange-100 text-orange-800','compte'=>'bg-blue-100 text-blue-800','autre'=>'bg-gray-100']; ?>
<tr class="hover:bg-gray-50 <?=$s['actif']?'':'opacity-40'?>"><td class="px-3 py-2"><strong><?=htmlspecialchars($s['nom'])?></strong><br><span class="text-xs text-gray-400"><?=$s['description']?></span></td><td class="px-3 py-2 text-center"><span class="inline-flex px-2 py-0.5 rounded text-xs font-medium <?=$cb[$s['categorie_service']]??''?>"><?=$s['categorie_service']?></span></td><td class="px-3 py-2 text-right font-bold"><?=$s['prix']>0?number_format($s['prix'],1).' DT':'Devis'?></td><td class="px-3 py-2 text-center hidden sm:table-cell"><?=$s['duree_minutes']?>min</td><td class="px-3 py-2 text-center"><?=$s['actif']?'🟢':'🔴'?></td>
<td class="px-3 py-2"><button onclick="document.getElementById('es<?=$s['id']?>').classList.toggle('hidden')" class="text-asel"><i class="bi bi-pencil"></i></button></td></tr>
<tr id="es<?=$s['id']?>" class="hidden bg-blue-50"><td colspan="6" class="px-4 py-3"><form method="POST" class="flex flex-wrap gap-2 items-end"><input type="hidden" name="_csrf" value="<?=$csrf?>"><input type="hidden" name="action" value="edit_service"><input type="hidden" name="service_id" value="<?=$s['id']?>">
<div><label class="text-xs font-bold">Nom</label><input name="nom" value="<?=htmlspecialchars($s['nom'])?>" class="border rounded px-2 py-1 text-sm w-40"></div>
<div><label class="text-xs font-bold">Cat.</label><select name="categorie_service" class="border rounded px-2 py-1 text-sm"><option value="technique" <?=$s['categorie_service']==='technique'?'selected':''?>>Tech</option><option value="compte" <?=$s['categorie_service']==='compte'?'selected':''?>>Compte</option><option value="autre" <?=$s['categorie_service']==='autre'?'selected':''?>>Autre</option></select></div>
<div><label class="text-xs font-bold">Prix</label><input name="prix" type="number" step="0.5" value="<?=$s['prix']?>" class="border rounded px-2 py-1 text-sm w-20"></div>
<div><label class="text-xs font-bold">Durée</label><input name="duree_minutes" type="number" value="<?=$s['duree_minutes']?>" class="border rounded px-2 py-1 text-sm w-16"></div>
<div><label class="text-xs font-bold">Desc.</label><input name="description" value="<?=htmlspecialchars($s['description'])?>" class="border rounded px-2 py-1 text-sm w-36"></div>
<div><label class="text-xs font-bold">Actif</label><select name="actif" class="border rounded px-2 py-1 text-sm"><option value="1" <?=$s['actif']?'selected':''?>>Oui</option><option value="0" <?=!$s['actif']?'selected':''?>>Non</option></select></div>
<button class="bg-asel text-white px-3 py-1 rounded text-sm font-bold">💾</button></form></td></tr>
<?php endforeach; ?></tbody></table></div></div>
<?php endif; ?>

<!-- ADMIN: GESTION OFFRES ASEL -->
<?php if ($page === 'gestion_asel' && can('gestion_asel')):
    $asel_prods = query("SELECT * FROM produits_asel ORDER BY actif DESC, type_produit, valeur_nominale");
    $tl=['recharge_solde'=>'💳 Recharge','recharge_internet'=>'🌐 Forfait','carte_sim'=>'📱 SIM','autre'=>'📋 Autre'];
?>
<h1 class="text-2xl font-bold text-asel-dark mb-6 flex items-center gap-2"><i class="bi bi-sim text-asel"></i> Offres & Forfaits ASEL</h1>
<div class="bg-white rounded-xl shadow-sm p-4 mb-4"><h3 class="font-bold text-sm mb-3">➕ Ajouter une offre</h3>
<form method="POST" class="flex flex-wrap gap-2"><input type="hidden" name="_csrf" value="<?=$csrf?>"><input type="hidden" name="action" value="add_asel_product">
<input name="nom" class="border-2 rounded-lg px-3 py-2 text-sm flex-1 min-w-[200px]" placeholder="Nom *" required>
<select name="type_produit" class="form-input"><option value="recharge_solde">💳 Recharge</option><option value="recharge_internet">🌐 Forfait</option><option value="carte_sim">📱 SIM</option><option value="autre">Autre</option></select>
<input name="valeur_nominale" type="number" step="0.1" class="form-input w-24" placeholder="Valeur" required>
<input name="prix_vente" type="number" step="0.1" class="form-input w-24" placeholder="Prix" required>
<input name="commission" type="number" step="0.01" class="form-input w-24" placeholder="Comm.">
<button class="btn-submit" style="width:auto;padding:10px 20px">+ Ajouter</button></form></div>
<div class="bg-white rounded-xl shadow-sm overflow-hidden"><div class="overflow-x-auto"><table class="w-full text-sm">
<thead><tr class="bg-asel-dark text-white text-xs uppercase"><th class="px-3 py-3 text-left">Offre</th><th class="px-3 py-3">Type</th><th class="px-3 py-3 text-right">Valeur</th><th class="px-3 py-3 text-right">Prix</th><th class="px-3 py-3 text-right hidden sm:table-cell">Comm.</th><th class="px-3 py-3">Actif</th><th class="px-3 py-3">Edit</th></tr></thead>
<tbody class="divide-y"><?php foreach ($asel_prods as $p): $tb=['recharge_solde'=>'bg-green-100 text-green-800','recharge_internet'=>'bg-cyan-100 text-cyan-800','carte_sim'=>'bg-purple-100 text-purple-800','autre'=>'bg-gray-100']; ?>
<tr class="hover:bg-gray-50 <?=$p['actif']?'':'opacity-40'?>"><td class="px-3 py-2 font-medium"><?=htmlspecialchars($p['nom'])?></td><td class="px-3 py-2 text-center"><span class="inline-flex px-2 py-0.5 rounded text-xs font-medium <?=$tb[$p['type_produit']]??''?>"><?=$tl[$p['type_produit']]??$p['type_produit']?></span></td><td class="px-3 py-2 text-right"><?=number_format($p['valeur_nominale'],1)?></td><td class="px-3 py-2 text-right font-bold"><?=number_format($p['prix_vente'],1)?> DT</td><td class="px-3 py-2 text-right text-green-600 hidden sm:table-cell"><?=number_format($p['commission'],2)?></td><td class="px-3 py-2 text-center"><?=$p['actif']?'🟢':'🔴'?></td>
<td class="px-3 py-2"><button onclick="document.getElementById('ea<?=$p['id']?>').classList.toggle('hidden')" class="text-asel"><i class="bi bi-pencil"></i></button></td></tr>
<tr id="ea<?=$p['id']?>" class="hidden bg-blue-50"><td colspan="7" class="px-4 py-3"><form method="POST" class="flex flex-wrap gap-2 items-end"><input type="hidden" name="_csrf" value="<?=$csrf?>"><input type="hidden" name="action" value="edit_asel_product"><input type="hidden" name="produit_id" value="<?=$p['id']?>">
<div><label class="text-xs font-bold">Nom</label><input name="nom" value="<?=htmlspecialchars($p['nom'])?>" class="border rounded px-2 py-1 text-sm w-44"></div>
<div><label class="text-xs font-bold">Type</label><select name="type_produit" class="border rounded px-2 py-1 text-sm"><option value="recharge_solde" <?=$p['type_produit']==='recharge_solde'?'selected':''?>>Recharge</option><option value="recharge_internet" <?=$p['type_produit']==='recharge_internet'?'selected':''?>>Forfait</option><option value="carte_sim" <?=$p['type_produit']==='carte_sim'?'selected':''?>>SIM</option><option value="autre" <?=$p['type_produit']==='autre'?'selected':''?>>Autre</option></select></div>
<div><label class="text-xs font-bold">Valeur</label><input name="valeur_nominale" type="number" step="0.1" value="<?=$p['valeur_nominale']?>" class="border rounded px-2 py-1 text-sm w-20"></div>
<div><label class="text-xs font-bold">Prix</label><input name="prix_vente" type="number" step="0.1" value="<?=$p['prix_vente']?>" class="border rounded px-2 py-1 text-sm w-20"></div>
<div><label class="text-xs font-bold">Comm.</label><input name="commission" type="number" step="0.01" value="<?=$p['commission']?>" class="border rounded px-2 py-1 text-sm w-20"></div>
<div><label class="text-xs font-bold">Actif</label><select name="actif" class="border rounded px-2 py-1 text-sm"><option value="1" <?=$p['actif']?'selected':''?>>Oui</option><option value="0" <?=!$p['actif']?'selected':''?>>Non</option></select></div>
<button class="bg-asel text-white px-3 py-1 rounded text-sm font-bold">💾</button></form></td></tr>
<?php endforeach; ?></tbody></table></div></div>
<?php endif; ?>

<!-- AUDIT LOG (admin only) -->
<?php if ($page === 'audit_log' && isAdmin()):
    $filter_user = $_GET['audit_user'] ?? '';
    $filter_action = $_GET['audit_action'] ?? '';
    $filter_d1 = $_GET['audit_d1'] ?? date('Y-m-d', strtotime('-7 days'));
    $filter_d2 = $_GET['audit_d2'] ?? date('Y-m-d');
    
    $where = ["date_creation BETWEEN ? AND DATE_ADD(?, INTERVAL 1 DAY)"];
    $params = [$filter_d1, $filter_d2];
    if ($filter_user) { $where[] = "utilisateur_id=?"; $params[] = $filter_user; }
    if ($filter_action) { $where[] = "action=?"; $params[] = $filter_action; }
    
    $audit_logs = query("SELECT * FROM audit_logs WHERE " . implode(' AND ', $where) . " ORDER BY date_creation DESC LIMIT 200", $params);
    $all_users_audit = query("SELECT DISTINCT utilisateur_id, utilisateur_nom FROM audit_logs ORDER BY utilisateur_nom");
    $all_actions_audit = query("SELECT DISTINCT action FROM audit_logs ORDER BY action");
?>
<h1 class="text-2xl font-bold text-asel-dark mb-6 flex items-center gap-2"><i class="bi bi-journal-text text-asel"></i> Journal d'audit</h1>

<!-- Filters -->
<form class="bg-white rounded-xl shadow-sm p-4 mb-4 flex flex-wrap gap-3 items-end">
    <input type="hidden" name="page" value="audit_log">
    <div>
        <label class="text-xs font-bold text-gray-500 block mb-1">Utilisateur</label>
        <select name="audit_user" class="border-2 border-gray-200 rounded-lg px-3 py-2 text-sm">
            <option value="">Tous</option>
            <?php foreach ($all_users_audit as $au): ?>
            <option value="<?=$au['utilisateur_id']?>" <?=$filter_user==$au['utilisateur_id']?'selected':''?>><?=htmlspecialchars($au['utilisateur_nom'])?></option>
            <?php endforeach; ?>
        </select>
    </div>
    <div>
        <label class="text-xs font-bold text-gray-500 block mb-1">Action</label>
        <select name="audit_action" class="border-2 border-gray-200 rounded-lg px-3 py-2 text-sm">
            <option value="">Toutes</option>
            <?php foreach ($all_actions_audit as $aa): ?>
            <option value="<?=$aa['action']?>" <?=$filter_action==$aa['action']?'selected':''?>><?=$aa['action']?></option>
            <?php endforeach; ?>
        </select>
    </div>
    <div>
        <label class="text-xs font-bold text-gray-500 block mb-1">Du</label>
        <input type="date" name="audit_d1" value="<?=$filter_d1?>" class="border-2 border-gray-200 rounded-lg px-3 py-2 text-sm">
    </div>
    <div>
        <label class="text-xs font-bold text-gray-500 block mb-1">Au</label>
        <input type="date" name="audit_d2" value="<?=$filter_d2?>" class="border-2 border-gray-200 rounded-lg px-3 py-2 text-sm">
    </div>
    <button class="bg-asel text-white px-4 py-2 rounded-lg text-sm font-semibold"><i class="bi bi-funnel"></i> Filtrer</button>
    <a href="?page=audit_log" class="text-gray-400 hover:text-gray-600 text-sm px-2 py-2">Réinitialiser</a>
</form>

<div class="text-xs text-gray-400 mb-2"><?=count($audit_logs)?> entrée(s) trouvée(s)</div>

<div class="bg-white rounded-xl shadow-sm overflow-hidden">
    <div class="overflow-x-auto"><table class="w-full text-sm">
        <thead><tr class="bg-asel-dark text-white text-xs uppercase tracking-wider">
            <th class="px-3 py-3 text-left">Date</th>
            <th class="px-3 py-3 text-left">Utilisateur</th>
            <th class="px-3 py-3">Action</th>
            <th class="px-3 py-3 text-left">Cible</th>
            <th class="px-3 py-3 text-left hidden md:table-cell">Détails</th>
            <th class="px-3 py-3 text-left hidden lg:table-cell">IP</th>
        </tr></thead>
        <tbody class="divide-y divide-gray-100">
        <?php foreach ($audit_logs as $log):
            $action_colors = [
                'vente'=>'bg-green-100 text-green-800',
                'entree_stock'=>'bg-blue-100 text-blue-800',
                'dispatch_stock'=>'bg-indigo-100 text-indigo-800',
                'transfert_demande'=>'bg-yellow-100 text-yellow-800',
                'login'=>'bg-purple-100 text-purple-800',
                'add_produit'=>'bg-cyan-100 text-cyan-800',
                'edit_produit'=>'bg-cyan-100 text-cyan-800',
                'add_user'=>'bg-pink-100 text-pink-800',
                'edit_user'=>'bg-pink-100 text-pink-800',
                'retour'=>'bg-orange-100 text-orange-800',
                'cancel_facture'=>'bg-red-100 text-red-800',
                'validate_inventaire'=>'bg-emerald-100 text-emerald-800',
                'validate_cloture'=>'bg-emerald-100 text-emerald-800',
            ];
        ?>
            <tr class="hover:bg-gray-50">
                <td class="px-3 py-2 text-xs text-gray-400 whitespace-nowrap"><?=date('d/m H:i:s', strtotime($log['date_creation']))?></td>
                <td class="px-3 py-2 font-medium text-sm"><?=htmlspecialchars($log['utilisateur_nom'] ?? '?')?></td>
                <td class="px-3 py-2 text-center"><span class="inline-flex px-2 py-0.5 rounded text-xs font-medium <?=$action_colors[$log['action']] ?? 'bg-gray-100'?>"><?=$log['action']?></span></td>
                <td class="px-3 py-2 text-xs"><?=$log['cible'] ?? '—'?> <?=$log['cible_id'] ? '#'.$log['cible_id'] : ''?></td>
                <td class="px-3 py-2 text-xs text-gray-500 hidden md:table-cell max-w-xs truncate"><?=htmlspecialchars(substr($log['details'] ?? '', 0, 100))?></td>
                <td class="px-3 py-2 text-xs font-mono text-gray-400 hidden lg:table-cell"><?=$log['ip_address']?></td>
            </tr>
        <?php endforeach; ?>
        <?php if (empty($audit_logs)): ?>
            <tr><td colspan="6" class="px-4 py-8 text-center text-gray-400">Aucune activité enregistrée pour ces filtres</td></tr>
        <?php endif; ?>
        </tbody>
    </table></div>
</div>
<?php endif; ?>

<!-- FRANCHISE LOCATION EDITOR (admin only) -->
<?php if ($page === 'franchise_locations' && isAdmin()):
    $all_franchises = query("SELECT * FROM franchises WHERE actif=1 ORDER BY type_franchise DESC, nom");
?>
<h1 class="text-2xl font-bold text-asel-dark mb-6 flex items-center gap-2"><i class="bi bi-geo-alt text-asel"></i> Coordonnées des franchises</h1>

<div class="bg-white rounded-xl shadow-sm overflow-hidden mb-6">
    <div class="px-4 py-3 border-b font-semibold text-sm text-asel-dark"><i class="bi bi-map text-asel"></i> Aperçu carte</div>
    <div id="locationPreviewMap" style="height:300px"></div>
</div>

<div class="grid sm:grid-cols-2 gap-4 mb-6">
    <?php foreach ($all_franchises as $f): if ($f['type_franchise'] === 'central') continue; ?>
    <div class="bg-white rounded-xl shadow-sm p-5 border-l-4 border-asel">
        <h3 class="font-bold text-asel-dark"><?=shortF($f['nom'])?></h3>
        <p class="text-xs text-gray-400 mb-3"><i class="bi bi-geo-alt"></i> <?=$f['adresse']?></p>
        <form method="POST" class="space-y-2" id="locForm_<?=$f['id']?>">
            <input type="hidden" name="_csrf" value="<?=$csrf?>">
            <input type="hidden" name="action" value="update_franchise_location">
            <input type="hidden" name="franchise_id" value="<?=$f['id']?>">
            <div class="grid grid-cols-2 gap-2">
                <div>
                    <label class="text-xs font-bold text-gray-500">Latitude</label>
                    <input name="latitude" type="number" step="0.000001" value="<?=$f['latitude']?>" class="w-full border-2 border-gray-200 rounded-lg px-3 py-2 text-sm font-mono" placeholder="36.XXXXXX" id="lat_<?=$f['id']?>">
                </div>
                <div>
                    <label class="text-xs font-bold text-gray-500">Longitude</label>
                    <input name="longitude" type="number" step="0.000001" value="<?=$f['longitude']?>" class="w-full border-2 border-gray-200 rounded-lg px-3 py-2 text-sm font-mono" placeholder="10.XXXXXX" id="lng_<?=$f['id']?>">
                </div>
            </div>
            <div class="flex gap-2">
                <button type="submit" class="bg-asel text-white px-4 py-2 rounded-lg text-xs font-bold flex-1"><i class="bi bi-check-circle"></i> Enregistrer</button>
                <button type="button" onclick="getLocation(<?=$f['id']?>)" id="geoBtn_<?=$f['id']?>" class="bg-green-500 text-white px-4 py-2 rounded-lg text-xs font-bold"><i class="bi bi-crosshair" id="geoIcon_<?=$f['id']?>"></i> Ma position</button>
            </div>
            <div id="geoStatus_<?=$f['id']?>" class="text-xs mt-1 hidden"></div>
        </form>
        <?php if ($f['latitude'] && $f['longitude']): ?>
        <a href="https://www.google.com/maps?q=<?=$f['latitude']?>,<?=$f['longitude']?>" target="_blank" class="text-asel text-xs hover:underline mt-2 inline-flex items-center gap-1"><i class="bi bi-map"></i> Voir sur Google Maps</a>
        <?php endif; ?>
    </div>
    <?php endforeach; ?>
</div>

<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
// Initialize preview map
const locMap = L.map('locationPreviewMap').setView([36.79, 10.17], 11);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(locMap);
const aselIcon = L.divIcon({
    html: '<div style="background:#2AABE2;color:white;width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:14px;box-shadow:0 2px 8px rgba(0,0,0,0.3);border:2px solid white">A</div>',
    className: '', iconSize: [32, 32], iconAnchor: [16, 16]
});
<?php foreach ($all_franchises as $f): if ($f['latitude'] && $f['longitude'] && $f['type_franchise'] !== 'central'): ?>
L.marker([<?=$f['latitude']?>, <?=$f['longitude']?>], {icon: aselIcon}).addTo(locMap).bindPopup('<strong><?=addslashes(shortF($f["nom"]))?></strong>');
<?php endif; endforeach; ?>

function getLocation(fid) {
    const btn = document.getElementById('geoBtn_' + fid);
    const icon = document.getElementById('geoIcon_' + fid);
    const status = document.getElementById('geoStatus_' + fid);
    
    // Check if geolocation is available
    if (!navigator.geolocation) {
        status.className = 'text-xs mt-1 text-red-500';
        status.textContent = 'Géolocalisation non supportée par ce navigateur';
        status.classList.remove('hidden');
        return;
    }
    
    // Check HTTPS (geolocation requires secure context)
    if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
        status.className = 'text-xs mt-1 text-amber-600';
        status.textContent = '⚠️ HTTPS requis pour la géolocalisation. Saisissez les coordonnées manuellement.';
        status.classList.remove('hidden');
        return;
    }
    
    // Show loading state
    btn.disabled = true;
    icon.className = 'bi bi-arrow-repeat animate-spin';
    btn.innerHTML = '<i class="bi bi-arrow-repeat" style="animation:spin 1s linear infinite"></i> Localisation...';
    status.className = 'text-xs mt-1 text-blue-500';
    status.textContent = 'Acquisition de la position GPS...';
    status.classList.remove('hidden');
    
    navigator.geolocation.getCurrentPosition(
        (pos) => {
            document.getElementById('lat_' + fid).value = pos.coords.latitude.toFixed(6);
            document.getElementById('lng_' + fid).value = pos.coords.longitude.toFixed(6);
            
            // Update map
            L.marker([pos.coords.latitude, pos.coords.longitude], {icon: aselIcon}).addTo(locMap);
            locMap.setView([pos.coords.latitude, pos.coords.longitude], 15);
            
            // Success state
            btn.disabled = false;
            btn.innerHTML = '<i class="bi bi-check-circle"></i> Position trouvée!';
            btn.className = 'bg-green-600 text-white px-4 py-2 rounded-lg text-xs font-bold';
            status.className = 'text-xs mt-1 text-green-600';
            status.textContent = '✅ Position: ' + pos.coords.latitude.toFixed(4) + ', ' + pos.coords.longitude.toFixed(4) + ' (précision: ±' + Math.round(pos.coords.accuracy) + 'm)';
            
            // Reset button after 3s
            setTimeout(() => {
                btn.innerHTML = '<i class="bi bi-crosshair"></i> Ma position';
                btn.className = 'bg-green-500 text-white px-4 py-2 rounded-lg text-xs font-bold';
            }, 3000);
        },
        (err) => {
            btn.disabled = false;
            btn.innerHTML = '<i class="bi bi-crosshair"></i> Ma position';
            status.classList.remove('hidden');
            
            let msg = '';
            switch(err.code) {
                case err.PERMISSION_DENIED:
                    msg = '❌ Permission refusée. Autorisez la géolocalisation dans les paramètres du navigateur.';
                    break;
                case err.POSITION_UNAVAILABLE:
                    msg = '❌ Position non disponible. Vérifiez que le GPS est activé.';
                    break;
                case err.TIMEOUT:
                    msg = '❌ Délai dépassé. Réessayez dans un endroit avec meilleur signal.';
                    break;
                default:
                    msg = '❌ Erreur inconnue: ' + err.message;
            }
            status.className = 'text-xs mt-1 text-red-500';
            status.textContent = msg;
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
}
</script>
<style>@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }</style>
<?php endif; ?>

    </div>
</main>

<!-- STOCK CENTRAL PAGE -->
<?php if ($page === 'stock_central' && can('stock_central')):
    $cid = getCentralId();
    $central_stock = query("SELECT s.*,p.nom as pnom,p.prix_vente,p.prix_achat,p.reference,p.marque,c.nom as cnom FROM stock s JOIN produits p ON s.produit_id=p.id JOIN categories c ON p.categorie_id=c.id WHERE s.franchise_id=? AND p.actif=1 ORDER BY c.nom,p.nom", [$cid]);
    $central_total_qty = array_sum(array_column($central_stock, 'quantite'));
    $central_total_val = 0;
    foreach ($central_stock as $cs) $central_total_val += $cs['quantite'] * $cs['prix_vente'];
    $recent_dispatches = query("SELECT t.*,p.nom as pnom,fd.nom as dest_nom FROM transferts t JOIN produits p ON t.produit_id=p.id JOIN franchises fd ON t.franchise_dest=fd.id WHERE t.franchise_source=? ORDER BY t.date_demande DESC LIMIT 20", [$cid]);
?>
<main class="lg:ml-64 pt-14 lg:pt-0 min-h-screen">
    <div class="p-4 lg:p-6 max-w-7xl mx-auto">
    
    <?php if ($flash): ?>
    <div class="mb-4 p-4 rounded-xl flex items-center gap-3 <?=$flash['type']==='success'?'bg-green-50 text-green-800 border border-green-200':'bg-red-50 text-red-800 border border-red-200'?>">
        <i class="bi <?=$flash['type']==='success'?'bi-check-circle-fill':'bi-exclamation-circle-fill'?> text-lg"></i>
        <span class="text-sm font-medium"><?=$flash['msg']?></span>
    </div>
    <?php endif; ?>
    
    <div class="flex justify-between items-center mb-6">
        <h1 class="text-2xl font-bold text-asel-dark flex items-center gap-2"><i class="bi bi-building text-asel"></i> Stock Central (Entrepôt)</h1>
        <a href="api.php?action=export_stock&fid=<?=$cid?>" class="bg-white border-2 border-asel text-asel font-semibold px-4 py-2 rounded-xl text-sm hover:bg-asel hover:text-white transition-colors"><i class="bi bi-download"></i> Export</a>
    </div>
    
    <!-- KPIs -->
    <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div class="bg-white rounded-xl p-5 shadow-sm border-l-4 border-indigo-500 hover-lift">
            <div class="text-xs font-semibold text-gray-400 uppercase tracking-wider">Articles en stock</div>
            <div class="text-2xl font-black text-asel-dark mt-1"><?=number_format($central_total_qty)?></div>
        </div>
        <div class="bg-white rounded-xl p-5 shadow-sm border-l-4 border-emerald-500 hover-lift">
            <div class="text-xs font-semibold text-gray-400 uppercase tracking-wider">Valeur totale</div>
            <div class="text-2xl font-black text-asel-dark mt-1"><?=number_format($central_total_val)?> DT</div>
        </div>
        <div class="bg-white rounded-xl p-5 shadow-sm border-l-4 border-amber-500 hover-lift">
            <div class="text-xs font-semibold text-gray-400 uppercase tracking-wider">Références</div>
            <div class="text-2xl font-black text-asel-dark mt-1"><?=count(array_filter($central_stock, fn($s)=>$s['quantite']>0))?></div>
            <div class="text-xs text-gray-400">avec stock &gt; 0</div>
        </div>
        <div class="bg-white rounded-xl p-5 shadow-sm border-l-4 border-purple-500 hover-lift">
            <div class="text-xs font-semibold text-gray-400 uppercase tracking-wider">Dispatches récents</div>
            <div class="text-2xl font-black text-asel-dark mt-1"><?=count($recent_dispatches)?></div>
        </div>
    </div>
    
    <!-- Dispatch Form -->
    <div class="form-card mb-6">
        <h3><i class="bi bi-truck text-indigo-500"></i> Dispatcher vers une franchise</h3>
        <form method="POST" class="space-y-3">
            <input type="hidden" name="_csrf" value="<?=$csrf?>">
            <input type="hidden" name="action" value="dispatch_stock">
            <div class="form-row form-row-4">
                <div class="col-span-2 sm:col-span-1">
                    <label class="form-label">Produit</label>
                    <select name="produit_id" class="ts-select w-full" data-placeholder="Rechercher un produit..." required>
                        <?php foreach ($central_stock as $cs): if ($cs['quantite'] <= 0) continue; ?>
                        <option value="<?=$cs['produit_id']?>"><?=htmlspecialchars($cs['pnom'])?> (<?=$cs['cnom']?>) — Stock: <?=$cs['quantite']?></option>
                        <?php endforeach; ?>
                    </select>
                </div>
                <div>
                    <label class="form-label">Franchise destination</label>
                    <select name="franchise_id" class="form-input" required>
                        <?php foreach ($franchises as $f): ?>
                        <option value="<?=$f['id']?>"><?=shortF($f['nom'])?></option>
                        <?php endforeach; ?>
                    </select>
                </div>
                <div>
                    <label class="form-label">Quantité</label>
                    <input type="number" name="quantite" min="1" value="1" required class="form-input">
                </div>
                <div>
                    <label class="form-label">Note</label>
                    <input type="text" name="note" class="form-input" placeholder="Optionnel...">
                </div>
            </div>
            <button type="submit" class="btn-submit" style="background:#4f46e5"><i class="bi bi-truck"></i> Dispatcher</button>
        </form>
    </div>
    
    <!-- Entrée stock central -->
    <div class="form-card mb-6">
        <h3><i class="bi bi-box-arrow-in-down text-asel"></i> Réception au Stock Central</h3>
        <form method="POST" class="space-y-3">
            <input type="hidden" name="_csrf" value="<?=$csrf?>">
            <input type="hidden" name="action" value="entree_stock">
            <input type="hidden" name="franchise_id" value="<?=$cid?>">
            <div class="form-row form-row-3">
                <div>
                    <label class="form-label">Produit</label>
                    <select name="produit_id" class="ts-select w-full" data-placeholder="Rechercher un produit..."><?php foreach ($produits as $p): ?><option value="<?=$p['id']?>"><?=$p['nom']?> (<?=$p['cat_nom']?>)</option><?php endforeach; ?></select>
                </div>
                <div>
                    <label class="form-label">Quantité</label>
                    <input type="number" name="quantite" min="1" value="1" required class="form-input">
                </div>
                <div>
                    <label class="form-label">Note</label>
                    <input type="text" name="note" class="form-input" placeholder="Fournisseur, BL...">
                </div>
            </div>
            <button type="submit" class="btn-submit"><i class="bi bi-box-arrow-in-down"></i> Réceptionner</button>
        </form>
    </div>
    
    <!-- Central Stock Table -->
    <div class="bg-white rounded-xl shadow-sm overflow-hidden mb-6">
        <div class="px-4 py-3 border-b font-semibold text-sm text-asel-dark flex items-center gap-2"><i class="bi bi-box-seam text-asel"></i> Inventaire Stock Central</div>
        <div class="overflow-x-auto">
            <table class="w-full text-sm">
                <thead><tr class="bg-indigo-900 text-white text-xs uppercase tracking-wider"><th class="px-3 py-3 text-left">Catégorie</th><th class="px-3 py-3 text-left">Produit</th><th class="px-3 py-3 text-left hidden sm:table-cell">Marque</th><th class="px-3 py-3 text-center">Qté</th><th class="px-3 py-3 text-right">P.V.</th><th class="px-3 py-3 text-right hidden sm:table-cell">Valeur</th></tr></thead>
                <tbody class="divide-y divide-gray-100"><?php foreach ($central_stock as $s): $v=$s['quantite']*$s['prix_vente']; ?>
                    <tr class="hover:bg-gray-50 <?=$s['quantite']<=0?'bg-red-50/50':($s['quantite']<=3?'bg-amber-50/30':'')?>">
                        <td class="px-3 py-2 text-xs"><?=$s['cnom']?></td>
                        <td class="px-3 py-2 font-medium"><?=htmlspecialchars($s['pnom'])?></td>
                        <td class="px-3 py-2 text-xs text-gray-400 hidden sm:table-cell"><?=$s['marque']?></td>
                        <td class="px-3 py-2 text-center"><span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold <?=$s['quantite']<=0?'bg-red-100 text-red-800':($s['quantite']<=3?'bg-amber-100 text-amber-800':'bg-green-100 text-green-800')?>"><?=$s['quantite']?></span></td>
                        <td class="px-3 py-2 text-right"><?=number_format($s['prix_vente'],1)?></td>
                        <td class="px-3 py-2 text-right font-medium hidden sm:table-cell"><?=number_format($v,0)?></td>
                    </tr>
                <?php endforeach; ?></tbody>
                <tfoot><tr class="bg-indigo-900 text-white font-bold"><td colspan="3" class="px-3 py-3">TOTAL</td><td class="px-3 py-3 text-center"><?=number_format($central_total_qty)?></td><td class="px-3 py-3"></td><td class="px-3 py-3 text-right hidden sm:table-cell"><?=number_format($central_total_val)?> DT</td></tr></tfoot>
            </table>
        </div>
    </div>
    
    <!-- Recent Dispatches -->
    <?php if ($recent_dispatches): ?>
    <div class="bg-white rounded-xl shadow-sm overflow-hidden">
        <div class="px-4 py-3 border-b font-semibold text-sm text-asel-dark"><i class="bi bi-truck text-indigo-500"></i> Derniers dispatches</div>
        <div class="overflow-x-auto"><table class="w-full text-sm">
            <thead><tr class="bg-gray-50 text-xs"><th class="px-3 py-2 text-left">Date</th><th class="px-3 py-2 text-left">Produit</th><th class="px-3 py-2">Qté</th><th class="px-3 py-2 text-left">Destination</th><th class="px-3 py-2">Statut</th></tr></thead>
            <tbody class="divide-y"><?php foreach ($recent_dispatches as $d): ?>
                <tr class="hover:bg-gray-50">
                    <td class="px-3 py-2 text-xs text-gray-400"><?=date('d/m H:i',strtotime($d['date_demande']))?></td>
                    <td class="px-3 py-2 font-medium"><?=htmlspecialchars($d['pnom'])?></td>
                    <td class="px-3 py-2 text-center font-bold"><?=$d['quantite']?></td>
                    <td class="px-3 py-2 text-xs"><?=shortF($d['dest_nom'])?></td>
                    <td class="px-3 py-2 text-center"><span class="inline-flex px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800"><?=$d['statut']?></span></td>
                </tr>
            <?php endforeach; ?></tbody>
        </table></div>
    </div>
    <?php endif; ?>
    
    </div>
</main>
<?php endif; ?>

<!-- Footer -->
<footer class="lg:ml-64 bg-white border-t py-3 px-6 text-center text-xs text-gray-400">
    <span>&copy; <?=date('Y')?> ASEL Mobile</span> &middot; 
    <a href="map.php" target="_blank" class="text-asel hover:underline"><i class="bi bi-map"></i> Nos franchises</a> &middot; 
    <span>v11.0</span>
</footer>

<!-- Global Barcode Scanner Modal -->
<div id="scannerModal" class="fixed inset-0 z-[9999] bg-black/70 hidden items-center justify-center p-4" style="display:none">
    <div class="bg-white rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl">
        <div class="bg-asel-dark text-white px-4 py-3 flex justify-between items-center">
            <span class="font-bold text-sm"><i class="bi bi-camera"></i> Scanner le code-barres</span>
            <button onclick="closeScanner()" class="text-white/70 hover:text-white text-xl">&times;</button>
        </div>
        <div class="p-4">
            <div id="globalReader" class="rounded-lg overflow-hidden"></div>
            <p class="text-xs text-gray-400 text-center mt-2">Pointez la caméra vers le code-barres</p>
            <div id="scannerResult" class="mt-2 text-center text-sm"></div>
        </div>
        <div class="px-4 pb-4">
            <div class="text-center text-xs text-gray-400 mb-2">— ou saisir manuellement —</div>
            <div class="flex gap-2">
                <input type="text" id="manualBarcodeInput" class="flex-1 border-2 border-dashed border-asel/30 rounded-lg px-3 py-2 text-center font-mono text-sm" placeholder="Saisir le code...">
                <button onclick="manualBarcodeDone()" class="bg-asel text-white px-4 py-2 rounded-lg text-sm font-bold">OK</button>
            </div>
        </div>
    </div>
</div>

<script>
let globalScanner = null;
let scannerTargetInput = null;

function openScanner(inputId) {
    scannerTargetInput = document.getElementById(inputId);
    const modal = document.getElementById('scannerModal');
    modal.style.display = 'flex';
    document.getElementById('scannerResult').innerHTML = '';
    document.getElementById('manualBarcodeInput').value = '';
    
    // Start camera
    globalScanner = new Html5Qrcode("globalReader");
    globalScanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 250, height: 100 }, aspectRatio: 2.0 },
        (decodedText) => {
            // Success!
            if (scannerTargetInput) {
                scannerTargetInput.value = decodedText;
            }
            document.getElementById('scannerResult').innerHTML = '<span class="text-green-600 font-bold"><i class="bi bi-check-circle"></i> ' + decodedText + '</span>';
            // Auto close after 1s
            setTimeout(() => closeScanner(), 1000);
        },
        (errorMessage) => { /* ignore */ }
    ).catch(err => {
        document.getElementById('scannerResult').innerHTML = '<span class="text-red-500 text-xs"><i class="bi bi-exclamation-triangle"></i> Caméra non disponible. Saisissez manuellement.</span>';
    });
}

function closeScanner() {
    if (globalScanner) {
        globalScanner.stop().then(() => {
            globalScanner.clear();
            globalScanner = null;
        }).catch(e => {});
    }
    document.getElementById('scannerModal').style.display = 'none';
}

function manualBarcodeDone() {
    const val = document.getElementById('manualBarcodeInput').value.trim();
    if (val && scannerTargetInput) {
        scannerTargetInput.value = val;
    }
    closeScanner();
}

// Close on Escape
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeScanner(); });
</script>

<script>
// Initialize Tom Select on all selects with .ts-select class
document.addEventListener('DOMContentLoaded', function() {
    document.querySelectorAll('.ts-select').forEach(el => {
        new TomSelect(el, {
            create: false,
            sortField: { field: "text", direction: "asc" },
            maxOptions: 50,
            placeholder: el.dataset.placeholder || 'Rechercher...',
        });
    });
});
</script>
<script src="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.js"></script>
</body>
</html>
