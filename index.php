<?php
require_once 'helpers.php';
requireLogin();
// Production: suppress PHP notices/warnings to avoid page breakage
error_reporting(E_ALL & ~E_NOTICE & ~E_DEPRECATED & ~E_STRICT);
@ini_set('display_errors', 0);

// Auto-update overdue écheances (lightweight — runs in background on each load)
// Only run once per hour per session to avoid hammering DB
if(!isset($_SESSION['last_echeance_check']) || (time() - $_SESSION['last_echeance_check']) > 3600) {
    try {
        execute("UPDATE echeances SET statut='en_retard' WHERE statut='en_attente' AND date_echeance < CURDATE()");
        $_SESSION['last_echeance_check'] = time();
    } catch(Exception $e) { /* silent */ }
}
$page = $_GET['page'] ?? 'dashboard';
// Vendeur defaults to POS
if ($page === 'dashboard' && isset($_SESSION['user']) && ($_SESSION['user']['role'] ?? '') === 'vendeur') {
    $page = 'pos';
}
$user = currentUser();
$fid = scopedFranchiseId();
$centralId = getCentralId();
$retailFranchises = getRetailFranchises();

// === RBAC: Check page permission ===
// Special admin tools via ?tool= parameter (no page permission needed)
if (isset($_GET['tool']) && $_GET['tool'] === 'import_phones' && isAdmin()) {
    $page = '__import_phones__';
}
if (isset($_GET['tool']) && $_GET['tool'] === 'add_invoice_products' && isAdmin()) {
    $page = '__add_invoice_products__';
}
if ($page !== '__import_phones__' && $page !== '__add_invoice_products__') {
    requirePermission($page);
}

// === Handle POST ===
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    try {
    verifyCsrf();
    $action = $_POST['action'] ?? '';
    requirePermission($action);
    
    if ($action === 'vente') {
        $items = json_decode($_POST['items'], true);
        if (empty($items)) {
            $_SESSION['flash'] = ['type'=>'danger','msg'=>'Panier vide!'];
            header("Location: index.php?page=pos"); exit;
        }
        $vfid = can('view_all_franchises') ? intval($_POST['franchise_id']) : currentFranchise();
        $client_id = intval($_POST['client_id']) ?: null;
        $type_facture = $_POST['type_facture'] ?? 'ticket';
        $mode_paiement = $_POST['mode_paiement'] ?? 'especes';
        $montant_recu = floatval($_POST['montant_recu'] ?? 0);
        
        // === PRE-CHECK STOCK BEFORE ANY INSERT (prevent partial sales) ===
        foreach ($items as $item) {
            $pid = intval($item['id']);
            $qty = intval($item['qty']);
            $sc = queryOne("SELECT quantite FROM stock WHERE franchise_id=? AND produit_id=?", [$vfid, $pid]);
            if (!$sc || $sc['quantite'] < $qty) {
                $_SESSION['flash'] = ['type'=>'danger','msg'=>'❌ Stock insuffisant: <b>'.e($item['nom']).'</b> (dispo: '.($sc['quantite']??0).')'];
                header("Location: index.php?page=pos&fid=$vfid"); exit;
            }
        }
        
        // Calculate totals
        $sous_total = 0; $remise_totale = 0;
        foreach ($items as $item) {
            $sous_total += $item['qty'] * $item['prix'];
            $remise_totale += floatval($item['remise'] ?? 0);
        }
        $total_ttc = max(0, $sous_total - $remise_totale);
        $monnaie = max(0, $montant_recu - $total_ttc);
        
        // Generate facture number
        $prefix = match($type_facture) { 'facture'=>'FA','devis'=>'DV',default=>'TK' };
        $count = queryOne("SELECT COUNT(*)+1 as n FROM factures WHERE DATE(date_facture)=CURDATE() AND type_facture=?", [$type_facture])['n'];
        $numero = $prefix . '-' . date('Ymd') . '-' . str_pad($count, 4, '0', STR_PAD_LEFT);
        
        // Create facture (stock pre-checked above, safe to insert)
        // Calculate HT and TVA from TTC (default 19% TVA)
        $total_ht_calc = round($total_ttc / 1.19, 2);
        $tva_calc = $total_ttc - $total_ht_calc;
        execute("INSERT INTO factures (numero,franchise_id,client_id,type_facture,sous_total,remise_totale,total_ht,tva,total_ttc,mode_paiement,montant_recu,monnaie,utilisateur_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
            [$numero, $vfid, $client_id, $type_facture, $sous_total, $remise_totale, $total_ht_calc, $tva_calc, $total_ttc, $mode_paiement, $montant_recu, round($monnaie,2), $user['id']]);
        $facture_id = db()->lastInsertId();
        
        // Create lines + stock updates
        foreach ($items as $item) {
            $remise_dt = floatval($item['remise'] ?? 0);
            $total = round($item['qty'] * $item['prix'] - $remise_dt, 2);
            if ($total < 0) $total = 0;
            
            execute("INSERT INTO facture_lignes (facture_id,type_ligne,produit_id,designation,quantite,prix_unitaire,remise,total) VALUES (?,?,?,?,?,?,?,?)",
                [$facture_id, 'produit', $item['id'], $item['nom'], $item['qty'], $item['prix'], $remise_dt, $total]);
            execute("INSERT INTO ventes (franchise_id,produit_id,quantite,prix_unitaire,prix_total,remise,utilisateur_id,client_id,facture_id,mode_paiement,montant_recu,monnaie) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                [$vfid, $item['id'], $item['qty'], $item['prix'], $total, $remise_dt, $user['id'], $client_id, $facture_id, $mode_paiement, $montant_recu, $monnaie]);
            execute("INSERT INTO mouvements (franchise_id,produit_id,type_mouvement,quantite,prix_unitaire,utilisateur_id) VALUES (?,?,'vente',?,?,?)",
                [$vfid, $item['id'], $item['qty'], $item['prix'], $user['id']]);
            execute("UPDATE stock SET quantite=GREATEST(0,quantite-?) WHERE franchise_id=? AND produit_id=?", [$item['qty'], $vfid, $item['id']]);
            // Auto-notify on stock bas after sale
            $new_stock = queryOne("SELECT s.quantite,p.seuil_alerte,p.nom FROM stock s JOIN produits p ON s.produit_id=p.id WHERE s.franchise_id=? AND s.produit_id=?", [$vfid,$item['id']]);
            if ($new_stock && $new_stock['quantite'] <= $new_stock['seuil_alerte'] && $new_stock['quantite'] >= 0) {
                $fname = queryOne("SELECT nom FROM franchises WHERE id=?",[$vfid])['nom']??'';
                $level = $new_stock['quantite'] <= 0 ? 'danger' : 'warning';
                $msg = $new_stock['quantite'] <= 0 ? "ÉPUISÉ" : "Stock bas: {$new_stock['quantite']} restant(s)";
                try { execute("INSERT INTO notifications (franchise_id,titre,message,type_notif,lien) VALUES (?,?,?,?,?)",
                    [$vfid, "⚠️ {$new_stock['nom']}", shortF($fname)." — $msg", $level, "index.php?page=entree&fid=$vfid"]); } catch(Exception $e) {}
            }
        }
        
        // Create echeances if payment by lot
        if ($mode_paiement === 'echeance' && $client_id) {
            $nb_ech = max(1, intval($_POST['nb_echeances'] ?? 2));
            $interv = max(1, intval($_POST['interv_jours'] ?? 30));
            $prem_date = $_POST['prem_date'] ?: date('Y-m-d', strtotime('+30 days'));
            $especes_versees = floatval($_POST['especes_versees'] ?? 0);
            // Prix lot may differ from cart total (seller can set markup)
            $prix_lot = floatval($_POST['prix_lot'] ?? 0);
            if ($prix_lot <= 0) $prix_lot = $total_ttc; // fallback to cart total
            
            $reste_a_etaler = max(0, $prix_lot - $especes_versees);
            
            // Always update facture with lot price and avance
            execute("UPDATE factures SET total_ttc=?,total_ht=?,montant_recu=?,monnaie=0,mode_paiement='echeance' WHERE id=?",
                [$prix_lot, $prix_lot, $especes_versees, $facture_id]);
            
            $montant_par = $nb_ech > 0 ? round($reste_a_etaler / $nb_ech, 2) : 0;
            $reste = round($reste_a_etaler - ($montant_par * ($nb_ech - 1)), 2);
            
            for ($i = 0; $i < $nb_ech; $i++) {
                $date_ech = date('Y-m-d', strtotime($prem_date . " + " . ($i * $interv) . " days"));
                $mt = ($i === $nb_ech - 1) ? $reste : $montant_par;
                if ($mt <= 0) continue;
                execute("INSERT INTO echeances (facture_id,franchise_id,client_id,montant,date_echeance,note,utilisateur_id) VALUES (?,?,?,?,?,?,?)",
                    [$facture_id, $vfid, $client_id, $mt, $date_ech, "Lot " . ($i+1) . "/$nb_ech — Facture $numero", $user['id']]);
            }
            auditLog('vente_lot', 'facture', $facture_id, [
                'prix_lot'=>$prix_lot, 'especes'=>$especes_versees, 
                'reste'=>$reste_a_etaler, 'nb_lots'=>$nb_ech
            ]);
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
    elseif ($action === 'entree_multi_stock' && can('entree_stock')) {
        $efid = can('view_all_franchises') ? intval($_POST['franchise_id']) : currentFranchise();
        $lignes = json_decode($_POST['lignes'], true) ?: [];
        $note_base = strParam('note');
        $ref_bl = strParam('reference_bl', 100);
        $fourn_id = intval($_POST['fournisseur_id']) ?: null;
        $create_bon = !empty($_POST['create_bon']);
        
        if (empty($lignes)) {
            $_SESSION['flash'] = ['type'=>'danger','msg'=>'Aucune ligne à enregistrer!'];
            header("Location: index.php?page=entree&fid=$efid"); exit;
        }
        
        $total_ht = 0; $total_tva = 0; $total_ttc = 0;
        foreach ($lignes as $l) {
            $lht = floatval($l['prix_ht']) * intval($l['qty']);
            $ltva = $lht * floatval($l['tva_rate'] ?? 19) / 100;
            $total_ht += $lht; $total_tva += $ltva; $total_ttc += $lht + $ltva;
        }
        
        $bon_id = null;
        if ($create_bon) {
            $count = queryOne("SELECT COUNT(*)+1 as n FROM bons_reception WHERE DATE(date_creation)=?", [date('Y-m-d')])['n'] ?? 1;
            $numero = 'BR-' . date('Ymd') . '-' . str_pad($count, 4, '0', STR_PAD_LEFT);
            execute("INSERT INTO bons_reception (numero,franchise_id,fournisseur_id,total_ht,tva,total_ttc,statut,note,utilisateur_id) VALUES (?,?,?,?,?,?,'valide',?,?)",
                [$numero, $efid, $fourn_id, round($total_ht,2), round($total_tva,2), round($total_ttc,2), $note_base ?: ($ref_bl ? "BL: $ref_bl" : null), $user['id']]);
            $bon_id = db()->lastInsertId();
        }
        
        foreach ($lignes as $l) {
            $pid = intval($l['id']);
            $qty = intval($l['qty']);
            $prix_ht = floatval($l['prix_ht']);
            $tva_r = floatval($l['tva_rate'] ?? 19);
            $prix_ttc = round($prix_ht * (1 + $tva_r/100), 2);
            $note = $note_base ?: ($ref_bl ? "BL: $ref_bl" : '');
            
            execute("INSERT INTO mouvements (franchise_id,produit_id,type_mouvement,quantite,prix_unitaire,note,utilisateur_id) VALUES (?,?,'entree',?,?,?,?)",
                [$efid, $pid, $qty, $prix_ht, $note, $user['id']]);
            execute("INSERT INTO stock (franchise_id,produit_id,quantite) VALUES (?,?,?) ON DUPLICATE KEY UPDATE quantite=quantite+VALUES(quantite)",
                [$efid, $pid, $qty]);
            // Update product purchase price
            if ($prix_ht > 0)
                execute("UPDATE produits SET prix_achat_ht=?, prix_achat_ttc=?, prix_achat=? WHERE id=?",
                    [$prix_ht, $prix_ttc, $prix_ttc, $pid]);
            
            if ($bon_id)
                execute("INSERT INTO bon_reception_lignes (bon_id,produit_id,quantite,prix_unitaire_ht,tva_rate,prix_unitaire_ttc,total_ht,total_ttc) VALUES (?,?,?,?,?,?,?,?)",
                    [$bon_id, $pid, $qty, $prix_ht, $tva_r, $prix_ttc, round($prix_ht*$qty,2), round($prix_ttc*$qty,2)]);
        }
        
        $msg = count($lignes) . ' produit(s) mis à jour';
        if ($bon_id) $msg .= " — Bon de réception <b>$numero</b> créé";
        $_SESSION['flash'] = ['type'=>'success','msg'=>$msg];
        auditLog('entree_multi_stock', 'franchise', $efid, ['lignes'=>count($lignes),'total_ttc'=>$total_ttc,'bon_id'=>$bon_id]);
        header("Location: index.php?page=entree&fid=$efid"); exit;
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
        $date_cl = $_POST['date_cloture'];
        $sys = queryOne("SELECT COALESCE(SUM(prix_total),0) as t, COALESCE(SUM(quantite),0) as a FROM ventes WHERE franchise_id=? AND date_vente=?", [$cfid, $date_cl]);
        $declare = floatval($_POST['total_declare']);
        $ecart = $declare - $sys['t'];
        execute("INSERT INTO clotures (franchise_id,date_cloture,total_ventes_declare,total_articles_declare,total_ventes_systeme,total_articles_systeme,commentaire,utilisateur_id) VALUES (?,?,?,?,?,?,?,?)",
            [$cfid, $date_cl, $declare, $_POST['articles_declare'], $sys['t'], $sys['a'], $_POST['commentaire'] ?? '', $user['id']]);
        // Auto-record declared amount in trésorerie for the day
        try {
            execute("INSERT INTO tresorerie (franchise_id,type_mouvement,montant,motif,reference,date_mouvement,utilisateur_id) VALUES (?,?,?,?,?,?,?)",
                [$cfid, 'encaissement', $declare, 'Clôture journalière déclarée', 'CL-'.$date_cl, $date_cl, $user['id']]);
        } catch(Exception $e) {}
        $ecart_msg = abs($ecart) < 0.01 ? '' : ($ecart > 0 ? " (excédent: +".number_format($ecart,2)." DT)" : " (manque: ".number_format($ecart,2)." DT)");
        $_SESSION['flash'] = ['type'=>abs($ecart)>1?'warning':'success','msg'=>'Clôture soumise! Déclaré: '.number_format($declare,2).' DT'.$ecart_msg];
        auditLog('cloture_submit', 'franchise', $cfid, ['date'=>$date_cl, 'declare'=>$declare, 'systeme'=>$sys['t'], 'ecart'=>$ecart]);
    }
    elseif ($action === 'add_produit') {
        $nom = trim($_POST['nom'] ?? '');
        if (!$nom) { $_SESSION['flash']=['type'=>'danger','msg'=>'Nom requis!']; header("Location: index.php?page=produits"); exit; }
        execute("INSERT INTO produits (nom,categorie_id,prix_achat,prix_vente,prix_achat_ht,prix_achat_ttc,prix_vente_ht,prix_vente_ttc,tva_rate,reference,code_barre,marque,seuil_alerte) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
            [$nom, intval($_POST['categorie_id']), floatval($_POST['prix_achat']), floatval($_POST['prix_vente']),
             floatval($_POST['prix_achat_ht'] ?? $_POST['prix_achat']), floatval($_POST['prix_achat_ttc'] ?? $_POST['prix_achat']),
             floatval($_POST['prix_vente_ht'] ?? $_POST['prix_vente']), floatval($_POST['prix_vente_ttc'] ?? $_POST['prix_vente']),
             floatval($_POST['tva_rate'] ?? 19),
             strParam('reference',50), strParam('code_barre',50), strParam('marque',50), intval($_POST['seuil'] ?? 3)]);
        $pid = db()->lastInsertId();
        foreach (query("SELECT id FROM franchises WHERE actif=1") as $f) execute("INSERT IGNORE INTO stock (franchise_id,produit_id,quantite) VALUES (?,?,0)", [$f['id'], $pid]);
        $_SESSION['flash'] = ['type'=>'success','msg'=>'Produit ajouté!'];
        auditLog('add_produit', 'produit', $pid, ['nom'=>$nom]);
    }
    elseif ($action === 'edit_produit') {
        $nom = trim($_POST['nom'] ?? '');
        if (!$nom) { $_SESSION['flash']=['type'=>'danger','msg'=>'Nom requis!']; header("Location: index.php?page=produits"); exit; }
        $tva = floatval($_POST['tva_rate'] ?? 19);
        $pa_ht = floatval($_POST['prix_achat_ht'] ?? 0);
        $pv_ht = floatval($_POST['prix_vente_ht'] ?? 0);
        $pa_ttc = $pa_ht > 0 ? round($pa_ht * (1 + $tva/100), 2) : floatval($_POST['prix_achat']);
        $pv_ttc = $pv_ht > 0 ? round($pv_ht * (1 + $tva/100), 2) : floatval($_POST['prix_vente']);
        
        // Handle image upload
        $image_sql = '';
        $image_params = [];
        if (!empty($_FILES['product_image']['tmp_name']) && is_uploaded_file($_FILES['product_image']['tmp_name'])) {
            $allowed = ['image/jpeg','image/png','image/webp','image/gif'];
            $ftype = $_FILES['product_image']['type'];
            if (in_array($ftype, $allowed) && $_FILES['product_image']['size'] <= 2 * 1024 * 1024) {
                $imgdata = file_get_contents($_FILES['product_image']['tmp_name']);
                $b64 = 'data:' . $ftype . ';base64,' . base64_encode($imgdata);
                $image_sql = ',image_base64=?';
                $image_params = [$b64];
            }
        }
        // Handle image removal
        if (isset($_POST['remove_image']) && $_POST['remove_image'] === '1') {
            $image_sql = ',image_base64=NULL';
        }
        
        execute("UPDATE produits SET nom=?,categorie_id=?,prix_achat=?,prix_vente=?,prix_achat_ht=?,prix_achat_ttc=?,prix_vente_ht=?,prix_vente_ttc=?,tva_rate=?,reference=?,code_barre=?,marque=?,seuil_alerte=?,description=?$image_sql WHERE id=?",
            array_merge([$nom, intval($_POST['categorie_id']), $pa_ttc, $pv_ttc, $pa_ht, $pa_ttc, $pv_ht, $pv_ttc, $tva,
             strParam('reference',50), strParam('code_barre',50), strParam('marque',50),
             intval($_POST['seuil'] ?? 3), strParam('description',500)], $image_params, [intval($_POST['produit_id'])]));
        $_SESSION['flash'] = ['type'=>'success','msg'=>'Produit mis à jour!'];
        auditLog('edit_produit', 'produit', intval($_POST['produit_id']), ['nom'=>$nom, 'pv_ttc'=>$pv_ttc]);
    }
    // === PRODUCT-FOURNISSEUR MANAGEMENT ===
    elseif ($action === 'add_product_fournisseur' && can('edit_produit')) {
        $pid = intval($_POST['produit_id']);
        $fid_f = intval($_POST['fournisseur_id']);
        $pa_ht = floatval($_POST['prix_achat_ht'] ?? 0);
        $tva = floatval($_POST['tva_rate'] ?? 19);
        $pa_ttc = round($pa_ht * (1 + $tva/100), 2);
        $is_default = intval($_POST['is_default'] ?? 0);
        
        // If setting as default, unset other defaults
        if ($is_default) {
            execute("UPDATE produit_fournisseurs SET is_default=0 WHERE produit_id=?", [$pid]);
        }
        
        execute("INSERT INTO produit_fournisseurs (produit_id, fournisseur_id, prix_achat_ht, prix_achat_ttc, reference_fournisseur, is_default, notes) VALUES (?,?,?,?,?,?,?)
                 ON DUPLICATE KEY UPDATE prix_achat_ht=VALUES(prix_achat_ht), prix_achat_ttc=VALUES(prix_achat_ttc), reference_fournisseur=VALUES(reference_fournisseur), is_default=VALUES(is_default), notes=VALUES(notes)",
            [$pid, $fid_f, $pa_ht, $pa_ttc, strParam('reference_fournisseur',50), $is_default, strParam('notes',255)]);
        
        // Update main product price if default
        if ($is_default) {
            $pv_ht = floatval($_POST['prix_vente_ht'] ?? 0);
            $pv_ttc = round($pv_ht * (1 + $tva/100), 2);
            execute("UPDATE produits SET fournisseur_id=?, prix_achat_ht=?, prix_achat_ttc=?, prix_achat=? WHERE id=?",
                [$fid_f, $pa_ht, $pa_ttc, $pa_ttc, $pid]);
        }
        
        $_SESSION['flash'] = ['type'=>'success','msg'=>'Fournisseur lié au produit!'];
        $page = 'produits';
    }
    elseif ($action === 'remove_product_fournisseur' && can('edit_produit')) {
        execute("DELETE FROM produit_fournisseurs WHERE id=? AND produit_id=?", [intval($_POST['link_id']), intval($_POST['produit_id'])]);
        $_SESSION['flash'] = ['type'=>'success','msg'=>'Fournisseur dissocié!'];
        $page = 'produits';
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
        $custom_perms = null;
        if (!empty($_POST['custom_permissions'])) {
            $custom_perms = json_encode(array_values(array_filter($_POST['custom_permissions'])));
        }
        execute("INSERT INTO utilisateurs (nom_utilisateur,mot_de_passe,nom_complet,prenom,cin,telephone,role,franchise_id,custom_permissions) VALUES (?,?,?,?,?,?,?,?,?)",
            [$_POST['username'], $pw, $_POST['nom_complet'], $_POST['prenom']??'', $_POST['cin']??'', $_POST['telephone']??'', $_POST['role'], $_POST['franchise_id'] ?: null, $custom_perms]);
        $_SESSION['flash'] = ['type'=>'success','msg'=>'Utilisateur créé!'];
        auditLog('add_user', 'utilisateur', db()->lastInsertId(), ['username'=>$_POST['username'], 'role'=>$_POST['role']]);
    }
    elseif ($action === 'edit_user') {
        $custom_perms = null;
        if (!empty($_POST['custom_permissions'])) {
            $custom_perms = json_encode(array_values(array_filter($_POST['custom_permissions'])));
        }
        execute("UPDATE utilisateurs SET nom_complet=?,prenom=?,cin=?,telephone=?,role=?,franchise_id=?,actif=?,custom_permissions=? WHERE id=?",
            [$_POST['nom_complet'], $_POST['prenom']??'', $_POST['cin']??'', $_POST['telephone']??'', $_POST['role'], $_POST['franchise_id'] ?: null, $_POST['actif'] ?? 1, $custom_perms, $_POST['user_id']]);
        if (!empty($_POST['new_password']))
            execute("UPDATE utilisateurs SET mot_de_passe=? WHERE id=?", [password_hash($_POST['new_password'], PASSWORD_DEFAULT), $_POST['user_id']]);
        $_SESSION['flash'] = ['type'=>'success','msg'=>'Utilisateur mis à jour!'];
        auditLog('edit_user', 'utilisateur', $_POST['user_id'], ['nom'=>$_POST['nom_complet'], 'role'=>$_POST['role'], 'actif'=>$_POST['actif']??1]);
    }
    elseif ($action === 'add_client') {
        $cfid = can('view_all_franchises') ? ($_POST['franchise_id'] ?? null) : currentFranchise();
        execute("INSERT INTO clients (nom,prenom,telephone,telephone2,email,type_client,entreprise,matricule_fiscal,cin,franchise_id,adresse,notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            [$_POST['nom'], $_POST['prenom'] ?? '', $_POST['telephone'] ?? '', $_POST['telephone2'] ?? '', $_POST['email'] ?? '', $_POST['type_client'] ?? 'passager', $_POST['entreprise'] ?? '', $_POST['matricule_fiscal'] ?? '', $_POST['cin'] ?? '', $cfid, strParam('adresse'), strParam('notes',1000)]);
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
        $eid = intval($_POST['echeance_id']);
        $ech = queryOne("SELECT * FROM echeances WHERE id=?", [$eid]);
        if($ech && $ech['statut'] !== 'payee') {
            execute("UPDATE echeances SET statut='payee',date_paiement=NOW(),mode_paiement='especes' WHERE id=?", [$eid]);
            // Auto-record in trésorerie
            try {
                execute("INSERT INTO tresorerie (franchise_id,type_mouvement,montant,motif,reference,utilisateur_id) VALUES (?,?,?,?,?,?)",
                    [$ech['franchise_id'], 'encaissement', $ech['montant'], 
                     'Lot échéance — ' . ($ech['note'] ?: 'Facture'), $ech['facture_id'] ? 'FAC-'.$ech['facture_id'] : '', $user['id']]);
            } catch(Exception $e) { /* trésorerie table may not exist yet */ }
            $_SESSION['flash'] = ['type'=>'success','msg'=>'✅ Échéance encaissée! '.number_format($ech['montant'],2).' DT enregistré.'];
            auditLog('pay_echeance', 'echeance', $eid, ['montant'=>$ech['montant']]);
        }
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
        $upd_fid = can('view_all_franchises') ? ($_POST['franchise_id'] ?? null) : null;
        if ($upd_fid) {
            execute("UPDATE clients SET nom=?,prenom=?,telephone=?,telephone2=?,email=?,type_client=?,entreprise=?,matricule_fiscal=?,cin=?,actif=?,notes=?,adresse=?,franchise_id=? WHERE id=?",
                [$_POST['nom'], $_POST['prenom']??'', $_POST['telephone']??'', $_POST['telephone2']??'', $_POST['email']??'', $_POST['type_client']??'passager', $_POST['entreprise']??'', $_POST['matricule_fiscal']??'', $_POST['cin']??'', $_POST['actif']??1, strParam('notes',1000), strParam('adresse'), $upd_fid, $_POST['client_id']]);
        } else {
            execute("UPDATE clients SET nom=?,prenom=?,telephone=?,telephone2=?,email=?,type_client=?,entreprise=?,matricule_fiscal=?,cin=?,actif=?,notes=?,adresse=? WHERE id=?",
                [$_POST['nom'], $_POST['prenom']??'', $_POST['telephone']??'', $_POST['telephone2']??'', $_POST['email']??'', $_POST['type_client']??'passager', $_POST['entreprise']??'', $_POST['matricule_fiscal']??'', $_POST['cin']??'', $_POST['actif']??1, strParam('notes',1000), strParam('adresse'), $_POST['client_id']]);
        }
        $_SESSION['flash'] = ['type'=>'success','msg'=>'Client mis à jour!'];
        auditLog('edit_client', 'client', $_POST['client_id'], ['nom'=>$_POST['nom']]);
    }
    elseif ($action === 'pay_facture' && can('vente')) {
        $fac_id = intval($_POST['facture_id']);
        $fac = queryOne("SELECT * FROM factures WHERE id=?", [$fac_id]);
        if($fac && $fac['statut'] === 'en_attente') {
            execute("UPDATE factures SET statut='payee' WHERE id=?", [$fac_id]);
            // Record in tresorerie
            try {
                execute("INSERT INTO tresorerie (franchise_id,type_mouvement,montant,motif,reference,utilisateur_id) VALUES (?,?,?,?,?,?)",
                    [$fac['franchise_id'], 'encaissement', $fac['total_ttc'], 'Règlement facture', $fac['numero'], $user['id']]);
            } catch(Exception $e) {}
            $_SESSION['flash'] = ['type'=>'success','msg'=>'Facture '.$fac['numero'].' marquée payée!'];
            auditLog('pay_facture', 'facture', $fac_id, ['numero'=>$fac['numero'], 'total'=>$fac['total_ttc']]);
        }
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
        try {
            execute("INSERT INTO franchises (nom, adresse, telephone, responsable, type_franchise, horaires) VALUES (?,?,?,?,'point_de_vente',?)",
                [$_POST['nom'], $_POST['adresse'] ?? '', $_POST['telephone'] ?? '', $_POST['responsable'] ?? '', $_POST['horaires'] ?? 'Lun-Sam: 09:00-19:00']);
        } catch (Exception $e) {
            execute("INSERT INTO franchises (nom, adresse, telephone, responsable) VALUES (?,?,?,?)",
                [$_POST['nom'], $_POST['adresse'] ?? '', $_POST['telephone'] ?? '', $_POST['responsable'] ?? '']);
        }
        $new_fid = db()->lastInsertId();
        // Create stock rows for all products
        foreach (query("SELECT id FROM produits WHERE actif=1") as $p) {
            execute("INSERT IGNORE INTO stock (franchise_id,produit_id,quantite) VALUES (?,?,0)", [$new_fid, $p['id']]);
        }
        $_SESSION['flash'] = ['type'=>'success','msg'=>'Franchise ajoutée!'];
        auditLog('add_franchise', 'franchise', $new_fid, ['nom'=>$_POST['nom']]);
    }
    elseif ($action === 'edit_franchise' && isAdmin()) {
        try {
            execute("UPDATE franchises SET nom=?, adresse=?, telephone=?, responsable=?, horaires=?, notes_internes=?, statut_commercial=?, actif=? WHERE id=?",
                [$_POST['nom'], $_POST['adresse'] ?? '', $_POST['telephone'] ?? '', $_POST['responsable'] ?? '', $_POST['horaires'] ?? '', $_POST['notes_internes'] ?? '', $_POST['statut_commercial'] ?? 'actif', $_POST['actif'] ?? 1, $_POST['franchise_id']]);
        } catch (Exception $e) {
            try {
                execute("UPDATE franchises SET nom=?, adresse=?, telephone=?, responsable=?, horaires=?, actif=? WHERE id=?",
                    [$_POST['nom'], $_POST['adresse'] ?? '', $_POST['telephone'] ?? '', $_POST['responsable'] ?? '', $_POST['horaires'] ?? '', $_POST['actif'] ?? 1, $_POST['franchise_id']]);
            } catch (Exception $e2) {
                execute("UPDATE franchises SET nom=?, adresse=?, telephone=?, responsable=?, actif=? WHERE id=?",
                    [$_POST['nom'], $_POST['adresse'] ?? '', $_POST['telephone'] ?? '', $_POST['responsable'] ?? '', $_POST['actif'] ?? 1, $_POST['franchise_id']]);
            }
        }
        $_SESSION['flash'] = ['type'=>'success','msg'=>'Franchise mise à jour!'];
        auditLog('edit_franchise', 'franchise', $_POST['franchise_id'], ['nom'=>$_POST['nom']]);
    }
    elseif ($action === 'delete_franchise' && isAdmin()) {
        $fcheck = queryOne("SELECT * FROM franchises WHERE id=?", [$_POST['franchise_id']]);
        if ($fcheck && ($fcheck['type_franchise'] ?? '') === 'central') {
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
    elseif ($action === 'add_point' && can('add_point')) {
        try {
            execute("INSERT INTO points_reseau (nom,type_point,statut,adresse,ville,gouvernorat,telephone,telephone2,email,responsable,horaires,latitude,longitude,notes_internes,commission_pct,date_contact,cree_par) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                [$_POST['nom'], $_POST['type_point'], $_POST['statut'] ?? 'prospect', $_POST['adresse'] ?? '', $_POST['ville'] ?? '', $_POST['gouvernorat'] ?? '',
                 $_POST['telephone'] ?? '', $_POST['telephone2'] ?? '', $_POST['email'] ?? '', $_POST['responsable'] ?? '',
                 $_POST['horaires'] ?? 'Lun-Sam: 09:00-19:00',
                 $_POST['latitude'] ?: null, $_POST['longitude'] ?: null,
                 $_POST['notes_internes'] ?? '', $_POST['commission_pct'] ?? 0,
                 $_POST['date_contact'] ?: null, $user['id']]);
            $_SESSION['flash'] = ['type'=>'success','msg'=>'Point ajouté au réseau!'];
            auditLog('add_point', 'point_reseau', db()->lastInsertId(), ['nom'=>$_POST['nom'], 'type'=>$_POST['type_point']]);
        } catch (Exception $e) {
            $_SESSION['flash'] = ['type'=>'danger','msg'=>'Erreur: '.$e->getMessage()];
        }
    }
    elseif ($action === 'edit_point' && can('edit_point')) {
        try {
            execute("UPDATE points_reseau SET nom=?,type_point=?,statut=?,adresse=?,ville=?,gouvernorat=?,telephone=?,telephone2=?,email=?,responsable=?,horaires=?,latitude=?,longitude=?,notes_internes=?,commission_pct=?,date_contact=?,date_contrat=?,date_activation=?,actif=? WHERE id=?",
                [$_POST['nom'], $_POST['type_point'], $_POST['statut'], $_POST['adresse'] ?? '', $_POST['ville'] ?? '', $_POST['gouvernorat'] ?? '',
                 $_POST['telephone'] ?? '', $_POST['telephone2'] ?? '', $_POST['email'] ?? '', $_POST['responsable'] ?? '',
                 $_POST['horaires'] ?? '',
                 $_POST['latitude'] ?: null, $_POST['longitude'] ?: null,
                 $_POST['notes_internes'] ?? '', $_POST['commission_pct'] ?? 0,
                 $_POST['date_contact'] ?: null, $_POST['date_contrat'] ?: null, $_POST['date_activation'] ?: null,
                 $_POST['actif'] ?? 1, $_POST['point_id']]);
            $_SESSION['flash'] = ['type'=>'success','msg'=>'Point mis à jour!'];
            auditLog('edit_point', 'point_reseau', $_POST['point_id'], ['nom'=>$_POST['nom'], 'statut'=>$_POST['statut']]);
        } catch (Exception $e) {
            $_SESSION['flash'] = ['type'=>'danger','msg'=>'Erreur: '.$e->getMessage()];
        }
    }
    elseif ($action === 'delete_point' && can('delete_point')) {
        execute("UPDATE points_reseau SET actif=0 WHERE id=?", [$_POST['point_id']]);
        $_SESSION['flash'] = ['type'=>'success','msg'=>'Point désactivé!'];
        auditLog('delete_point', 'point_reseau', $_POST['point_id']);
    }
    elseif ($action === 'stock_set' && isAdmin()) {
        $pid = intval($_POST['produit_id']);
        $fid_s = intval($_POST['franchise_id']);
        $qty = max(0, intval($_POST['quantite_new']));
        $note = strParam('note', 100) ?: 'Correction manuelle';
        // Get current qty for mouvements
        $current = queryOne("SELECT quantite FROM stock WHERE franchise_id=? AND produit_id=?", [$fid_s, $pid]);
        $old_qty = intval($current['quantite'] ?? 0);
        $diff = $qty - $old_qty;
        execute("INSERT INTO stock (franchise_id,produit_id,quantite) VALUES (?,?,?) ON DUPLICATE KEY UPDATE quantite=?", [$fid_s, $pid, $qty, $qty]);
        execute("INSERT INTO mouvements (franchise_id,produit_id,type_mouvement,quantite,note,utilisateur_id) VALUES (?,?,?,?,?,?)",
            [$fid_s, $pid, 'correction', $diff, "$note (ancien: $old_qty → nouveau: $qty)", $user['id']]);
        $_SESSION['flash'] = ['type'=>'success','msg'=>"Stock corrigé: $old_qty → $qty"];
        auditLog('stock_set', 'stock', $pid, ['fid'=>$fid_s,'old'=>$old_qty,'new'=>$qty,'note'=>$note]);
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
    // === POINTAGE ===
    elseif ($action === 'add_pointage' && can('add_pointage')) {
        $lat = $_POST['latitude'] ? floatval($_POST['latitude']) : null;
        $lng = $_POST['longitude'] ? floatval($_POST['longitude']) : null;
        $type = in_array($_POST['type_pointage'], ['entree','sortie','pause_debut','pause_fin']) ? $_POST['type_pointage'] : 'entree';
        $franchise_id_p = can('view_all_franchises') ? (intval($_POST['franchise_id']) ?: currentFranchise()) : currentFranchise();
        $now_tz = date('Y-m-d H:i:s'); // Uses PHP timezone (Africa/Tunis)
        
        execute("INSERT INTO pointages (utilisateur_id,franchise_id,type_pointage,heure,latitude,longitude,adresse,note,device_info) VALUES (?,?,?,?,?,?,?,?,?)",
            [$user['id'], $franchise_id_p, $type, $now_tz, $lat, $lng, strParam('adresse',300), strParam('note'), strParam('device_info',100)]);
        
        $msg = match($type) {
            'entree' => '✅ Entrée enregistrée à ' . date('H:i'),
            'sortie' => '👋 Sortie enregistrée à ' . date('H:i'),
            'pause_debut' => '☕ Pause commencée à ' . date('H:i'),
            'pause_fin' => '✅ Retour de pause à ' . date('H:i'),
        };
        if($lat && $lng) $msg .= " — 📍 Localisé";
        
        $_SESSION['flash'] = ['type'=>'success','msg'=>$msg];
        auditLog('pointage', 'pointage', null, ['type'=>$type, 'lat'=>$lat, 'lng'=>$lng]);
        $page = 'pointage';
    }
    // === BULK PRICE ADJUSTMENT ===
    elseif ($action === 'bulk_price_adjust' && isAdmin()) {
        $pct = floatval($_POST['pct_change'] ?? 0);
        $type = $_POST['price_type'] ?? 'vente'; // 'vente' or 'achat' or 'both'
        $cat_id = intval($_POST['cat_id'] ?? 0);
        $direction = $_POST['direction'] ?? 'increase'; // increase / decrease
        
        if ($pct <= 0 || $pct > 100) {
            $_SESSION['flash'] = ['type'=>'danger','msg'=>'Pourcentage invalide (1-100%)'];
            header("Location: index.php?page=produits"); exit;
        }
        
        $multiplier = $direction === 'increase' ? (1 + $pct/100) : (1 - $pct/100);
        $where = $cat_id ? "WHERE categorie_id=$cat_id" : "WHERE 1=1";
        
        $updated = 0;
        if ($type === 'vente' || $type === 'both') {
            $result = db()->exec("UPDATE produits SET prix_vente=ROUND(prix_vente*$multiplier,2), prix_vente_ttc=ROUND(prix_vente_ttc*$multiplier,2), prix_vente_ht=ROUND(prix_vente_ht*$multiplier,2) $where AND actif=1");
            $updated += $result;
        }
        if ($type === 'achat' || $type === 'both') {
            db()->exec("UPDATE produits SET prix_achat=ROUND(prix_achat*$multiplier,2), prix_achat_ttc=ROUND(prix_achat_ttc*$multiplier,2), prix_achat_ht=ROUND(prix_achat_ht*$multiplier,2) $where AND actif=1");
        }
        
        $sign = $direction === 'increase' ? '+' : '-';
        $_SESSION['flash'] = ['type'=>'success','msg'=>"✅ Prix ".($type==='vente'?'de vente':($type==='achat'?"d'achat":''))." ajustés: $sign$pct% sur ".($cat_id?'la catégorie sélectionnée':'tous les produits')];
        auditLog('bulk_price_adjust', 'produits', null, ['pct'=>$pct,'direction'=>$direction,'type'=>$type,'cat'=>$cat_id]);
        header("Location: index.php?page=produits"); exit;
    }
    // === PRODUCT CSV IMPORT ===
    elseif ($action === 'import_produits' && isAdmin()) {
        if (!isset($_FILES['csv_file']) || $_FILES['csv_file']['error']) {
            $_SESSION['flash'] = ['type'=>'danger','msg'=>'Fichier CSV requis!'];
            header("Location: index.php?page=produits"); exit;
        }
        $file = fopen($_FILES['csv_file']['tmp_name'], 'r');
        $skip = !empty($_POST['skip_header']);
        $update = !empty($_POST['update_existing']);
        $imported = 0; $updated = 0; $errors = [];
        $first = fgets($file); $sep = substr_count($first, ';') > substr_count($first, ',') ? ';' : ','; rewind($file);
        $line_num = 0;
        while (($row = fgetcsv($file, 1000, $sep)) !== false) {
            $line_num++;
            if ($skip && $line_num === 1) continue;
            if (count($row) < 2 || !trim($row[0])) continue;
            $nom = trim($row[0]); $cat_id = intval($row[1] ?? 0);
            $pa_ht = floatval($row[2] ?? 0); $pv_ht = floatval($row[3] ?? 0);
            $tva = floatval($row[4] ?? 19); $ref = trim($row[5] ?? '');
            $code_barre = trim($row[6] ?? ''); $marque = trim($row[7] ?? '');
            $seuil = intval($row[8] ?? 3);
            if ($cat_id <= 0) {
                $cr = queryOne("SELECT id FROM categories WHERE nom=?", [$row[1]]);
                $cat_id = $cr ? $cr['id'] : (query("SELECT id FROM categories LIMIT 1")[0]['id'] ?? 1);
            }
            $pa_ttc = round($pa_ht*(1+$tva/100),2); $pv_ttc = round($pv_ht*(1+$tva/100),2);
            try {
                if ($update && $ref && ($ex = queryOne("SELECT id FROM produits WHERE reference=?",[$ref]))) {
                    execute("UPDATE produits SET nom=?,categorie_id=?,prix_achat=?,prix_vente=?,prix_achat_ht=?,prix_achat_ttc=?,prix_vente_ht=?,prix_vente_ttc=?,tva_rate=?,code_barre=?,marque=?,seuil_alerte=? WHERE id=?",
                        [$nom,$cat_id,$pa_ttc,$pv_ttc,$pa_ht,$pa_ttc,$pv_ht,$pv_ttc,$tva,$code_barre,$marque,$seuil,$ex['id']]);
                    $updated++;
                } else {
                    execute("INSERT INTO produits (nom,categorie_id,prix_achat,prix_vente,prix_achat_ht,prix_achat_ttc,prix_vente_ht,prix_vente_ttc,tva_rate,reference,code_barre,marque,seuil_alerte) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
                        [$nom,$cat_id,$pa_ttc,$pv_ttc,$pa_ht,$pa_ttc,$pv_ht,$pv_ttc,$tva,$ref,$code_barre,$marque,$seuil]);
                    $pid = db()->lastInsertId();
                    foreach(query("SELECT id FROM franchises WHERE actif=1") as $f) execute("INSERT IGNORE INTO stock (franchise_id,produit_id,quantite) VALUES (?,?,0)",[$f['id'],$pid]);
                    $imported++;
                }
            } catch(Exception $e) { $errors[] = "L.$line_num: ".$e->getMessage(); }
        }
        fclose($file);
        $msg = "✅ <b>$imported</b> créé(s)".($updated?" · <b>$updated</b> mis à jour":"").($errors?" · ⚠️ ".count($errors)." erreur(s)":"");
        $_SESSION['flash'] = ['type'=>$errors?'warning':'success','msg'=>$msg];
        auditLog('import_produits', 'produits', null, ['imported'=>$imported,'updated'=>$updated]);
        header("Location: index.php?page=produits"); exit;
    }
    elseif ($action === 'add_fournisseur' && can('add_fournisseur')) {
        execute("INSERT INTO fournisseurs (nom,telephone,telephone2,email,adresse,ice) VALUES (?,?,?,?,?,?)",
            [strParam('nom'), strParam('telephone',50), strParam('telephone2',50), strParam('email',100), strParam('adresse'), strParam('ice',50)]);
        $_SESSION['flash'] = ['type'=>'success','msg'=>'Fournisseur ajouté!'];
        auditLog('add_fournisseur', 'fournisseur', db()->lastInsertId());
        $page = 'fournisseurs';
    }
    elseif ($action === 'edit_fournisseur' && can('edit_fournisseur')) {
        execute("UPDATE fournisseurs SET nom=?,telephone=?,telephone2=?,email=?,adresse=?,ice=?,actif=? WHERE id=?",
            [strParam('nom'), strParam('telephone',50), strParam('telephone2',50), strParam('email',100), strParam('adresse'), strParam('ice',50), intval($_POST['actif'] ?? 1), intval($_POST['id'])]);
        $_SESSION['flash'] = ['type'=>'success','msg'=>'Fournisseur mis à jour!'];
        $page = 'fournisseurs';
    }
    // === BON DE RECEPTION ===
    elseif ($action === 'create_bon_reception' && can('create_bon_reception')) {
        $br_fid = can('view_all_franchises') ? intval($_POST['franchise_id']) : currentFranchise();
        $br_fourn = intval($_POST['fournisseur_id']) ?: null;
        $lignes = json_decode($_POST['lignes'], true);
        $is_draft = ($_POST['save_as'] ?? '') === 'brouillon';
        $total_ht = 0; $total_tva = 0; $total_ttc = 0;
        foreach ($lignes as $l) {
            $lht = floatval($l['prix_ht']) * intval($l['qty']);
            $ltva = $lht * floatval($l['tva_rate'] ?? 19) / 100;
            $total_ht += $lht; $total_tva += $ltva; $total_ttc += $lht + $ltva;
        }
        $prefix = $is_draft ? 'BRB' : 'BR';
        $today = date('Y-m-d');
        $today_ymd = date('Ymd');
        $count = queryOne("SELECT COUNT(*)+1 as n FROM bons_reception WHERE DATE(date_creation)=? AND numero LIKE ?", [$today, $prefix.'-%'])['n'] ?? 1;
        $numero = $prefix . '-' . $today_ymd . '-' . str_pad($count, 4, '0', STR_PAD_LEFT);
        $statut = $is_draft ? 'brouillon' : 'valide';
        execute("INSERT INTO bons_reception (numero,franchise_id,fournisseur_id,total_ht,tva,total_ttc,statut,note,utilisateur_id) VALUES (?,?,?,?,?,?,?,?,?)",
            [$numero, $br_fid, $br_fourn, round($total_ht,2), round($total_tva,2), round($total_ttc,2), $statut, strParam('note'), $user['id']]);
        $bon_id = db()->lastInsertId();
        foreach ($lignes as $l) {
            $pid = intval($l['produit_id']);
            $qty = intval($l['qty']);
            $prix_ht = floatval($l['prix_ht']);
            $tva_r = floatval($l['tva_rate'] ?? 19);
            $prix_ttc = round($prix_ht * (1 + $tva_r/100), 2);
            execute("INSERT INTO bon_reception_lignes (bon_id,produit_id,quantite,prix_unitaire_ht,tva_rate,prix_unitaire_ttc,total_ht,total_ttc) VALUES (?,?,?,?,?,?,?,?)",
                [$bon_id, $pid, $qty, $prix_ht, $tva_r, $prix_ttc, round($prix_ht*$qty,2), round($prix_ttc*$qty,2)]);
            // Only update stock if NOT draft
            if (!$is_draft) {
                execute("INSERT INTO stock (franchise_id,produit_id,quantite) VALUES (?,?,?) ON DUPLICATE KEY UPDATE quantite=quantite+VALUES(quantite)", [$br_fid, $pid, $qty]);
                execute("INSERT INTO mouvements (franchise_id,produit_id,type_mouvement,quantite,prix_unitaire,note,utilisateur_id) VALUES (?,?,'entree',?,?,?,?)",
                    [$br_fid, $pid, $qty, $prix_ht, "BR $numero", $user['id']]);
            }
        }
        if ($is_draft) {
            $_SESSION['flash'] = ['type'=>'info','msg'=>"📝 Brouillon $numero enregistré. Validez-le pour mettre à jour le stock."];
        } else {
            $_SESSION['flash'] = ['type'=>'success','msg'=>"✅ Bon $numero créé! Stock mis à jour."];
        }
        auditLog('bon_reception', 'bon', $bon_id, ['numero'=>$numero, 'total_ttc'=>$total_ttc, 'lignes'=>count($lignes), 'statut'=>$statut]);
        $page = 'bons_reception';
    }
    // === VALIDATE DRAFT BON ===
    elseif ($action === 'validate_bon_reception' && can('create_bon_reception')) {
        $bon_id = intval($_POST['bon_id']);
        $bon = queryOne("SELECT * FROM bons_reception WHERE id=? AND statut='brouillon'", [$bon_id]);
        if ($bon) {
            $bon_lignes = query("SELECT * FROM bon_reception_lignes WHERE bon_id=?", [$bon_id]);
            foreach ($bon_lignes as $l) {
                execute("INSERT INTO stock (franchise_id,produit_id,quantite) VALUES (?,?,?) ON DUPLICATE KEY UPDATE quantite=quantite+VALUES(quantite)",
                    [$bon['franchise_id'], $l['produit_id'], $l['quantite']]);
                execute("INSERT INTO mouvements (franchise_id,produit_id,type_mouvement,quantite,prix_unitaire,note,utilisateur_id) VALUES (?,?,'entree',?,?,?,?)",
                    [$bon['franchise_id'], $l['produit_id'], $l['quantite'], $l['prix_unitaire_ht'], "BR ".$bon['numero']." (validé)", $user['id']]);
                // Update product purchase price
                if ($l['prix_unitaire_ht'] > 0) {
                    execute("UPDATE produits SET prix_achat_ht=?, prix_achat_ttc=?, prix_achat=? WHERE id=?",
                        [$l['prix_unitaire_ht'], $l['prix_unitaire_ttc'], $l['prix_unitaire_ttc'], $l['produit_id']]);
                }
            }
            execute("UPDATE bons_reception SET statut='valide' WHERE id=?", [$bon_id]);
            $_SESSION['flash'] = ['type'=>'success','msg'=>"✅ Bon ".$bon['numero']." validé! Stock mis à jour (".count($bon_lignes)." produit(s))."];
            auditLog('validate_bon', 'bon', $bon_id, ['numero'=>$bon['numero'], 'lignes'=>count($bon_lignes)]);
        } else {
            $_SESSION['flash'] = ['type'=>'danger','msg'=>"Bon introuvable ou déjà validé."];
        }
        $page = 'bons_reception';
    }
    // === DELETE DRAFT BON ===
    elseif ($action === 'delete_bon_reception' && can('create_bon_reception')) {
        $bon_id = intval($_POST['bon_id']);
        $bon = queryOne("SELECT * FROM bons_reception WHERE id=? AND statut='brouillon'", [$bon_id]);
        if ($bon) {
            execute("DELETE FROM bon_reception_lignes WHERE bon_id=?", [$bon_id]);
            execute("DELETE FROM bons_reception WHERE id=?", [$bon_id]);
            $_SESSION['flash'] = ['type'=>'success','msg'=>"🗑️ Brouillon ".$bon['numero']." supprimé."];
            auditLog('delete_bon_draft', 'bon', $bon_id, ['numero'=>$bon['numero']]);
        }
        $page = 'bons_reception';
    }
    // === EDIT DRAFT BON DE RECEPTION ===
    elseif ($action === 'edit_bon_reception' && can('create_bon_reception')) {
        $bon_id = intval($_POST['bon_id']);
        $bon = queryOne("SELECT * FROM bons_reception WHERE id=? AND statut='brouillon'", [$bon_id]);
        if ($bon) {
            $br_fid = can('view_all_franchises') ? intval($_POST['franchise_id']) : $bon['franchise_id'];
            $br_fourn = intval($_POST['fournisseur_id']) ?: null;
            $lignes = json_decode($_POST['lignes'], true);
            $is_draft = ($_POST['save_as'] ?? '') === 'brouillon';
            $total_ht = 0; $total_tva = 0; $total_ttc = 0;
            foreach ($lignes as $l) {
                $lht = floatval($l['prix_ht']) * intval($l['qty']);
                $ltva = $lht * floatval($l['tva_rate'] ?? 19) / 100;
                $total_ht += $lht; $total_tva += $ltva; $total_ttc += $lht + $ltva;
            }
            $statut = $is_draft ? 'brouillon' : 'valide';
            // Update the bon
            execute("UPDATE bons_reception SET franchise_id=?, fournisseur_id=?, total_ht=?, tva=?, total_ttc=?, statut=?, note=? WHERE id=?",
                [$br_fid, $br_fourn, round($total_ht,2), round($total_tva,2), round($total_ttc,2), $statut, strParam('note'), $bon_id]);
            // Delete old lines and insert new
            execute("DELETE FROM bon_reception_lignes WHERE bon_id=?", [$bon_id]);
            foreach ($lignes as $l) {
                $pid = intval($l['produit_id']); $qty = intval($l['qty']);
                $prix_ht = floatval($l['prix_ht']); $tva_r = floatval($l['tva_rate'] ?? 19);
                $prix_ttc = round($prix_ht * (1 + $tva_r/100), 2);
                execute("INSERT INTO bon_reception_lignes (bon_id,produit_id,quantite,prix_unitaire_ht,tva_rate,prix_unitaire_ttc,total_ht,total_ttc) VALUES (?,?,?,?,?,?,?,?)",
                    [$bon_id, $pid, $qty, $prix_ht, $tva_r, $prix_ttc, round($prix_ht*$qty,2), round($prix_ttc*$qty,2)]);
                if (!$is_draft) {
                    execute("INSERT INTO stock (franchise_id,produit_id,quantite) VALUES (?,?,?) ON DUPLICATE KEY UPDATE quantite=quantite+VALUES(quantite)", [$br_fid, $pid, $qty]);
                    execute("INSERT INTO mouvements (franchise_id,produit_id,type_mouvement,quantite,prix_unitaire,note,utilisateur_id) VALUES (?,?,'entree',?,?,?,?)",
                        [$br_fid, $pid, $qty, $prix_ht, "BR ".$bon['numero']." (modifié)", $user['id']]);
                }
            }
            if ($is_draft) {
                $_SESSION['flash'] = ['type'=>'info','msg'=>"📝 Brouillon ".$bon['numero']." mis à jour."];
            } else {
                $_SESSION['flash'] = ['type'=>'success','msg'=>"✅ Bon ".$bon['numero']." validé! Stock mis à jour."];
            }
            auditLog('edit_bon', 'bon', $bon_id, ['numero'=>$bon['numero'], 'statut'=>$statut]);
        } else {
            $_SESSION['flash'] = ['type'=>'danger','msg'=>"Bon introuvable ou déjà validé."];
        }
        $page = 'bons_reception';
    }
    // === TRESORERIE ===
    elseif ($action === 'add_tresorerie' && can('add_tresorerie')) {
        $tr_fid = can('view_all_franchises') ? intval($_POST['franchise_id']) : currentFranchise();
        execute("INSERT INTO tresorerie (franchise_id,type_mouvement,montant,motif,reference,date_mouvement,utilisateur_id) VALUES (?,?,?,?,?,?,?)",
            [$tr_fid, $_POST['type_mouvement'], floatval($_POST['montant']), strParam('motif'), strParam('reference',100), $_POST['date_mouvement'] ?: date('Y-m-d'), $user['id']]);
        $_SESSION['flash'] = ['type'=>'success','msg'=>'Mouvement de trésorerie enregistré!'];
        $page = 'tresorerie';
    }
    // === FAMILLE / SOUS-CATEGORIE ===
    elseif ($action === 'add_famille' && can('add_famille')) {
        execute("INSERT IGNORE INTO familles (nom,description) VALUES (?,?)", [strParam('nom'), strParam('description')]);
        $_SESSION['flash'] = ['type'=>'success','msg'=>'Famille ajoutée!'];
        $page = 'familles_categories';
    }
    elseif ($action === 'add_sous_categorie' && can('add_sous_categorie')) {
        execute("INSERT INTO sous_categories (nom,categorie_id) VALUES (?,?)", [strParam('nom'), intval($_POST['categorie_id'])]);
        $_SESSION['flash'] = ['type'=>'success','msg'=>'Sous-catégorie ajoutée!'];
        $page = 'familles_categories';
    }
    // === ADD PRODUCT WITH HT/TTC ===
    elseif ($action === 'duplicate_produit' && can('add_produit')) {
        $src_id = intval($_POST['source_id']);
        $src = queryOne("SELECT * FROM produits WHERE id=?", [$src_id]);
        if($src) {
            $new_nom = 'Copie — ' . $src['nom'];
            execute("INSERT INTO produits (nom,categorie_id,sous_categorie_id,prix_achat,prix_vente,prix_achat_ht,prix_achat_ttc,prix_vente_ht,prix_vente_ttc,tva_rate,marque,fournisseur_id,description,seuil_alerte) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                [$new_nom,$src['categorie_id'],$src['sous_categorie_id'],$src['prix_achat'],$src['prix_vente'],$src['prix_achat_ht'],$src['prix_achat_ttc'],$src['prix_vente_ht'],$src['prix_vente_ttc'],$src['tva_rate'],$src['marque'],$src['fournisseur_id'],$src['description'],$src['seuil_alerte']]);
            $new_pid = db()->lastInsertId();
            foreach(query("SELECT id FROM franchises WHERE actif=1") as $f) execute("INSERT IGNORE INTO stock (franchise_id,produit_id,quantite) VALUES (?,?,0)",[$f['id'],$new_pid]);
            $_SESSION['flash'] = ['type'=>'success','msg'=>"Produit dupliqué: <b>$new_nom</b> — Modifiez les infos"];
            auditLog('duplicate_produit','produit',$new_pid,['source'=>$src_id,'nom'=>$new_nom]);
        }
        $page = 'produits';
    }
    elseif ($action === 'add_produit_v2' && can('add_produit')) {
        $tva_rate = floatval($_POST['tva_rate'] ?? 19);
        $pa_ht = floatval($_POST['prix_achat_ht']);
        $pv_ht = floatval($_POST['prix_vente_ht']);
        $pa_ttc = round($pa_ht * (1 + $tva_rate/100), 2);
        $pv_ttc = round($pv_ht * (1 + $tva_rate/100), 2);
        $scid = intval($_POST['sous_categorie_id']) ?: null;
        
        // Handle image
        $img_b64 = null;
        if (!empty($_FILES['product_image']['tmp_name']) && is_uploaded_file($_FILES['product_image']['tmp_name'])) {
            $allowed = ['image/jpeg','image/png','image/webp','image/gif'];
            if (in_array($_FILES['product_image']['type'], $allowed) && $_FILES['product_image']['size'] <= 2*1024*1024) {
                $img_b64 = 'data:'.$_FILES['product_image']['type'].';base64,'.base64_encode(file_get_contents($_FILES['product_image']['tmp_name']));
            }
        }
        execute("INSERT INTO produits (nom,categorie_id,sous_categorie_id,prix_achat,prix_vente,prix_achat_ht,prix_achat_ttc,prix_vente_ht,prix_vente_ttc,tva_rate,reference,code_barre,marque,fournisseur_id,description,seuil_alerte,image_base64) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            [strParam('nom',150), intval($_POST['categorie_id']), $scid, $pa_ttc, $pv_ttc, $pa_ht, $pa_ttc, $pv_ht, $pv_ttc, $tva_rate,
             strParam('reference',50), strParam('code_barre',50), strParam('marque',50), intval($_POST['fournisseur_id']) ?: null, strParam('description',500), intval($_POST['seuil_alerte'] ?? 3), $img_b64]);
        $new_pid = db()->lastInsertId();
        // Create zero-stock entry for all active franchises
        foreach (query("SELECT id FROM franchises WHERE actif=1") as $f) {
            execute("INSERT IGNORE INTO stock (franchise_id,produit_id,quantite) VALUES (?,?,0)", [$f['id'], $new_pid]);
        }
        // If initial stock specified
        if (!empty($_POST['stock_initial']) && intval($_POST['stock_initial']) > 0) {
            $init_fid = can('view_all_franchises') ? (intval($_POST['init_franchise_id']) ?: getCentralId()) : currentFranchise();
            execute("UPDATE stock SET quantite=quantite+? WHERE franchise_id=? AND produit_id=?",
                [intval($_POST['stock_initial']), $init_fid, $new_pid]);
        }
        $_SESSION['flash'] = ['type'=>'success','msg'=>'Produit créé avec succès!'];
        auditLog('add_produit', 'produit', $new_pid, ['nom'=>strParam('nom',150)]);
        $page = $_POST['return_page'] ?? 'produits';
    }
    
    header("Location: index.php?page=$page" . ($fid ? "&fid=$fid" : "")); exit;
    } catch (Exception $e) {
        error_log("ASEL POST error [$action]: " . $e->getMessage());
        $_SESSION['flash'] = ['type'=>'danger','msg'=>'Erreur: ' . htmlspecialchars($e->getMessage())];
        header("Location: index.php?page=" . ($_GET['page'] ?? 'dashboard')); exit;
    }
}

// === Load data ===
$franchises = getRetailFranchises() ?? [];
$allFranchises = query("SELECT * FROM franchises WHERE actif=1 ORDER BY nom") ?? [];
$categories = query("SELECT * FROM categories ORDER BY nom") ?? [];
$produits = query("SELECT p.*,c.nom as cat_nom FROM produits p JOIN categories c ON p.categorie_id=c.id WHERE p.actif=1 ORDER BY c.nom,p.nom") ?? [];
$fournisseurs = query("SELECT * FROM fournisseurs WHERE actif=1 ORDER BY nom") ?? [];
try { $familles = query("SELECT * FROM familles WHERE actif=1 ORDER BY nom"); } catch(Exception $e) { $familles = []; }
try { $sous_categories = query("SELECT sc.*,c.nom as cat_nom FROM sous_categories sc JOIN categories c ON sc.categorie_id=c.id ORDER BY c.nom,sc.nom"); } catch(Exception $e) { $sous_categories = []; }
$flash = $_SESSION['flash'] ?? null; unset($_SESSION['flash']);
$csrf = csrfToken();
?>
<!DOCTYPE html>
<html lang="fr" class="h-full">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>ASEL Mobile — <?=htmlspecialchars(match($page) {
        'dashboard' => 'Tableau de bord',
        'pos' => 'Point de vente',
        'stock' => 'Stock',
        'entree' => 'Entrée stock',
        'rapports' => 'Rapports',
        'produits' => 'Produits',
        'ventes' => 'Ventes',
        'clients' => 'Clients',
        'factures' => 'Factures',
        'echeances' => 'Échéances',
        'bons_reception' => 'Bons de réception',
        'tresorerie' => 'Trésorerie',
        'fournisseurs' => 'Fournisseurs',
        'stock_central' => 'Stock Central',
        default => 'Gestion de Stock'
    })?></title>
    <meta name="description" content="ASEL Mobile - Système de gestion de stock, point de vente et facturation pour franchises de téléphonie mobile en Tunisie">
    <meta name="author" content="ASEL Mobile">
    <meta name="robots" content="noindex, nofollow">
    <meta name="theme-color" content="#2AABE2">
    <link rel="manifest" href="manifest.json">
    <link rel="apple-touch-icon" sizes="180x180" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>📱</text></svg>">
    <script src="https://cdn.tailwindcss.com"></script>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css" rel="stylesheet">
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
    <script>tailwind.config={theme:{extend:{colors:{asel:'#2AABE2','asel-dark':'#1B3A5C','asel-light':'#F0F8FF','asel-accent':'#E63946'},fontFamily:{sans:['Inter','sans-serif']}}}}</script>
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
    function resetTimer(){clearTimeout(sessionTimer);sessionTimer=setTimeout(()=>{
        openModal(modalHeader('bi-clock-history','Session expirée','Votre session a expiré') +
            `<div class="p-6 text-center"><p class="text-gray-600 mb-4">Veuillez vous reconnecter pour continuer.</p><a href="logout.php" class="w-full block py-2.5 rounded-xl bg-asel text-white font-bold text-sm">Se reconnecter</a></div>`,
            {size:'max-w-xs'});
    },30*60*1000);}
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
    /* Force Leaflet maps below sidebar/nav */
    .leaflet-pane, .leaflet-control, .leaflet-top, .leaflet-bottom { z-index: 1 !important; }
    .leaflet-container { z-index: 0 !important; position: relative; }
    /* Sticky table headers */
    .sticky-thead th { position: sticky; top: 0; z-index: 2; }
    /* Page transitions */
    .main > div { animation: fadeSlideIn 0.2s ease-out; }
    @keyframes fadeSlideIn { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:translateY(0)} }
    /* Better focus */
    input:focus, select:focus, textarea:focus { outline:none; border-color:#2AABE2!important; box-shadow:0 0 0 3px rgba(42,171,226,0.15)!important; }
    /* Scanner pulse */
    @keyframes scanPulse { 0%,100%{box-shadow:0 0 0 0 rgba(42,171,226,0.4)} 50%{box-shadow:0 0 0 8px rgba(42,171,226,0)} }
    .scan-active { animation: scanPulse 1.5s infinite; }
    /* Toast */
    #toast { position:fixed;bottom:20px;right:20px;z-index:9999;transform:translateY(100px);opacity:0;transition:all 0.3s ease;pointer-events:none; }
    #toast.show { transform:translateY(0);opacity:1; }
    /* Empty state pattern */
    .empty-state { text-align:center;padding:3rem 1rem;color:#9ca3af; }
    .empty-state i { font-size:3rem;opacity:0.3; }
    /* Mobile FAB */
    .fab { position:fixed;bottom:24px;right:24px;z-index:50;width:56px;height:56px;border-radius:50%;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 14px rgba(0,0,0,0.2); }
    @media(min-width:1024px){.fab{display:none}}
    /* Number input spinners hide */
    input[type=number]::-webkit-inner-spin-button,input[type=number]::-webkit-outer-spin-button{-webkit-appearance:none;margin:0;}
    input[type=number]{-moz-appearance:textfield;}
    /* Better select styling */
    select { cursor:pointer; }
    /* Loading skeleton */
    .skeleton { background:linear-gradient(90deg,#f0f0f0 25%,#e0e0e0 50%,#f0f0f0 75%);background-size:200% 100%;animation:shimmer 1.5s infinite; }
    @keyframes shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }
    /* Hover card effect */
    .hover-lift { transition: transform 0.2s, box-shadow 0.2s; }
    .hover-lift:hover { transform: translateY(-2px); box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
    /* Badge animation */
    @keyframes badge-bounce { 0%,100%{transform:scale(1)} 50%{transform:scale(1.2)} }
    .badge-animate { animation: badge-bounce 0.5s ease; }
    </style>
    <!-- ASEL Design System v2 -->
    <style>
    :root {
        --asel: #2AABE2; --asel-dark: #1B3A5C; --asel-light: #F0F8FF; --asel-accent: #E63946;
        --radius-sm: 0.5rem; --radius-md: 0.75rem; --radius-lg: 1rem; --radius-xl: 1.5rem;
        --shadow-card: 0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04);
        --shadow-hover: 0 4px 14px rgba(0,0,0,0.08);
        --transition-fast: 150ms cubic-bezier(0.4,0,0.2,1);
        --transition-normal: 250ms cubic-bezier(0.4,0,0.2,1);
    }
    /* Table enhancement */
    .asel-table-wrapper { position: relative; }
    .asel-table-toolbar { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center; justify-content: space-between; padding: 0.75rem 1rem; border-bottom: 1px solid #f3f4f6; background: #fafbfc; border-radius: var(--radius-lg) var(--radius-lg) 0 0; }
    .asel-table-search { border: 2px solid #e5e7eb; border-radius: var(--radius-md); padding: 6px 12px 6px 32px; font-size: 0.8125rem; width: 220px; max-width: 100%; transition: border-color var(--transition-fast); background: white url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' fill='%239ca3af' viewBox='0 0 16 16'%3E%3Cpath d='M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001q.044.06.098.115l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85a1 1 0 0 0-.115-.1zM12 6.5a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0'/%3E%3C/svg%3E") no-repeat 10px center; }
    .asel-table-search:focus { border-color: var(--asel); outline: none; box-shadow: 0 0 0 3px rgba(42,171,226,0.12); }
    .asel-table-meta { font-size: 0.6875rem; color: #9ca3af; font-weight: 600; }
    .asel-table-pagination { display: flex; align-items: center; gap: 2px; padding: 0.625rem 1rem; border-top: 1px solid #f3f4f6; background: #fafbfc; border-radius: 0 0 var(--radius-lg) var(--radius-lg); justify-content: center; flex-wrap: wrap; }
    .asel-table-pagination button, .asel-table-pagination span { font-size: 0.75rem; padding: 4px 10px; border-radius: 6px; border: none; cursor: pointer; font-weight: 600; transition: all var(--transition-fast); background: transparent; color: #6b7280; }
    .asel-table-pagination button:hover:not(:disabled) { background: var(--asel-light); color: var(--asel); }
    .asel-table-pagination button:disabled { opacity: 0.3; cursor: default; }
    .asel-table-pagination .pg-active { background: var(--asel); color: white; border-radius: 6px; }
    .asel-table-pagination .pg-info { font-size: 0.6875rem; color: #9ca3af; padding: 4px 8px; }
    /* Sortable headers */
    th[data-sortable] { cursor: pointer; user-select: none; position: relative; padding-right: 20px !important; }
    th[data-sortable]:hover { background: rgba(42,171,226,0.08) !important; }
    th[data-sortable]::after { content: '⇅'; position: absolute; right: 6px; top: 50%; transform: translateY(-50%); font-size: 10px; opacity: 0.25; }
    th[data-sort-dir="asc"]::after { content: '↑'; opacity: 0.7; color: var(--asel); }
    th[data-sort-dir="desc"]::after { content: '↓'; opacity: 0.7; color: var(--asel); }
    /* Row hover accent */
    .asel-enhanced tbody tr { transition: background var(--transition-fast); border-left: 3px solid transparent; }
    .asel-enhanced tbody tr:hover { background: var(--asel-light) !important; border-left-color: var(--asel); }
    .asel-enhanced tbody tr:nth-child(even) { background: rgba(0,0,0,0.015); }
    /* Toast stack */
    .toast-container { position: fixed; bottom: 20px; right: 20px; z-index: 9999; display: flex; flex-direction: column-reverse; gap: 8px; pointer-events: none; }
    .toast-item { pointer-events: auto; padding: 12px 18px; border-radius: var(--radius-md); font-size: 0.8125rem; font-weight: 500; box-shadow: var(--shadow-hover); transform: translateX(120%); opacity: 0; transition: all 300ms cubic-bezier(0.34,1.56,0.64,1); max-width: 320px; position: relative; overflow: hidden; }
    .toast-item.show { transform: translateX(0); opacity: 1; }
    .toast-item .toast-progress { position: absolute; bottom: 0; left: 0; height: 3px; background: rgba(255,255,255,0.4); transition: width linear; }
    .toast-success { background: #059669; color: white; }
    .toast-error { background: #DC2626; color: white; }
    .toast-warning { background: #D97706; color: white; }
    .toast-info { background: var(--asel); color: white; }
    /* Modal enhancements */
    #modal { backdrop-filter: blur(4px); }
    #modalContent { animation: modalSlideUp 250ms cubic-bezier(0.34,1.56,0.64,1); }
    @keyframes modalSlideUp { from { opacity: 0; transform: translateY(20px) scale(0.97); } to { opacity: 1; transform: translateY(0) scale(1); } }
    /* Card system */
    .card { background: white; border-radius: var(--radius-lg); box-shadow: var(--shadow-card); transition: box-shadow var(--transition-normal), transform var(--transition-normal); }
    .card:hover { box-shadow: var(--shadow-hover); }
    .card-interactive:hover { transform: translateY(-1px); }
    /* Empty state */
    .asel-empty { text-align: center; padding: 3rem 1rem; color: #d1d5db; }
    .asel-empty i { font-size: 2.5rem; margin-bottom: 0.75rem; display: block; }
    .asel-empty p { font-size: 0.875rem; color: #9ca3af; }
    /* Better scrollbar for tables */
    .asel-table-wrapper::-webkit-scrollbar { height: 6px; }
    .asel-table-wrapper::-webkit-scrollbar-thumb { background: var(--asel); border-radius: 3px; }
    .asel-table-wrapper::-webkit-scrollbar-track { background: #f1f1f1; }
    @media print { .asel-table-toolbar, .asel-table-pagination, .toast-container, #modal, .fab, nav, .sidebar, .no-print { display: none !important; } }
    @media (max-width: 640px) { .asel-table-search { width: 100%; } .asel-table-toolbar { flex-direction: column; align-items: stretch; } }
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
try {
    $notif_count = queryOne($notif_sql, $notif_params)['c'] ?? 0;
    $notifs = query("SELECT * FROM notifications WHERE lu=0 AND (" . implode(' OR ', $notif_where) . ") ORDER BY date_creation DESC LIMIT 10", $notif_params);
} catch(Exception $e) { $notif_count = 0; $notifs = []; }
?>

<!-- Mobile nav toggle -->
<div class="lg:hidden fixed top-0 left-0 right-0 z-50 bg-asel text-white px-4 py-3 flex items-center justify-between shadow-lg">
    <div class="font-black text-lg tracking-wider"><span class="bg-gradient-to-r from-red-400 via-yellow-300 to-green-400 bg-clip-text text-transparent">A</span>SEL</div>
    <div class="flex items-center gap-3">
        <!-- Quick search mobile -->
        <button onclick="document.getElementById('globalSearchBar').classList.toggle('hidden')" class="p-1" title="Recherche rapide"><i class="bi bi-search text-lg"></i></button>
        <?php if (can('pos')): ?>
        <a href="?page=pos" class="p-1" title="POS"><i class="bi bi-cart3 text-lg"></i></a>
        <?php endif; ?>
        <?php if ($notif_count > 0): ?>
        <a href="?page=notifications" class="relative">
            <i class="bi bi-bell text-xl"></i>
            <span class="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] rounded-full w-4 h-4 flex items-center justify-center font-bold"><?=min($notif_count,9)?></span>
        </a>
        <?php endif; ?>
        <button onclick="document.getElementById('sidebar').classList.toggle('-translate-x-full');document.getElementById('backdrop').classList.toggle('hidden')" class="p-1"><i class="bi bi-list text-2xl"></i></button>
    </div>
</div>
<!-- Global search bar (mobile, toggleable) -->
<div id="globalSearchBar" class="lg:hidden hidden fixed top-14 left-0 right-0 z-40 bg-white shadow-lg px-4 py-3 border-b">
    <div class="relative">
        <i class="bi bi-search absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"></i>
        <input type="text" id="globalSearchInput" placeholder="Rechercher produit, client, facture..." 
            class="w-full pl-9 pr-4 py-2.5 border-2 border-asel/30 rounded-xl text-sm focus:border-asel outline-none"
            oninput="doGlobalSearch(this.value)"
            onkeydown="if(event.key==='Escape'){document.getElementById('globalSearchBar').classList.add('hidden')}">
    </div>
    <div id="globalSearchResults" class="mt-2 hidden space-y-1 max-h-60 overflow-y-auto"></div>
</div>

<!-- Sidebar -->
<aside id="sidebar" class="fixed inset-y-0 left-0 z-40 w-64 bg-asel-dark text-white transform -translate-x-full lg:translate-x-0 transition-transform duration-200 ease-in-out overflow-y-auto">
    <!-- Logo -->
    <div class="px-6 py-5 border-b border-white/10">
        <div class="text-2xl font-black tracking-wider"><span class="bg-gradient-to-r from-red-400 via-yellow-300 via-green-400 to-blue-400 bg-clip-text text-transparent">A</span>SEL MOBILE</div>
        <div class="text-[10px] text-white/30 mt-0.5">Gestion de Stock v15.5</div>
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
    
    <!-- Notification preview in sidebar -->
    <?php if($notifs && count($notifs) > 0): ?>
    <div class="px-3 py-2 border-b border-white/10">
        <?php foreach(array_slice($notifs, 0, 3) as $n): $nc=match($n['type_notif']){'danger'=>'border-red-400 bg-red-900/30','warning'=>'border-amber-400 bg-amber-900/30',default=>'border-blue-400 bg-blue-900/20'}; ?>
        <a href="<?=e($n['lien']??'?page=notifications')?>" class="flex items-start gap-2 py-1.5 px-2 rounded-lg hover:bg-white/10 transition-colors mb-1 border-l-2 <?=$nc?>">
            <div class="flex-1 min-w-0"><div class="text-xs font-semibold text-white/90 truncate"><?=e($n['titre'])?></div><div class="text-[10px] text-white/50 truncate"><?=e(mb_substr($n['message'],0,35))?></div></div>
        </a>
        <?php endforeach; ?>
        <a href="?page=notifications" class="text-[10px] text-white/40 hover:text-white/70 block text-center mt-1">Voir tout (<?=$notif_count?>)</a>
    </div>
    <?php endif; ?>
    
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
            ['familles_categories', 'bi-diagram-3', 'Familles & Catégories'],
            ['fournisseurs', 'bi-truck', 'Fournisseurs'],
            ['bons_reception', 'bi-receipt', 'Bons de réception'],
            ['tresorerie', 'bi-cash-stack', 'Trésorerie'],
            ['pointage', 'bi-clock-history', 'Pointage employés'],
            ['gestion_services', 'bi-gear', 'Gérer services'],
            ['gestion_asel', 'bi-sim', 'Gérer offres ASEL'],
            ['franchises_mgmt', 'bi-shop', 'Franchises'],
            ['points_reseau', 'bi-geo-alt', 'Réseau & Carte'],
            ['franchise_locations', 'bi-pin-map', 'Coordonnées GPS'],
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
        <a href="?page=<?=$item[0]?>" class="flex items-center gap-3 px-6 py-2.5 text-sm transition-all <?= $active ? 'bg-white/15 text-white border-l-4 border-asel' : 'text-white/60 hover:text-white hover:bg-white/5' ?>" onclick="document.getElementById('sidebar').classList.add('-translate-x-full');document.getElementById('backdrop').classList.add('hidden')">
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

<div class="lg:hidden fixed inset-0 bg-black/50 z-30 hidden" id="backdrop" onclick="document.getElementById('sidebar').classList.add('-translate-x-full');this.classList.add('hidden')"></div>

<!-- Main content -->
<main class="lg:ml-64 pt-14 lg:pt-0 min-h-screen">
    <div class="p-4 lg:p-6 max-w-7xl mx-auto">
    
    <?php if ($flash): ?>
    <div class="mb-4 p-4 rounded-xl flex items-center gap-3 <?=$flash['type']==='success'?'bg-green-50 text-green-800 border border-green-200':'bg-red-50 text-red-800 border border-red-200'?> transition-all duration-300" id="flashMsg">
        <i class="bi <?=$flash['type']==='success'?'bi-check-circle-fill':'bi-exclamation-circle-fill'?> text-lg shrink-0"></i>
        <span class="text-sm font-medium flex-1"><?=strip_tags($flash['msg'], '<a><strong><b><i><em><br>')?></span>
        <button onclick="document.getElementById('flashMsg').remove()" class="text-current opacity-50 hover:opacity-100 shrink-0"><i class="bi bi-x-lg"></i></button>
    </div>
    <script>setTimeout(()=>{const f=document.getElementById('flashMsg');if(f){f.style.opacity='0';f.style.transform='translateY(-10px)';setTimeout(()=>f.remove(),300);}},5000);</script>
    <?php endif; ?>
    
    <?php
    // === BREADCRUMBS ===
    $pageNames = [
        'dashboard'=>'Tableau de bord','pos'=>'Point de vente','stock'=>'Stock','entree'=>'Entrée stock',
        'transferts'=>'Transferts','demandes'=>'Demandes','retours'=>'Retours','cloture'=>'Clôture',
        'echeances'=>'Échéances','inventaire'=>'Inventaire','clients'=>'Clients','services'=>'Services',
        'recharges'=>'Recharges','factures'=>'Factures','ventes'=>'Ventes','rapports'=>'Rapports',
        'produits'=>'Produits','franchises_mgmt'=>'Franchises','points_reseau'=>'Réseau','franchise_locations'=>'Coordonnées',
        'audit_log'=>'Journal d\'audit','users'=>'Utilisateurs','mon_compte'=>'Mon compte',
        'stock_central'=>'Stock Central','gestion_services'=>'Gérer services','gestion_asel'=>'Offres ASEL',
        'notifications'=>'Notifications',
        'fournisseurs'=>'Fournisseurs','bons_reception'=>'Bons de réception','tresorerie'=>'Trésorerie',
        'familles_categories'=>'Familles & Catégories',
        'pointage'=>'Pointage employés',
    ];
    if ($page !== 'dashboard' && $page !== 'pointage' && $page !== '__import_phones__'):
    ?>
    <nav class="flex items-center gap-1.5 text-xs text-gray-400 mb-4">
        <a href="?page=dashboard" class="hover:text-asel"><i class="bi bi-house"></i></a>
        <i class="bi bi-chevron-right text-[10px]"></i>
        <span class="text-gray-600 font-medium"><?=$pageNames[$page] ?? ucfirst($page)?></span>
    </nav>
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
    $wf_ech = $fid ? "AND franchise_id=".intval($fid) : "";
    $wf_fac = $fid ? "AND f.franchise_id=".intval($fid) : "";
    $wfs = $fid ? "AND s.franchise_id=".intval($fid) : "";
    $st = queryOne("SELECT COALESCE(SUM(s.quantite),0) as total, COALESCE(SUM(s.quantite*p.prix_vente),0) as valeur, COALESCE(SUM(s.quantite*p.prix_achat),0) as cout FROM stock s JOIN produits p ON s.produit_id=p.id WHERE 1=1 $wfs");
    $vj = queryOne("SELECT COALESCE(SUM(v.prix_total),0) as t, COUNT(*) as n, COALESCE(SUM(v.quantite*p.prix_achat),0) as cout FROM ventes v JOIN produits p ON v.produit_id=p.id WHERE v.date_vente=CURDATE() $wf");
    // Cash from echeance payments today + avances on lot sales today
    $echeances_cash_today = queryOne("SELECT COALESCE(SUM(montant),0) as t FROM echeances WHERE statut='payee' AND DATE(date_paiement)=CURDATE() $wf_ech")['t'] ?? 0;
    $avances_today = queryOne("SELECT COALESCE(SUM(f.montant_recu),0) as t FROM factures f WHERE f.id IN (SELECT DISTINCT facture_id FROM echeances) AND DATE(f.date_facture)=? AND f.montant_recu > 0 $wf_fac", [date('Y-m-d')])['t'] ?? 0;
    $total_cash_today = $vj['t'] + $echeances_cash_today;
    $vm = queryOne("SELECT COALESCE(SUM(v.prix_total),0) as t, COUNT(*) as n, COALESCE(SUM(v.quantite*p.prix_achat),0) as cout FROM ventes v JOIN produits p ON v.produit_id=p.id WHERE MONTH(v.date_vente)=MONTH(CURDATE()) AND YEAR(v.date_vente)=YEAR(CURDATE()) $wf");
    $vh = queryOne("SELECT COALESCE(SUM(prix_total),0) as t FROM ventes WHERE date_vente=DATE_SUB(CURDATE(), INTERVAL 1 DAY) $wf");
    // Last month comparison
    $vm_prev = queryOne("SELECT COALESCE(SUM(prix_total),0) as t FROM ventes WHERE MONTH(date_vente)=MONTH(DATE_SUB(CURDATE(),INTERVAL 1 MONTH)) AND YEAR(date_vente)=YEAR(DATE_SUB(CURDATE(),INTERVAL 1 MONTH)) $wf");
    $month_trend = $vm_prev['t'] > 0 ? round(($vm['t'] - $vm_prev['t']) / $vm_prev['t'] * 100) : 0;
    // This week vs last week
    $vw = queryOne("SELECT COALESCE(SUM(prix_total),0) as t, COUNT(*) as n FROM ventes WHERE date_vente >= DATE_SUB(CURDATE(), INTERVAL WEEKDAY(CURDATE()) DAY) AND date_vente <= CURDATE() $wf");
    $vw_prev = queryOne("SELECT COALESCE(SUM(prix_total),0) as t FROM ventes WHERE date_vente >= DATE_SUB(CURDATE(), INTERVAL WEEKDAY(CURDATE())+7 DAY) AND date_vente < DATE_SUB(CURDATE(), INTERVAL WEEKDAY(CURDATE()) DAY) $wf");
    $week_trend = $vw_prev['t'] > 0 ? round(($vw['t'] - $vw_prev['t']) / $vw_prev['t'] * 100) : 0;
    $alertes = query("SELECT s.*,p.nom as pnom,p.seuil_alerte,p.marque,f.nom as fnom FROM stock s JOIN produits p ON s.produit_id=p.id JOIN franchises f ON s.franchise_id=f.id WHERE s.quantite<=p.seuil_alerte AND p.actif=1 $wfs ORDER BY s.quantite LIMIT 15");
    $pending_transfers = queryOne("SELECT COUNT(*) as c FROM transferts WHERE statut='en_attente'")['c'] ?? 0;
    $pending_demands = queryOne("SELECT COUNT(*) as c FROM demandes_produits WHERE statut='en_attente'")['c'] ?? 0;
    $overdue_echeances = queryOne("SELECT COUNT(*) as c FROM echeances WHERE statut='en_retard'")['c'] ?? 0;
    // Trend & profit
    $trend = $vh['t'] > 0 ? round(($vj['t'] - $vh['t']) / $vh['t'] * 100) : 0;
    $profit_today = $vj['t'] - $vj['cout'];
    $profit_month = $vm['t'] - $vm['cout'];
    $margin_today = $vj['t'] > 0 ? round($profit_today / $vj['t'] * 100) : 0;
    $stock_profit_potential = $st['valeur'] - $st['cout'];
    // Trésorerie today
    try {
        $tr_enc_today = queryOne("SELECT COALESCE(SUM(montant),0) as t FROM tresorerie WHERE type_mouvement='encaissement' AND date_mouvement=CURDATE()".($fid?" AND franchise_id=".intval($fid):""))['t'];
        $tr_dec_today = queryOne("SELECT COALESCE(SUM(montant),0) as t FROM tresorerie WHERE type_mouvement='decaissement' AND date_mouvement=CURDATE()".($fid?" AND franchise_id=".intval($fid):""))['t'];
        $tr_solde = $tr_enc_today - $tr_dec_today;
    } catch(Exception $e) { $tr_enc_today = $tr_dec_today = $tr_solde = 0; }
    // Monthly treasury
    try {
        $tr_enc_month = queryOne("SELECT COALESCE(SUM(montant),0) as t FROM tresorerie WHERE type_mouvement='encaissement' AND MONTH(date_mouvement)=MONTH(CURDATE()) AND YEAR(date_mouvement)=YEAR(CURDATE())".($fid?" AND franchise_id=".intval($fid):""))['t'];
        $tr_dec_month = queryOne("SELECT COALESCE(SUM(montant),0) as t FROM tresorerie WHERE type_mouvement='decaissement' AND MONTH(date_mouvement)=MONTH(CURDATE()) AND YEAR(date_mouvement)=YEAR(CURDATE())".($fid?" AND franchise_id=".intval($fid):""))['t'];
        $tr_solde_month = $tr_enc_month - $tr_dec_month;
    } catch(Exception $e) { $tr_enc_month = $tr_dec_month = $tr_solde_month = 0; }
?>

<!-- Dashboard header with quick actions -->
<div class="flex flex-wrap items-center justify-between gap-3 mb-4">
    <div>
        <h1 class="text-2xl font-bold text-asel-dark flex items-center gap-2"><i class="bi bi-speedometer2 text-asel"></i> Tableau de bord</h1>
        <div class="text-xs text-gray-400 mt-0.5"><?=date('l d F Y', time())?> &middot; <?=e($user['nom_complet'])?></div>
    </div>
    <div class="flex gap-2 flex-wrap">
        <?php if (can('pos')): ?><a href="?page=pos" class="bg-asel hover:bg-asel-dark text-white text-xs font-bold px-4 py-2 rounded-lg transition-colors"><i class="bi bi-cart3"></i> Nouvelle vente</a><?php endif; ?>
        <?php if (can('entree')): ?><button onclick="openQuickStockEntry('<?=$fid?:($franchises[0]['id']??'')?>','<?=ejs($fid?shortF($franchises[0]['nom']??''):'')?>') " class="bg-white border-2 border-gray-200 text-gray-600 text-xs font-bold px-4 py-2 rounded-lg hover:border-asel hover:text-asel transition-colors"><i class="bi bi-box-arrow-in-down"></i> Entrée stock</button><?php endif; ?>
        <?php if (can('add_produit')): ?><button onclick="openQuickAddProduct()" class="bg-white border-2 border-gray-200 text-gray-600 text-xs font-bold px-4 py-2 rounded-lg hover:border-green-500 hover:text-green-600 transition-colors"><i class="bi bi-plus-circle"></i> Produit</button><?php endif; ?>
        <?php if (isAdmin()): ?><button onclick="openBarcodeLookup()" class="bg-white border-2 border-gray-200 text-gray-600 text-xs font-bold px-4 py-2 rounded-lg hover:border-purple-500 hover:text-purple-600 transition-colors"><i class="bi bi-upc-scan"></i> Scanner</button>
        <a href="pdf.php?type=rapport_jour&date=<?=date('Y-m-d')?><?=$fid?"&fid=$fid":''?>" target="_blank" class="bg-white border-2 border-gray-200 text-gray-600 text-xs font-bold px-4 py-2 rounded-lg hover:border-orange-500 hover:text-orange-600 transition-colors"><i class="bi bi-file-pdf"></i> Bilan du jour</a>
        <?php endif; ?>
    </div>
</div>
<!-- Today's at-a-glance banner -->
<div class="bg-gradient-to-r from-asel to-asel-dark rounded-xl p-4 mb-4 text-white flex flex-wrap gap-4 items-center">
    <div class="flex-1 min-w-0">
        <div class="text-xs text-white/60 font-bold uppercase">CA Aujourd'hui</div>
        <div class="text-3xl font-black"><?=number_format($vj['t'],2)?> <span class="text-base font-normal text-white/70">DT</span></div>
        <?php if($trend != 0): ?><div class="text-xs text-white/70 mt-0.5"><?=$trend>0?'↑ +':'↓ '?><?=abs($trend)?>% vs hier</div><?php endif; ?>
        <?php if($echeances_cash_today > 0 || $avances_today > 0): ?>
        <div class="text-[10px] text-white/50 mt-1">
            <?php if($avances_today > 0): ?>💰 Avances: <?=number_format($avances_today,2)?> DT<?php endif; ?>
            <?php if($echeances_cash_today > 0): ?> | ✅ Échéances payées: <?=number_format($echeances_cash_today,2)?> DT<?php endif; ?>
        </div>
        <div class="text-xs text-green-300 font-bold mt-0.5">Total encaissé: <?=number_format($total_cash_today,2)?> DT</div>
        <?php endif; ?>
    </div>
    <div class="w-px bg-white/20 h-12 hidden sm:block"></div>
    <div class="text-center">
        <div class="text-xs text-white/60 font-bold uppercase">Ventes</div>
        <div class="text-xl font-black"><?=$vj['n']?></div>
    </div>
    <div class="w-px bg-white/20 h-12 hidden sm:block"></div>
    <?php if(isAdminOrGest()): ?>
    <div class="text-center">
        <div class="text-xs text-white/60 font-bold uppercase">Bénéfice</div>
        <div class="text-xl font-black <?=$profit_today>=0?'text-green-300':'text-red-300'?>"><?=number_format($profit_today,1)?></div>
        <div class="text-xs text-white/50"><?=$margin_today?>% marge</div>
    </div>
    <?php endif; ?>
    <?php if($tr_solde != 0): ?>
    <div class="w-px bg-white/20 h-12 hidden sm:block"></div>
    <div class="text-center">
        <div class="text-xs text-white/60 font-bold uppercase">Trésorerie</div>
        <div class="text-xl font-black <?=$tr_solde>=0?'text-green-300':'text-red-300'?>"><?=number_format($tr_solde,1)?></div>
    </div>
    <?php endif; ?>
    <?php if(count($alertes)>0): ?>
    <div class="w-px bg-white/20 h-12 hidden sm:block"></div>
    <a href="?page=stock" class="text-center hover:text-yellow-200 transition-colors">
        <div class="text-xs text-white/60 font-bold uppercase">Stock bas</div>
        <div class="text-xl font-black text-yellow-300">⚠️ <?=count($alertes)?></div>
    </a>
    <?php endif; ?>
</div>

<!-- KPIs -->
<div class="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
    <div class="bg-white rounded-xl p-4 shadow-sm border-l-4 border-asel hover-lift">
        <div class="flex items-center justify-between">
            <div>
                <div class="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Stock total</div>
                <div class="text-2xl font-black text-asel-dark mt-0.5"><?=number_format($st['total'])?></div>
                <div class="text-xs text-gray-400">unités</div>
            </div>
            <div class="w-10 h-10 bg-asel/10 rounded-lg flex items-center justify-center"><i class="bi bi-box-seam text-asel text-lg"></i></div>
        </div>
    </div>
    <div class="bg-white rounded-xl p-4 shadow-sm border-l-4 border-emerald-500 hover-lift">
        <div class="flex items-center justify-between">
            <div>
                <div class="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Valeur stock</div>
                <div class="text-2xl font-black text-asel-dark mt-0.5"><?=number_format($st['valeur'])?></div>
                <div class="text-xs text-gray-400">DT</div>
            </div>
            <div class="w-10 h-10 bg-emerald-50 rounded-lg flex items-center justify-center"><i class="bi bi-currency-exchange text-emerald-500 text-lg"></i></div>
        </div>
    </div>
    <div class="bg-white rounded-xl p-4 shadow-sm border-l-4 border-amber-500 hover-lift">
        <div class="flex items-center justify-between">
            <div>
                <div class="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Ventes aujourd'hui</div>
                <div class="text-2xl font-black text-asel-dark mt-0.5"><?=number_format($vj['t'])?> <span class="text-sm font-normal text-gray-400">DT</span></div>
                <div class="text-xs <?=$trend>0?'text-green-600':($trend<0?'text-red-500':'text-gray-400')?>">
                    <?=$vj['n']?> vente(s) <?=$trend!=0?($trend>0?'↑':'↓').abs($trend).'% vs hier':''?>
                </div>
            </div>
            <div class="w-10 h-10 bg-amber-50 rounded-lg flex items-center justify-center"><i class="bi bi-receipt text-amber-500 text-lg"></i></div>
        </div>
    </div>
    <div class="bg-white rounded-xl p-4 shadow-sm border-l-4 border-purple-500 hover-lift">
        <div class="flex items-center justify-between">
            <div>
                <div class="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Ventes du mois</div>
                <div class="text-2xl font-black text-asel-dark mt-0.5"><?=number_format($vm['t'],2)?> <span class="text-sm font-normal text-gray-400">DT</span></div>
                <div class="text-xs <?=$month_trend>0?'text-green-600':($month_trend<0?'text-red-500':'text-gray-400')?>">
                    <?=$vm['n']?> vente(s) <?=$month_trend!=0?($month_trend>0?'↑ +':'↓ ').abs($month_trend).'% vs mois dernier':''?>
                </div>
            </div>
            <div class="w-10 h-10 bg-purple-50 rounded-lg flex items-center justify-center"><i class="bi bi-graph-up-arrow text-purple-500 text-lg"></i></div>
        </div>
    </div>
</div>

<!-- Week comparison row -->
<div class="grid grid-cols-2 gap-3 mb-4">
    <div class="bg-white rounded-xl p-3 shadow-sm border-l-4 border-cyan-500">
        <div class="text-[10px] font-bold text-gray-400 uppercase">Cette semaine</div>
        <div class="text-xl font-black text-asel-dark"><?=number_format($vw['t'],2)?> <span class="text-xs text-gray-400">DT</span></div>
        <div class="text-xs <?=$week_trend>0?'text-green-600':($week_trend<0?'text-red-500':'text-gray-400')?>"><?=$vw['n']?> ventes <?=$week_trend!=0?($week_trend>0?'↑ +':'↓ ').abs($week_trend).'% vs sem. passée':''?></div>
    </div>
    <div class="bg-white rounded-xl p-3 shadow-sm border-l-4 border-gray-300">
        <div class="text-[10px] font-bold text-gray-400 uppercase">Semaine passée</div>
        <div class="text-xl font-black text-gray-500"><?=number_format($vw_prev['t'],2)?> <span class="text-xs text-gray-400">DT</span></div>
        <?php if($week_trend !== 0): ?>
        <div class="text-xs text-gray-400">Écart: <?=$week_trend>0?'+':''?><?=number_format($vw['t'] - $vw_prev['t'],2)?> DT</div>
        <?php endif; ?>
    </div>
</div>

<?php if (isAdmin()): ?>
<!-- Profit KPIs (admin only) -->
<div class="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
    <div class="bg-white rounded-xl p-4 shadow-sm border-l-4 border-green-500 hover-lift">
        <div class="flex items-center justify-between">
            <div>
                <div class="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Bénéfice aujourd'hui</div>
                <div class="text-2xl font-black <?=$profit_today>=0?'text-green-600':'text-red-600'?>"><?=number_format($profit_today)?> <span class="text-sm font-normal text-gray-400">DT</span></div>
                <div class="text-xs text-gray-400">Marge: <?=$margin_today?>%</div>
            </div>
            <div class="w-10 h-10 bg-green-50 rounded-lg flex items-center justify-center"><i class="bi bi-piggy-bank text-green-500 text-lg"></i></div>
        </div>
    </div>
    <div class="bg-white rounded-xl p-4 shadow-sm border-l-4 border-teal-500 hover-lift">
        <div class="flex items-center justify-between">
            <div>
                <div class="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Bénéfice du mois</div>
                <div class="text-2xl font-black <?=$profit_month>=0?'text-teal-600':'text-red-600'?>"><?=number_format($profit_month)?> <span class="text-sm font-normal text-gray-400">DT</span></div>
                <div class="text-xs text-gray-400"><?=$vm['n']?> ventes</div>
            </div>
            <div class="w-10 h-10 bg-teal-50 rounded-lg flex items-center justify-center"><i class="bi bi-cash-stack text-teal-500 text-lg"></i></div>
        </div>
    </div>
    <div class="bg-white rounded-xl p-4 shadow-sm border-l-4 border-cyan-500 hover-lift">
        <div class="flex items-center justify-between">
            <div>
                <div class="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Coût du stock</div>
                <div class="text-2xl font-black text-asel-dark"><?=number_format($st['cout'])?> <span class="text-sm font-normal text-gray-400">DT</span></div>
                <div class="text-xs text-gray-400">investissement</div>
            </div>
            <div class="w-10 h-10 bg-cyan-50 rounded-lg flex items-center justify-center"><i class="bi bi-safe text-cyan-500 text-lg"></i></div>
        </div>
    </div>
    <div class="bg-white rounded-xl p-4 shadow-sm border-l-4 border-indigo-500 hover-lift">
        <div class="flex items-center justify-between">
            <div>
                <div class="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Profit potentiel stock</div>
                <div class="text-2xl font-black text-indigo-600"><?=number_format($stock_profit_potential)?> <span class="text-sm font-normal text-gray-400">DT</span></div>
                <div class="text-xs text-gray-400">si tout vendu</div>
            </div>
            <div class="w-10 h-10 bg-indigo-50 rounded-lg flex items-center justify-center"><i class="bi bi-gem text-indigo-500 text-lg"></i></div>
        </div>
    </div>
    <div class="bg-white rounded-xl p-4 shadow-sm border-l-4 border-emerald-600 hover-lift">
        <div class="flex items-center justify-between">
            <div>
                <div class="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Trésorerie (aujourd'hui)</div>
                <div class="text-2xl font-black <?=$tr_solde>=0?'text-emerald-600':'text-red-600'?>"><?=number_format($tr_solde)?> <span class="text-sm font-normal text-gray-400">DT</span></div>
                <div class="text-xs text-gray-400">Enc: <?=number_format($tr_enc_today)?> · Déc: <?=number_format($tr_dec_today)?></div>
            </div>
            <div class="w-10 h-10 bg-emerald-50 rounded-lg flex items-center justify-center"><i class="bi bi-cash-stack text-emerald-600 text-lg"></i></div>
        </div>
    </div>
    <div class="bg-white rounded-xl p-4 shadow-sm border-l-4 border-teal-500 hover-lift">
        <div class="flex items-center justify-between">
            <div>
                <div class="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Trésorerie (ce mois)</div>
                <div class="text-2xl font-black <?=$tr_solde_month>=0?'text-teal-600':'text-red-600'?>"><?=number_format($tr_solde_month)?> <span class="text-sm font-normal text-gray-400">DT</span></div>
                <div class="text-xs text-gray-400">Enc: <?=number_format($tr_enc_month)?> · Déc: <?=number_format($tr_dec_month)?></div>
            </div>
            <div class="w-10 h-10 bg-teal-50 rounded-lg flex items-center justify-center"><i class="bi bi-calendar-month text-teal-500 text-lg"></i></div>
        </div>
    </div>
</div>
<?php endif; ?>

<!-- Pending actions bar -->
<?php if ($pending_transfers || $pending_demands || $overdue_echeances || count($alertes)): ?>
<div class="flex flex-wrap gap-2 mb-6">
    <?php if (count($alertes)): ?>
    <a href="?page=stock" class="inline-flex items-center gap-1.5 bg-amber-50 border border-amber-200 text-amber-800 text-xs font-medium px-3 py-1.5 rounded-full hover:bg-amber-100 transition-colors">
        <i class="bi bi-exclamation-triangle-fill"></i> <?=count($alertes)?> stock bas
    </a>
    <?php endif; ?>
    <?php if ($pending_transfers): ?>
    <a href="?page=transferts" class="inline-flex items-center gap-1.5 bg-blue-50 border border-blue-200 text-blue-800 text-xs font-medium px-3 py-1.5 rounded-full hover:bg-blue-100 transition-colors">
        <i class="bi bi-arrow-left-right"></i> <?=$pending_transfers?> transfert(s) en attente
    </a>
    <?php endif; ?>
    <?php if ($pending_demands): ?>
    <a href="?page=demandes" class="inline-flex items-center gap-1.5 bg-indigo-50 border border-indigo-200 text-indigo-800 text-xs font-medium px-3 py-1.5 rounded-full hover:bg-indigo-100 transition-colors">
        <i class="bi bi-megaphone-fill"></i> <?=$pending_demands?> demande(s) en attente
    </a>
    <?php endif; ?>
    <?php if ($overdue_echeances): ?>
    <a href="?page=echeances" class="inline-flex items-center gap-1.5 bg-red-50 border border-red-200 text-red-800 text-xs font-medium px-3 py-1.5 rounded-full hover:bg-red-100 transition-colors">
        <i class="bi bi-credit-card-fill"></i> <?=$overdue_echeances?> échéance(s) en retard
    </a>
    <?php endif; ?>
</div>
<?php endif; ?>

<!-- Stock alerts table -->
<?php if (count($alertes)): ?>
<div class="bg-white rounded-xl shadow-sm overflow-hidden mb-6 border-l-4 border-amber-500">
    <div class="bg-amber-50 border-b border-amber-200 px-4 py-3 flex items-center justify-between">
        <span class="flex items-center gap-2 text-amber-800 font-semibold text-sm"><i class="bi bi-exclamation-triangle-fill"></i> <?=count($alertes)?> produit(s) en stock bas — Commandez maintenant</span>
        <?php if (can('entree_stock')): ?>
        <a href="?page=entree<?=$fid?"&fid=$fid":""?>" class="bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold px-3 py-1.5 rounded-lg transition-colors"><i class="bi bi-box-arrow-in-down"></i> Entrée stock</a>
        <?php endif; ?>
    </div>
    <div class="overflow-x-auto">
        <table class="w-full text-sm">
            <thead class="bg-gray-50 sticky-thead"><tr class="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                <th class="px-4 py-2">Franchise</th>
                <th class="px-4 py-2">Produit</th>
                <th class="px-4 py-2 text-center">Stock</th>
                <th class="px-4 py-2 text-center">Seuil</th>
                <?php if(can('entree_stock')): ?><th class="px-4 py-2 text-center">Action</th><?php endif; ?>
            </tr></thead>
            <tbody class="divide-y divide-gray-100">
            <?php foreach ($alertes as $a): ?>
                <tr class="<?=$a['quantite']<=0?'bg-red-50':'hover:bg-amber-50/30'?>">
                    <td class="px-4 py-2 text-xs text-gray-500"><?=shortF($a['fnom'])?></td>
                    <td class="px-4 py-2">
                        <div class="font-medium"><?=e($a['pnom'])?></div>
                        <div class="text-xs text-gray-400"><?=e($a['marque'])?></div>
                    </td>
                    <td class="px-4 py-2 text-center">
                        <span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold <?=$a['quantite']<=0?'bg-red-100 text-red-800':'bg-amber-100 text-amber-800'?>">
                            <?=$a['quantite']<=0?'⚠️ ÉPUISÉ':$a['quantite']?>
                        </span>
                    </td>
                    <td class="px-4 py-2 text-center text-xs text-gray-400"><?=$a['seuil_alerte']?></td>
                    <?php if(can('entree_stock')): ?>
                    <td class="px-4 py-2 text-center">
                        <a href="?page=entree&fid=<?=$a['franchise_id']?>" 
                           class="inline-flex items-center gap-1 bg-asel/10 hover:bg-asel text-asel hover:text-white text-xs font-bold px-2.5 py-1.5 rounded-lg transition-colors"
                           title="Faire une entrée de stock">
                            <i class="bi bi-plus-circle"></i> Réappro.
                        </a>
                    </td>
                    <?php endif; ?>
                </tr>
            <?php endforeach; ?>
            </tbody>
        </table>
    </div>
</div>
<?php endif; ?>

<!-- Charts -->
<?php if(isAdminOrGest()): ?>
<!-- Today's franchise status -->
<?php
$franchise_status = query("SELECT f.id, f.nom,
    COALESCE((SELECT SUM(prix_total) FROM ventes WHERE franchise_id=f.id AND date_vente=CURDATE()),0) as ca_today,
    COALESCE((SELECT COUNT(*) FROM ventes WHERE franchise_id=f.id AND date_vente=CURDATE()),0) as nb_today,
    (SELECT id FROM clotures WHERE franchise_id=f.id AND date_cloture=CURDATE() LIMIT 1) as cloture_id
    FROM franchises f WHERE f.actif=1 AND (f.type_franchise IS NULL OR f.type_franchise='point_de_vente') ORDER BY f.nom");
?>
<?php if(count($franchise_status)>1): ?>
<div class="grid grid-cols-<?=min(count($franchise_status),4)?> gap-3 mb-4">
<?php foreach($franchise_status as $fs): ?>
<div class="bg-white rounded-xl p-3 shadow-sm border-l-4 <?=$fs['cloture_id']?'border-green-500':'border-gray-200'?>">
    <div class="flex items-center justify-between mb-1">
        <span class="text-xs font-bold text-gray-600"><?=e(shortF($fs['nom']))?></span>
        <?php if($fs['cloture_id']): ?>
        <i class="bi bi-check-circle-fill text-green-500 text-sm"></i>
        <?php else: ?>
        <a href="?page=cloture&fid=<?=$fs['id']?>" class="text-[10px] bg-amber-100 text-amber-700 font-bold px-1.5 py-0.5 rounded hover:bg-amber-200">Clôturer</a>
        <?php endif; ?>
    </div>
    <div class="text-lg font-black <?=$fs['cloture_id']?'text-green-600':'text-asel-dark'?>"><?=number_format($fs['ca_today'],0)?> DT</div>
    <div class="text-[10px] text-gray-400"><?=$fs['nb_today']?> ventes</div>
</div>
<?php endforeach; ?>
</div>
<?php endif; ?>
<?php endif; ?>
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

<!-- Recent sales + Stock by category -->
<div class="grid lg:grid-cols-3 gap-4">
<div class="lg:col-span-2 bg-white rounded-xl shadow-sm overflow-hidden">
    <div class="px-4 py-3 border-b font-semibold text-sm text-asel-dark flex items-center justify-between">
        <span class="flex items-center gap-2"><i class="bi bi-clock-history text-asel"></i> Dernières ventes</span>
        <a href="?page=ventes" class="text-xs text-asel hover:underline">Tout voir →</a>
    </div>
    <div class="overflow-x-auto">
        <table class="w-full text-sm">
            <thead class="bg-gray-50"><tr class="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider"><th class="px-4 py-3">Date</th><th class="px-4 py-3">Produit</th><th class="px-4 py-3 hidden sm:table-cell">Franchise</th><th class="px-4 py-3 text-right">Total</th></tr></thead>
            <tbody class="divide-y divide-gray-100">
            <?php foreach (query("SELECT v.*,p.nom as pnom,f.nom as fnom,fa.id as fac_id FROM ventes v JOIN produits p ON v.produit_id=p.id JOIN franchises f ON v.franchise_id=f.id LEFT JOIN factures fa ON v.facture_id=fa.id WHERE 1=1 $wf ORDER BY v.date_creation DESC LIMIT 8") as $v): ?>
                <tr class="hover:bg-gray-50">
                    <td class="px-4 py-2 text-xs text-gray-400 whitespace-nowrap"><?=date('d/m H:i',strtotime($v['date_creation']))?></td>
                    <td class="px-4 py-2 font-medium text-sm truncate max-w-[150px]"><?=e($v['pnom'])?></td>
                    <td class="px-4 py-2 text-xs text-gray-400 hidden sm:table-cell"><?=shortF($v['fnom'])?></td>
                    <td class="px-4 py-2 text-right font-bold">
                        <?=number_format($v['prix_total'],2)?> DT
                        <?php if($v['fac_id']): ?><a href="receipt.php?id=<?=$v['fac_id']?>" target="_blank" class="text-gray-300 hover:text-asel ml-1"><i class="bi bi-receipt text-xs"></i></a><?php endif; ?>
                    </td>
                </tr>
            <?php endforeach; ?>
            </tbody>
        </table>
    </div>
</div>
<!-- Stock by category (admin) -->
<?php if(isAdminOrGest()): ?>
<div class="bg-white rounded-xl shadow-sm overflow-hidden">
    <div class="px-4 py-3 border-b font-semibold text-sm text-asel-dark flex items-center gap-2"><i class="bi bi-boxes text-asel"></i> Valeur stock / catégorie</div>
    <?php
    $cat_stock = query("SELECT c.nom, COALESCE(SUM(s.quantite),0) as qty, COALESCE(SUM(s.quantite*p.prix_vente),0) as val FROM categories c LEFT JOIN produits p ON p.categorie_id=c.id LEFT JOIN stock s ON s.produit_id=p.id WHERE 1=1 $wfs GROUP BY c.id,c.nom HAVING qty>0 ORDER BY val DESC LIMIT 8");
    $total_cat_val = array_sum(array_column($cat_stock,'val'));
    ?>
    <div class="divide-y">
    <?php foreach($cat_stock as $cs): $pct = $total_cat_val>0 ? round($cs['val']/$total_cat_val*100) : 0; ?>
        <div class="px-4 py-2.5 hover:bg-gray-50">
            <div class="flex justify-between items-center mb-1">
                <span class="text-sm font-medium"><?=e($cs['nom'])?></span>
                <span class="text-xs font-bold text-asel"><?=number_format($cs['val'],0)?> DT</span>
            </div>
            <div class="flex items-center gap-2">
                <div class="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden"><div class="h-full bg-asel/60 rounded-full" style="width:<?=$pct?>%"></div></div>
                <span class="text-[10px] text-gray-400 w-8 text-right"><?=$cs['qty']?> u</span>
            </div>
        </div>
    <?php endforeach; ?>
    </div>
</div>
<?php endif; ?>
</div>

<!-- Top clients this month (admin) -->
<?php if(isAdminOrGest()): 
    $top_clients = query("SELECT c.nom, c.prenom, c.telephone, COALESCE(SUM(v.prix_total),0) as ca, COUNT(*) as nb FROM ventes v JOIN clients c ON v.client_id=c.id WHERE MONTH(v.date_vente)=MONTH(CURDATE()) AND YEAR(v.date_vente)=YEAR(CURDATE()) $wf GROUP BY c.id ORDER BY ca DESC LIMIT 5");
    if($top_clients): ?>
<div class="bg-white rounded-xl shadow-sm overflow-hidden mt-4">
    <div class="px-4 py-3 border-b font-semibold text-sm text-asel-dark flex items-center justify-between">
        <span class="flex items-center gap-2"><i class="bi bi-star text-amber-500"></i> Top clients ce mois</span>
        <a href="?page=clients" class="text-xs text-asel hover:underline">Tous →</a>
    </div>
    <div class="divide-y">
    <?php foreach($top_clients as $i=>$tc): ?>
    <div class="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50">
        <span class="w-5 h-5 flex items-center justify-center text-[10px] font-black <?=$i===0?'bg-amber-100 text-amber-700':($i===1?'bg-gray-100 text-gray-600':($i===2?'bg-orange-50 text-orange-600':'bg-gray-50 text-gray-400'))?> rounded-full"><?=$i+1?></span>
        <div class="flex-1 min-w-0">
            <div class="text-sm font-semibold truncate"><?=e($tc['nom'].' '.($tc['prenom']??''))?></div>
            <div class="text-xs text-gray-400"><?=$tc['nb']?> achats</div>
        </div>
        <div class="text-sm font-bold text-asel"><?=number_format($tc['ca'],2)?> DT</div>
    </div>
    <?php endforeach; ?>
    </div>
</div>
<?php endif; endif; ?>

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
    $stock = query("SELECT s.*,p.nom as pnom,p.prix_vente,p.reference,p.code_barre,p.marque,p.seuil_alerte,p.description,c.nom as cnom FROM stock s JOIN produits p ON s.produit_id=p.id JOIN categories c ON p.categorie_id=c.id WHERE s.franchise_id=? AND s.quantite>0 AND p.actif=1 ORDER BY c.nom,p.nom", [$pos_fid]);
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
                    <input type="text" id="barcodeInput" class="w-full pl-10 pr-4 py-3 border-2 border-dashed border-asel/30 rounded-xl bg-asel-light/30 text-center font-mono text-lg focus:border-asel focus:ring-2 focus:ring-asel/20 outline-none" placeholder="Scanner ou taper le code-barres..." autofocus onkeypress="if(event.key==='Enter'){scanBarcode(this.value);this.value='';event.preventDefault();}">
                </div>
                <button onclick="toggleCamera()" id="btnCamera" class="px-4 bg-asel text-white rounded-xl hover:bg-asel-dark transition-colors relative" title="Ouvrir caméra (F2)">
                    <i class="bi bi-camera text-xl" id="cameraIcon"></i>
                    <span id="cameraBadge" class="hidden absolute -top-1 -right-1 w-3 h-3 bg-green-400 rounded-full border-2 border-white"></span>
                </button>
            </div>
            <div id="barcodeResult" class="mt-2 text-sm"></div>
            <div id="cameraZone" style="display:none" class="mt-3">
                <div class="relative rounded-xl overflow-hidden bg-black">
                    <div id="reader" class="rounded-xl overflow-hidden"></div>
                    <!-- Scan guide overlay -->
                    <div class="absolute inset-0 pointer-events-none flex items-center justify-center">
                        <div class="border-2 border-asel/60 rounded-lg" style="width:260px;height:110px;box-shadow:0 0 0 9999px rgba(0,0,0,0.4)">
                            <div class="w-full h-full relative">
                                <div class="absolute top-0 left-0 w-5 h-5 border-t-3 border-l-3 border-asel rounded-tl-sm"></div>
                                <div class="absolute top-0 right-0 w-5 h-5 border-t-3 border-r-3 border-asel rounded-tr-sm"></div>
                                <div class="absolute bottom-0 left-0 w-5 h-5 border-b-3 border-l-3 border-asel rounded-bl-sm"></div>
                                <div class="absolute bottom-0 right-0 w-5 h-5 border-b-3 border-r-3 border-asel rounded-br-sm"></div>
                            </div>
                        </div>
                    </div>
                    <!-- Animated scan line -->
                    <div class="absolute left-1/2 -translate-x-1/2 top-1/2 -translate-y-1/2 pointer-events-none" style="width:240px">
                        <div class="h-0.5 bg-gradient-to-r from-transparent via-red-500 to-transparent animate-pulse"></div>
                    </div>
                </div>
                <div class="flex justify-between items-center mt-2 px-1">
                    <p class="text-xs text-gray-400"><i class="bi bi-lightbulb"></i> Alignez le code-barres dans le cadre</p>
                    <div class="flex gap-3">
                        <button onclick="toggleTorch()" class="text-xs text-gray-500 hover:text-yellow-500 flex items-center gap-1" id="torchBtn"><i class="bi bi-lightning-fill"></i> Flash</button>
                        <button onclick="toggleCamera()" class="text-xs text-red-500 hover:text-red-700 flex items-center gap-1"><i class="bi bi-x-circle"></i> Fermer</button>
                    </div>
                </div>
            </div>
        </div>
        
        <!-- Search -->
        <div class="relative">
            <i class="bi bi-search absolute left-4 top-1/2 -translate-y-1/2 text-gray-400"></i>
            <input type="text" id="searchProd" class="w-full pl-11 pr-4 py-3 bg-white border border-gray-200 rounded-xl shadow-sm focus:border-asel focus:ring-2 focus:ring-asel/20 outline-none text-sm" placeholder="Rechercher (nom, marque, réf.)..." oninput="filterProducts()">
        </div>
        
        <!-- Category pills with count -->
        <div class="flex gap-1.5 flex-wrap">
            <?php
            $cat_counts = array_count_values(array_column($stock, 'cnom'));
            $total_pos_items = count($stock);
            ?>
            <button class="px-3 py-1.5 rounded-full text-xs font-semibold bg-asel text-white flex items-center gap-1" onclick="filterCat('')" id="cat-all">Tous <span class="bg-white/20 px-1.5 rounded-full text-[10px]"><?=$total_pos_items?></span></button>
            <?php $cats_used = array_unique(array_column($stock, 'cnom')); sort($cats_used); foreach ($cats_used as $cat): $cnt = $cat_counts[$cat] ?? 0; ?>
                <button class="px-3 py-1.5 rounded-full text-xs font-semibold bg-white text-gray-600 border hover:bg-asel hover:text-white transition-colors flex items-center gap-1" onclick="filterCat('<?=ejs($cat)?>')" data-cat="<?=e($cat)?>"><?=e($cat)?> <span class="bg-gray-100 px-1.5 rounded-full text-[10px]"><?=$cnt?></span></button>
            <?php endforeach; ?>
        </div>
        
        <!-- Product list -->
        <div class="space-y-1 max-h-[50vh] overflow-y-auto" id="prodGrid">
            <?php foreach ($stock as $s): 
                $is_low = $s['quantite'] <= $s['seuil_alerte'] && $s['quantite'] > 0;
                $is_zero = $s['quantite'] <= 0;
            ?>
            <div class="bg-white rounded-lg p-3 flex items-center justify-between cursor-pointer hover:bg-asel-light/50 hover:border-asel border <?=$is_zero?'border-red-200 bg-red-50/30':($is_low?'border-amber-200 bg-amber-50/20':'border-transparent')?> transition-all <?=$is_zero?'opacity-60':''?>"
                 data-search="<?=e(strtolower($s['pnom'].' '.$s['reference'].' '.$s['code_barre'].' '.$s['marque'].' '.$s['cnom']))?>"
                 data-cat="<?=e($s['cnom'])?>" data-barcode="<?=e($s['code_barre'])?>"
                 title="<?=e($s['pnom'])?><?=$s['description']?' — '.mb_substr($s['description'],0,80):'?'?>"
                 onclick="addToCart(<?=$s['produit_id']?>,'<?=ejs($s['pnom'])?>',<?=$s['prix_vente']?>,<?=$s['quantite']?>,<?=$s['seuil_alerte']?>)">
                <div class="flex-1 min-w-0">
                    <div class="font-semibold text-sm text-asel-dark truncate"><?=e($s['pnom'])?></div>
                    <div class="text-xs text-gray-400"><?=e($s['marque'])?> · <?=e($s['reference'])?></div>
                </div>
                <div class="text-right shrink-0 ml-2">
                    <div class="font-bold text-asel"><?=number_format($s['prix_vente'],1)?> DT</div>
                    <div class="text-xs font-bold <?=$is_zero?'text-red-500':($is_low?'text-amber-600':'text-gray-400')?>">
                        <?=$is_zero?'⚠️ Épuisé':($is_low?'⚠️ '.$s['quantite']:'×'.$s['quantite'])?>
                    </div>
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
            <div class="p-4 border-t bg-asel-dark/5">
                <div class="flex justify-between items-center mb-3 bg-asel-dark rounded-xl px-4 py-3">
                    <span class="font-bold text-lg text-white">TOTAL</span>
                    <span class="text-3xl font-black text-white" id="cartTotal">0.00 DT</span>
                </div>
                <!-- Client -->
                <div class="flex gap-1 mb-2">
                    <select id="clientSelect" class="ts-select flex-1 text-sm" data-placeholder="Rechercher un client..." onchange="document.getElementById('formClientId').value=this.value;toggleEcheance();loadClientInfo(this.value)">
                        <option value="" data-type="passager">Client passager</option>
                        <?php 
                        $pos_cl_where = can('view_all_franchises') ? "" : "AND (franchise_id=".intval(currentFranchise())." OR franchise_id IS NULL)";
                        $pos_clients=query("SELECT * FROM clients WHERE actif=1 $pos_cl_where ORDER BY type_client,nom"); 
                        foreach($pos_clients as $pc): $ico=match($pc['type_client']){'boutique'=>'🏪','entreprise'=>'🏢',default=>'👤'}; ?>
                        <option value="<?=$pc['id']?>" data-type="<?=$pc['type_client']?>"><?=$ico?> <?=htmlspecialchars($pc['nom'].' '.($pc['prenom']??''))?></option>
                        <?php endforeach; ?>
                    </select>
                    <button type="button" onclick="openQuickAddClient()" class="px-2 bg-green-50 text-green-600 hover:bg-green-100 rounded-lg text-sm" title="Nouveau client"><i class="bi bi-person-plus"></i></button>
                </div>
                <!-- Client info badge -->
                <div id="clientInfoBadge" class="hidden mb-2"></div>
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
                    <input type="number" id="montantRecu" step="0.5" class="flex-1 border-2 border-gray-200 rounded-lg px-3 py-1.5 text-xs" placeholder="Montant reçu (F6=exact)" oninput="calcMonnaie()">
                    <button type="button" onclick="const t=parseFloat(document.getElementById('cartTotal').textContent)||0;document.getElementById('montantRecu').value=t.toFixed(2);calcMonnaie()" class="text-[10px] bg-gray-100 hover:bg-asel hover:text-white text-gray-600 px-2 py-1.5 rounded-lg transition-colors font-bold whitespace-nowrap" title="Montant exact (F6)">Exact</button>
                    <span class="text-xs font-bold text-green-600" id="monnaieDisplay"></span>
                </div>
                <!-- Echeance / Paiement par lots -->
                <div id="echeanceDiv" class="mb-2 hidden bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs space-y-2">
                    <div class="font-bold text-amber-800 flex items-center gap-1"><i class="bi bi-calendar-range"></i> Paiement par lots</div>
                    <!-- Prix lot (may differ from cart total) -->
                    <div>
                        <label class="font-bold text-gray-600">Prix total lot (DT) <span class="text-gray-400 font-normal">— peut être différent du prix panier</span></label>
                        <div class="flex gap-2 mt-0.5">
                            <input type="number" id="prixLot" step="0.5" class="w-32 border-2 border-amber-300 rounded-lg px-2 py-1.5 text-xs font-bold" oninput="calcEcheances()" placeholder="0.00">
                            <button type="button" onclick="document.getElementById('prixLot').value=parseFloat(document.getElementById('cartTotal').textContent)||0;calcEcheances()" class="text-xs text-amber-700 hover:text-amber-900 underline">= Prix panier</button>
                        </div>
                    </div>
                    <!-- Espèces versées upfront -->
                    <div>
                        <label class="font-bold text-gray-600">Espèces versées maintenant (DT)</label>
                        <input type="number" id="especesVersees" step="0.5" value="0" min="0" class="w-32 border-2 border-green-300 rounded-lg px-2 py-1.5 text-xs mt-0.5" oninput="calcEcheances()" placeholder="0.00">
                    </div>
                    <!-- Lots config -->
                    <div class="grid grid-cols-3 gap-2">
                        <div><label class="font-bold text-gray-600">Nb de lots</label><input type="number" id="nbEch" min="1" max="24" value="2" class="w-full border-2 border-gray-200 rounded-lg px-2 py-1.5 text-xs mt-0.5" oninput="calcEcheances()"></div>
                        <div><label class="font-bold text-gray-600">Intervalle (jours)</label><input type="number" id="intervJ" min="7" max="180" value="30" class="w-full border-2 border-gray-200 rounded-lg px-2 py-1.5 text-xs mt-0.5" oninput="calcEcheances()"></div>
                        <div><label class="font-bold text-gray-600">1ère date</label><input type="date" id="premD" class="w-full border-2 border-gray-200 rounded-lg px-2 py-1.5 text-xs mt-0.5" value="<?=date('Y-m-d',strtotime('+30 days'))?>" oninput="calcEcheances()"></div>
                    </div>
                    <!-- Summary -->
                    <div id="echeanceSummary" class="bg-white rounded-lg p-2 space-y-1 border border-amber-200 text-xs"></div>
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
                    <input type="hidden" name="nb_echeances" id="formNbEch" value="2">
                    <input type="hidden" name="interv_jours" id="formIntervJ" value="30">
                    <input type="hidden" name="prem_date" id="formPremD" value="">
                    <input type="hidden" name="especes_versees" id="formEspecesVersees" value="0">
                    <input type="hidden" name="prix_lot" id="formPrixLot" value="0">
                    <button type="submit" class="w-full bg-asel hover:bg-asel-dark text-white font-bold py-3 rounded-xl transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2" id="btnVente" disabled onclick="event.preventDefault();prepareSubmit();if(checkStockBeforeSale()){this.innerHTML='<i class=\'bi bi-hourglass-split\'></i> Traitement...';this.disabled=true;document.getElementById('saleForm').submit();}">
                        <i class="bi bi-check-circle"></i> VALIDER LA VENTE
                    </button>
                </form>
                <button class="w-full mt-2 text-xs text-gray-400 hover:text-red-500 py-1" onclick="clearCart()">🗑️ Vider</button>
            </div>
        </div>
    </div>
</div>

<script>
let cart=[];
// Sound feedback for POS actions
const beepOk = () => { try { const ac=new AudioContext();const o=ac.createOscillator();const g=ac.createGain();o.connect(g);g.connect(ac.destination);o.frequency.value=800;g.gain.value=0.1;o.start();setTimeout(()=>{o.stop();ac.close()},100); } catch(e){} };
const beepErr = () => { try { const ac=new AudioContext();const o=ac.createOscillator();const g=ac.createGain();o.connect(g);g.connect(ac.destination);o.frequency.value=300;g.gain.value=0.1;o.start();setTimeout(()=>{o.stop();ac.close()},200); } catch(e){} };

function showToast(msg, type='success') {
    let t=document.getElementById('toast');
    if(!t){t=document.createElement('div');t.id='toast';document.body.appendChild(t);}
    const colors = {
        success: 'bg-green-500 text-white',
        error: 'bg-red-500 text-white',
        warning: 'bg-amber-400 text-amber-900',
        info: 'bg-blue-500 text-white'
    };
    t.className='fixed bottom-5 right-5 z-[9999] px-4 py-3 rounded-xl shadow-lg text-sm font-medium transition-all duration-300 max-w-xs '+(colors[type]||colors.success);
    t.textContent=msg;t.style.transform='translateY(0)';t.style.opacity='1';
    clearTimeout(t._timer);
    t._timer=setTimeout(()=>{t.style.transform='translateY(100px)';t.style.opacity='0';},3000);
}

function addToCart(id,nom,prix,max,seuil){
    seuil = seuil || 3;
    if(max <= 0){
        beepErr();
        openModal(modalHeader('bi-x-octagon','Stock épuisé','Impossible d\'ajouter',true) +
            `<div class="p-6 text-center">
                <div class="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-3"><i class="bi bi-x-octagon-fill text-red-500 text-2xl"></i></div>
                <p class="font-bold text-gray-800 mb-1">${nom}</p>
                <p class="text-red-600 text-sm mb-4">Stock = 0. Faites une entrée de stock d'abord.</p>
                <button onclick="closeModal()" class="w-full py-2.5 rounded-xl bg-gray-200 font-semibold text-sm">Fermer</button>
            </div>`,
            {size:'max-w-xs'});
        return;
    }
    const e=cart.find(c=>c.id===id);
    const newQty = e ? e.qty + 1 : 1;
    if(newQty > max){
        beepErr();
        showToast(`⚠️ Stock max atteint pour ${nom} (${max})`, 'error');
        return;
    }
    // Non-blocking low-stock toast warning (doesn't interrupt flow)
    if(max <= seuil && !e){
        showToast(`⚠️ Stock bas: ${nom} (${max} restant)`, 'warning');
    }
    forceAddToCart(id,nom,prix,max);
}
function forceAddToCart(id,nom,prix,max){
    const e=cart.find(c=>c.id===id);
    if(e){
        if(e.qty>=max){beepErr();showToast('Stock maximum atteint!','error');return;}
        e.qty++;
    } else {
        cart.push({id,nom,prix,qty:1,maxQty:max,remise:0});
    }
    beepOk();
    renderCart();
}
function scanBarcode(code){
    if(!code) return;
    // Try exact barcode match
    let el = document.querySelector(`[data-barcode="${code}"]`);
    if(el){ 
        el.click();
        document.getElementById('barcodeResult').innerHTML='<span class="text-green-600"><i class="bi bi-check-circle-fill"></i> '+code+' — Ajouté!</span>';
        beepOk();
    } else {
        // Try ref match
        el = document.querySelector(`[data-search*="${code.toLowerCase()}"]`);
        if(el && el.dataset.search.split(' ')[1] === code.toLowerCase()) {
            el.click();
            document.getElementById('barcodeResult').innerHTML='<span class="text-green-600"><i class="bi bi-check-circle-fill"></i> Réf. '+code+' — Ajouté!</span>';
            beepOk();
        } else {
            // Fall through to name search
            document.getElementById('searchProd').value = code;
            filterProducts();
            const visible = [...document.querySelectorAll('#prodGrid > div')].filter(e=>e.style.display!=='none');
            if(visible.length === 1) {
                visible[0].click();
                document.getElementById('searchProd').value = '';
                filterProducts();
                document.getElementById('barcodeResult').innerHTML='<span class="text-green-600"><i class="bi bi-check-circle-fill"></i> Résultat unique — Ajouté!</span>';
                beepOk();
            } else {
                document.getElementById('barcodeResult').innerHTML='<span class="text-red-500"><i class="bi bi-x-circle-fill"></i> Code <b>'+code+'</b> non trouvé</span>' +
                    (<?=can('add_produit')?'true':'false'?> ? '<button onclick="openQuickAddProduct(\'pos\');document.getElementById(\'barcodeResult\').innerHTML=\'\'" class="ml-2 text-xs text-asel underline">+ Créer produit</button>' : '');
                beepErr();
            }
        }
    }
    setTimeout(()=>document.getElementById('barcodeResult').innerHTML='',3000);
}
function removeFromCart(i){cart.splice(i,1);renderCart();showToast('Article retiré');}
function clearCart(){if(cart.length){showConfirm('Vider le panier?','Tous les articles seront retirés.','warning',()=>{cart=[];renderCart();showToast('Panier vidé');});}}
function updateQty(i,v){const q=Math.min(Math.max(1,parseInt(v)||1),cart[i].maxQty);if(q!==cart[i].qty){cart[i].qty=q;renderCart();}}
function updateRemise(i,v){cart[i].remise=Math.max(0,parseFloat(v)||0);renderCart();}
function renderCart(){
    const b=document.getElementById('cartBody');
    document.getElementById('cartCount').textContent=cart.reduce((s,c)=>s+c.qty,0);
    if(!cart.length){
        b.innerHTML='<div class="py-10 text-center text-gray-300"><i class="bi bi-cart3 text-4xl block mb-2 opacity-50"></i><p class="text-sm">Panier vide</p><p class="text-xs mt-1">Scannez ou cliquez sur un produit</p></div>';
        document.getElementById('cartTotal').textContent='0.00 DT';
        document.getElementById('btnVente').disabled=true;
        return;
    }
    let h='<div class="space-y-2">',t=0, totalRemise=0;
    cart.forEach((c,i)=>{
        const lineTotal=Math.max(0,c.qty*c.prix-c.remise);
        t+=lineTotal;
        if(c.remise>0) totalRemise+=c.remise;
        h+=`<div class="flex items-start gap-2 pb-2 border-b border-gray-100 group">
            <div class="flex-1 min-w-0">
                <div class="text-sm font-semibold truncate leading-tight">${c.nom}</div>
                <div class="text-xs text-gray-400 mt-0.5">${c.prix.toFixed(2)} DT × ${c.qty} = <b class="text-gray-600">${(c.prix*c.qty).toFixed(2)}</b></div>
            </div>
            <div class="flex items-center bg-gray-50 rounded-lg border">
                <button onclick="updateQty(${i},${c.qty-1})" class="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-red-500 font-bold text-lg leading-none" ${c.qty<=1?'':''}>&minus;</button>
                <span class="w-8 text-center text-sm font-bold">${c.qty}</span>
                <button onclick="updateQty(${i},${c.qty+1})" class="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-green-500 font-bold text-lg leading-none" ${c.qty>=c.maxQty?'disabled style="opacity:0.3"':''}>+</button>
            </div>
            <div class="flex flex-col items-end gap-1">
                <div class="text-sm font-bold text-asel-dark">${lineTotal.toFixed(2)}</div>
                <input type="number" value="${c.remise>0?c.remise:''}" min="0" step="0.5" class="w-12 text-center text-xs border rounded py-0.5 ${c.remise>0?'border-orange-300 text-orange-600':'border-gray-200 text-gray-400'}" onchange="updateRemise(${i},this.value)" placeholder="Rem." title="Remise DT">
                <button type="button" onclick="updateRemise(${i},+(c.qty*c.prix*0.05).toFixed(2));renderCart()" class="text-[9px] bg-gray-100 hover:bg-orange-100 hover:text-orange-600 text-gray-400 px-1 rounded transition-colors" title="5%">5%</button>
                <button type="button" onclick="updateRemise(${i},+(c.qty*c.prix*0.1).toFixed(2));renderCart()" class="text-[9px] bg-gray-100 hover:bg-orange-100 hover:text-orange-600 text-gray-400 px-1 rounded transition-colors" title="10%">10%</button>
            </div>
            <button class="text-gray-200 hover:text-red-500 transition-colors p-0.5 mt-1 opacity-0 group-hover:opacity-100" onclick="removeFromCart(${i})" title="Retirer"><i class="bi bi-x-lg text-xs"></i></button>
        </div>`;
    });
    
    // Totals summary
    const sousTotal = cart.reduce((s,c)=>s+c.qty*c.prix,0);
    h += `</div>
    <div class="border-t border-gray-200 mt-3 pt-3 space-y-1">
        <div class="flex justify-between text-xs text-gray-500"><span>Sous-total</span><span>${sousTotal.toFixed(2)} DT</span></div>
        ${totalRemise > 0 ? `<div class="flex justify-between text-xs text-orange-600"><span>Remise</span><span>-${totalRemise.toFixed(2)} DT</span></div>` : ''}
    </div>`;
    
    b.innerHTML=h;
    document.getElementById('cartTotal').textContent=t.toFixed(2)+' DT';
    document.getElementById('cartItems').value=JSON.stringify(cart);
    document.getElementById('btnVente').disabled=false;
    calcMonnaie();
    // Update lot payment preview if active
    if(document.getElementById('modePaiement')?.value === 'echeance') calcEcheances();
}
function filterProducts(){
    const q = document.getElementById('searchProd').value;
    if(!q.trim()) {
        document.querySelectorAll('#prodGrid > div').forEach(el => el.style.display = '');
        return;
    }
    const ql = q.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9\s]/g,' ').trim();
    const words = ql.split(/\s+/).filter(Boolean);
    document.querySelectorAll('#prodGrid > div').forEach(el => {
        const s = (el.dataset.search||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'');
        const match = words.every(w => s.includes(w));
        el.style.display = match ? '' : 'none';
    });
}
function filterCat(cat){document.querySelectorAll('#prodGrid > div').forEach(el=>{el.style.display=(!cat||el.dataset.cat===cat)?'':'none'});document.querySelectorAll('[data-cat]').forEach(b=>{b.className='px-3 py-1.5 rounded-full text-xs font-semibold bg-white text-gray-600 border hover:bg-asel hover:text-white transition-colors'});if(cat){const btn=document.querySelector(`[data-cat="${cat}"]`);if(btn)btn.className='px-3 py-1.5 rounded-full text-xs font-semibold bg-asel text-white';document.getElementById('cat-all').className='px-3 py-1.5 rounded-full text-xs font-semibold bg-white text-gray-600 border'}else{document.getElementById('cat-all').className='px-3 py-1.5 rounded-full text-xs font-semibold bg-asel text-white'}}
function loadClientInfo(cid) {
    const badge = document.getElementById('clientInfoBadge');
    if(!badge) return;
    if(!cid) { badge.classList.add('hidden'); badge.innerHTML = ''; return; }
    
    fetch('api.php?action=client_profile&id=' + cid)
        .then(r => r.json())
        .then(d => {
            if(!d.client) { badge.classList.add('hidden'); return; }
            const c = d.client;
            const du = d.echeances_pending?.reduce((s,e)=>s+parseFloat(e.montant),0) || 0;
            const achats = parseFloat(d.total_achats || 0);
            
            badge.innerHTML = `<div class="flex items-center gap-2 text-xs bg-gray-50 border rounded-xl px-3 py-2">
                <span class="font-bold text-asel-dark">${c.nom} ${c.prenom||''}</span>
                ${c.telephone ? `<a href="tel:${c.telephone}" class="text-asel ml-1"><i class="bi bi-telephone"></i> ${c.telephone}</a>` : ''}
                ${c.telephone ? `<a href="https://wa.me/${(c.telephone||'').replace(/[^0-9]/g,'')}" target="_blank" class="text-green-600 hover:text-green-700 ml-1" title="WhatsApp"><i class="bi bi-whatsapp"></i></a>` : ''}
                ${achats > 0 ? `<span class="text-gray-400 ml-auto">Total: <b class="text-asel">${achats.toFixed(0)} DT</b></span>` : ''}
                ${du > 0 ? `<span class="ml-1 bg-red-100 text-red-700 font-bold px-2 py-0.5 rounded">⚠️ Doit: ${du.toFixed(2)} DT</span>` : ''}
            </div>`;
            badge.classList.remove('hidden');
        })
        .catch(() => badge.classList.add('hidden'));
}

function toggleEcheance(){
    const mp = document.getElementById('modePaiement').value;
    const mr = document.getElementById('montantRecuDiv');
    const ed = document.getElementById('echeanceDiv');
    const clientId = document.getElementById('formClientId').value;
    
    if(mp === 'echeance') {
        // Require a client for lot payment
        if(!clientId) {
            showToast('⚠️ Sélectionnez un client pour utiliser le paiement par lot', 'warning');
            document.getElementById('modePaiement').value = 'especes';
            document.getElementById('formModePaiement').value = 'especes';
            mr.classList.remove('hidden');
            ed.classList.add('hidden');
            return;
        }
        mr.classList.add('hidden');
        ed.classList.remove('hidden');
        // Auto-fill prix lot with cart total
        const cartTot = parseFloat(document.getElementById('cartTotal').textContent) || 0;
        if(!document.getElementById('prixLot').value && cartTot > 0)
            document.getElementById('prixLot').value = cartTot.toFixed(2);
        calcEcheances();
    } else {
        mr.classList.remove('hidden');
        ed.classList.add('hidden');
    }
}

function calcEcheances(){
    const prixLot = parseFloat(document.getElementById('prixLot').value) || 0;
    const especes = parseFloat(document.getElementById('especesVersees').value) || 0;
    const nbLots = parseInt(document.getElementById('nbEch').value) || 2;
    const interv = parseInt(document.getElementById('intervJ').value) || 30;
    const premDate = document.getElementById('premD').value;
    const resteAEtaler = Math.max(0, prixLot - especes);
    const montantParLot = nbLots > 0 ? (resteAEtaler / nbLots) : 0;
    const cartTot = parseFloat(document.getElementById('cartTotal').textContent) || 0;
    const majoriation = prixLot > 0 && cartTot > 0 ? ((prixLot - cartTot) / cartTot * 100) : 0;
    
    // Build summary
    let rows = '';
    if(especes > 0)
        rows += `<div class="flex justify-between text-green-700"><span>💵 Espèces maintenant</span><span class="font-bold">${especes.toFixed(2)} DT</span></div>`;
    
    if(resteAEtaler > 0 && nbLots > 0) {
        for(let i = 0; i < nbLots; i++) {
            const mt = (i === nbLots-1) ? (resteAEtaler - montantParLot*(nbLots-1)).toFixed(2) : montantParLot.toFixed(2);
            let d = '—';
            if(premDate) {
                const date = new Date(premDate);
                date.setDate(date.getDate() + i * interv);
                d = date.toLocaleDateString('fr-TN');
            }
            rows += `<div class="flex justify-between text-gray-600"><span>Lot ${i+1}/${nbLots} — ${d}</span><span class="font-bold">${mt} DT</span></div>`;
        }
    }
    
    const summary = document.getElementById('echeanceSummary');
    if(summary) summary.innerHTML = `
        ${rows}
        <div class="border-t pt-1 mt-1 flex justify-between font-bold">
            <span>TOTAL</span>
            <span class="text-amber-700">${prixLot.toFixed(2)} DT${majoriation > 0.1 ? ` <span class="text-orange-500 font-normal">(+${majoriation.toFixed(1)}% vs panier)</span>` : ''}</span>
        </div>`;
}
function calcMonnaie(){
    const recu = parseFloat(document.getElementById('montantRecu').value) || 0;
    const total = parseFloat(document.getElementById('cartTotal').textContent) || 0;
    const monnaie = recu - total;
    const el = document.getElementById('monnaieDisplay');
    if(monnaie > 0.01) {
        el.textContent = '↩️ Monnaie: ' + monnaie.toFixed(2) + ' DT';
        el.className = 'text-xs font-bold text-green-600';
    } else if(monnaie < -0.01) {
        el.textContent = '⚠️ Insuffisant: ' + Math.abs(monnaie).toFixed(2) + ' DT';
        el.className = 'text-xs font-bold text-red-600';
    } else {
        el.textContent = recu > 0 ? '✅ Exact' : '';
        el.className = 'text-xs font-bold text-green-600';
    }
}
function prepareSubmit(){
    const mp = document.getElementById('modePaiement').value;
    document.getElementById('formMontantRecu').value = document.getElementById('montantRecu').value || '0';
    document.getElementById('formNbEch').value = document.getElementById('nbEch')?.value || '2';
    document.getElementById('formIntervJ').value = document.getElementById('intervJ')?.value || '30';
    document.getElementById('formPremD').value = document.getElementById('premD')?.value || '';
    if(mp === 'echeance') {
        const especes = parseFloat(document.getElementById('especesVersees')?.value || 0);
        const prixLot = parseFloat(document.getElementById('prixLot')?.value || 0);
        document.getElementById('formEspecesVersees').value = especes.toFixed(2);
        document.getElementById('formPrixLot').value = prixLot.toFixed(2);
        document.getElementById('formMontantRecu').value = especes.toFixed(2);
    }
}
document.addEventListener('keydown',e=>{
    const bi=document.getElementById('barcodeInput');
    if(e.key==='F2'){e.preventDefault();if(bi)bi.focus();return;}
    if(e.key==='F8'){e.preventDefault();const btn=document.getElementById('btnVente');if(btn&&!btn.disabled){prepareSubmit();document.getElementById('saleForm').submit();}return;}
    if(e.key==='F6'){
        // F6 = set montant reçu to exact cart total
        e.preventDefault();
        const total=parseFloat(document.getElementById('cartTotal').textContent)||0;
        const mr=document.getElementById('montantRecu');
        if(mr){mr.value=total.toFixed(2);calcMonnaie();}
        return;
    }
    if(e.key==='Escape'){e.preventDefault();if(cart.length)clearCart();return;}
    if(e.key==='F4'){e.preventDefault();toggleCamera();return;}
    // Auto-focus barcode input when typing numbers/letters
    if(bi&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)&&/^[a-zA-Z0-9]$/.test(e.key))bi.focus();
});
let html5QrcodeScanner=null,cameraActive=false;
let torchOn=false;

function toggleTorch(){
    if(!html5QrcodeScanner)return;
    try{
        const track=html5QrcodeScanner.getRunningTrackCameraCapabilities?.()?.torchFeature?.();
        if(track){
            torchOn=!torchOn;
            track.apply(torchOn);
            document.getElementById('torchBtn').classList.toggle('text-yellow-500',torchOn);
            document.getElementById('torchBtn').classList.toggle('text-gray-500',!torchOn);
        }else{
            // Fallback: try via video track directly
            const videoEl = document.querySelector('#reader video');
            if(videoEl && videoEl.srcObject){
                const track = videoEl.srcObject.getVideoTracks()[0];
                if(track){
                    torchOn=!torchOn;
                    track.applyConstraints({advanced:[{torch:torchOn}]}).catch(()=>{});
                    const btn=document.getElementById('torchBtn');
                    if(btn){btn.classList.toggle('text-yellow-500',torchOn);btn.classList.toggle('text-gray-500',!torchOn);}
                }
            }
        }
    }catch(e){showToast('Flash non supporté','error');}
}

function toggleCamera(){
    const z=document.getElementById('cameraZone'),ic=document.getElementById('cameraIcon'),badge=document.getElementById('cameraBadge');
    if(cameraActive){
        if(html5QrcodeScanner){html5QrcodeScanner.stop().then(()=>{html5QrcodeScanner.clear();html5QrcodeScanner=null}).catch(e=>{})}
        z.style.display='none';ic.className='bi bi-camera';cameraActive=false;
        if(badge)badge.classList.add('hidden');
    } else {
        z.style.display='block';ic.className='bi bi-camera-video-off';cameraActive=true;
        if(badge)badge.classList.remove('hidden');
        html5QrcodeScanner=new Html5Qrcode("reader");
        // Optimized for PHONE CAMERA barcode scanning
        html5QrcodeScanner.start(
            {facingMode:"environment"},
            {
                fps: 15,                    // Higher FPS for faster detection
                qrbox: {width:280,height:120}, // Wide box for barcodes
                aspectRatio: 1.777,         // 16:9 for phone cameras
                disableFlip: false,
                experimentalFeatures: {useBarCodeDetectorIfSupported: true}, // Use native BarcodeDetector API if available
                formatsToSupport: [
                    0, // QR_CODE
                    2, // CODE_128
                    3, // CODE_39
                    4, // CODE_93
                    7, // EAN_13
                    8, // EAN_8
                    10, // ITF
                    11, // UPC_A
                    12, // UPC_E
                ],
            },
            (decodedText)=>{
                beepOk();
                scanBarcode(decodedText);
                // Brief pause then auto-resume for continuous scanning
                html5QrcodeScanner.pause(true);
                setTimeout(()=>{
                    if(cameraActive&&html5QrcodeScanner){
                        try{html5QrcodeScanner.resume()}catch(e){}
                    }
                },800); // Shorter pause = faster continuous scanning
            },
            (error)=>{/* ignore scan errors */}
        ).catch(e=>{
            document.getElementById('barcodeResult').innerHTML='<span class="text-red-500"><i class="bi bi-exclamation-triangle"></i> Caméra non disponible. Vérifiez les permissions.</span>';
            z.style.display='none';ic.className='bi bi-camera';cameraActive=false;
            if(badge)badge.classList.add('hidden');
        });
    }
}
</script>

<?php
// =====================================================
// STOCK
// =====================================================
elseif ($page === 'stock'):
    if (!$fid && can('view_all_franchises')):
        // Show franchise cards with stock summary
        $franchise_stocks = query("SELECT f.id, f.nom, COALESCE(SUM(s.quantite),0) as total_qty, COALESCE(SUM(s.quantite*p.prix_vente),0) as valeur FROM franchises f LEFT JOIN stock s ON f.id=s.franchise_id LEFT JOIN produits p ON s.produit_id=p.id WHERE f.actif=1 GROUP BY f.id,f.nom ORDER BY f.nom");
?>
<div class="flex items-center justify-between mb-4">
    <h1 class="text-2xl font-bold text-asel-dark flex items-center gap-2"><i class="bi bi-box-seam text-asel"></i> Stock</h1>
    <a href="?page=stock&fid=all" class="bg-white border-2 border-gray-200 text-gray-600 text-xs font-bold px-3 py-2 rounded-xl hover:border-asel hover:text-asel transition-colors"><i class="bi bi-grid"></i> Voir tout</a>
</div>
<div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
    <?php foreach ($franchise_stocks as $f):
        $low = queryOne("SELECT COUNT(*) as c FROM stock s JOIN produits p ON s.produit_id=p.id WHERE s.franchise_id=? AND s.quantite<=p.seuil_alerte AND p.actif=1", [$f['id']])['c'];
    ?>
    <a href="?page=stock&fid=<?=$f['id']?>" class="bg-white border-2 border-transparent hover:border-asel rounded-xl p-5 shadow-sm transition-all group">
        <div class="flex items-start justify-between mb-3">
            <div class="w-10 h-10 bg-asel/10 rounded-xl flex items-center justify-center group-hover:bg-asel transition-colors">
                <i class="bi bi-shop text-asel group-hover:text-white"></i>
            </div>
            <?php if($low > 0): ?>
            <span class="bg-amber-100 text-amber-700 text-[10px] font-bold px-2 py-0.5 rounded-full">⚠️ <?=$low?> bas</span>
            <?php endif; ?>
        </div>
        <div class="font-bold text-asel-dark"><?=shortF($f['nom'])?></div>
        <div class="text-sm text-gray-500 mt-1"><?=number_format($f['total_qty'])?> unités</div>
        <div class="text-xs text-asel font-semibold mt-0.5"><?=number_format($f['valeur'])?> DT</div>
    </a>
    <?php endforeach; ?>
</div>
<?php return; endif;
    // fid=all means show all franchises (no filter)
    if ($fid === 'all') $fid = null;
    $stock = query("SELECT s.*,p.nom as pnom,p.prix_vente,p.prix_achat,p.reference,p.marque,c.nom as cnom,f.nom as fnom FROM stock s JOIN produits p ON s.produit_id=p.id JOIN categories c ON p.categorie_id=c.id JOIN franchises f ON s.franchise_id=f.id WHERE p.actif=1 ".($fid?"AND s.franchise_id=".intval($fid):"")." ORDER BY f.nom,c.nom,p.nom");
?>
<div class="flex flex-wrap justify-between items-center gap-3 mb-4">
    <div class="flex items-center gap-3">
        <a href="?page=stock" class="text-gray-400 hover:text-asel"><i class="bi bi-arrow-left text-lg"></i></a>
        <h1 class="text-2xl font-bold text-asel-dark flex items-center gap-2"><i class="bi bi-box-seam text-asel"></i> Stock <?php if($fid): ?><span class="text-lg font-normal text-gray-400">— <?php foreach($allFranchises as $af) { if($af['id']==$fid) echo shortF($af['nom']); } ?></span><?php endif; ?></h1>
    </div>
    <div class="flex gap-2">
        <?php if(can('view_all_franchises') && $fid): ?>
        <select onchange="location.href='?page=stock&fid='+this.value" class="border-2 border-gray-200 rounded-xl px-3 py-1.5 text-xs">
            <option value="">Toutes</option>
            <?php foreach($allFranchises as $af): ?>
            <option value="<?=$af['id']?>" <?=$fid==$af['id']?'selected':''?>><?=shortF($af['nom'])?></option>
            <?php endforeach; ?>
        </select>
        <?php endif; ?>
        <a href="api.php?action=export_stock<?=$fid?"&fid=$fid":""?>" class="bg-white border-2 border-asel text-asel font-semibold px-4 py-2 rounded-xl text-sm hover:bg-asel hover:text-white transition-colors"><i class="bi bi-download"></i> Export</a>
    </div>
</div>
<!-- Instant search + quick filters -->
<?php
// Stock KPIs for detail view
$stock_kpi = queryOne("SELECT COALESCE(SUM(s.quantite),0) as qty, COALESCE(SUM(s.quantite*p.prix_vente),0) as val_ttc, COALESCE(SUM(s.quantite*p.prix_achat),0) as cout FROM stock s JOIN produits p ON s.produit_id=p.id WHERE p.actif=1".($fid?" AND s.franchise_id=".intval($fid):""));
$stock_profit = ($stock_kpi['val_ttc']??0) - ($stock_kpi['cout']??0);
?>
<div class="grid grid-cols-3 gap-3 mb-4">
    <div class="bg-white rounded-xl p-3 shadow-sm border-l-4 border-asel">
        <div class="text-[10px] text-gray-400 font-bold uppercase">Unités</div>
        <div class="text-xl font-black text-asel-dark"><?=number_format($stock_kpi['qty'])?></div>
    </div>
    <div class="bg-white rounded-xl p-3 shadow-sm border-l-4 border-blue-500">
        <div class="text-[10px] text-gray-400 font-bold uppercase">Valeur TTC</div>
        <div class="text-xl font-black text-asel-dark"><?=number_format($stock_kpi['val_ttc'],0)?> <span class="text-xs text-gray-400">DT</span></div>
    </div>
    <div class="bg-white rounded-xl p-3 shadow-sm border-l-4 border-green-500">
        <div class="text-[10px] text-gray-400 font-bold uppercase">Profit potentiel</div>
        <div class="text-xl font-black <?=$stock_profit>=0?'text-green-600':'text-red-600'?>"><?=number_format($stock_profit,0)?> <span class="text-xs text-gray-400">DT</span></div>
    </div>
</div>
<div class="flex gap-2 mb-4 flex-wrap items-center">
    <div class="relative flex-1 min-w-[200px]">
        <i class="bi bi-search absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"></i>
        <input type="text" id="stockSearch" class="w-full pl-10 pr-4 py-2.5 border-2 border-gray-200 rounded-xl text-sm focus:border-asel" placeholder="Rechercher produit, marque, catégorie..." oninput="filterStock()">
        <span id="stockCount" class="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400"></span>
    </div>
    <button onclick="filterStockLow()" id="btnStockLow" class="px-3 py-2 rounded-xl text-xs font-bold bg-amber-100 text-amber-700 hover:bg-amber-200 transition-colors border-2 border-transparent" title="Afficher stock bas seulement">⚠️ Stock bas</button>
    <button onclick="filterStockZero()" id="btnStockZero" class="px-3 py-2 rounded-xl text-xs font-bold bg-red-100 text-red-700 hover:bg-red-200 transition-colors border-2 border-transparent" title="Afficher épuisés seulement">🔴 Épuisés</button>
    <button onclick="clearStockFilter()" class="px-3 py-2 rounded-xl text-xs font-bold bg-gray-100 text-gray-500 hover:bg-gray-200 transition-colors">Tout</button>
</div>
</div>
<div class="bg-white rounded-xl shadow-sm overflow-hidden">
    <div class="overflow-x-auto">
        <table class="w-full text-sm" id="stockTable">
            <thead class="sticky-thead"><tr class="bg-asel-dark text-white text-xs uppercase tracking-wider"><th class="px-3 py-3 text-left">Franchise</th><th class="px-3 py-3 text-left">Catégorie</th><th class="px-3 py-3 text-left">Produit</th><th class="px-3 py-3 text-left hidden sm:table-cell">Marque</th><th class="px-3 py-3 text-center">Qté</th><th class="px-3 py-3 text-right">P.V.</th><th class="px-3 py-3 text-right hidden sm:table-cell">Valeur</th><?php if(isAdmin()):?><th class="px-3 py-3"></th><?php endif;?></tr></thead>
            <tbody class="divide-y divide-gray-100"><?php $tq=0;$tv=0; foreach ($stock as $s): $v=$s['quantite']*$s['prix_vente'];$tq+=$s['quantite'];$tv+=$v; ?>
                <tr class="hover:bg-gray-50 stock-row <?=$s['quantite']<=0?'bg-red-50/50':($s['quantite']<=3?'bg-amber-50/30':'')?>" data-search="<?=e(strtolower($s['pnom'].' '.$s['cnom'].' '.$s['marque'].' '.shortF($s['fnom'])))?>">
                    <td class="px-3 py-2 text-xs text-gray-500"><?=shortF($s['fnom'])?></td>
                    <td class="px-3 py-2 text-xs"><?=$s['cnom']?></td>
                    <td class="px-3 py-2 font-medium"><?=htmlspecialchars($s['pnom'])?></td>
                    <td class="px-3 py-2 text-xs text-gray-400 hidden sm:table-cell"><?=$s['marque']?></td>
                    <td class="px-3 py-2 text-center"><span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold <?=$s['quantite']<=0?'bg-red-100 text-red-800':($s['quantite']<=3?'bg-amber-100 text-amber-800':'bg-green-100 text-green-800')?>"><?=$s['quantite']?></span></td>
                    <td class="px-3 py-2 text-right"><?=number_format($s['prix_vente'],1)?></td>
                    <td class="px-3 py-2 text-right font-medium hidden sm:table-cell"><?=number_format($v,0)?></td>
                    <?php if(isAdmin()):?><td class="px-3 py-2">
                        <div class="flex gap-1">
                        <?php if($s['quantite'] <= 3): ?>
                        <a href="?page=entree&fid=<?=$s['franchise_id']?>" class="text-asel hover:text-asel-dark" title="Entrée stock"><i class="bi bi-plus-circle text-xs"></i></a>
                        <?php endif; ?>
                        <button onclick="openStockCorrection(<?=$s['produit_id']?>,<?=$s['franchise_id']?>,<?=$s['quantite']?>,'<?=ejs($s['pnom'])?>')" class="text-gray-400 hover:text-purple-600" title="Corriger le stock"><i class="bi bi-pencil-square text-xs"></i></button>
                        <?php if($s['quantite'] <= 0): ?>
                        <form method="POST" class="inline" onsubmit="return confirm('Désactiver?')"><input type="hidden" name="_csrf" value="<?=$csrf?>"><input type="hidden" name="action" value="toggle_produit"><input type="hidden" name="produit_id" value="<?=$s['produit_id']?>">
                        <button class="text-red-400 hover:text-red-700 text-xs"><i class="bi bi-eye-slash"></i></button></form>
                        <?php endif; ?>
                        </div>
                    </td><?php endif;?>
                </tr>
            <?php endforeach; ?></tbody>
            <tfoot><tr class="bg-asel-dark text-white font-bold"><td colspan="4" class="px-3 py-3">TOTAL</td><td class="px-3 py-3 text-center"><?=number_format($tq)?></td><td class="px-3 py-3"></td><td class="px-3 py-3 text-right hidden sm:table-cell"><?=number_format($tv)?> DT</td><?php if(isAdmin()):?><td></td><?php endif;?></tr></tfoot>
        </table>
    </div>
</div>
<script>
function filterStock(){
    const q = document.getElementById('stockSearch').value;
    const rows = document.querySelectorAll('.stock-row');
    if(!q.trim()) {
        rows.forEach(r => r.style.display = '');
        document.getElementById('stockCount').textContent = '';
        return;
    }
    const ql = q.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9\s]/g,' ').trim();
    const words = ql.split(/\s+/).filter(Boolean);
    let v = 0;
    rows.forEach(r => {
        const s = (r.dataset.search||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'');
        const match = words.every(w => s.includes(w));
        r.style.display = match ? '' : 'none';
        if(match) v++;
    });
    document.getElementById('stockCount').textContent = q ? v+'/'+rows.length : '';
}

function openStockCorrection(pid, fid, currentQty, nom) {
    openModal(
        modalHeader('bi-pencil-square','Correction de stock',nom) +
        `<form method="POST" class="p-6 space-y-4">
            <input type="hidden" name="_csrf" value="<?=$csrf?>">
            <input type="hidden" name="action" value="stock_set">
            <input type="hidden" name="produit_id" value="${pid}">
            <input type="hidden" name="franchise_id" value="${fid}">
            <div class="bg-gray-50 rounded-xl p-3 text-center mb-2">
                <div class="text-xs text-gray-400">Stock actuel</div>
                <div class="text-3xl font-black text-asel">${currentQty}</div>
            </div>
            ${modalField('Nouvelle quantité *', 'quantite_new', 'number', currentQty, '0')}
            ${modalField('Raison', 'note', 'text', '', 'Correction inventaire, casse, vol...')}
            <div class="flex gap-3">
                <button type="button" onclick="closeModal()" class="flex-1 py-2.5 rounded-xl border-2 border-gray-200 font-semibold text-sm">Annuler</button>
                <button type="submit" class="flex-1 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-bold text-sm transition-colors flex items-center justify-center gap-2">
                    <i class="bi bi-check-circle"></i> Appliquer
                </button>
            </div>
        </form>`,
        {size: 'max-w-sm'}
    );
    setTimeout(() => document.querySelector('[name="quantite_new"]')?.select(), 200);
}

function filterStockLow(){
    clearStockFilter();
    const rows = document.querySelectorAll('.stock-row');
    let v=0;
    rows.forEach(r => {
        const isLow = r.classList.contains('bg-amber-50/30') || r.classList.contains('bg-red-50/50');
        r.style.display = isLow ? '' : 'none';
        if(isLow) v++;
    });
    document.getElementById('stockCount').textContent = v+' stock(s) bas';
    document.getElementById('btnStockLow').classList.add('border-amber-500');
}

function filterStockZero(){
    clearStockFilter();
    const rows = document.querySelectorAll('.stock-row');
    let v=0;
    rows.forEach(r => {
        const isZero = r.classList.contains('bg-red-50/50');
        r.style.display = isZero ? '' : 'none';
        if(isZero) v++;
    });
    document.getElementById('stockCount').textContent = v+' épuisé(s)';
    document.getElementById('btnStockZero').classList.add('border-red-500');
}

function clearStockFilter(){
    document.getElementById('stockSearch').value = '';
    document.querySelectorAll('.stock-row').forEach(r => r.style.display = '');
    document.getElementById('stockCount').textContent = '';
    document.getElementById('btnStockLow').classList.remove('border-amber-500');
    document.getElementById('btnStockZero').classList.remove('border-red-500');
}
</script>

<?php
// =====================================================
// ENTREE STOCK
// =====================================================
elseif ($page === 'entree'):
    $e_fid = $fid ?: currentFranchise();
    if (!$e_fid && can('view_all_franchises')): ?>
<h1 class="text-2xl font-bold text-asel-dark mb-4 flex items-center gap-2"><i class="bi bi-box-arrow-in-down text-asel"></i> Entrée de stock</h1>
<?php
// Load all stock counts in one query (avoid N+1)
$stock_counts = [];
foreach(query("SELECT franchise_id, SUM(quantite) as t FROM stock GROUP BY franchise_id") as $sc) {
    $stock_counts[$sc['franchise_id']] = intval($sc['t']);
}
?>
<div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
    <?php foreach ($allFranchises as $f): $sc_qty = $stock_counts[$f['id']] ?? 0; ?>
    <a href="?page=entree&fid=<?=$f['id']?>" class="bg-white border-2 border-transparent hover:border-asel rounded-xl p-5 shadow-sm transition-all group">
        <div class="flex items-center gap-3 mb-3">
            <div class="w-10 h-10 bg-asel/10 rounded-xl flex items-center justify-center group-hover:bg-asel transition-colors"><i class="bi bi-shop text-asel group-hover:text-white"></i></div>
            <div><div class="font-bold text-asel-dark"><?=shortF($f['nom'])?></div><div class="text-xs text-gray-400"><?=number_format($sc_qty)?> articles en stock</div></div>
        </div>
        <div class="flex justify-end"><span class="text-xs font-bold text-asel group-hover:text-asel-dark">Gérer →</span></div>
    </a>
    <?php endforeach; ?>
</div>
<?php return; endif;

$franchise_info = queryOne("SELECT * FROM franchises WHERE id=?", [$e_fid]);
$recent_entrees = query("SELECT m.*,p.nom as pnom,p.reference FROM mouvements m JOIN produits p ON m.produit_id=p.id WHERE m.franchise_id=? AND m.type_mouvement='entree' ORDER BY m.date_mouvement DESC LIMIT 10", [$e_fid]);
?>
<div class="flex items-center gap-3 mb-4">
    <a href="?page=entree" class="text-gray-400 hover:text-asel"><i class="bi bi-arrow-left text-lg"></i></a>
    <h1 class="text-2xl font-bold text-asel-dark flex items-center gap-2"><i class="bi bi-box-arrow-in-down text-asel"></i> Entrée stock — <?=e(shortF($franchise_info['nom']??''))?></h1>
</div>

<div class="grid lg:grid-cols-5 gap-4">
<!-- LEFT: Multi-product entry form -->
<div class="lg:col-span-3">
<div class="bg-white rounded-xl shadow-sm p-4 border-2 border-asel/20">
    <div class="flex items-center justify-between mb-4">
        <h3 class="font-bold text-asel-dark flex items-center gap-2"><i class="bi bi-plus-circle text-asel"></i> Nouvelle entrée multi-produits</h3>
        <span class="text-xs bg-asel/10 text-asel font-bold px-2 py-1 rounded-lg" id="entreeCount">0 produit(s)</span>
    </div>
    
    <!-- Search & add product -->
    <div class="bg-asel-light/30 rounded-xl p-3 mb-4 border border-asel/10">
        <label class="text-xs font-bold text-gray-500 mb-2 block"><i class="bi bi-upc-scan"></i> Scanner ou rechercher — code-barres, référence, nom, modèle, marque</label>
        <div class="flex gap-2">
            <div class="relative flex-1">
                <i class="bi bi-search absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm pointer-events-none"></i>
                <input type="text" id="entreeSearch" placeholder="Tapez n'importe quoi ou scannez le code-barres (↑↓ naviguer, Entrée ajouter)..." 
                    class="w-full pl-9 pr-4 border-2 border-asel/30 rounded-xl py-2.5 text-sm focus:border-asel outline-none bg-white"
                    oninput="searchEntreeProducts(this.value)" 
                    onkeydown="handleEntreeKey(event)"
                    autocomplete="off" spellcheck="false">
                <div id="entreeSearchResults" class="absolute top-full left-0 right-0 bg-white border-2 border-asel/30 rounded-xl mt-1 shadow-2xl z-50 max-h-72 overflow-y-auto hidden"></div>
            </div>
            <div class="flex gap-1">
                <input type="number" id="entreeQty" value="1" min="1" class="w-16 border-2 border-gray-200 rounded-xl px-2 text-center text-sm font-bold" title="Quantité" placeholder="Qté">
                <input type="number" id="entreePrixHT" step="0.01" placeholder="P.A. HT" class="w-24 border-2 border-gray-200 rounded-xl px-2 text-xs" title="Prix d'achat HT">
                <button type="button" onclick="addEntreeLineFromSearch()" class="bg-green-500 hover:bg-green-600 text-white px-3 rounded-xl text-sm font-bold transition-colors" title="Ajouter (ou appuyer Entrée)">
                    <i class="bi bi-plus-lg"></i>
                </button>
            </div>
        </div>
        <div id="entreeSelectedProduct" class="mt-2 hidden">
            <div class="flex items-center gap-2 bg-green-50 border border-green-200 rounded-lg px-3 py-2 text-xs">
                <i class="bi bi-check-circle-fill text-green-500"></i>
                <span id="entreeSelectedName" class="font-semibold"></span>
                <span id="entreeSelectedInfo" class="text-gray-400"></span>
            </div>
        </div>
    </div>
    
    <!-- Lignes en attente -->
    <div id="entreeLines" class="space-y-2 mb-4 min-h-16">
        <div id="entreePlaceholder" class="flex items-center justify-center py-8 text-gray-400 text-sm">
            <div class="text-center"><i class="bi bi-box-arrow-in-down text-3xl opacity-30 mb-2 block"></i>Recherchez des produits pour les ajouter</div>
        </div>
    </div>
    
    <!-- Options et validation -->
    <form id="entreeForm" method="POST">
        <input type="hidden" name="_csrf" value="<?=$csrf?>">
        <input type="hidden" name="action" value="entree_multi_stock">
        <input type="hidden" name="franchise_id" value="<?=$e_fid?>">
        <input type="hidden" name="lignes" id="entreeLignesInput" value="[]">
        
        <div class="border-t pt-3 space-y-3">
            <div class="grid grid-cols-2 gap-3">
                <div>
                    <label class="text-xs font-bold text-gray-500">Fournisseur</label>
                    <select name="fournisseur_id" class="w-full border-2 border-gray-200 rounded-xl px-3 py-2 text-sm">
                        <option value="">— Aucun —</option>
                        <?php foreach($fournisseurs as $f): ?>
                        <option value="<?=$f['id']?>"><?=e($f['nom'])?></option>
                        <?php endforeach; ?>
                    </select>
                </div>
                <div>
                    <label class="text-xs font-bold text-gray-500">Référence / N° BL</label>
                    <input name="reference_bl" class="w-full border-2 border-gray-200 rounded-xl px-3 py-2 text-sm" placeholder="BL-2024-001">
                </div>
            </div>
            <div class="flex items-center gap-2">
                <input type="checkbox" name="create_bon" id="createBon" value="1" checked class="rounded">
                <label for="createBon" class="text-xs text-gray-600">Créer un bon de réception automatiquement</label>
            </div>
            <div>
                <label class="text-xs font-bold text-gray-500">Note</label>
                <input name="note" class="w-full border-2 border-gray-200 rounded-xl px-3 py-2 text-sm" placeholder="Note optionnelle">
            </div>
        </div>
        
        <div class="mt-4 bg-asel-light/50 rounded-xl p-3 flex justify-between items-center">
            <div class="text-sm"><span class="text-gray-500">Total HT:</span> <span class="font-bold text-asel-dark" id="entreeTotalHT">0.00</span> DT &nbsp; <span class="text-gray-400 text-xs" id="entreeTotalTTC"></span></div>
            <button type="submit" id="entreSubmit" disabled 
                onclick="if(!this.disabled){this.disabled=true;this.innerHTML='<i class=\'bi bi-hourglass-split\'></i> Enregistrement...'}"
                class="bg-asel disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-bold px-6 py-2.5 rounded-xl text-sm transition-colors flex items-center gap-2">
                <i class="bi bi-check-circle"></i> Valider l'entrée
            </button>
        </div>
    </form>
</div>
</div>

<!-- RIGHT: Recent entries -->
<div class="lg:col-span-2">
    <div class="bg-white rounded-xl shadow-sm overflow-hidden">
        <div class="px-4 py-3 border-b flex items-center gap-2">
            <i class="bi bi-clock-history text-gray-400"></i>
            <span class="font-semibold text-sm">Dernières entrées</span>
        </div>
        <?php if($recent_entrees): ?>
        <div class="divide-y">
        <?php foreach($recent_entrees as $e): ?>
        <div class="px-4 py-3 flex items-center justify-between hover:bg-gray-50">
            <div>
                <div class="font-medium text-sm"><?=e($e['pnom'])?></div>
                <div class="text-xs text-gray-400"><?=date('d/m H:i',strtotime($e['date_mouvement']))?> <?=$e['note']?"— ".e(mb_substr($e['note'],0,25)):''?></div>
            </div>
            <span class="font-bold text-green-600 text-sm">+<?=$e['quantite']?></span>
        </div>
        <?php endforeach; ?>
        </div>
        <?php else: ?>
        <div class="px-4 py-8 text-center text-gray-400 text-sm"><i class="bi bi-inbox text-2xl block mb-2 opacity-30"></i>Aucune entrée récente</div>
        <?php endif; ?>
    </div>
    
    <!-- Quick stock check -->
    <div class="bg-white rounded-xl shadow-sm overflow-hidden mt-4">
        <div class="px-4 py-3 border-b flex items-center gap-2">
            <i class="bi bi-exclamation-triangle text-amber-500"></i>
            <span class="font-semibold text-sm">Stock bas</span>
        </div>
        <?php
        $stock_bas = query("SELECT s.*,p.nom as pnom,p.seuil_alerte FROM stock s JOIN produits p ON s.produit_id=p.id WHERE s.franchise_id=? AND s.quantite<=p.seuil_alerte AND p.actif=1 ORDER BY s.quantite LIMIT 8", [$e_fid]);
        ?>
        <?php if($stock_bas): ?>
        <div class="divide-y">
        <?php foreach($stock_bas as $s): ?>
        <div class="px-4 py-2.5 flex items-center justify-between hover:bg-amber-50">
            <span class="text-sm"><?=e($s['pnom'])?></span>
            <span class="font-bold text-xs <?=$s['quantite']<=0?'text-red-600':'text-amber-600'?>"><?=$s['quantite']?></span>
        </div>
        <?php endforeach; ?>
        </div>
        <?php else: ?>
        <div class="px-4 py-6 text-center text-gray-400 text-sm"><i class="bi bi-check-circle text-green-400 text-xl block mb-1"></i>Tout le stock est OK</div>
        <?php endif; ?>
    </div>
</div>
</div>

<script>
const entreeProds = <?=json_encode(array_map(fn($p)=>[
    'id'=>$p['id'],'nom'=>$p['nom'],'ref'=>$p['reference']??'','cat'=>$p['cat_nom'],
    'marque'=>$p['marque']??'','pa'=>floatval($p['prix_achat_ht']??$p['prix_achat']),
    'pv'=>floatval($p['prix_vente_ttc']??$p['prix_vente']),
    'tva'=>floatval($p['tva_rate']??19),'code_barre'=>$p['code_barre']??'',
    'desc'=>$p['description']??'',
    // Searchable composite string
    'search'=>strtolower($p['nom'].' '.$p['reference'].' '.($p['marque']??'').' '.($p['code_barre']??'').' '.$p['cat_nom'].' '.($p['description']??''))
], $produits ?? []))?>;

let entreeLines = [];
let selectedProd = null;
let searchIdx = -1;

function normalizeSearch(s) {
    return s.toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9\s]/g, ' ').trim();
}

function scoreMatch(prod, q) {
    const ql = normalizeSearch(q);
    const words = ql.split(/\s+/).filter(Boolean);
    
    // Exact barcode match = highest priority
    if(prod.code_barre && prod.code_barre.toLowerCase() === q.toLowerCase()) return 1000;
    
    // Exact ref match
    if(prod.ref && prod.ref.toLowerCase() === ql) return 900;
    
    let score = 0;
    const name = normalizeSearch(prod.nom);
    const ref = (prod.ref||'').toLowerCase();
    const marque = normalizeSearch(prod.marque||'');
    const cat = normalizeSearch(prod.cat||'');
    const search = normalizeSearch(prod.search||'');
    
    for(const w of words) {
        if(name.startsWith(w)) score += 50;
        else if(name.includes(w)) score += 30;
        if(ref.startsWith(w)) score += 40;
        else if(ref.includes(w)) score += 20;
        if(marque.startsWith(w)) score += 25;
        else if(marque.includes(w)) score += 15;
        if(cat.includes(w)) score += 10;
        if(search.includes(w)) score += 5;
    }
    
    // Bonus: all words matched
    if(words.every(w => search.includes(w))) score += 20;
    
    return score;
}

function searchEntreeProducts(q) {
    const res = document.getElementById('entreeSearchResults');
    selectedProd = null;
    searchIdx = -1;
    document.getElementById('entreeSelectedProduct').classList.add('hidden');
    
    if(!q || q.trim().length < 1) { res.classList.add('hidden'); return; }
    
    // Score and sort
    const scored = entreeProds
        .map(p => ({p, score: scoreMatch(p, q)}))
        .filter(x => x.score > 0)
        .sort((a,b) => b.score - a.score)
        .slice(0, 12);
    
    if(!scored.length) {
        res.innerHTML = `<div class="px-4 py-3 text-gray-400 text-sm text-center"><i class="bi bi-search text-lg block mb-1 opacity-30"></i>Aucun résultat pour "${q}"</div>`;
        res.classList.remove('hidden');
        return;
    }
    
    res.innerHTML = scored.map(({p,score}, i) => {
        const ql = q.toLowerCase();
        // Highlight matching text
        let displayName = p.nom;
        // Color code based on score
        const badge = p.code_barre && p.code_barre.toLowerCase() === ql ? 
            `<span class="bg-green-100 text-green-700 text-[9px] px-1 py-0.5 rounded font-bold ml-1">SCAN</span>` : 
            p.ref && p.ref.toLowerCase() === ql ?
            `<span class="bg-blue-100 text-blue-700 text-[9px] px-1 py-0.5 rounded font-bold ml-1">REF</span>` : '';
        
        return `<div class="entree-result px-4 py-2.5 hover:bg-asel-light cursor-pointer border-b last:border-0 flex items-center gap-3 transition-colors" 
            data-idx="${i}"
            onclick="selectEntreeProdById(${p.id})"
            onmouseenter="searchIdx=${i};highlightResult()">
            <div class="flex-1 min-w-0">
                <div class="font-semibold text-sm truncate">${displayName}${badge}</div>
                <div class="text-xs text-gray-400 flex gap-2 flex-wrap">
                    ${p.ref?`<span class="font-mono">${p.ref}</span>`:''}
                    ${p.marque?`<span>${p.marque}</span>`:''}
                    <span class="text-gray-300">·</span>
                    <span>${p.cat}</span>
                    ${p.code_barre?`<span class="font-mono text-[10px] text-gray-300">${p.code_barre}</span>`:''}
                </div>
            </div>
            <div class="text-right flex-shrink-0">
                <div class="font-bold text-sm text-asel">${p.pv.toFixed(2)} DT</div>
                <div class="text-[10px] text-gray-400">PA: ${p.pa.toFixed(2)}</div>
            </div>
        </div>`;
    }).join('');
    
    res.classList.remove('hidden');
    
    // Auto-select first result
    if(scored.length === 1 || (scored[0].score >= 900)) {
        selectEntreeProdById(scored[0].p.id);
    }
}

function highlightResult() {
    document.querySelectorAll('.entree-result').forEach((el, i) => {
        el.classList.toggle('bg-asel-light', i === searchIdx);
        el.classList.toggle('bg-white', i !== searchIdx);
    });
}

function handleEntreeKey(e) {
    const results = document.querySelectorAll('.entree-result');
    if(e.key === 'ArrowDown') {
        e.preventDefault();
        searchIdx = Math.min(searchIdx + 1, results.length - 1);
        highlightResult();
        results[searchIdx]?.scrollIntoView({block:'nearest'});
    } else if(e.key === 'ArrowUp') {
        e.preventDefault();
        searchIdx = Math.max(searchIdx - 1, 0);
        highlightResult();
        results[searchIdx]?.scrollIntoView({block:'nearest'});
    } else if(e.key === 'Enter') {
        e.preventDefault();
        if(searchIdx >= 0 && results[searchIdx]) {
            results[searchIdx].click();
        } else if(selectedProd) {
            addEntreeLineFromSearch();
        } else if(e.target.value.trim()) {
            // Try barcode scan - exact match priority
            const exact = entreeProds.find(p => 
                p.code_barre === e.target.value.trim() || 
                p.ref === e.target.value.trim()
            );
            if(exact) {
                selectEntreeProdById(exact.id);
                addEntreeLineFromSearch();
            }
        }
    } else if(e.key === 'Escape') {
        document.getElementById('entreeSearchResults').classList.add('hidden');
        searchIdx = -1;
    } else if(e.key === 'Tab' && selectedProd) {
        e.preventDefault();
        document.getElementById('entreeQty').focus();
        document.getElementById('entreeSearchResults').classList.add('hidden');
    }
}

function selectEntreeProdById(id) {
    const prod = entreeProds.find(p => p.id === id);
    if(prod) selectEntreeProd(prod);
}
function selectEntreeProd(prod) {
    selectedProd = typeof prod === 'string' ? JSON.parse(prod) : prod;
    
    // Update selected display
    const nameEl = document.getElementById('entreeSelectedName');
    const infoEl = document.getElementById('entreeSelectedInfo');
    const selectedEl = document.getElementById('entreeSelectedProduct');
    
    if(nameEl) nameEl.textContent = selectedProd.nom;
    if(infoEl) infoEl.textContent = [selectedProd.ref, selectedProd.marque, selectedProd.cat].filter(Boolean).join(' · ');
    if(selectedEl) selectedEl.classList.remove('hidden');
    
    // Update price field
    const priceEl = document.getElementById('entreePrixHT');
    if(priceEl && selectedProd.pa) priceEl.value = selectedProd.pa;
    
    // Close dropdown, focus qty
    document.getElementById('entreeSearchResults').classList.add('hidden');
    document.getElementById('entreeSearch').value = selectedProd.nom;
    
    // Focus qty for quick quantity entry
    setTimeout(() => document.getElementById('entreeQty').select(), 50);
}

function addEntreeLineFromSearch() {
    if(!selectedProd) return;
    addEntreeLine(selectedProd.id, selectedProd.nom, selectedProd.ref, selectedProd.cat, selectedProd.pa, selectedProd.tva);
    
    // Reset search for next product
    document.getElementById('entreeSearch').value = '';
    document.getElementById('entreeQty').value = 1;
    document.getElementById('entreePrixHT').value = '';
    document.getElementById('entreeSelectedProduct').classList.add('hidden');
    selectedProd = null;
    document.getElementById('entreeSearch').focus();
}

function addEntreeLine(id, nom, ref, cat, pa, tva) {
    const qty = parseInt(document.getElementById('entreeQty').value) || 1;
    const prix = parseFloat(document.getElementById('entreePrixHT').value) || pa;
    
    const existing = entreeLines.find(l => l.id === id);
    if(existing) { existing.qty += qty; renderEntreeLines(); return; }
    
    entreeLines.push({id, nom, ref, cat, qty, prix_ht: prix, tva_rate: tva});
    renderEntreeLines();
}

function removeEntreeLine(i) { entreeLines.splice(i, 1); renderEntreeLines(); }
function updateEntreeLine(i, field, val) {
    if(field === 'qty') entreeLines[i].qty = Math.max(1, parseInt(val)||1);
    if(field === 'prix') entreeLines[i].prix_ht = Math.max(0, parseFloat(val)||0);
    renderEntreeLines();
}

function renderEntreeLines() {
    const container = document.getElementById('entreeLines');
    const placeholder = document.getElementById('entreePlaceholder');
    document.getElementById('entreeCount').textContent = entreeLines.length + ' produit(s)';
    
    if(!entreeLines.length) {
        placeholder.style.display = 'flex';
        document.getElementById('entreSubmit').disabled = true;
        document.getElementById('entreeTotalHT').textContent = '0.00';
        document.getElementById('entreeTotalTTC').textContent = '';
        document.getElementById('entreeLignesInput').value = '[]';
        return;
    }
    
    placeholder.style.display = 'none';
    document.getElementById('entreSubmit').disabled = false;
    
    let totalHT = 0, totalTTC = 0;
    const rows = entreeLines.map((l,i) => {
        const lht = l.qty * l.prix_ht;
        const lttc = lht * (1 + l.tva_rate/100);
        totalHT += lht; totalTTC += lttc;
        return `<div class="flex items-center gap-2 bg-gray-50 rounded-xl px-3 py-2">
            <div class="flex-1 min-w-0">
                <div class="font-semibold text-sm truncate">${l.nom}</div>
                <div class="text-xs text-gray-400">${l.ref} · TVA ${l.tva_rate}%</div>
            </div>
            <input type="number" value="${l.qty}" min="1" class="w-14 border-2 border-gray-200 rounded-lg px-1 py-1 text-center text-sm font-bold"
                onchange="updateEntreeLine(${i},'qty',this.value)">
            <input type="number" value="${l.prix_ht.toFixed(2)}" step="0.01" class="w-20 border-2 border-gray-200 rounded-lg px-1 py-1 text-right text-sm"
                onchange="updateEntreeLine(${i},'prix',this.value)">
            <span class="text-xs text-gray-400 w-6">HT</span>
            <span class="font-bold text-sm text-asel-dark w-20 text-right">${lttc.toFixed(2)} TTC</span>
            <button type="button" onclick="removeEntreeLine(${i})" class="text-red-400 hover:text-red-600 ml-1"><i class="bi bi-x-lg text-xs"></i></button>
        </div>`;
    }).join('');
    
    container.innerHTML = rows;
    document.getElementById('entreeTotalHT').textContent = totalHT.toFixed(2);
    document.getElementById('entreeTotalTTC').textContent = '(' + totalTTC.toFixed(2) + ' DT TTC)';
    document.getElementById('entreeLignesInput').value = JSON.stringify(entreeLines);
}

// Close search results on outside click
document.addEventListener('click', e => {
    if(!e.target.closest('#entreeSearch') && !e.target.closest('#entreeSearchResults'))
        document.getElementById('entreeSearchResults')?.classList.add('hidden');
});

// Barcode scan support
document.getElementById('entreeSearch').addEventListener('keydown', e => {
    if(e.key === 'Enter') {
        const q = e.target.value.trim();
        const exact = entreeProds.find(p => p.code_barre === q || p.ref === q);
        if(exact) { addEntreeLine(exact.id, exact.nom, exact.ref, exact.cat, exact.pa, exact.tva); e.preventDefault(); }
    }
});
</script>

<?php
// =====================================================
// DEMANDES
// =====================================================
elseif ($page === 'demandes'):
    $is_franchise = (userRole() === 'franchise');
    $can_treat = isAdminOrGest();
    $cid_dm = getCentralId();
    $demandes = query("SELECT d.*,p.nom as pnom,f.nom as fnom,u.nom_complet as demandeur,
        COALESCE(s.quantite,0) as stock_central
        FROM demandes_produits d 
        LEFT JOIN produits p ON d.produit_id=p.id 
        JOIN franchises f ON d.franchise_id=f.id 
        LEFT JOIN utilisateurs u ON d.demandeur_id=u.id
        LEFT JOIN stock s ON s.produit_id=d.produit_id AND s.franchise_id=?
        ".($is_franchise?"WHERE d.franchise_id=".intval(currentFranchise()):"")."
        ORDER BY FIELD(d.statut,'en_attente','en_cours','livre','rejete'), FIELD(d.urgence,'critique','urgent','normal'), d.date_demande DESC LIMIT 50", [$cid_dm]);
    $pending_dm = count(array_filter($demandes, fn($d) => $d['statut']==='en_attente'));
?>
<div class="flex justify-between items-center mb-4">
    <h1 class="text-2xl font-bold text-asel-dark flex items-center gap-2"><i class="bi bi-megaphone text-asel"></i> Demandes <?php if($pending_dm):?><span class="bg-amber-100 text-amber-800 text-xs font-bold px-2 py-0.5 rounded-full"><?=$pending_dm?> en attente</span><?php endif;?></h1>
</div>

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
        <thead><tr class="bg-asel-dark text-white text-xs uppercase tracking-wider"><th class="px-3 py-3 text-left">Date</th><th class="px-3 py-3 text-left">Franchise</th><th class="px-3 py-3 text-left">Produit</th><th class="px-3 py-3 text-center">Demandé</th><?php if($can_treat && $cid_dm):?><th class="px-3 py-3 text-center bg-indigo-900">Central</th><?php endif;?><th class="px-3 py-3 text-center">Urgence</th><th class="px-3 py-3 text-center">Statut</th><?php if($can_treat):?><th class="px-3 py-3">Action</th><?php endif;?></tr></thead>
        <tbody class="divide-y divide-gray-100"><?php foreach ($demandes as $d): 
            $ub=['normal'=>'bg-green-100 text-green-800','urgent'=>'bg-yellow-100 text-yellow-800','critique'=>'bg-red-100 text-red-800']; 
            $sb=['en_attente'=>'bg-gray-100 text-gray-800','en_cours'=>'bg-blue-100 text-blue-800','livre'=>'bg-green-100 text-green-800','rejete'=>'bg-red-100 text-red-800'];
            $stock_ok = $d['stock_central'] >= $d['quantite'];
        ?>
            <tr class="hover:bg-gray-50 <?=$d['urgence']==='critique'?'bg-red-50/30':($d['urgence']==='urgent'?'bg-amber-50/20':'')?>">
                <td class="px-3 py-2 text-xs text-gray-400 whitespace-nowrap"><?=date('d/m H:i',strtotime($d['date_demande']))?></td>
                <td class="px-3 py-2 text-xs"><?=shortF($d['fnom'])?></td>
                <td class="px-3 py-2 font-medium"><?=e($d['pnom']?:$d['nom_produit']?:'—')?></td>
                <td class="px-3 py-2 text-center font-bold"><?=$d['quantite']?></td>
                <?php if($can_treat && $cid_dm): ?>
                <td class="px-3 py-2 text-center bg-indigo-50">
                    <?php if($d['produit_id']): ?>
                    <span class="font-bold text-xs <?=$stock_ok?'text-indigo-700':'text-red-600'?>"><?=$d['stock_central']?> <?=!$stock_ok?'⚠️':''?></span>
                    <?php else: ?><span class="text-gray-300 text-xs">—</span><?php endif; ?>
                </td>
                <?php endif; ?>
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
    $ventes=query("SELECT v.*,p.nom as pnom,p.prix_achat,p.prix_achat_ht,f.nom as fnom,u.nom_complet as vendeur,fa.numero as facture_num,fa.mode_paiement FROM ventes v JOIN produits p ON v.produit_id=p.id JOIN franchises f ON v.franchise_id=f.id LEFT JOIN utilisateurs u ON v.utilisateur_id=u.id LEFT JOIN factures fa ON v.facture_id=fa.id WHERE v.date_vente BETWEEN ? AND ? ".($fid?"AND v.franchise_id=".intval($fid):"")." ORDER BY v.date_creation DESC LIMIT 200",[$d1,$d2]);
    $tca=array_sum(array_column($ventes,'prix_total'));
    $tart=array_sum(array_column($ventes,'quantite'));
    $tcout=array_sum(array_map(fn($v)=>$v['prix_achat']*$v['quantite'], $ventes));
    $tprofit=$tca-$tcout;
    $tmarge=$tca>0?round($tprofit/$tca*100):0;
    $tca_ht = round($tca/1.19, 2);
    $ttva = $tca - $tca_ht;
    // Cash breakdown for the period
    $wf_v = $fid ? "AND v.franchise_id=".intval($fid) : "";
    $wf_f = $fid ? "AND f.franchise_id=".intval($fid) : "";
    $especes_period = queryOne("SELECT COALESCE(SUM(v.prix_total),0) as t FROM ventes v JOIN factures fa ON v.facture_id=fa.id WHERE v.date_vente BETWEEN ? AND ? AND fa.mode_paiement='especes' AND fa.id NOT IN (SELECT DISTINCT facture_id FROM echeances) $wf_v", [$d1,$d2])['t'] ?? 0;
    $carte_period = queryOne("SELECT COALESCE(SUM(v.prix_total),0) as t FROM ventes v JOIN factures fa ON v.facture_id=fa.id WHERE v.date_vente BETWEEN ? AND ? AND fa.mode_paiement='carte' $wf_v", [$d1,$d2])['t'] ?? 0;
    $avances_period = queryOne("SELECT COALESCE(SUM(f.montant_recu),0) as t FROM factures f WHERE DATE(f.date_facture) BETWEEN ? AND ? AND f.id IN (SELECT DISTINCT facture_id FROM echeances) AND f.montant_recu > 0 $wf_f", [$d1,$d2])['t'] ?? 0;
    $echeances_period = queryOne("SELECT COALESCE(SUM(montant),0) as t FROM echeances WHERE statut='payee' AND DATE(date_paiement) BETWEEN ? AND ? ".($fid?"AND franchise_id=".intval($fid):""), [$d1,$d2])['t'] ?? 0;
    $total_especes_period = $especes_period + $avances_period + $echeances_period;
?>
<div class="flex flex-wrap justify-between items-center gap-3 mb-4">
    <h1 class="text-2xl font-bold text-asel-dark flex items-center gap-2"><i class="bi bi-receipt text-asel"></i> Historique des ventes</h1>
    <a href="api.php?action=export_ventes&d1=<?=$d1?>&d2=<?=$d2?><?=$fid?"&fid=$fid":""?>" class="bg-white border-2 border-asel text-asel font-semibold px-3 py-1.5 rounded-lg text-xs hover:bg-asel hover:text-white transition-colors"><i class="bi bi-download"></i> Export</a>
</div>
<!-- Date filter with quick shortcuts -->
<div class="bg-white rounded-xl shadow-sm p-3 mb-4">
    <form class="flex flex-wrap gap-2 items-center">
        <input type="hidden" name="page" value="ventes">
        <div class="flex gap-1 mr-2">
            <a href="?page=ventes&d1=<?=date('Y-m-d')?>&d2=<?=date('Y-m-d')?>" class="px-2 py-1 rounded text-xs font-medium <?=$d1===date('Y-m-d')&&$d2===date('Y-m-d')?'bg-asel text-white':'bg-gray-100 text-gray-600 hover:bg-gray-200'?>">Aujourd'hui</a>
            <a href="?page=ventes&d1=<?=date('Y-m-d',strtotime('-1 day'))?>&d2=<?=date('Y-m-d',strtotime('-1 day'))?>" class="px-2 py-1 rounded text-xs font-medium bg-gray-100 text-gray-600 hover:bg-gray-200">Hier</a>
            <a href="?page=ventes&d1=<?=date('Y-m-d',strtotime('-7 days'))?>&d2=<?=date('Y-m-d')?>" class="px-2 py-1 rounded text-xs font-medium bg-gray-100 text-gray-600 hover:bg-gray-200">7j</a>
            <a href="?page=ventes&d1=<?=date('Y-m-01')?>&d2=<?=date('Y-m-d')?>" class="px-2 py-1 rounded text-xs font-medium <?=$d1===date('Y-m-01')?'bg-asel text-white':'bg-gray-100 text-gray-600 hover:bg-gray-200'?>">Ce mois</a>
        </div>
        <input type="date" name="d1" value="<?=$d1?>" class="border-2 border-gray-200 rounded-lg px-2 py-1 text-sm">
        <span class="text-gray-400 text-xs">→</span>
        <input type="date" name="d2" value="<?=$d2?>" class="border-2 border-gray-200 rounded-lg px-2 py-1 text-sm">
        <button class="bg-asel text-white px-3 py-1 rounded-lg text-sm font-semibold"><i class="bi bi-funnel"></i></button>
    </form>
</div>
<!-- KPIs -->
<div class="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
    <div class="bg-white rounded-xl p-4 shadow-sm border-l-4 border-asel">
        <div class="text-[10px] text-gray-400 uppercase font-bold">Chiffre d'affaires</div>
        <div class="text-xl font-black text-asel-dark"><?=number_format($tca,2)?> <span class="text-xs font-normal text-gray-400">DT TTC</span></div>
        <div class="text-xs text-gray-400"><?=count($ventes)?> ventes · <?=number_format($tart)?> articles · HT: <?=number_format($tca_ht,2)?> DT</div>
    </div>
    <?php if(isAdminOrGest()): ?>
    <div class="bg-white rounded-xl p-4 shadow-sm border-l-4 border-green-500">
        <div class="text-[10px] text-gray-400 uppercase font-bold">Bénéfice</div>
        <div class="text-xl font-black <?=$tprofit>=0?'text-green-600':'text-red-600'?>"><?=number_format($tprofit,2)?> <span class="text-xs font-normal text-gray-400">DT</span></div>
        <div class="text-xs text-gray-400">Marge: <b><?=$tmarge?>%</b> · Coût: <?=number_format($tcout,2)?></div>
    </div>
    <?php endif; ?>
    <div class="bg-white rounded-xl p-4 shadow-sm border-l-4 border-purple-500">
        <div class="text-[10px] text-gray-400 uppercase font-bold">Panier moyen</div>
        <div class="text-xl font-black text-asel-dark"><?=count($ventes)?number_format($tca/count($ventes),2):'0.00'?> <span class="text-xs font-normal text-gray-400">DT</span></div>
    </div>
    <div class="bg-white rounded-xl p-4 shadow-sm border-l-4 border-emerald-500">
        <div class="text-[10px] text-gray-400 uppercase font-bold">Articles</div>
        <div class="text-xl font-black text-asel-dark"><?=number_format($tart)?></div>
        <?php if($tart>0): ?><div class="text-xs text-gray-400">Moy: <?=number_format($tca/$tart,2)?> DT/article</div><?php endif; ?>
    </div>
</div>
<!-- Cash breakdown -->
<div class="bg-white rounded-xl shadow-sm p-3 mb-4">
    <div class="flex flex-wrap items-center gap-4 text-xs">
        <span class="font-bold text-gray-500"><i class="bi bi-cash-stack text-asel"></i> Encaissements:</span>
        <span>💵 Espèces: <b class="text-green-700"><?=number_format($especes_period,2)?></b></span>
        <span>💰 Avances: <b class="text-amber-700"><?=number_format($avances_period,2)?></b></span>
        <span>✅ Échéances: <b class="text-purple-700"><?=number_format($echeances_period,2)?></b></span>
        <span>💳 Carte: <b class="text-blue-700"><?=number_format($carte_period,2)?></b></span>
        <span class="ml-auto font-bold text-asel-dark bg-asel/10 px-3 py-1 rounded-lg">🏦 Total espèces: <?=number_format($total_especes_period,2)?> DT</span>
    </div>
</div>
<!-- Search -->
<div class="relative mb-3">
    <i class="bi bi-search absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"></i>
    <input type="text" id="ventesSearch" class="w-full pl-10 pr-4 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-asel" placeholder="Rechercher produit, franchise, vendeur..." oninput="filterVentes()">
</div>
<div class="bg-white rounded-xl shadow-sm overflow-hidden"><div class="overflow-x-auto"><table class="w-full text-sm" id="ventesTable">
    <thead class="sticky-thead"><tr class="bg-asel-dark text-white text-xs uppercase tracking-wider"><th class="px-3 py-3 text-left">Date</th><th class="px-3 py-3 text-left hidden sm:table-cell">Franchise</th><th class="px-3 py-3 text-left">Produit</th><th class="px-3 py-3 text-center">Qté</th><th class="px-3 py-3 text-right">Total</th><th class="px-3 py-3 text-center hidden md:table-cell">Mode</th><th class="px-3 py-3 text-left hidden sm:table-cell">Vendeur</th><th class="px-3 py-3 text-center">🧾</th></tr></thead>
    <tbody class="divide-y divide-gray-100"><?php 
    $mode_icons=['especes'=>'💵','carte'=>'💳','virement'=>'🏦','cheque'=>'📋','echeance'=>'📅'];
    foreach($ventes as $v):?><tr class="hover:bg-gray-50 vente-row" data-search="<?=e(strtolower($v['pnom'].' '.shortF($v['fnom']).' '.($v['vendeur']??'').' '.($v['facture_num']??'').' '.($v['mode_paiement']??'')))?>">
        <td class="px-3 py-2 text-xs text-gray-400"><?=date('d/m H:i',strtotime($v['date_creation']))?></td>
        <td class="px-3 py-2 text-xs hidden sm:table-cell"><?=shortF($v['fnom'])?></td>
        <td class="px-3 py-2 font-medium"><?=e($v['pnom'])?></td>
        <td class="px-3 py-2 text-center"><?=$v['quantite']?></td>
        <td class="px-3 py-2 text-right font-bold"><?=number_format($v['prix_total'],2)?></td>
        <td class="px-3 py-2 text-center hidden md:table-cell" title="<?=e($v['mode_paiement']??'')?>">
            <?=$mode_icons[$v['mode_paiement']??''] ?? '—'?>
        </td>
        <td class="px-3 py-2 text-xs text-gray-400 hidden sm:table-cell"><?=e($v['vendeur']??'')?></td>
        <td class="px-3 py-2 text-center">
            <?php if($v['facture_id']): ?>
            <a href="receipt.php?id=<?=$v['facture_id']?>" target="_blank" class="text-gray-400 hover:text-asel" title="Ticket <?=e($v['facture_num']??'')?>"><i class="bi bi-receipt text-sm"></i></a>
            <?php endif; ?>
        </td>
    </tr><?php endforeach;?></tbody>
</table></div></div>
<script>function filterAudit(){
    const q = document.getElementById('auditSearch').value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
    document.querySelectorAll('.audit-row').forEach(r=>{r.style.display=(!q||(r.dataset.search||'').includes(q))?'':'none';});
}

function filterVentes(){
    const q = document.getElementById('ventesSearch').value;
    const qn = q.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9\s]/g,' ').trim();
    document.querySelectorAll('.vente-row').forEach(r=>{
        const s = (r.dataset.search||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'');
        r.style.display=(!qn||s.includes(qn))?'':'none';
    });
}</script>

<?php
// =====================================================
// TRANSFERTS / RETOURS / CLOTURE / RAPPORTS / PRODUITS / FRANCHISES / USERS
// Same pattern — keeping compact for file size. Let me include remaining pages:
// =====================================================
elseif ($page === 'transferts'):
    $transferts=query("SELECT t.*,p.nom as pnom,fs.nom as src,fd.nom as dst,u.nom_complet as demandeur_nom FROM transferts t JOIN produits p ON t.produit_id=p.id JOIN franchises fs ON t.franchise_source=fs.id JOIN franchises fd ON t.franchise_dest=fd.id LEFT JOIN utilisateurs u ON t.demandeur_id=u.id ORDER BY t.date_demande DESC LIMIT 50");
    $pending = count(array_filter($transferts, fn($t) => $t['statut'] === 'en_attente'));
?>
<div class="flex flex-wrap justify-between items-center gap-3 mb-4">
    <h1 class="text-2xl font-bold text-asel-dark flex items-center gap-2"><i class="bi bi-arrow-left-right text-asel"></i> Transferts <?php if($pending):?><span class="bg-amber-100 text-amber-800 text-xs font-bold px-2 py-0.5 rounded-full"><?=$pending?> en attente</span><?php endif;?></h1>
</div>
<div class="grid lg:grid-cols-2 gap-6">
<div class="form-card">
    <h3><i class="bi bi-arrow-left-right text-asel"></i> Demander un transfert</h3>
    <form method="POST" class="space-y-3">
        <input type="hidden" name="_csrf" value="<?=$csrf?>"><input type="hidden" name="action" value="transfert">
        <div class="grid grid-cols-2 gap-3">
            <div><label class="form-label">De (source)</label><select name="source" class="form-input"><?php foreach($allFranchises as $f):?><option value="<?=$f['id']?>"><?=shortF($f['nom'])?></option><?php endforeach;?></select></div>
            <div><label class="form-label">Vers (destination)</label><select name="dest" class="form-input"><?php foreach($allFranchises as $f):?><option value="<?=$f['id']?>"><?=shortF($f['nom'])?></option><?php endforeach;?></select></div>
        </div>
        <div><label class="form-label">Produit</label>
            <select name="produit_id" id="transfertProduit" class="ts-select w-full" data-placeholder="Rechercher un produit..." onchange="checkTransfertStock()">
                <?php foreach($produits as $p):?>
                <option value="<?=$p['id']?>"><?=e($p['nom'])?> (<?=e($p['cat_nom'])?>)</option>
                <?php endforeach;?>
            </select>
            <div id="transfertStockInfo" class="mt-1 text-xs text-gray-400 hidden"></div>
        </div>
        <div class="grid grid-cols-2 gap-3">
            <div><label class="form-label">Quantité</label><input name="quantite" id="transfertQty" type="number" min="1" value="1" class="form-input text-center font-bold"></div>
            <div><label class="form-label">Note</label><input name="note" class="form-input" placeholder="Raison du transfert..."></div>
        </div>
        <button type="submit" class="btn-submit"><i class="bi bi-send"></i> Envoyer la demande</button>
    </form>
    <script>
    function checkTransfertStock() {
        const pid = document.getElementById('transfertProduit')?.value;
        const src = document.querySelector('select[name="source"]')?.value;
        const info = document.getElementById('transfertStockInfo');
        if(!pid || !src || !info) return;
        
        fetch(`api.php?action=barcode_full_lookup&code=__id__${pid}__src__${src}`)
            .catch(()=>{});
        
        // Quick client-side stock check from stock data
        // Use api.php client lookup to get stock
        fetch(`api.php?action=quick_stats&fid=${src}&pid=${pid}`)
            .then(r=>r.json())
            .then(d=>{
                if(d.stock_produit !== undefined) {
                    info.textContent = `Stock disponible à la source: ${d.stock_produit} unité(s)`;
                    info.className = `mt-1 text-xs font-bold ${d.stock_produit>0?'text-green-600':'text-red-500'}`;
                    info.classList.remove('hidden');
                    document.getElementById('transfertQty').max = d.stock_produit;
                }
            })
            .catch(()=>{});
    }
    document.querySelector('select[name="source"]')?.addEventListener('change', checkTransfertStock);
    </script>
</div>
<div class="bg-white rounded-xl shadow-sm overflow-hidden">
    <div class="px-4 py-3 border-b font-semibold text-sm flex items-center gap-2"><i class="bi bi-clock-history text-gray-400"></i> Historique (<?=count($transferts)?>)</div>
    <div class="overflow-x-auto"><table class="w-full text-sm">
        <thead class="sticky-thead"><tr class="bg-gray-50 text-xs font-semibold text-gray-500 uppercase"><th class="px-3 py-2 text-left">Date</th><th class="px-3 py-2 text-left">Produit</th><th class="px-3 py-2 text-left">Trajet</th><th class="px-3 py-2 text-center">Qté</th><th class="px-3 py-2 text-center">Statut</th><?php if(isAdminOrGest()):?><th class="px-3 py-2 text-center">Action</th><?php endif;?></tr></thead>
        <tbody class="divide-y"><?php foreach($transferts as $t):
            $sb=['en_attente'=>'bg-yellow-100 text-yellow-800','accepte'=>'bg-green-100 text-green-800','rejete'=>'bg-red-100 text-red-800'];
        ?><tr class="hover:bg-gray-50 <?=$t['statut']==='en_attente'?'bg-yellow-50/50':''?>">
            <td class="px-3 py-2 text-xs text-gray-400"><?=date('d/m H:i',strtotime($t['date_demande']))?></td>
            <td class="px-3 py-2 font-medium text-sm"><?=e($t['pnom'])?></td>
            <td class="px-3 py-2 text-xs"><?=shortF($t['src'])?> <i class="bi bi-arrow-right text-asel"></i> <?=shortF($t['dst'])?></td>
            <td class="px-3 py-2 text-center font-bold"><?=$t['quantite']?></td>
            <td class="px-3 py-2 text-center"><span class="inline-flex px-2 py-0.5 rounded text-xs font-medium <?=$sb[$t['statut']]??''?>"><?=$t['statut']?></span></td>
            <?php if(isAdminOrGest()):?><td class="px-3 py-2 text-center"><?php if($t['statut']==='en_attente'):?>
                <form method="POST" class="flex gap-1 justify-center"><input type="hidden" name="_csrf" value="<?=$csrf?>"><input type="hidden" name="action" value="transfert_valider"><input type="hidden" name="tid" value="<?=$t['id']?>">
                <button name="decision" value="accept" class="bg-green-500 hover:bg-green-600 text-white px-2 py-1 rounded text-xs font-bold transition-colors" title="Accepter"><i class="bi bi-check-lg"></i></button>
                <button name="decision" value="reject" class="bg-red-500 hover:bg-red-600 text-white px-2 py-1 rounded text-xs font-bold transition-colors" title="Rejeter"><i class="bi bi-x-lg"></i></button>
                </form><?php else:?>—<?php endif;?></td><?php endif;?>
        </tr><?php endforeach;?></tbody>
    </table></div>
</div>
</div>

<?php elseif ($page === 'retours'): $r_fid=$fid?:(currentFranchise()?:($franchises[0]['id']??1));
    $recent_retours = query("SELECT r.*,p.nom as pnom,p.prix_vente,f.nom as fnom,u.nom_complet as par FROM retours r JOIN produits p ON r.produit_id=p.id JOIN franchises f ON r.franchise_id=f.id LEFT JOIN utilisateurs u ON r.utilisateur_id=u.id ".($r_fid?"WHERE r.franchise_id=".intval($r_fid):"")." ORDER BY r.date_retour DESC LIMIT 30");
    $total_retours = count($recent_retours);
    $nb_echanges = count(array_filter($recent_retours, fn($r) => $r['type_retour']==='echange'));
    $val_retours = array_sum(array_map(fn($r) => $r['quantite'] * floatval($r['prix_vente']), array_filter($recent_retours, fn($r) => $r['type_retour']==='retour')));
?>
<h1 class="text-2xl font-bold text-asel-dark mb-4 flex items-center gap-2"><i class="bi bi-arrow-counterclockwise text-asel"></i> Retours & Échanges</h1>
<!-- KPIs -->
<div class="grid grid-cols-3 gap-3 mb-4">
    <div class="bg-white rounded-xl p-3 shadow-sm border-l-4 border-amber-500"><div class="text-[10px] text-gray-400 font-bold uppercase">Retours (30 derniers)</div><div class="text-xl font-black text-asel-dark"><?=$total_retours - $nb_echanges?></div></div>
    <div class="bg-white rounded-xl p-3 shadow-sm border-l-4 border-blue-500"><div class="text-[10px] text-gray-400 font-bold uppercase">Échanges</div><div class="text-xl font-black text-asel-dark"><?=$nb_echanges?></div></div>
    <div class="bg-white rounded-xl p-3 shadow-sm border-l-4 border-red-400"><div class="text-[10px] text-gray-400 font-bold uppercase">Valeur rendue</div><div class="text-xl font-black text-red-600"><?=number_format($val_retours,2)?> <span class="text-xs text-gray-400">DT</span></div></div>
</div>
<div class="grid lg:grid-cols-2 gap-6">
<div class="form-card">
    <h3><i class="bi bi-arrow-counterclockwise text-amber-500"></i> Nouveau retour / échange</h3>
    <form method="POST" class="space-y-3"><input type="hidden" name="_csrf" value="<?=$csrf?>"><input type="hidden" name="action" value="retour"><input type="hidden" name="franchise_id" value="<?=$r_fid?>">
        <div><label class="form-label">Produit</label><select name="produit_id" class="ts-select w-full" data-placeholder="Rechercher un produit..."><?php foreach($produits as $p):?><option value="<?=$p['id']?>"><?=e($p['nom'])?> (<?=e($p['cat_nom'])?>)</option><?php endforeach;?></select></div>
        <div class="form-row form-row-2">
            <div><label class="form-label">Quantité</label><input name="quantite" type="number" min="1" value="1" class="form-input text-center font-bold"></div>
            <div><label class="form-label">Type</label><select name="type_retour" class="form-input"><option value="retour"><i class="bi bi-arrow-counterclockwise"></i> Retour (remboursement)</option><option value="echange">Échange (remplacement)</option></select></div>
        </div>
        <div><label class="form-label">Raison</label><input name="raison" class="form-input" placeholder="Produit défectueux, erreur client, etc."></div>
        <button type="submit" class="btn-submit" style="background:#f59e0b"><i class="bi bi-arrow-counterclockwise"></i> Enregistrer</button>
    </form>
</div>
<?php if ($recent_retours): ?>
<div class="bg-white rounded-xl shadow-sm overflow-hidden">
    <div class="px-4 py-3 border-b font-semibold text-sm flex items-center gap-2"><i class="bi bi-clock-history text-gray-400"></i> Récents (<?=count($recent_retours)?>)</div>
    <div class="overflow-x-auto"><table class="w-full text-sm">
        <thead class="sticky-thead"><tr class="bg-gray-50 text-xs font-semibold text-gray-500 uppercase"><th class="px-3 py-2">Date</th><th class="px-3 py-2">Produit</th><th class="px-3 py-2 text-center">Qté</th><th class="px-3 py-2">Type</th><th class="px-3 py-2">Raison</th></tr></thead>
        <tbody class="divide-y"><?php foreach ($recent_retours as $r): ?>
            <tr class="hover:bg-gray-50"><td class="px-3 py-2 text-xs text-gray-400"><?=date('d/m H:i',strtotime($r['date_retour']))?></td><td class="px-3 py-2 font-medium"><?=e($r['pnom'])?></td><td class="px-3 py-2 text-center"><?=$r['quantite']?></td>
            <td class="px-3 py-2"><span class="inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium <?=$r['type_retour']==='retour'?'bg-amber-100 text-amber-800':'bg-blue-100 text-blue-800'?>"><?=$r['type_retour']?></span></td>
            <td class="px-3 py-2 text-xs text-gray-500"><?=e($r['raison'])?></td></tr>
        <?php endforeach; ?></tbody>
    </table></div>
</div>
<?php endif; ?>
</div>

<?php elseif ($page === 'cloture'): 
    // Admin must select a specific franchise for cloture
    $cl_fid = $fid ?: (intval($_GET['cl_fid'] ?? 0) ?: (currentFranchise() ?: ($franchises[0]['id'] ?? 1)));
    if (isset($_GET['cl_fid'])) $cl_fid = intval($_GET['cl_fid']);
    $today = $_GET['cl_date'] ?? date('Y-m-d');
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $today)) $today = date('Y-m-d');
    $is_today = ($today === date('Y-m-d'));
    $sys = queryOne("SELECT COALESCE(SUM(prix_total),0) as t, COALESCE(SUM(quantite),0) as a FROM ventes WHERE franchise_id=? AND DATE(date_vente)=?", [$cl_fid, $today]);
    
    // Cash breakdown
    $especes_ventes = queryOne("SELECT COALESCE(SUM(v.prix_total),0) as t FROM ventes v JOIN factures f ON v.facture_id=f.id WHERE v.franchise_id=? AND DATE(v.date_vente)=? AND f.mode_paiement='especes' AND f.id NOT IN (SELECT DISTINCT facture_id FROM echeances)", [$cl_fid, $today])['t'] ?? 0;
    $carte_ventes = queryOne("SELECT COALESCE(SUM(v.prix_total),0) as t FROM ventes v JOIN factures f ON v.facture_id=f.id WHERE v.franchise_id=? AND DATE(v.date_vente)=? AND f.mode_paiement='carte'", [$cl_fid, $today])['t'] ?? 0;
    $avances_lots = queryOne("SELECT COALESCE(SUM(f.montant_recu),0) as t FROM factures f WHERE f.franchise_id=? AND DATE(f.date_facture)=? AND f.id IN (SELECT DISTINCT facture_id FROM echeances) AND f.montant_recu > 0", [$cl_fid, $today])['t'] ?? 0;
    $echeances_payees = queryOne("SELECT COALESCE(SUM(montant),0) as t FROM echeances WHERE franchise_id=? AND statut='payee' AND DATE(date_paiement)=?", [$cl_fid, $today])['t'] ?? 0;
    $total_especes_caisse = $especes_ventes + $avances_lots + $echeances_payees;
    
    $recent_clotures = query("SELECT cl.*,f.nom as fnom,u.nom_complet as par FROM clotures cl JOIN franchises f ON cl.franchise_id=f.id LEFT JOIN utilisateurs u ON cl.utilisateur_id=u.id WHERE cl.franchise_id=? ORDER BY cl.date_cloture DESC LIMIT 10", [$cl_fid]);
    try {
        $tr_today_enc = queryOne("SELECT COALESCE(SUM(montant),0) as t FROM tresorerie WHERE franchise_id=? AND type_mouvement='encaissement' AND DATE(date_mouvement)=?", [$cl_fid, $today])['t'];
        $tr_today_dec = queryOne("SELECT COALESCE(SUM(montant),0) as t FROM tresorerie WHERE franchise_id=? AND type_mouvement='decaissement' AND DATE(date_mouvement)=?", [$cl_fid, $today])['t'];
    } catch(Exception $e) { $tr_today_enc = $tr_today_dec = 0; }
    $already_closed = queryOne("SELECT id FROM clotures WHERE franchise_id=? AND date_cloture=?", [$cl_fid, $today]);
?>
<div class="flex flex-wrap justify-between items-center gap-3 mb-4">
    <h1 class="text-2xl font-bold text-asel-dark flex items-center gap-2"><i class="bi bi-calendar-check text-asel"></i> Clôture journalière</h1>
    <div class="flex items-center gap-2 flex-wrap">
        <?php if(can('view_all_franchises')): ?>
        <form class="flex gap-1 items-center">
            <input type="hidden" name="page" value="cloture">
            <input type="hidden" name="cl_date" value="<?=$today?>">
            <select name="cl_fid" class="border-2 border-gray-200 rounded-lg px-3 py-1.5 text-sm font-medium" onchange="this.form.submit()">
                <?php foreach($allFranchises as $af): ?>
                <option value="<?=$af['id']?>" <?=$cl_fid==$af['id']?'selected':''?>><?=shortF($af['nom'])?></option>
                <?php endforeach; ?>
            </select>
        </form>
        <?php endif; ?>
        <a href="?page=cloture&cl_fid=<?=$cl_fid?>&cl_date=<?=date('Y-m-d',strtotime($today.' -1 day'))?>" class="border-2 border-gray-200 rounded-lg px-2 py-1.5 text-sm hover:border-asel hover:text-asel transition-colors"><i class="bi bi-chevron-left"></i></a>
        <form class="flex gap-1 items-center">
            <input type="hidden" name="page" value="cloture">
            <input type="hidden" name="cl_fid" value="<?=$cl_fid?>">
            <input type="date" name="cl_date" value="<?=$today?>" class="border-2 border-gray-200 rounded-lg px-3 py-1.5 text-sm font-medium" onchange="this.form.submit()">
        </form>
        <?php if(!$is_today): ?>
        <a href="?page=cloture&cl_fid=<?=$cl_fid?>&cl_date=<?=date('Y-m-d',strtotime($today.' +1 day'))?>" class="border-2 border-gray-200 rounded-lg px-2 py-1.5 text-sm hover:border-asel hover:text-asel transition-colors"><i class="bi bi-chevron-right"></i></a>
        <a href="?page=cloture&cl_fid=<?=$cl_fid?>" class="bg-asel text-white px-3 py-1.5 rounded-lg text-xs font-bold">Aujourd'hui</a>
        <?php endif; ?>
        <?php if(!$already_closed): ?>
        <button onclick="quickCloture()" class="bg-gradient-to-r from-asel to-asel-dark text-white font-bold px-4 py-2 rounded-xl text-sm flex items-center gap-2 hover:opacity-90 transition-opacity">
            <i class="bi bi-lightning-charge-fill"></i> Clôture rapide
        </button>
        <?php endif; ?>
    </div>
</div>
<?php if(!$is_today): ?>
<div class="bg-amber-50 border-2 border-amber-200 rounded-xl p-3 mb-4 flex items-center gap-2 text-sm text-amber-800">
    <i class="bi bi-clock-history text-lg"></i>
    <span>Clôture pour le <b><?=date('d/m/Y', strtotime($today))?></b> — <?=date('l', strtotime($today))?></span>
</div>
<?php endif; ?>

<!-- Cash breakdown -->
<div class="bg-white rounded-2xl shadow-sm border-2 border-asel/20 p-5 mb-4">
    <h3 class="font-bold text-asel-dark text-sm mb-3 flex items-center gap-2"><i class="bi bi-cash-stack text-asel"></i> Détail des encaissements du jour</h3>
    <div class="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <div class="bg-green-50 rounded-xl p-3 text-center">
            <div class="text-[10px] text-green-600 font-bold uppercase">💵 Ventes espèces</div>
            <div class="text-lg font-black text-green-700"><?=number_format($especes_ventes,2)?></div>
        </div>
        <div class="bg-amber-50 rounded-xl p-3 text-center">
            <div class="text-[10px] text-amber-600 font-bold uppercase">💰 Avances lots</div>
            <div class="text-lg font-black text-amber-700"><?=number_format($avances_lots,2)?></div>
        </div>
        <div class="bg-purple-50 rounded-xl p-3 text-center">
            <div class="text-[10px] text-purple-600 font-bold uppercase">✅ Échéances encaissées</div>
            <div class="text-lg font-black text-purple-700"><?=number_format($echeances_payees,2)?></div>
        </div>
        <div class="bg-blue-50 rounded-xl p-3 text-center">
            <div class="text-[10px] text-blue-600 font-bold uppercase">💳 Carte</div>
            <div class="text-lg font-black text-blue-700"><?=number_format($carte_ventes,2)?></div>
        </div>
        <div class="bg-asel/10 rounded-xl p-3 text-center border-2 border-asel/30">
            <div class="text-[10px] text-asel font-bold uppercase">🏦 TOTAL ESPÈCES CAISSE</div>
            <div class="text-xl font-black text-asel-dark"><?=number_format($total_especes_caisse,2)?></div>
            <div class="text-[9px] text-gray-400">= ventes + avances + échéances</div>
        </div>
    </div>
</div>

<!-- System totals -->
<div class="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
    <div class="bg-asel/10 border-2 border-asel/20 rounded-xl p-4">
        <div class="text-[10px] text-asel font-bold uppercase">CA Système</div>
        <div class="text-xl font-black text-asel-dark"><?=number_format($sys['t'],2)?> <span class="text-xs text-gray-400">DT</span></div>
        <div class="text-xs text-gray-400"><?=number_format($sys['a'])?> articles</div>
    </div>
    <div class="bg-green-50 border-2 border-green-200 rounded-xl p-4">
        <div class="text-[10px] text-green-600 font-bold uppercase">Encaissements tréso</div>
        <div class="text-xl font-black text-green-700"><?=number_format($tr_today_enc,2)?> <span class="text-xs text-gray-400">DT</span></div>
    </div>
    <div class="bg-red-50 border-2 border-red-200 rounded-xl p-4">
        <div class="text-[10px] text-red-600 font-bold uppercase">Décaissements</div>
        <div class="text-xl font-black text-red-700"><?=number_format($tr_today_dec,2)?> <span class="text-xs text-gray-400">DT</span></div>
    </div>
    <div class="bg-gray-50 border-2 border-gray-200 rounded-xl p-4">
        <div class="text-[10px] text-gray-500 font-bold uppercase">Solde théorique</div>
        <div class="text-xl font-black text-asel-dark"><?=number_format($total_especes_caisse - $tr_today_dec,2)?> <span class="text-xs text-gray-400">DT</span></div>
        <div class="text-[9px] text-gray-400">caisse - décaissements</div>
    </div>
</div>
<?php if($already_closed): ?>
<div class="bg-green-50 border-2 border-green-300 rounded-xl p-4 mb-4 flex items-center gap-3">
    <i class="bi bi-check-circle-fill text-green-500 text-2xl"></i>
    <div><div class="font-bold text-green-700">Clôture du jour déjà soumise</div></div>
</div>
<?php endif; ?>
<div class="grid lg:grid-cols-2 gap-6">
<div class="form-card">
    <h3><i class="bi bi-calendar-check text-asel"></i> Soumettre la clôture</h3>
    <form method="POST" class="space-y-3"><input type="hidden" name="_csrf" value="<?=$csrf?>"><input type="hidden" name="action" value="cloture_submit"><input type="hidden" name="franchise_id" value="<?=$cl_fid?>">
        <div><label class="form-label">Date</label><input type="date" name="date_cloture" value="<?=$today?>" class="form-input"></div>
        <div class="form-row form-row-2">
            <div><label class="form-label">Total caisse déclaré (DT)</label><input name="total_declare" type="number" step="0.01" class="form-input text-center text-lg font-bold" required placeholder="0.00" value="<?=number_format($total_especes_caisse,2,'.','')?>"></div>
            <div><label class="form-label">Nb articles déclaré</label><input name="articles_declare" type="number" class="form-input text-center text-lg font-bold" required placeholder="0" value="<?=$sys['a']?>"></div>
        </div>
        <div class="bg-blue-50 rounded-xl p-3 text-xs text-blue-700 space-y-1">
            <div><b>💵 Ventes espèces:</b> <?=number_format($especes_ventes,2)?> DT</div>
            <div><b>💰 + Avances lots:</b> <?=number_format($avances_lots,2)?> DT</div>
            <div><b>✅ + Échéances encaissées:</b> <?=number_format($echeances_payees,2)?> DT</div>
            <div class="border-t border-blue-200 pt-1 mt-1 font-bold text-sm"><b>🏦 = Total espèces caisse:</b> <?=number_format($total_especes_caisse,2)?> DT</div>
            <div class="text-blue-400"><b>💳 Carte (hors caisse):</b> <?=number_format($carte_ventes,2)?> DT</div>
        </div>
        <div><label class="form-label">Commentaire</label><textarea name="commentaire" class="form-input" rows="2" placeholder="Notes sur la journée, anomalies..."></textarea></div>
        <button type="submit" class="btn-submit"><i class="bi bi-calendar-check"></i> Soumettre la clôture</button>
    </form>
</div>
<script>
function quickCloture() {
    var sysCA = <?=number_format($total_especes_caisse,2,'.','')?>;
    var sysArt = <?=intval($sys['a'])?>;
    openModal(
        modalHeader('bi-lightning-charge-fill','Clôture rapide','Confirmer les totaux système') +
        `<div class="p-6 space-y-4">
            <div class="bg-asel/10 rounded-xl p-4 text-center">
                <div class="text-3xl font-black text-asel">${sysCA.toFixed(2)} DT</div>
                <div class="text-sm text-gray-500">${sysArt} articles vendus</div>
            </div>
            <p class="text-sm text-gray-600">La clôture sera soumise avec ces totaux système. Confirmez-vous?</p>
            <div class="flex gap-3">
                <button onclick="closeModal()" class="flex-1 py-2.5 rounded-xl border-2 border-gray-200 font-semibold text-sm">Vérifier manuellement</button>
                <button onclick="closeModal();submitQuickCloture(${sysCA},${sysArt})" class="flex-1 py-2.5 rounded-xl bg-asel text-white font-bold text-sm flex items-center justify-center gap-2">
                    <i class="bi bi-check-circle"></i> Confirmer
                </button>
            </div>
        </div>`,
        {size:'max-w-sm'}
    );
}
function submitQuickCloture(ca, art) {
    const form = document.querySelector('form[action="#"], .form-card form');
    // Find the cloture form by action input
    const forms = document.querySelectorAll('form');
    for(const f of forms) {
        const action = f.querySelector('input[name="action"]');
        if(action && action.value === 'cloture_submit') {
            const totalDecl = f.querySelector('input[name="total_declare"]');
            const artDecl = f.querySelector('input[name="articles_declare"]');
            const commentaire = f.querySelector('textarea[name="commentaire"]');
            if(totalDecl) totalDecl.value = ca.toFixed(2);
            if(artDecl) artDecl.value = art;
            if(commentaire) commentaire.value = 'Clôture rapide — totaux système';
            f.submit();
            return;
        }
    }
}
</script>
<?php if ($recent_clotures): ?>
<div class="bg-white rounded-xl shadow-sm overflow-hidden">
    <div class="px-4 py-3 border-b font-semibold text-sm"><i class="bi bi-clock-history text-gray-400"></i> Historique</div>
    <div class="overflow-x-auto"><table class="w-full text-sm">
        <thead class="sticky-thead"><tr class="bg-gray-50 text-xs"><th class="px-3 py-2">Date</th><th class="px-3 py-2 text-right">Déclaré</th><th class="px-3 py-2 text-right">Système</th><th class="px-3 py-2 text-center">Écart</th><th class="px-3 py-2 text-center">Validé</th></tr></thead>
        <tbody class="divide-y"><?php foreach ($recent_clotures as $cl): $ecart = $cl['total_ventes_declare'] - $cl['total_ventes_systeme']; ?>
            <tr class="hover:bg-gray-50"><td class="px-3 py-2 text-xs"><?=date('d/m/Y',strtotime($cl['date_cloture']))?></td>
            <td class="px-3 py-2 text-right font-bold"><?=number_format($cl['total_ventes_declare'],2)?></td>
            <td class="px-3 py-2 text-right text-gray-500"><?=number_format($cl['total_ventes_systeme'],2)?></td>
            <td class="px-3 py-2 text-center"><span class="inline-flex px-1.5 py-0.5 rounded text-[10px] font-bold <?=abs($ecart)<1?'bg-green-100 text-green-800':'bg-red-100 text-red-800'?>"><?=$ecart>0?'+':''?><?=number_format($ecart,2)?></span></td>
            <td class="px-3 py-2 text-center"><?=$cl['valide']?'<i class="bi bi-check-circle-fill text-green-500"></i>':'<i class="bi bi-clock text-gray-300"></i>'?></td></tr>
        <?php endforeach; ?></tbody>
    </table></div>
</div>
<?php endif; ?>
</div>

<?php elseif ($page === 'rapports' && can('rapports')):
    $d1=$_GET['d1']??date('Y-m-01');$d2=$_GET['d2']??date('Y-m-d');
    $r_fid = $fid ?: null;
    $r_fwhere = $r_fid ? "AND v.franchise_id=".intval($r_fid) : "";
    
    $by_f=query("SELECT f.nom,f.id,COALESCE(SUM(v.prix_total),0) as ca,COALESCE(SUM(v.quantite),0) as art,COUNT(DISTINCT v.id) as tx FROM franchises f LEFT JOIN ventes v ON f.id=v.franchise_id AND v.date_vente BETWEEN ? AND ? WHERE f.actif=1 AND (f.type_franchise IS NULL OR f.type_franchise='point_de_vente') GROUP BY f.id,f.nom ORDER BY ca DESC",[$d1,$d2]);
    $top=query("SELECT p.nom,p.marque,p.reference,p.prix_achat,p.prix_achat_ht,p.tva_rate,SUM(v.quantite) as qty,SUM(v.prix_total) as ca,SUM(v.quantite*p.prix_achat) as cout FROM ventes v JOIN produits p ON v.produit_id=p.id WHERE v.date_vente BETWEEN ? AND ? $r_fwhere GROUP BY p.id ORDER BY ca DESC LIMIT 15",[$d1,$d2]);
    $total_ca = array_sum(array_column($by_f, 'ca'));
    $total_art = array_sum(array_column($by_f, 'art'));
    $total_tx = array_sum(array_column($by_f, 'tx'));
    $by_cat=query("SELECT c.nom,SUM(v.prix_total) as ca,SUM(v.quantite) as qty,SUM(v.quantite*p.prix_achat) as cout FROM ventes v JOIN produits p ON v.produit_id=p.id JOIN categories c ON p.categorie_id=c.id WHERE v.date_vente BETWEEN ? AND ? $r_fwhere GROUP BY c.nom ORDER BY ca DESC",[$d1,$d2]);
    // By vendeur (employee performance)
    $by_vendeur = query("SELECT u.nom_complet, COALESCE(SUM(v.prix_total),0) as ca, COALESCE(SUM(v.quantite),0) as art, COUNT(DISTINCT v.id) as tx FROM ventes v LEFT JOIN utilisateurs u ON v.utilisateur_id=u.id WHERE v.date_vente BETWEEN ? AND ? $r_fwhere GROUP BY v.utilisateur_id, u.nom_complet ORDER BY ca DESC LIMIT 10", [$d1,$d2]);
    // By hour (peak hours analysis) - only for single day or narrow range
    $day_diff = (strtotime($d2) - strtotime($d1)) / 86400;
    $by_hour = $day_diff <= 7 ? query("SELECT HOUR(v.date_creation) as hr, COALESCE(SUM(v.prix_total),0) as ca, COUNT(*) as tx FROM ventes v WHERE v.date_vente BETWEEN ? AND ? $r_fwhere GROUP BY HOUR(v.date_creation) ORDER BY hr", [$d1,$d2]) : [];
    
    // Reorder suggestions: products with high sales velocity + low stock
    $reorder_suggestions = query("SELECT p.nom, p.reference, p.marque, p.seuil_alerte,
        COALESCE((SELECT SUM(v.quantite) FROM ventes v WHERE v.produit_id=p.id AND v.date_vente>=DATE_SUB(CURDATE(),INTERVAL 30 DAY)),0) as ventes_30j,
        COALESCE((SELECT SUM(s.quantite) FROM stock s WHERE s.produit_id=p.id),0) as stock_total
        FROM produits p WHERE p.actif=1
        HAVING ventes_30j > 0 AND stock_total <= GREATEST(ventes_30j * 0.5, p.seuil_alerte)
        ORDER BY (ventes_30j / GREATEST(stock_total,0.1)) DESC LIMIT 8");
    $r_fwhere_v = $r_fid ? "AND v.franchise_id=".intval($r_fid) : "";
    $total_cout = queryOne("SELECT COALESCE(SUM(v.quantite*p.prix_achat),0) as c FROM ventes v JOIN produits p ON v.produit_id=p.id WHERE v.date_vente BETWEEN ? AND ? $r_fwhere", [$d1,$d2])['c'];
    $total_profit = $total_ca - $total_cout;
    $total_margin = $total_ca > 0 ? round($total_profit / $total_ca * 100) : 0;
    // Financial breakdown HT/TVA/TTC
    $tva_rate_moy = 19; // default
    $total_ca_ht = round($total_ca / (1 + $tva_rate_moy/100), 2);
    $total_tva = $total_ca - $total_ca_ht;
    // Tresorerie for period (requires migration v8)
    try {
        $tr_enc = queryOne("SELECT COALESCE(SUM(montant),0) as t FROM tresorerie WHERE type_mouvement='encaissement' AND date_mouvement BETWEEN ? AND ?", [$d1,$d2])['t'];
        $tr_dec = queryOne("SELECT COALESCE(SUM(montant),0) as t FROM tresorerie WHERE type_mouvement='decaissement' AND date_mouvement BETWEEN ? AND ?", [$d1,$d2])['t'];
    } catch(Exception $e) { $tr_enc = $tr_dec = 0; }
    // Daily sales for sparkline
    $daily = query("SELECT date_vente as d, SUM(prix_total) as ca FROM ventes WHERE date_vente BETWEEN ? AND ? $r_fwhere GROUP BY date_vente ORDER BY date_vente", [$d1,$d2]);
?>
<div class="flex flex-wrap justify-between items-center gap-3 mb-3">
    <h1 class="text-2xl font-bold text-asel-dark flex items-center gap-2"><i class="bi bi-graph-up text-asel"></i> Rapports</h1>
    <div class="flex gap-2">
        <a href="pdf.php?type=rapport_jour&date=<?=date('Y-m-d')?><?=$r_fid?"&fid=$r_fid":''?>" target="_blank" class="bg-white border-2 border-gray-200 text-gray-600 text-xs font-bold px-3 py-1.5 rounded-lg hover:border-asel hover:text-asel"><i class="bi bi-file-pdf"></i> PDF Jour</a>
        <a href="pdf.php?type=rapport_mois&mois=<?=date('Y-m')?><?=$r_fid?"&fid=$r_fid":''?>" target="_blank" class="bg-white border-2 border-gray-200 text-gray-600 text-xs font-bold px-3 py-1.5 rounded-lg hover:border-asel hover:text-asel"><i class="bi bi-file-pdf"></i> PDF Mois</a>
    </div>
</div>
<?php if(can('view_all_franchises')): ?>
<div class="flex gap-2 mb-3 flex-wrap">
    <a href="?page=rapports&d1=<?=$d1?>&d2=<?=$d2?>" class="px-3 py-1.5 rounded-lg text-xs font-bold <?=!$r_fid?'bg-asel text-white':'bg-white border-2 border-gray-200 text-gray-600 hover:border-asel hover:text-asel'?>">Toutes</a>
    <?php foreach($franchises as $rf): ?>
    <a href="?page=rapports&d1=<?=$d1?>&d2=<?=$d2?>&fid=<?=$rf['id']?>" class="px-3 py-1.5 rounded-lg text-xs font-bold <?=$r_fid==$rf['id']?'bg-asel text-white':'bg-white border-2 border-gray-200 text-gray-600 hover:border-asel hover:text-asel'?>"><?=shortF($rf['nom'])?></a>
    <?php endforeach; ?>
</div>
<?php endif; ?>
<!-- Date filter with shortcuts -->
<div class="bg-white rounded-xl shadow-sm p-3 mb-4">
    <form class="flex flex-wrap gap-2 items-center">
        <input type="hidden" name="page" value="rapports">
        <div class="flex gap-1 mr-2">
            <a href="?page=rapports&d1=<?=date('Y-m-d')?>&d2=<?=date('Y-m-d')?>" class="px-2 py-1 rounded text-xs font-medium <?=$d1===date('Y-m-d')?'bg-asel text-white':'bg-gray-100 text-gray-600 hover:bg-gray-200'?>">Aujourd'hui</a>
            <a href="?page=rapports&d1=<?=date('Y-m-d',strtotime('-7 days'))?>&d2=<?=date('Y-m-d')?>" class="px-2 py-1 rounded text-xs font-medium bg-gray-100 text-gray-600 hover:bg-gray-200">7j</a>
            <a href="?page=rapports&d1=<?=date('Y-m-01')?>&d2=<?=date('Y-m-d')?>" class="px-2 py-1 rounded text-xs font-medium <?=$d1===date('Y-m-01')?'bg-asel text-white':'bg-gray-100 text-gray-600 hover:bg-gray-200'?>">Ce mois</a>
            <a href="?page=rapports&d1=<?=date('Y-m-01',strtotime('-1 month'))?>&d2=<?=date('Y-m-t',strtotime('-1 month'))?>" class="px-2 py-1 rounded text-xs font-medium bg-gray-100 text-gray-600 hover:bg-gray-200">Mois dernier</a>
            <a href="?page=rapports&d1=<?=date('Y-01-01')?>&d2=<?=date('Y-m-d')?>" class="px-2 py-1 rounded text-xs font-medium bg-gray-100 text-gray-600 hover:bg-gray-200"><?=date('Y')?></a>
        </div>
        <input type="date" name="d1" value="<?=$d1?>" class="border-2 border-gray-200 rounded-lg px-2 py-1 text-sm">
        <span class="text-gray-400 text-xs">→</span>
        <input type="date" name="d2" value="<?=$d2?>" class="border-2 border-gray-200 rounded-lg px-2 py-1 text-sm">
        <button class="bg-asel text-white px-3 py-1 rounded-lg text-sm font-semibold"><i class="bi bi-funnel"></i></button>
    </form>
</div>
<!-- Global KPIs -->
<div class="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
    <div class="bg-gradient-to-br from-asel to-asel-dark rounded-xl p-4 shadow-sm text-white">
        <div class="text-[10px] text-white/70 uppercase font-bold">CA TTC</div>
        <div class="text-2xl font-black"><?=number_format($total_ca)?> <span class="text-sm font-normal opacity-70">DT</span></div>
        <div class="text-xs text-white/60 mt-1">HT: <?=number_format($total_ca_ht)?> · TVA: <?=number_format($total_tva)?></div>
    </div>
    <div class="bg-white rounded-xl p-4 shadow-sm border-l-4 border-green-500">
        <div class="text-[10px] text-gray-400 uppercase font-bold">Bénéfice net</div>
        <div class="text-2xl font-black <?=$total_profit>=0?'text-green-600':'text-red-600'?>"><?=number_format($total_profit)?> <span class="text-sm font-normal text-gray-400">DT</span></div>
        <div class="text-xs text-gray-400">Marge: <b><?=$total_margin?>%</b> · Coût: <?=number_format($total_cout)?></div>
    </div>
    <div class="bg-white rounded-xl p-4 shadow-sm border-l-4 border-emerald-500">
        <div class="text-[10px] text-gray-400 uppercase font-bold">Articles / Transactions</div>
        <div class="text-2xl font-black text-asel-dark"><?=number_format($total_art)?></div>
        <div class="text-xs text-gray-400"><?=$total_tx?> ventes · moy <?=$total_tx?number_format($total_ca/$total_tx,1):'0'?> DT</div>
    </div>
    <div class="bg-white rounded-xl p-4 shadow-sm border-l-4 border-purple-500">
        <div class="text-[10px] text-gray-400 uppercase font-bold">Trésorerie période</div>
        <div class="text-xl font-black <?=($tr_enc-$tr_dec)>=0?'text-green-600':'text-red-600'?>"><?=number_format($tr_enc-$tr_dec,0)?> <span class="text-sm font-normal text-gray-400">DT</span></div>
        <div class="text-xs text-gray-400">Enc: <?=number_format($tr_enc,0)?> · Déc: <?=number_format($tr_dec,0)?></div>
    </div>
</div>
<?php if(count($daily) > 1): ?>
<div class="bg-white rounded-xl shadow-sm p-4 mb-4">
    <div class="flex items-center justify-between mb-3">
        <h3 class="font-bold text-asel-dark text-sm"><i class="bi bi-bar-chart text-asel"></i> CA journalier</h3>
        <span class="text-xs text-gray-400"><?=count($daily)?> jours</span>
    </div>
    <div class="flex items-end gap-0.5 h-20">
    <?php $max_daily = max(array_column($daily,'ca')); foreach($daily as $drow): $h = $max_daily > 0 ? max(4, round($drow['ca']/$max_daily*80)) : 4; ?>
        <div class="flex-1 bg-asel/80 rounded-t hover:bg-asel transition-colors cursor-default" style="height:<?=$h?>px" title="<?=date('d/m',strtotime($drow['d']))?> : <?=number_format($drow['ca'])?> DT"></div>
    <?php endforeach; ?>
    </div>
    <div class="flex justify-between text-[9px] text-gray-400 mt-1">
        <span><?=date('d/m',strtotime($daily[0]['d']))?></span>
        <span><?=date('d/m',strtotime($daily[count($daily)-1]['d']))?></span>
    </div>
</div>
<?php endif; ?>
<!-- Per franchise -->
<div class="grid sm:grid-cols-2 gap-3 mb-6"><?php foreach($by_f as $f): $pct = $total_ca > 0 ? round($f['ca']/$total_ca*100) : 0; ?><div class="bg-white rounded-xl p-4 shadow-sm hover-lift">
    <div class="flex items-center justify-between mb-2">
        <h3 class="font-bold text-asel-dark"><?=shortF($f['nom'])?></h3>
        <span class="text-xs bg-asel/10 text-asel font-bold px-2 py-0.5 rounded"><?=$pct?>%</span>
    </div>
    <div class="text-2xl font-black text-asel"><?=number_format($f['ca'])?> <span class="text-sm font-normal text-gray-400">DT</span></div>
    <div class="text-xs text-gray-400"><?=number_format($f['art'])?> articles · <?=$f['tx']?> ventes</div>
    <div class="mt-2 h-1.5 bg-gray-100 rounded-full overflow-hidden"><div class="h-full bg-asel rounded-full" style="width:<?=$pct?>%"></div></div>
</div><?php endforeach; ?></div>
<!-- Top products + Category breakdown -->
<div class="grid lg:grid-cols-2 gap-4">
<?php if($top):?><div class="bg-white rounded-xl shadow-sm overflow-hidden"><div class="px-4 py-3 border-b font-semibold text-sm flex items-center gap-2"><i class="bi bi-trophy text-amber-500"></i> Top 15 produits</div><div class="overflow-x-auto"><table class="w-full text-sm"><thead class="sticky-thead"><tr class="bg-gray-50 text-xs"><th class="px-3 py-2 text-left">#</th><th class="px-3 py-2 text-left">Produit</th><th class="px-3 py-2 text-center">Qté</th><th class="px-3 py-2 text-right">CA</th><th class="px-3 py-2 text-right">Bénéfice</th></tr></thead><tbody class="divide-y"><?php foreach($top as $i=>$t): $profit=$t['ca']-$t['cout']; ?><tr class="hover:bg-gray-50"><td class="px-3 py-2 text-xs text-gray-400"><?=$i+1?></td><td class="px-3 py-2"><div class="font-medium"><?=e($t['nom'])?></div><div class="text-xs text-gray-400"><?=e($t['marque'])?> · <?=e($t['reference'])?></div></td><td class="px-3 py-2 text-center font-semibold"><?=$t['qty']?></td><td class="px-3 py-2 text-right font-bold"><?=number_format($t['ca'])?></td><td class="px-3 py-2 text-right font-bold <?=$profit>=0?'text-green-600':'text-red-600'?>"><?=number_format($profit)?></td></tr><?php endforeach;?></tbody></table></div></div><?php endif;?>
<?php if($by_cat):?><div class="bg-white rounded-xl shadow-sm overflow-hidden"><div class="px-4 py-3 border-b font-semibold text-sm flex items-center gap-2"><i class="bi bi-pie-chart text-asel"></i> Par catégorie</div><div class="overflow-x-auto"><table class="w-full text-sm"><thead class="sticky-thead"><tr class="bg-gray-50 text-xs"><th class="px-3 py-2 text-left">Catégorie</th><th class="px-3 py-2 text-center">Qté</th><th class="px-3 py-2 text-right">CA</th><th class="px-3 py-2 text-right">%</th></tr></thead><tbody class="divide-y"><?php foreach($by_cat as $c): $cpct=$total_ca>0?round($c['ca']/$total_ca*100):0; ?><tr class="hover:bg-gray-50"><td class="px-3 py-2 font-medium"><?=e($c['nom'])?></td><td class="px-3 py-2 text-center"><?=$c['qty']?></td><td class="px-3 py-2 text-right font-bold"><?=number_format($c['ca'])?></td><td class="px-3 py-2 text-right text-xs"><span class="bg-asel/10 text-asel font-bold px-1.5 py-0.5 rounded"><?=$cpct?>%</span></td></tr><?php endforeach;?></tbody></table></div></div><?php endif;?>
<?php if($by_vendeur): ?><div class="bg-white rounded-xl shadow-sm overflow-hidden mt-4 col-span-2"><div class="px-4 py-3 border-b font-semibold text-sm flex items-center gap-2"><i class="bi bi-people text-asel"></i> Performance par vendeur</div><div class="overflow-x-auto"><table class="w-full text-sm"><thead class="sticky-thead"><tr class="bg-gray-50 text-xs"><th class="px-3 py-2 text-left">Vendeur</th><th class="px-3 py-2 text-center">Ventes</th><th class="px-3 py-2 text-center">Articles</th><th class="px-3 py-2 text-right">CA</th><th class="px-3 py-2 text-right">%</th><th class="px-3 py-2 text-right hidden sm:table-cell">Moy/vente</th></tr></thead><tbody class="divide-y"><?php foreach($by_vendeur as $bv): $vpct=$total_ca>0?round($bv['ca']/$total_ca*100):0; ?><tr class="hover:bg-gray-50"><td class="px-3 py-2 font-medium"><?=e($bv['nom_complet']??'Inconnu')?></td><td class="px-3 py-2 text-center"><?=$bv['tx']?></td><td class="px-3 py-2 text-center"><?=$bv['art']?></td><td class="px-3 py-2 text-right font-bold"><?=number_format($bv['ca'],2)?></td><td class="px-3 py-2 text-right text-xs"><span class="bg-green-50 text-green-700 font-bold px-1.5 py-0.5 rounded"><?=$vpct?>%</span></td><td class="px-3 py-2 text-right text-xs text-gray-400 hidden sm:table-cell"><?=$bv['tx']>0?number_format($bv['ca']/$bv['tx'],2).'DT':'—'?></td></tr><?php endforeach;?></tbody></table></div></div><?php endif; ?>
<?php if($by_hour && count($by_hour)>1): ?>
<div class="bg-white rounded-xl shadow-sm p-4 mt-4 col-span-2">
    <div class="font-bold text-sm mb-3 flex items-center gap-2"><i class="bi bi-clock text-asel"></i> Ventes par heure (heures de pointe)</div>
    <?php $max_hr = max(array_column($by_hour,'ca')); ?>
    <div class="flex items-end gap-1 h-16 mb-1">
    <?php for($h=0;$h<24;$h++): 
        $hr_data = null;
        foreach($by_hour as $bh) if($bh['hr']==$h) { $hr_data=$bh; break; }
        $bar_h = $hr_data && $max_hr>0 ? max(3, round($hr_data['ca']/$max_hr*60)) : 0;
    ?>
    <div class="flex-1 flex flex-col items-center" title="<?=$h?>h: <?=$hr_data?number_format($hr_data['ca'],0).' DT':'0 DT'?>">
        <?php if($bar_h>0): ?><div class="w-full bg-asel/70 hover:bg-asel rounded-t transition-colors" style="height:<?=$bar_h?>px"></div><?php else: ?><div class="w-full" style="height:1px"></div><?php endif; ?>
    </div>
    <?php endfor; ?>
    </div>
    <div class="flex justify-between text-[9px] text-gray-400">
        <span>0h</span><span>6h</span><span>12h</span><span>18h</span><span>23h</span>
    </div>
</div>
<?php endif; ?>

<?php if($reorder_suggestions): ?>
<div class="bg-orange-50 border border-orange-200 rounded-xl p-4 mt-4">
    <div class="flex items-center gap-2 mb-3"><i class="bi bi-cart-plus-fill text-orange-500 text-lg"></i><span class="font-bold text-orange-800">Suggestions de réapprovisionnement</span><span class="text-xs text-orange-600 ml-auto">Ventes rapides / stock bas</span></div>
    <div class="grid sm:grid-cols-2 lg:grid-cols-4 gap-2">
    <?php foreach($reorder_suggestions as $rs): 
        $days_stock = $rs['ventes_30j']>0 ? round($rs['stock_total'] / ($rs['ventes_30j']/30)) : 999;
    ?>
    <div class="bg-white rounded-lg p-3 border border-orange-100">
        <div class="font-semibold text-sm truncate"><?=e($rs['nom'])?></div>
        <div class="text-xs text-gray-400"><?=e($rs['marque'])?> · <?=e($rs['reference']??'')?></div>
        <div class="flex justify-between mt-2 text-xs">
            <span class="text-green-600 font-bold"><?=$rs['ventes_30j']?>/mois</span>
            <span class="<?=$rs['stock_total']<=0?'text-red-600 font-bold':'text-amber-600 font-semibold'?>"><?=$rs['stock_total']?> en stock</span>
        </div>
        <?php if($days_stock<999): ?><div class="text-[10px] text-red-500 font-bold mt-1">⏰ Épuisé dans ~<?=$days_stock?> j</div><?php endif; ?>
        <a href="?page=entree" class="mt-2 flex items-center justify-center gap-1 text-[10px] font-bold bg-orange-100 hover:bg-orange-200 text-orange-700 px-2 py-1 rounded-lg transition-colors"><i class="bi bi-box-arrow-in-down"></i> Commander</a>
    </div>
    <?php endforeach; ?>
    </div>
</div>
<?php endif; ?>
</div>

<?php elseif ($page === 'produits' && can('produits')):
    // Filters
    $pf_cat = $_GET['pf_cat'] ?? '';
    $pf_marque = $_GET['pf_marque'] ?? '';
    $pf_search = $_GET['pf_q'] ?? '';
    $pf_sort = $_GET['pf_sort'] ?? 'cat';
    
    $pw = ["p.actif=1"]; $pp = [];
    if ($pf_cat) { $pw[] = "p.categorie_id=?"; $pp[] = $pf_cat; }
    if ($pf_marque) { $pw[] = "p.marque=?"; $pp[] = $pf_marque; }
    if ($pf_search) { $pw[] = "(p.nom LIKE ? OR p.reference LIKE ? OR p.code_barre LIKE ? OR p.marque LIKE ?)"; $pp = array_merge($pp, ["%$pf_search%","%$pf_search%","%$pf_search%","%$pf_search%"]); }
    
    $order = match($pf_sort) {
        'nom' => 'p.nom ASC',
        'prix_asc' => 'p.prix_vente ASC',
        'prix_desc' => 'p.prix_vente DESC',
        'marge' => '((p.prix_vente-p.prix_achat)/GREATEST(p.prix_vente,0.01)*100) DESC',
        'marge_asc' => '((p.prix_vente-p.prix_achat)/GREATEST(p.prix_vente,0.01)*100) ASC',
        'slow' => 'ventes_30j ASC, p.nom ASC',
        'hot' => 'ventes_30j DESC, p.nom ASC',
        'ref' => 'p.reference ASC',
        'marque' => 'p.marque ASC, p.nom ASC',
        default => 'c.nom ASC, p.nom ASC',
    };
    
    $filtered_produits = query("SELECT p.id,p.nom,p.reference,p.code_barre,p.marque,p.categorie_id,p.sous_categorie_id,p.prix_achat,p.prix_vente,p.prix_achat_ht,p.prix_achat_ttc,p.prix_vente_ht,p.prix_vente_ttc,p.tva_rate,p.seuil_alerte,p.description,p.fournisseur_id,p.actif,p.date_creation,(p.image_base64 IS NOT NULL AND p.image_base64!='') as has_image,c.nom as cat_nom,
        COALESCE((SELECT SUM(v.quantite) FROM ventes v WHERE v.produit_id=p.id AND v.date_vente>=DATE_SUB(CURDATE(),INTERVAL 30 DAY)),0) as ventes_30j,
        COALESCE((SELECT SUM(v.quantite) FROM ventes v WHERE v.produit_id=p.id AND v.date_vente>=DATE_SUB(CURDATE(),INTERVAL 90 DAY)),0) as ventes_90j
        FROM produits p JOIN categories c ON p.categorie_id=c.id WHERE " . implode(' AND ', $pw) . " ORDER BY $order", $pp);
    $all_marques = query("SELECT DISTINCT marque FROM produits WHERE actif=1 AND marque!='' ORDER BY marque");
    $total_produits = count($filtered_produits);
    
    // Load stock per franchise for each product
    $stock_by_product = [];
    $stock_rows = query("SELECT s.produit_id, s.franchise_id, s.quantite, f.nom as fnom FROM stock s JOIN franchises f ON s.franchise_id=f.id WHERE f.actif=1 ORDER BY f.nom");
    foreach ($stock_rows as $sr) {
        $stock_by_product[$sr['produit_id']][$sr['franchise_id']] = ['qty' => $sr['quantite'], 'name' => shortF($sr['fnom'])];
    }
    // Get franchise list for column headers (exclude Stock Central)
    $stock_franchises = getRetailFranchises();
    $central_id = getCentralId();
?>
<div class="flex flex-wrap justify-between items-center gap-2 mb-4">
    <h1 class="text-2xl font-bold text-asel-dark flex items-center gap-2"><i class="bi bi-tags text-asel"></i> Produits <span class="text-sm font-normal text-gray-400">(<?=$total_produits?>)</span></h1>
    <div class="flex gap-2 flex-wrap">
        <a href="api.php?action=export_produits" class="bg-white border-2 border-asel text-asel font-semibold px-3 py-1.5 rounded-xl text-xs hover:bg-asel hover:text-white transition-colors"><i class="bi bi-download"></i> Export</a>
        <?php if(isAdmin()): ?>
        <button onclick="openImportModal()" class="bg-white border-2 border-green-500 text-green-600 font-semibold px-3 py-1.5 rounded-xl text-xs hover:bg-green-500 hover:text-white transition-colors"><i class="bi bi-upload"></i> Import</button>
        <button onclick="openBulkPriceModal()" class="bg-white border-2 border-purple-500 text-purple-600 font-semibold px-3 py-1.5 rounded-xl text-xs hover:bg-purple-500 hover:text-white transition-colors"><i class="bi bi-percent"></i> Ajuster prix</button>
        <?php endif; ?>
    </div>
</div>

<!-- Instant search + server filters -->
<div class="bg-white rounded-xl shadow-sm p-3 mb-3 space-y-2">
    <!-- Instant search (client-side, no reload) -->
    <div class="relative">
        <i class="bi bi-search absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"></i>
        <input type="text" id="instantSearch" class="w-full pl-10 pr-4 py-2.5 border-2 border-asel/30 rounded-xl bg-asel-light/20 text-sm focus:border-asel focus:ring-2 focus:ring-asel/20 outline-none" placeholder="Recherche instantanée — nom, réf, marque, code-barres..." oninput="instantFilter()" autofocus>
        <span id="instantCount" class="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400"></span>
    </div>
    <!-- Server-side filters (collapsible) -->
    <details class="text-sm">
        <summary class="text-xs text-gray-400 cursor-pointer hover:text-asel"><i class="bi bi-sliders"></i> Filtres avancés <?=($pf_cat||$pf_marque||$pf_sort!=='cat')?'<span class="text-asel font-bold">(actifs)</span>':''?></summary>
        <form class="flex flex-wrap gap-2 items-end mt-2 pt-2 border-t border-gray-100">
            <input type="hidden" name="page" value="produits">
            <div>
                <label class="text-[10px] font-bold text-gray-400 uppercase block mb-0.5">Catégorie</label>
                <select name="pf_cat" class="border-2 border-gray-200 rounded-lg px-2 py-1.5 text-sm">
                    <option value="">Toutes</option>
                    <?php foreach($categories as $c): ?><option value="<?=$c['id']?>" <?=$pf_cat==$c['id']?'selected':''?>><?=e($c['nom'])?></option><?php endforeach; ?>
                </select>
            </div>
            <div>
                <label class="text-[10px] font-bold text-gray-400 uppercase block mb-0.5">Marque</label>
                <select name="pf_marque" class="border-2 border-gray-200 rounded-lg px-2 py-1.5 text-sm">
                    <option value="">Toutes</option>
                    <?php foreach($all_marques as $m): ?><option value="<?=e($m['marque'])?>" <?=$pf_marque===$m['marque']?'selected':''?>><?=e($m['marque'])?></option><?php endforeach; ?>
                </select>
            </div>
            <div>
                <label class="text-[10px] font-bold text-gray-400 uppercase block mb-0.5">Tri</label>
                <select name="pf_sort" class="border-2 border-gray-200 rounded-lg px-2 py-1.5 text-sm">
                    <option value="cat" <?=$pf_sort==='cat'?'selected':''?>>Catégorie</option>
                    <option value="nom" <?=$pf_sort==='nom'?'selected':''?>>Nom A→Z</option>
                    <option value="ref" <?=$pf_sort==='ref'?'selected':''?>>Référence</option>
                    <option value="marque" <?=$pf_sort==='marque'?'selected':''?>>Marque</option>
                    <option value="prix_asc" <?=$pf_sort==='prix_asc'?'selected':''?>>Prix ↑</option>
                    <option value="prix_desc" <?=$pf_sort==='prix_desc'?'selected':''?>>Prix ↓</option>
                    <option value="marge" <?=$pf_sort==='marge'?'selected':''?>>Marge ↓</option>
                    <option value="marge_asc" <?=$pf_sort==='marge_asc'?'selected':''?>>Marge ↑ (faible)</option>
                    <option value="slow" <?=$pf_sort==='slow'?'selected':''?>>🐌 Invendus (30j)</option>
                    <option value="hot" <?=$pf_sort==='hot'?'selected':''?>>🔥 Meilleures ventes (30j)</option>
                </select>
            </div>
            <button class="bg-asel text-white px-3 py-1.5 rounded-lg text-sm font-semibold"><i class="bi bi-funnel"></i> Appliquer</button>
            <?php if ($pf_search || $pf_cat || $pf_marque || $pf_sort !== 'cat'): ?>
            <a href="?page=produits" class="text-gray-400 hover:text-red-500 text-xs px-2 py-1.5"><i class="bi bi-x-circle"></i> Reset</a>
            <?php endif; ?>
        </form>
    </details>
</div>

<!-- Quick actions bar -->
<div class="flex flex-wrap gap-2 mb-3">
    <button onclick="openAddCategory()" class="bg-white border-2 border-gray-200 text-gray-600 text-xs font-bold px-3 py-1.5 rounded-lg hover:border-asel hover:text-asel transition-colors"><i class="bi bi-folder-plus"></i> Catégorie</button>
    <button onclick="openQuickAddProduct()" class="bg-white border-2 border-gray-200 text-gray-600 text-xs font-bold px-3 py-1.5 rounded-lg hover:border-green-500 hover:text-green-600 transition-colors"><i class="bi bi-plus-circle"></i> Produit</button>
    <button onclick="openBarcodeLookup()" class="bg-white border-2 border-gray-200 text-gray-600 text-xs font-bold px-3 py-1.5 rounded-lg hover:border-purple-500 hover:text-purple-600 transition-colors"><i class="bi bi-upc-scan"></i> Scanner & Rechercher</button>
    <button onclick="printSelectedLabels()" class="bg-white border-2 border-gray-200 text-gray-600 text-xs font-bold px-3 py-1.5 rounded-lg hover:border-orange-500 hover:text-orange-600 transition-colors"><i class="bi bi-tag"></i> Étiquettes</button>
</div>

<!-- Products table -->
<div class="bg-white rounded-xl shadow-sm overflow-hidden">
    <div class="overflow-x-auto">
        <table class="w-full text-sm" id="productsTable">
            <thead><tr class="bg-asel-dark text-white text-[10px] uppercase tracking-wider">
                <th class="px-1 py-3 w-8"><input type="checkbox" id="selectAllProds" onchange="toggleAllProds(this.checked)" class="rounded"></th>
                <th class="px-2 py-3 text-left cursor-pointer hover:bg-white/10" onclick="sortTable(0)">Produit <i class="bi bi-arrow-down-up text-white/30"></i></th>
                <th class="px-2 py-3 text-left cursor-pointer hover:bg-white/10" onclick="sortTable(1)">Réf. <i class="bi bi-arrow-down-up text-white/30"></i></th>
                <th class="px-2 py-3 text-left hidden sm:table-cell cursor-pointer hover:bg-white/10" onclick="sortTable(2)">Cat.</th>
                <th class="px-2 py-3 text-left hidden md:table-cell cursor-pointer hover:bg-white/10" onclick="sortTable(3)">Marque</th>
                <th class="px-2 py-3 text-right cursor-pointer hover:bg-white/10 hidden md:table-cell" onclick="sortTable(4)">PA HT</th>
                <th class="px-2 py-3 text-right cursor-pointer hover:bg-white/10" onclick="sortTable(5)">PV TTC</th>
                <th class="px-2 py-3 text-center cursor-pointer hover:bg-white/10 hidden lg:table-cell" onclick="sortTable(6)" title="Ventes 30 derniers jours">V.30j</th>
                <th class="px-2 py-3 text-center cursor-pointer hover:bg-white/10" onclick="sortTable(6)">Marge</th>
                <?php if ($central_id): ?>
                <th class="px-2 py-3 text-center bg-indigo-900 cursor-pointer hover:bg-indigo-800" onclick="sortTable(6)" title="Stock Central">Central</th>
                <?php endif; ?>
                <?php foreach ($stock_franchises as $fi => $sf): ?>
                <th class="px-2 py-3 text-center cursor-pointer hover:bg-white/10" onclick="sortTable(<?=7+$fi?>)" title="<?=e($sf['nom'])?>"><?=e(mb_substr(shortF($sf['nom']),0,6))?></th>
                <?php endforeach; ?>
                <th class="px-2 py-3 text-center font-bold cursor-pointer hover:bg-white/10" onclick="sortTable(<?=7+count($stock_franchises)?>)">Total</th>
                <th class="px-2 py-3">Act.</th>
            </tr></thead>
            <tbody class="divide-y">
            <?php foreach($filtered_produits as $p):
                $m = $p['prix_vente'] > 0 ? (($p['prix_vente'] - $p['prix_achat']) / $p['prix_vente'] * 100) : 0;
                $total_stock = 0;
                $central_qty = $stock_by_product[$p['id']][$central_id]['qty'] ?? 0;
            ?>
                <tr class="hover:bg-gray-50 prod-row" data-pid="<?=$p['id']?>" data-search="<?=e(strtolower($p['nom'].' '.$p['reference'].' '.$p['marque'].' '.$p['code_barre'].' '.$p['cat_nom']))?>">
                    <td class="px-1 py-1.5"><input type="checkbox" class="prod-check rounded" value="<?=$p['id']?>" data-nom="<?=e($p['nom'])?>" data-ref="<?=e($p['reference']??'')?>" data-prix="<?=number_format($p['prix_vente_ttc']??$p['prix_vente'],2)?>" data-code="<?=e($p['code_barre']??'')?>"></td>
                    <td class="px-2 py-1.5">
                        <div class="flex items-center gap-2">
                            <div class="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center shrink-0 text-gray-300 overflow-hidden border prod-img" data-pid="<?=$p['id']?>">
                                <i class="bi bi-image text-xs"></i>
                                <i class="bi bi-image text-xs"></i>
                            </div>
                            <div class="font-medium text-sm"><?=e($p['nom'])?></div>
                        </div>
                    </td>
                    <td class="px-2 py-1.5 text-xs font-mono text-gray-500"><?=e($p['reference'])?:'-'?></td>
                    <td class="px-2 py-1.5 text-xs hidden sm:table-cell"><span class="inline-flex px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 text-[10px]"><?=e($p['cat_nom'])?></span></td>
                    <td class="px-2 py-1.5 text-xs text-gray-500 hidden md:table-cell"><?=e($p['marque'])?></td>
                    <td class="px-2 py-1.5 text-right text-xs text-gray-500 hidden md:table-cell">
                        <div><?=number_format($p['prix_achat_ht'] ?? $p['prix_achat'],2)?></div>
                        <div class="text-[9px] text-gray-300">TVA <?=number_format($p['tva_rate']??19,0)?>%</div>
                    </td>
                    <td class="px-2 py-1.5 text-right">
                        <div class="font-bold text-sm"><?=number_format($p['prix_vente_ttc'] ?? $p['prix_vente'],2)?></div>
                        <div class="text-[9px] text-gray-400 hidden sm:block">HT <?=number_format($p['prix_vente_ht']??$p['prix_vente'],2)?></div>
                    </td>
                    <td class="px-2 py-1.5 text-center">
                        <span class="inline-flex px-1.5 py-0.5 rounded text-[10px] font-bold <?=$m>=30?'bg-green-100 text-green-800':($m>=15?'bg-yellow-100 text-yellow-800':'bg-red-100 text-red-800')?>"><?=number_format($m,0)?>%</span>
                    </td>
                    <!-- Ventes 30j -->
                    <td class="px-2 py-1.5 text-center hidden lg:table-cell">
                        <?php $v30 = intval($p['ventes_30j']??0); ?>
                        <span class="text-xs font-bold <?=$v30<=0?'text-gray-300':($v30>=10?'text-green-600':'text-asel')?>"><?=$v30>0?$v30:'—'?></span>
                    </td>
                    <?php if ($central_id): ?>
                    <td class="px-2 py-1.5 text-center bg-indigo-50">
                        <span class="font-bold text-xs <?=$central_qty<=0?'text-red-500':($central_qty<=3?'text-amber-600':'text-indigo-700')?>"><?=$central_qty?></span>
                    </td>
                    <?php endif; ?>
                    <?php foreach ($stock_franchises as $sf):
                        $sq = $stock_by_product[$p['id']][$sf['id']]['qty'] ?? 0;
                        $total_stock += $sq;
                    ?>
                    <td class="px-2 py-1.5 text-center">
                        <span class="text-xs font-semibold <?=$sq<=0?'text-red-400':($sq<=$p['seuil_alerte']?'text-amber-600':'text-green-700')?>"><?=$sq?></span>
                    </td>
                    <?php endforeach; ?>
                    <?php $total_stock += $central_qty; ?>
                    <td class="px-2 py-1.5 text-center">
                        <span class="inline-flex px-2 py-0.5 rounded text-xs font-black <?=$total_stock<=0?'bg-red-100 text-red-800':($total_stock<=$p['seuil_alerte']?'bg-amber-100 text-amber-800':'bg-green-100 text-green-800')?>"><?=$total_stock?></span>
                    </td>
                    <td class="px-2 py-1.5">
                        <div class="flex gap-0.5">
                            <button onclick="viewProductDetails(<?=$p['id']?>,'<?=ejs($p['nom'])?>','<?=ejs($p['reference'])?>','<?=ejs($p['marque'])?>','<?=ejs($p['cat_nom'])?>',<?=$p['prix_achat']?>,<?=$p['prix_vente']?>,'<?=ejs($p['code_barre'])?>',<?=$p['seuil_alerte']?>)" class="text-gray-400 hover:text-asel" title="Détails"><i class="bi bi-eye text-sm"></i></button>
                            <button onclick="openEditProduct(<?=$p['id']?>,'<?=ejs($p['nom'])?>',<?=$p['categorie_id']?>,'<?=ejs($p['marque'])?>','<?=ejs($p['reference'])?>','<?=ejs($p['code_barre'])?>',<?=$p['prix_achat']?>,<?=$p['prix_vente']?>,<?=$p['seuil_alerte']?>,<?=floatval($p['prix_achat_ht']??0)?>,<?=floatval($p['prix_vente_ht']??0)?>,<?=floatval($p['tva_rate']??19)?>, '<?=ejs($p['description']??'')?>')" class="text-asel hover:text-asel-dark" title="Modifier"><i class="bi bi-pencil text-sm"></i></button>
                            <?php if($p['code_barre'] || $p['reference']): ?>
                            <a href="pdf.php?type=etiquettes&ids=<?=$p['id']?>&qty=1" target="_blank" class="text-orange-400 hover:text-orange-600" title="Imprimer étiquette"><i class="bi bi-tag text-sm"></i></a>
                            <form method="POST" class="inline"><input type="hidden" name="_csrf" value="<?=$csrf?>"><input type="hidden" name="action" value="duplicate_produit"><input type="hidden" name="source_id" value="<?=$p['id']?>"><button class="text-gray-300 hover:text-blue-500" title="Dupliquer ce produit"><i class="bi bi-copy text-sm"></i></button></form>
                            <?php endif; ?>
                            <?php if(isAdmin()): ?>
                            <form method="POST" class="inline" onsubmit="return confirm('Désactiver?')"><input type="hidden" name="_csrf" value="<?=$csrf?>"><input type="hidden" name="action" value="toggle_produit"><input type="hidden" name="produit_id" value="<?=$p['id']?>">
                            <button class="text-gray-300 hover:text-red-500" title="Désactiver"><i class="bi bi-eye-slash text-sm"></i></button></form>
                            <?php endif; ?>
                        </div>
                    </td>
                </tr>
            <?php endforeach; ?>
            </tbody>
        </table>
    </div>
</div>

<!-- Instant filter + column sorting -->
<script>
// Instant client-side search
function toggleAllProds(checked) {
    document.querySelectorAll('.prod-check').forEach(function(cb) {
        if (cb.closest('tr').style.display !== 'none') cb.checked = checked;
    });
    updateLabelCount();
}

function updateLabelCount() {
    var count = document.querySelectorAll('.prod-check:checked').length;
    var btn = document.querySelector('[onclick="printSelectedLabels()"]');
    if (btn) btn.innerHTML = '<i class="bi bi-tag"></i> Étiquettes' + (count > 0 ? ' (' + count + ')' : '');
}

// Listen for checkbox changes
document.addEventListener('change', function(e) {
    if (e.target.classList.contains('prod-check')) updateLabelCount();
});

function printSelectedLabels() {
    var checked = document.querySelectorAll('.prod-check:checked');
    
    if (!checked.length) {
        var visible = document.querySelectorAll('#productsTable .prod-row:not([style*="display: none"])');
        if (!visible.length) { alert('Aucun produit visible'); return; }
        if (confirm('Aucun produit coché. Sélectionner tous les ' + visible.length + ' produits visibles ?')) {
            visible.forEach(function(r) {
                var cb = r.querySelector('.prod-check');
                if (cb) cb.checked = true;
            });
            checked = document.querySelectorAll('.prod-check:checked');
            updateLabelCount();
        } else return;
    }
    
    // Collect product data
    var products = [];
    checked.forEach(function(cb) {
        products.push({
            id: cb.value,
            nom: cb.dataset.nom || '?',
            ref: cb.dataset.ref || '',
            prix: cb.dataset.prix || '0',
            code: cb.dataset.code || ''
        });
    });
    
    // Check if openModal is available, otherwise use direct print
    if (typeof openModal !== 'function') {
        // Direct print without modal
        if (confirm('Imprimer ' + products.length + ' étiquette(s) ?')) {
            doDirectLabelPrint(products);
        }
        return;
    }
    
    openModal(modalHeader('bi-tag', 'Imprimer étiquettes', products.length + ' produit(s) sélectionné(s)') +
        '<div class="p-5 space-y-3">' +
        '<div class="flex gap-3 items-center mb-2">' +
            '<label class="text-xs font-bold text-gray-500">Taille</label>' +
            '<select id="labelSize" class="border-2 border-gray-200 rounded-lg px-2 py-1 text-sm">' +
                '<option value="small">Petit (4 par ligne)</option>' +
                '<option value="medium" selected>Moyen (3 par ligne)</option>' +
                '<option value="large">Grand (2 par ligne)</option>' +
            '</select>' +
            '<label class="text-xs font-bold text-gray-500 ml-2">Qté/produit</label>' +
            '<input type="number" id="labelQtyAll" value="1" min="1" max="20" class="w-14 border-2 border-gray-200 rounded-lg px-2 py-1 text-sm text-center">' +
        '</div>' +
        '<div class="max-h-48 overflow-y-auto space-y-1 border rounded-lg p-2 bg-gray-50">' +
        products.map(function(p) {
            return '<div class="flex items-center gap-2 text-xs py-1 border-b border-gray-200">' +
                '<span class="flex-1 truncate font-medium">' + p.nom + '</span>' +
                '<span class="text-gray-400 font-mono">' + p.ref + '</span>' +
                '<span class="text-asel font-bold">' + p.prix + ' DT</span>' +
                '<input type="number" class="label-qty w-12 border rounded px-1 py-0.5 text-xs text-center" value="1" min="1" max="20" data-id="' + p.id + '">' +
            '</div>';
        }).join('') +
        '</div>' +
        '<div class="flex gap-2 items-center text-xs text-gray-400">' +
            '<label><input type="checkbox" id="labelShowPrice" checked class="mr-1">Afficher prix</label>' +
            '<label><input type="checkbox" id="labelShowBarcode" checked class="mr-1">Code-barres</label>' +
            '<label><input type="checkbox" id="labelShowRef" checked class="mr-1">Référence</label>' +
        '</div>' +
        '<button onclick="generateLabels()" class="w-full py-2.5 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-bold text-sm transition-colors"><i class="bi bi-printer"></i> Générer & Imprimer</button>' +
        '</div>',
        {size: 'max-w-md'}
    );
    
    // Apply qty to all when global qty changes
    document.getElementById('labelQtyAll').addEventListener('input', function() {
        var v = this.value;
        document.querySelectorAll('.label-qty').forEach(function(el) { el.value = v; });
    });
}

function generateLabels() {
    var inputs = document.querySelectorAll('.label-qty[data-id]');
    var size = document.getElementById('labelSize').value;
    var showPrice = document.getElementById('labelShowPrice').checked;
    var showBarcode = document.getElementById('labelShowBarcode').checked;
    var showRef = document.getElementById('labelShowRef').checked;
    
    var cols = size === 'small' ? 4 : size === 'large' ? 2 : 3;
    var labelW = size === 'small' ? '23%' : size === 'large' ? '48%' : '31%';
    var fontSize = size === 'small' ? '8px' : size === 'large' ? '12px' : '10px';
    var priceFontSize = size === 'small' ? '14px' : size === 'large' ? '22px' : '18px';
    
    // Collect labels (repeat by qty)
    var labels = [];
    inputs.forEach(function(inp) {
        var qty = parseInt(inp.value) || 1;
        var cb = document.querySelector('.prod-check[value="' + inp.dataset.id + '"]');
        if (!cb) return;
        for (var i = 0; i < qty; i++) {
            labels.push({
                nom: cb.dataset.nom,
                ref: cb.dataset.ref,
                prix: cb.dataset.prix,
                code: cb.dataset.code
            });
        }
    });
    
    if (!labels.length) { showToast('Aucune étiquette à imprimer', 'warning'); return; }
    
    // Generate print window
    var html = '<!DOCTYPE html><html><head><title>Étiquettes ASEL</title><style>' +
        '@page { margin: 5mm; } ' +
        '@media print { body { margin: 0; } .no-print { display: none !important; } }' +
        'body { font-family: Arial, sans-serif; margin: 10px; }' +
        '.labels-grid { display: flex; flex-wrap: wrap; gap: 4px; }' +
        '.label { width: ' + labelW + '; border: 1px solid #ccc; border-radius: 6px; padding: 6px; text-align: center; page-break-inside: avoid; box-sizing: border-box; }' +
        '.label .nom { font-weight: bold; font-size: ' + fontSize + '; line-height: 1.2; margin-bottom: 3px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }' +
        '.label .ref { font-size: ' + (parseInt(fontSize)-1) + 'px; color: #888; margin-bottom: 2px; }' +
        '.label .prix { font-size: ' + priceFontSize + '; font-weight: 900; color: #1B3A5C; }' +
        '.label .code { font-family: monospace; font-size: ' + (parseInt(fontSize)-1) + 'px; color: #666; margin-top: 2px; letter-spacing: 1px; }' +
        '.label .brand { font-size: 7px; color: #2AABE2; margin-top: 2px; } .label .barcode { width: 100%; max-height: 35px; }' +
        '</style></head><body>' +
        '<div class="no-print" style="padding:10px;text-align:center;margin-bottom:10px">' +
        '<button onclick="window.print()" style="padding:10px 30px;background:#2AABE2;color:white;border:none;border-radius:8px;font-weight:bold;font-size:14px;cursor:pointer">🖨️ Imprimer</button>' +
        ' <span style="color:#888;font-size:12px;margin-left:10px">' + labels.length + ' étiquette(s)</span></div>' +
        '<div class="labels-grid">';
    
    labels.forEach(function(l) {
        html += '<div class="label">';
        html += '<div class="nom">' + l.nom + '</div>';
        if (showRef && l.ref) html += '<div class="ref">' + l.ref + '</div>';
        if (showPrice) html += '<div class="prix">' + l.prix + ' DT</div>';
        if (showBarcode && l.code) html += '<svg class="barcode" data-code="' + l.code + '"></svg>';
        html += '<div class="brand">ASEL Mobile</div>';
        html += '</div>';
    });
    
    html += '</div></body></html>';
    
    // Add barcode rendering
    html = html.replace('</head>', '<script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js"><\/script></head>');
    html = html.replace('</body>', '<script>document.querySelectorAll(".barcode").forEach(function(svg){var code=svg.getAttribute("data-code");if(code){try{JsBarcode(svg,code,{format:"CODE128",width:1,height:30,displayValue:true,fontSize:8,margin:2,textMargin:1});}catch(e){svg.outerHTML="<div style=\'font-family:monospace;font-size:8px;color:#666\'>"+code+"</div>";}}});<\/script></body>');
    var w = window.open('', '_blank');
    w.document.write(html);
    w.document.close();
    if (typeof closeModal === 'function') closeModal();
}

function doDirectLabelPrint(products) {
    var labels = [];
    products.forEach(function(p) { labels.push(p); });
    var html = '<!DOCTYPE html><html><head><title>Étiquettes ASEL</title><style>' +
        '@page{margin:5mm}body{font-family:Arial,sans-serif;margin:10px}' +
        '.grid{display:flex;flex-wrap:wrap;gap:4px}' +
        '.label{width:31%;border:1px solid #ccc;border-radius:6px;padding:6px;text-align:center;page-break-inside:avoid}' +
        '.nom{font-weight:bold;font-size:10px;margin-bottom:3px}.prix{font-size:18px;font-weight:900;color:#1B3A5C}' +
        '.ref{font-size:9px;color:#888}.brand{font-size:7px;color:#2AABE2;margin-top:2px}' +
        '</style></head><body><div class="grid">';
    labels.forEach(function(l) {
        html += '<div class="label"><div class="nom">' + l.nom + '</div>';
        if (l.ref) html += '<div class="ref">' + l.ref + '</div>';
        html += '<div class="prix">' + l.prix + ' DT</div>';
        if (l.code) html += '<svg class="barcode" data-code="' + l.code + '"></svg>';
        html += '<div class="brand">ASEL Mobile</div></div>';
    });
    html += '</div><script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js"><\/script><script>document.querySelectorAll(".barcode").forEach(function(svg){var code=svg.getAttribute("data-code");if(code){try{JsBarcode(svg,code,{format:"CODE128",width:1,height:30,displayValue:true,fontSize:8,margin:2});}catch(e){}}});setTimeout(function(){window.print()},500);<\/script></body></html>';
    var w = window.open('', '_blank');
    w.document.write(html);
    w.document.close();
}

function instantFilter() {
    const q = document.getElementById('instantSearch').value.toLowerCase().trim();
    const qNorm = q.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const rows = document.querySelectorAll('#productsTable .prod-row');
    let visible = 0;
    rows.forEach(row => {
        const s = (row.dataset.search||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'');
        const match = !q || s.includes(qNorm);
        row.style.display = match ? '' : 'none';
        if (match) visible++;
    });
    const countEl = document.getElementById('instantCount');
    if(countEl) countEl.textContent = q ? visible + '/' + rows.length : '';
    
    // Show/hide empty state
    let emptyRow = document.getElementById('prodEmptyRow');
    if(q && visible === 0) {
        if(!emptyRow) {
            emptyRow = document.createElement('tr');
            emptyRow.id = 'prodEmptyRow';
            emptyRow.innerHTML = `<td colspan="20" class="px-4 py-10 text-center text-gray-400"><i class="bi bi-search text-2xl block mb-2 opacity-30"></i>Aucun produit pour "${q}"</td>`;
            document.querySelector('#productsTable tbody').appendChild(emptyRow);
        }
        emptyRow.style.display = '';
    } else if(emptyRow) {
        emptyRow.style.display = 'none';
    }
}

// Column sorting
let sortDir = {};
function sortTable(colIdx) {
    const table = document.getElementById('productsTable');
    const tbody = table.querySelector('tbody');
    const rows = Array.from(tbody.querySelectorAll('tr.prod-row'));
    
    sortDir[colIdx] = !sortDir[colIdx];
    const dir = sortDir[colIdx] ? 1 : -1;
    
    rows.sort((a, b) => {
        const aCell = a.cells[colIdx]?.textContent.trim() || '';
        const bCell = b.cells[colIdx]?.textContent.trim() || '';
        const aNum = parseFloat(aCell.replace(/[^0-9.-]/g, ''));
        const bNum = parseFloat(bCell.replace(/[^0-9.-]/g, ''));
        if (!isNaN(aNum) && !isNaN(bNum) && colIdx >= 4) {
            return (aNum - bNum) * dir;
        }
        return aCell.localeCompare(bCell, 'fr') * dir;
    });
    
    const frag = document.createDocumentFragment();
    rows.forEach(row => {
        frag.appendChild(row);
    });
    tbody.appendChild(frag);
}

// Keyboard shortcut: / to focus search
document.addEventListener('keydown', e => {
    if (e.key === '/' && !['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)) {
        e.preventDefault();
        document.getElementById('instantSearch').focus();
    }
});

// Lazy load product images
(function(){
    var imgDivs = document.querySelectorAll('.prod-img[data-pid]');
    var loaded = {};
    function loadVisibleImages() {
        imgDivs.forEach(function(div) {
            var pid = div.dataset.pid;
            if (loaded[pid] || div.closest('tr').style.display === 'none') return;
            var rect = div.getBoundingClientRect();
            if (rect.top < window.innerHeight + 200 && rect.bottom > -200) {
                loaded[pid] = true;
                fetch('api.php?action=get_product_image&id=' + pid)
                    .then(function(r){ return r.json(); })
                    .then(function(d){
                        if (d.image) {
                            div.innerHTML = '<img src="' + d.image + '" class="w-full h-full object-cover">';
                        }
                    }).catch(function(){});
            }
        });
    }
    // Load on page ready + scroll
    setTimeout(loadVisibleImages, 500);
    window.addEventListener('scroll', loadVisibleImages, {passive: true});
    // Reload after filter changes
    var origFilter = window.instantFilter;
    if (origFilter) {
        window.instantFilter = function() {
            origFilter.apply(this, arguments);
            setTimeout(loadVisibleImages, 100);
        };
    }
})();
</script>

<?php elseif ($page === 'franchises_mgmt' && can('franchises_mgmt')):
    try { $all_fr = query("SELECT * FROM franchises ORDER BY type_franchise DESC, actif DESC, nom"); }
    catch (Exception $e) { $all_fr = query("SELECT * FROM franchises ORDER BY actif DESC, nom"); }
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
        if (($f['type_franchise'] ?? '') === 'central') continue; // Skip Stock Central display here
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
                <?php
                $fc_statut = $f['statut_commercial'] ?? 'actif';
                $fc_badges = ['prospect'=>'bg-gray-100 text-gray-800','contact'=>'bg-blue-100 text-blue-800','contrat_non_signe'=>'bg-yellow-100 text-yellow-800','contrat_signe'=>'bg-indigo-100 text-indigo-800','actif'=>'bg-green-100 text-green-800','suspendu'=>'bg-orange-100 text-orange-800','resilie'=>'bg-red-100 text-red-800'];
                $fc_labels = ['prospect'=>'Prospect','contact'=>'Contacté','contrat_non_signe'=>'Contrat non signé','contrat_signe'=>'Contrat signé','actif'=>'Actif','suspendu'=>'Suspendu','resilie'=>'Résilié'];
                ?>
                <span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium <?=$fc_badges[$fc_statut]??'bg-gray-100'?> mt-1"><?=$fc_labels[$fc_statut]??$fc_statut?></span>
                <?php if ($f['notes_internes'] ?? ''): ?>
                <p class="text-xs text-gray-400 mt-1 italic"><i class="bi bi-sticky"></i> <?=htmlspecialchars(substr($f['notes_internes'],0,80))?><?=strlen($f['notes_internes']??'')>80?'...':''?></p>
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
                    <select name="statut_commercial" class="border-2 border-gray-200 rounded-lg px-3 py-1.5 text-sm">
                        <?php foreach(['prospect'=>'Prospect','contact'=>'Contacté','contrat_non_signe'=>'Contrat non signé','contrat_signe'=>'Contrat signé','actif'=>'Actif','suspendu'=>'Suspendu','resilie'=>'Résilié'] as $sk=>$sl): ?>
                        <option value="<?=$sk?>" <?=($f['statut_commercial']??'actif')===$sk?'selected':''?>><?=$sl?></option>
                        <?php endforeach; ?>
                    </select>
                    <button class="bg-asel text-white px-4 py-1.5 rounded-lg text-sm font-bold flex-1"><i class="bi bi-check-circle"></i> Enregistrer</button>
                </div>
                <div><label class="text-xs font-bold text-gray-500">Notes internes</label><textarea name="notes_internes" class="w-full border-2 border-gray-200 rounded-lg px-3 py-1.5 text-sm" rows="2" placeholder="Notes confidentielles..."><?=htmlspecialchars($f['notes_internes']??'')?></textarea></div>
            </form>
        </div>
        <?php endif; ?>
    </div>
    <?php endforeach; ?>
</div>

<?php elseif ($page === 'users' && can('users')): $users=query("SELECT u.*,f.nom as fnom FROM utilisateurs u LEFT JOIN franchises f ON u.franchise_id=f.id ORDER BY u.role,u.nom_complet"); ?>
<div class="flex flex-wrap justify-between items-center gap-3 mb-4">
    <h1 class="text-2xl font-bold text-asel-dark flex items-center gap-2"><i class="bi bi-people text-asel"></i> Utilisateurs <span class="text-sm font-normal text-gray-400">(<?=count($users)?>)</span></h1>
    <button onclick="openAddUser()" class="bg-asel hover:bg-asel-dark text-white text-xs font-bold px-4 py-2 rounded-lg transition-colors"><i class="bi bi-person-plus"></i> Nouvel utilisateur</button>
</div>
<div class="bg-white rounded-xl shadow-sm overflow-hidden"><div class="overflow-x-auto"><table class="w-full text-sm"><thead><tr class="bg-asel-dark text-white text-xs uppercase tracking-wider"><th class="px-3 py-3 text-left">Login</th><th class="px-3 py-3 text-left">Nom & Prénom</th><th class="px-3 py-3 hidden md:table-cell">CIN</th><th class="px-3 py-3 hidden sm:table-cell">Tél</th><th class="px-3 py-3">Rôle</th><th class="px-3 py-3 text-left hidden sm:table-cell">Franchise</th><th class="px-3 py-3">Statut</th><th class="px-3 py-3">Edit</th></tr></thead>
<tbody class="divide-y"><?php foreach($users as $u):?>
<tr class="hover:bg-gray-50 <?=$u['actif']?'':'opacity-50'?>">
<td class="px-3 py-2 font-mono text-sm"><?=e($u['nom_utilisateur'])?></td>
<td class="px-3 py-2"><div class="font-medium"><?=e($u['nom_complet'])?></div><?php if(!empty($u['prenom'])): ?><div class="text-xs text-gray-400"><?=e($u['prenom'])?></div><?php endif; ?></td>
<td class="px-3 py-2 text-xs font-mono text-gray-500 hidden md:table-cell"><?=e($u['cin']??'')?></td>
<td class="px-3 py-2 text-xs hidden sm:table-cell"><?=e($u['telephone']??'')?></td>
<td class="px-3 py-2 text-center"><?=roleBadge($u['role'])?></td>
<td class="px-3 py-2 text-xs hidden sm:table-cell"><?=$u['fnom']?shortF($u['fnom']):'—'?></td>
<td class="px-3 py-2 text-center"><?=$u['actif']?'<span class="text-green-500"><i class="bi bi-check-circle-fill"></i></span>':'<span class="text-red-400"><i class="bi bi-x-circle-fill"></i></span>'?></td>
<td class="px-3 py-2"><button onclick="openEditUser(<?=$u['id']?>,'<?=ejs($u['nom_complet'])?>','<?=$u['role']?>',<?=$u['franchise_id']?:0?>,<?=$u['actif']?>)" class="text-asel hover:text-asel-dark"><i class="bi bi-pencil"></i></button></td>
</tr>
<?php endforeach;?></tbody></table></div></div>

<?php
// =====================================================
// CLIENTS
// =====================================================
elseif ($page === 'clients'):
    $cl_where = "";
    $cl_params = [];
    if (!can('view_all_franchises')) {
        $cl_where = "WHERE c.franchise_id=?";
        $cl_params = [currentFranchise()];
    } elseif ($fid) {
        $cl_where = "WHERE c.franchise_id=?";
        $cl_params = [$fid];
    }
    $clients = query("SELECT c.*,f.nom as fnom,
        COALESCE((SELECT SUM(prix_total) FROM ventes WHERE client_id=c.id),0) as total_achats,
        COALESCE((SELECT SUM(montant) FROM echeances WHERE client_id=c.id AND statut IN ('en_attente','en_retard')),0) as solde_du
        FROM clients c LEFT JOIN franchises f ON c.franchise_id=f.id $cl_where ORDER BY c.date_creation DESC LIMIT 200", $cl_params);
    $en_retard = query("SELECT e.*,c.nom as client_nom,c.prenom as client_prenom,c.telephone as client_tel FROM echeances e JOIN clients c ON e.client_id=c.id WHERE e.statut='en_retard' ORDER BY e.date_echeance ASC LIMIT 20") ?? [];
?>
<div class="flex flex-wrap justify-between items-center gap-3 mb-4">
    <h1 class="text-2xl font-bold text-asel-dark flex items-center gap-2"><i class="bi bi-person-lines-fill text-asel"></i> Clients <span class="text-sm font-normal text-gray-400">(<?=count($clients)?>)</span></h1>
    <div class="flex gap-2 items-center">
        <?php if(can('view_all_franchises')): ?>
        <form class="flex gap-2 items-center">
            <input type="hidden" name="page" value="clients">
            <select name="fid" class="border-2 border-gray-200 rounded-lg px-3 py-1.5 text-sm" onchange="this.form.submit()">
                <option value="">👥 Tous</option>
                <?php foreach($allFranchises as $af): ?>
                <option value="<?=$af['id']?>" <?=$fid==$af['id']?'selected':''?>><?=shortF($af['nom'])?></option>
                <?php endforeach; ?>
            </select>
        </form>
        <?php endif; ?>
        <button onclick="openAddClientModal()" class="bg-asel text-white px-4 py-2 rounded-xl text-sm font-bold"><i class="bi bi-person-plus"></i> Nouveau client</button>
    </div>
</div>

<!-- ADD CLIENT FORM (toggle, no JS modal needed) -->
<div id="addClientForm" class="hidden mb-4 bg-white rounded-2xl shadow-sm border-2 border-asel/30 overflow-hidden">
    <div class="bg-gradient-to-r from-asel-dark to-asel text-white px-5 py-3 flex justify-between items-center">
        <h3 class="font-bold flex items-center gap-2"><i class="bi bi-person-plus"></i> Nouveau client</h3>
        <button onclick="document.getElementById('addClientForm').classList.add('hidden')" class="text-white/70 hover:text-white text-xl">&times;</button>
    </div>
    <form method="POST" class="p-5 space-y-3">
        <input type="hidden" name="_csrf" value="<?=$csrf?>">
        <input type="hidden" name="action" value="add_client">
        <?php if(can('view_all_franchises')): ?>
        <div><label class="text-xs font-bold text-gray-500 uppercase block mb-1">Franchise</label>
            <select name="franchise_id" class="w-full border-2 border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:border-asel">
                <?php foreach($allFranchises as $af): ?><option value="<?=$af['id']?>"><?=shortF($af['nom'])?></option><?php endforeach; ?>
            </select>
        </div>
        <?php endif; ?>
        <div class="grid grid-cols-2 gap-3">
            <div><label class="text-xs font-bold text-gray-500 uppercase block mb-1">Nom *</label><input name="nom" required class="w-full border-2 border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:border-asel" placeholder="Nom de famille"></div>
            <div><label class="text-xs font-bold text-gray-500 uppercase block mb-1">Prénom</label><input name="prenom" class="w-full border-2 border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:border-asel" placeholder="Prénom"></div>
        </div>
        <div><label class="text-xs font-bold text-gray-500 uppercase block mb-1">Type</label>
            <select name="type_client" class="w-full border-2 border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:border-asel">
                <option value="passager">🚶 Passager</option><option value="boutique">🏪 Client boutique</option><option value="entreprise">🏢 Entreprise</option>
            </select>
        </div>
        <div class="grid grid-cols-2 gap-3">
            <div><label class="text-xs font-bold text-gray-500 uppercase block mb-1">📞 Téléphone</label><input name="telephone" type="tel" class="w-full border-2 border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:border-asel" placeholder="+216 XX XXX XXX"></div>
            <div><label class="text-xs font-bold text-gray-500 uppercase block mb-1">📞 Tél 2 (optionnel)</label><input name="telephone2" type="tel" class="w-full border-2 border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:border-asel" placeholder="2ème numéro"></div>
        </div>
        <div class="grid grid-cols-3 gap-3">
            <div><label class="text-xs font-bold text-gray-500 uppercase block mb-1">✉️ Email</label><input name="email" type="email" class="w-full border-2 border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:border-asel" placeholder="email@exemple.com"></div>
            <div><label class="text-xs font-bold text-gray-500 uppercase block mb-1">🪪 CIN</label><input name="cin" type="text" maxlength="8" pattern="[0-9]{8}" class="w-full border-2 border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:border-asel" placeholder="12345678"></div>
            <div><label class="text-xs font-bold text-gray-500 uppercase block mb-1">📋 Matricule fiscal</label><input name="matricule_fiscal" class="w-full border-2 border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:border-asel" placeholder="0000000/X/X/X/000"></div>
        </div>
        <div class="grid grid-cols-2 gap-3">
            <div><label class="text-xs font-bold text-gray-500 uppercase block mb-1">🏢 Entreprise</label><input name="entreprise" class="w-full border-2 border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:border-asel" placeholder="Nom entreprise"></div>
            <div><label class="text-xs font-bold text-gray-500 uppercase block mb-1">📍 Adresse</label><input name="adresse" class="w-full border-2 border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:border-asel" placeholder="Adresse complète"></div>
        </div>
        <div><label class="text-xs font-bold text-gray-500 uppercase block mb-1">📝 Notes</label><textarea name="notes" rows="2" class="w-full border-2 border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:border-asel" placeholder="Notes internes..."></textarea></div>
        <button type="submit" class="w-full py-2.5 rounded-xl bg-asel hover:bg-asel-dark text-white font-bold text-sm transition-colors"><i class="bi bi-check-circle"></i> Ajouter le client</button>
    </form>
</div>

<!-- Search -->
<div class="relative mb-4">
    <i class="bi bi-search absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"></i>
    <input type="text" id="clientSearch" class="w-full pl-10 pr-4 py-2.5 border-2 border-gray-200 rounded-xl text-sm focus:border-asel" placeholder="Rechercher nom, téléphone, email, entreprise..." oninput="filterClients()">
    <span id="clientCount" class="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400"></span>
</div>

<!-- Client table -->
<div class="bg-white rounded-xl shadow-sm overflow-hidden">
    <div class="overflow-x-auto"><table class="w-full text-sm">
        <thead><tr class="bg-asel-dark text-white text-xs uppercase tracking-wider">
            <th class="px-3 py-3 text-left">Nom</th>
            <th class="px-3 py-3 hidden sm:table-cell">Tél</th>
            <th class="px-3 py-3">Type</th>
            <?php if(can('view_all_franchises')): ?><th class="px-3 py-3 hidden md:table-cell">Franchise</th><?php endif; ?>
            <th class="px-3 py-3 hidden md:table-cell">Entreprise</th>
            <th class="px-3 py-3 text-right hidden sm:table-cell">Achats</th>
            <th class="px-3 py-3 text-right hidden sm:table-cell">Solde dû</th>
            <th class="px-3 py-3">Actions</th>
        </tr></thead>
        <tbody class="divide-y">
        <?php foreach ($clients as $c): $tb=['passager'=>'bg-gray-100','boutique'=>'bg-blue-100 text-blue-800','entreprise'=>'bg-purple-100 text-purple-800']; ?>
            <tr class="hover:bg-gray-50 client-row" data-search="<?=e(strtolower($c['nom'].' '.($c['prenom']??'').' '.$c['telephone'].' '.$c['email'].' '.($c['entreprise']??'').' '.$c['type_client']))?>">
                <td class="px-3 py-2 font-medium"><?=e($c['nom'].' '.($c['prenom']??''))?></td>
                <td class="px-3 py-2 hidden sm:table-cell"><a href="tel:<?=e($c['telephone'])?>" class="text-asel"><?=e($c['telephone'])?></a></td>
                <td class="px-3 py-2"><span class="inline-flex px-2 py-0.5 rounded text-xs font-medium <?=$tb[$c['type_client']]??''?>"><?=$c['type_client']?></span></td>
                <?php if(can('view_all_franchises')): ?><td class="px-3 py-2 text-xs hidden md:table-cell"><?=e(shortF($c['fnom']??'—'))?></td><?php endif; ?>
                <td class="px-3 py-2 text-xs hidden md:table-cell"><?=e($c['entreprise']??'')?></td>
                <td class="px-3 py-2 text-right text-xs font-bold text-asel hidden sm:table-cell"><?=$c['total_achats']>0?number_format($c['total_achats'],2).' DT':'—'?></td>
                <td class="px-3 py-2 text-right text-xs hidden sm:table-cell">
                    <?php if($c['solde_du']>0): ?><span class="font-bold text-red-600"><?=number_format($c['solde_du'],2)?> DT</span><?php else: ?><span class="text-green-500">✓</span><?php endif; ?>
                </td>
                <td class="px-3 py-2 flex gap-1">
                    <button onclick="openEditClientModal(this)" class="text-gray-400 hover:text-asel p-1" title="Modifier"
                        data-id="<?=$c['id']?>"
                        data-nom="<?=e($c['nom'])?>"
                        data-prenom="<?=e($c['prenom']??'')?>"
                        data-tel="<?=e($c['telephone']??'')?>"
                        data-email="<?=e($c['email']??'')?>"
                        data-type="<?=$c['type_client']?>"
                        data-entreprise="<?=e($c['entreprise']??'')?>"
                        data-mf="<?=e($c['matricule_fiscal']??'')?>"
                        data-adresse="<?=e($c['adresse']??'')?>"
                        data-notes="<?=e($c['notes']??'')?>"
                        data-actif="<?=$c['actif']?>"
                    ><i class="bi bi-pencil text-sm"></i></button>
                </td>
            </tr>
            <!-- INLINE EDIT ROW -->
            <tr id="editRow<?=$c['id']?>" class="hidden bg-gradient-to-r from-blue-50 to-white">
                <td colspan="<?=can('view_all_franchises')?'8':'7'?>" class="px-4 py-3">
                    <form method="POST" class="space-y-2">
                        <input type="hidden" name="_csrf" value="<?=$csrf?>">
                        <input type="hidden" name="action" value="edit_client">
                        <input type="hidden" name="client_id" value="<?=$c['id']?>">
                        <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
                            <div><label class="text-[10px] font-bold text-gray-400">Nom</label><input name="nom" value="<?=e($c['nom'])?>" class="w-full border rounded-lg px-2 py-1.5 text-sm"></div>
                            <div><label class="text-[10px] font-bold text-gray-400">Prénom</label><input name="prenom" value="<?=e($c['prenom']??'')?>" class="w-full border rounded-lg px-2 py-1.5 text-sm"></div>
                            <div><label class="text-[10px] font-bold text-gray-400">Téléphone</label><input name="telephone" value="<?=e($c['telephone']??'')?>" class="w-full border rounded-lg px-2 py-1.5 text-sm"></div>
                            <div><label class="text-[10px] font-bold text-gray-400">Tél 2</label><input name="telephone2" value="<?=e($c['telephone2']??'')?>" class="w-full border rounded-lg px-2 py-1.5 text-sm"></div>
                        </div>
                        <div class="grid grid-cols-2 sm:grid-cols-6 gap-2">
                            <div><label class="text-[10px] font-bold text-gray-400">Email</label><input name="email" value="<?=e($c['email']??'')?>" class="w-full border rounded-lg px-2 py-1.5 text-sm"></div>
                            <div><label class="text-[10px] font-bold text-gray-400">🪪 CIN</label><input name="cin" value="<?=e($c['cin']??'')?>" maxlength="8" pattern="[0-9]{8}" class="w-full border rounded-lg px-2 py-1.5 text-sm" placeholder="12345678"></div>
                            <div><label class="text-[10px] font-bold text-gray-400">Type</label>
                                <select name="type_client" class="w-full border rounded-lg px-2 py-1.5 text-sm">
                                    <option value="passager" <?=$c['type_client']==='passager'?'selected':''?>>Passager</option>
                                    <option value="boutique" <?=$c['type_client']==='boutique'?'selected':''?>>Boutique</option>
                                    <option value="entreprise" <?=$c['type_client']==='entreprise'?'selected':''?>>Entreprise</option>
                                </select>
                            </div>
                            <div><label class="text-[10px] font-bold text-gray-400">Entreprise</label><input name="entreprise" value="<?=e($c['entreprise']??'')?>" class="w-full border rounded-lg px-2 py-1.5 text-sm"></div>
                            <div><label class="text-[10px] font-bold text-gray-400">MF</label><input name="matricule_fiscal" value="<?=e($c['matricule_fiscal']??'')?>" class="w-full border rounded-lg px-2 py-1.5 text-sm"></div>
                            <div><label class="text-[10px] font-bold text-gray-400">Actif</label>
                                <select name="actif" class="w-full border rounded-lg px-2 py-1.5 text-sm">
                                    <option value="1" <?=$c['actif']?'selected':''?>>Oui</option>
                                    <option value="0" <?=!$c['actif']?'selected':''?>>Non</option>
                                </select>
                            </div>
                        </div>
                        <div><label class="text-[10px] font-bold text-gray-400">Adresse</label><input name="adresse" value="<?=e($c['adresse']??'')?>" class="w-full border rounded-lg px-2 py-1.5 text-sm"></div>
                        <div class="flex gap-2">
                            <button type="submit" class="bg-asel text-white px-4 py-1.5 rounded-lg text-xs font-bold"><i class="bi bi-check-circle"></i> Enregistrer</button>
                            <button type="button" onclick="document.getElementById('editRow<?=$c['id']?>').classList.add('hidden')" class="bg-gray-200 text-gray-600 px-3 py-1.5 rounded-lg text-xs font-bold">Annuler</button>
                        </div>
                    </form>
                </td>
            </tr>
        <?php endforeach; ?>
        </tbody>
    </table></div>
</div>

<script>
function filterClients(){
    var q=document.getElementById('clientSearch').value.toLowerCase();
    var rows=document.querySelectorAll('.client-row');
    var v=0;
    rows.forEach(function(r){
        var m=!q||r.dataset.search.includes(q);
        r.style.display=m?'':'none';
        if(m)v++;
    });
    document.getElementById('clientCount').textContent=q?v+'/'+rows.length:'';
}

function openAddClientModal() {
    if (typeof openModal !== 'function') {
        // Fallback: show inline form
        document.getElementById('addClientForm').classList.remove('hidden');
        document.getElementById('addClientForm').scrollIntoView({behavior:'smooth'});
        return;
    }
    openModal(
        modalHeader('bi-person-plus', 'Nouveau client', 'Ajouter un client') +
        document.getElementById('addClientForm').querySelector('form').outerHTML
    );
    // Remove the hidden class from the form inside the modal
    document.getElementById('modal').querySelector('form').style.display = '';
}

function openEditClientModal(btn) {
    var d = btn.dataset;
    if (typeof openModal !== 'function') {
        // Fallback: show inline edit row
        var row = document.getElementById('editRow' + d.id);
        if (row) row.classList.toggle('hidden');
        return;
    }
    openModal(
        modalHeader('bi-pencil-square', 'Modifier ' + d.nom, d.prenom || '') +
        '<form method="POST" class="p-5 space-y-3">' +
        '<input type="hidden" name="_csrf" value="<?=$csrf?>">' +
        '<input type="hidden" name="action" value="edit_client">' +
        '<input type="hidden" name="client_id" value="' + d.id + '">' +
        modalRow([
            modalField('Nom *', 'nom', 'text', d.nom, ''),
            modalField('Prénom', 'prenom', 'text', d.prenom, ''),
        ]) +
        modalField('Type', 'type_client', 'select', '', '', [
            {value:'passager', label:'Passager', selected: d.type==='passager'},
            {value:'boutique', label:'Client boutique', selected: d.type==='boutique'},
            {value:'entreprise', label:'Entreprise', selected: d.type==='entreprise'},
        ]) +
        modalRow([
            modalField('Téléphone', 'telephone', 'tel', d.tel, ''),
            modalField('Email', 'email', 'email', d.email, ''),
        ]) +
        modalRow([
            modalField('Entreprise', 'entreprise', 'text', d.entreprise, ''),
            modalField('Matricule fiscal', 'matricule_fiscal', 'text', d.mf, ''),
        ]) +
        modalField('Adresse', 'adresse', 'text', d.adresse, '') +
        modalField('Notes', 'notes', 'textarea', d.notes, '') +
        modalField('Actif', 'actif', 'select', '', '', [
            {value:'1', label:'Oui', selected: d.actif==='1'},
            {value:'0', label:'Non', selected: d.actif==='0'},
        ]) +
        '<div class="flex gap-3 pt-2">' +
        '<button type="button" onclick="closeModal()" class="flex-1 py-2.5 rounded-xl border-2 border-gray-200 text-gray-600 font-semibold text-sm">Annuler</button>' +
        '<button type="submit" class="flex-1 py-2.5 rounded-xl bg-asel text-white font-semibold text-sm">💾 Enregistrer</button>' +
        '</div></form>',
        {size: 'max-w-lg'}
    );
}
</script>

<?php
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
    $fac_d1 = $_GET['d1'] ?? date('Y-m-01');
    $fac_d2 = $_GET['d2'] ?? date('Y-m-d');
    $factures = query("SELECT f.*,fr.nom as fnom,c.nom as client_nom,c.prenom as client_prenom,u.nom_complet as vendeur FROM factures f JOIN franchises fr ON f.franchise_id=fr.id LEFT JOIN clients c ON f.client_id=c.id LEFT JOIN utilisateurs u ON f.utilisateur_id=u.id WHERE DATE(f.date_facture) BETWEEN ? AND ? $where_f ORDER BY f.date_facture DESC LIMIT 200", [$fac_d1, $fac_d2]);
    $total_factures = array_sum(array_column($factures, 'total_ttc'));
    $payees = array_filter($factures, fn($f) => $f['statut'] === 'payee');
    $annulees = array_filter($factures, fn($f) => $f['statut'] === 'annulee');
    $en_attente_fac = array_filter($factures, fn($f) => $f['statut'] === 'en_attente');
    $by_mode = [];
    foreach ($factures as $fac) {
        if ($fac['statut'] !== 'annulee') {
            $m = $fac['mode_paiement'] ?? 'especes';
            $by_mode[$m] = ($by_mode[$m] ?? 0) + $fac['total_ttc'];
        }
    }
?>
<div class="flex flex-wrap justify-between items-center gap-3 mb-4">
    <h1 class="text-2xl font-bold text-asel-dark flex items-center gap-2"><i class="bi bi-file-earmark-text text-asel"></i> Factures <span class="text-sm font-normal text-gray-400">(<?=count($factures)?>)</span></h1>
    <div class="flex gap-2">
        <a href="pdf.php?type=rapport_jour&date=<?=date('Y-m-d')?><?=$fid?"&fid=$fid":''?>" target="_blank" class="bg-white border-2 border-gray-200 text-gray-600 text-xs font-bold px-3 py-1.5 rounded-lg hover:border-asel hover:text-asel"><i class="bi bi-file-pdf"></i> PDF Jour</a>
        <a href="pdf.php?type=rapport_mois&mois=<?=date('Y-m')?><?=$fid?"&fid=$fid":''?>" target="_blank" class="bg-white border-2 border-gray-200 text-gray-600 text-xs font-bold px-3 py-1.5 rounded-lg hover:border-asel hover:text-asel"><i class="bi bi-file-pdf"></i> PDF Mois</a>
    </div>
</div>
<!-- Date filter -->
<div class="bg-white rounded-xl p-3 mb-3 shadow-sm">
    <form class="flex flex-wrap gap-2 items-center">
        <input type="hidden" name="page" value="factures">
        <?php if($fid): ?><input type="hidden" name="fid" value="<?=$fid?>"><?php endif; ?>
        <div class="flex gap-1 mr-1">
            <a href="?page=factures<?=$fid?"&fid=$fid":''?>&d1=<?=date('Y-m-d')?>&d2=<?=date('Y-m-d')?>" class="px-2 py-1 rounded text-xs font-medium <?=$fac_d1===date('Y-m-d')&&$fac_d2===date('Y-m-d')?'bg-asel text-white':'bg-gray-100 text-gray-600 hover:bg-gray-200'?>">Aujourd'hui</a>
            <a href="?page=factures<?=$fid?"&fid=$fid":''?>&d1=<?=date('Y-m-01')?>&d2=<?=date('Y-m-d')?>" class="px-2 py-1 rounded text-xs font-medium <?=$fac_d1===date('Y-m-01')&&$fac_d2===date('Y-m-d')?'bg-asel text-white':'bg-gray-100 text-gray-600 hover:bg-gray-200'?>">Ce mois</a>
        </div>
        <input type="date" name="d1" value="<?=$fac_d1?>" class="border-2 border-gray-200 rounded-lg px-2 py-1 text-sm">
        <span class="text-gray-400 text-xs">→</span>
        <input type="date" name="d2" value="<?=$fac_d2?>" class="border-2 border-gray-200 rounded-lg px-2 py-1 text-sm">
        <button class="bg-asel text-white px-3 py-1 rounded-lg text-sm font-semibold"><i class="bi bi-funnel"></i></button>
    </form>
</div>
<!-- KPIs -->
<div class="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
    <div class="bg-white rounded-xl p-3 shadow-sm border-l-4 border-asel">
        <div class="text-[10px] text-gray-400 uppercase font-bold">Total TTC</div>
        <div class="text-lg font-black text-asel-dark"><?=number_format($total_factures,2)?> DT</div>
        <div class="text-xs text-gray-400"><?=count($factures)?> factures</div>
    </div>
    <div class="bg-white rounded-xl p-3 shadow-sm border-l-4 border-green-500">
        <div class="text-[10px] text-gray-400 uppercase font-bold">Payées</div>
        <div class="text-lg font-black text-green-700"><?=count($payees)?></div>
    </div>
    <?php if(count($en_attente_fac)): ?>
    <div class="bg-white rounded-xl p-3 shadow-sm border-l-4 border-yellow-500">
        <div class="text-[10px] text-gray-400 uppercase font-bold">En attente</div>
        <div class="text-lg font-black text-yellow-700"><?=count($en_attente_fac)?></div>
    </div>
    <?php endif; ?>
    <div class="bg-white rounded-xl p-3 shadow-sm border-l-4 border-blue-500">
        <div class="text-[10px] text-gray-400 uppercase font-bold">Par mode</div>
        <div class="text-xs space-y-0.5 mt-1">
            <?php foreach($by_mode as $mode => $mt): ?>
            <div class="flex justify-between"><span class="text-gray-500"><?=$mode?></span><span class="font-bold"><?=number_format($mt,0)?> DT</span></div>
            <?php endforeach; ?>
        </div>
    </div>
</div>
<!-- Search -->
<div class="relative mb-3">
    <i class="bi bi-search absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"></i>
    <input type="text" id="factSearch" class="w-full pl-10 pr-4 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-asel" placeholder="Rechercher N° facture, client, franchise..." oninput="filterFact()">
</div>
<div class="bg-white rounded-xl shadow-sm overflow-hidden">
    <div class="overflow-x-auto"><table class="w-full text-sm">
        <thead class="sticky-thead"><tr class="bg-asel-dark text-white text-xs uppercase tracking-wider"><th class="px-3 py-3">N°</th><th class="px-3 py-3">Date</th><th class="px-3 py-3 hidden sm:table-cell">Franchise</th><th class="px-3 py-3">Client</th><th class="px-3 py-3">Type</th><th class="px-3 py-3 text-right">Total</th><th class="px-3 py-3">Paiement</th><th class="px-3 py-3">Statut</th><th class="px-3 py-3">Actions</th></tr></thead>
        <tbody class="divide-y"><?php foreach ($factures as $f): $type_b=['ticket'=>'bg-gray-100','facture'=>'bg-blue-100 text-blue-800','devis'=>'bg-yellow-100 text-yellow-800']; $stat_b=['payee'=>'bg-green-100 text-green-800','en_attente'=>'bg-yellow-100 text-yellow-800','annulee'=>'bg-red-100 text-red-800']; ?>
            <tr class="hover:bg-gray-50 fact-row <?=$f['statut']==='annulee'?'opacity-50':''?>" data-search="<?=e(strtolower($f['numero'].' '.($f['client_nom']??'').' '.shortF($f['fnom'])))?>">
                <td class="px-3 py-2 font-mono text-xs font-bold"><?=e($f['numero'])?></td>
                <td class="px-3 py-2 text-xs text-gray-500"><?=date('d/m H:i',strtotime($f['date_facture']))?></td>
                <td class="px-3 py-2 text-xs hidden sm:table-cell"><?=shortF($f['fnom'])?></td>
                <td class="px-3 py-2 text-sm"><?=$f['client_nom'] ? e($f['client_nom'].' '.($f['client_prenom']??'')) : '<span class="text-gray-400 text-xs">Passager</span>'?></td>
                <td class="px-3 py-2"><span class="inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium <?=$type_b[$f['type_facture']]??''?>"><?=$f['type_facture']?></span></td>
                <td class="px-3 py-2 text-right font-bold"><?=number_format($f['total_ttc'],2)?></td>
                <td class="px-3 py-2 text-xs">
                    <?php if($f['mode_paiement'] === 'echeance'): 
                        $f_echs = query("SELECT id,montant,date_echeance,statut FROM echeances WHERE facture_id=? ORDER BY date_echeance", [$f['id']]);
                        $avance = floatval($f['montant_recu'] ?? 0);
                        $nb_ech = count($f_echs);
                        $payees = count(array_filter($f_echs, fn($e)=>$e['statut']==='payee'));
                    ?>
                        <div class="space-y-0.5">
                            <?php if($avance > 0): ?>
                            <div class="text-green-600 font-semibold">💰 Avance: <?=number_format($avance,2)?> DT</div>
                            <?php endif; ?>
                            <div class="text-amber-600">📅 <?=$payees?>/<?=$nb_ech?> échéances</div>
                            <?php foreach($f_echs as $ech): 
                                $ech_color = match($ech['statut']){'payee'=>'text-green-600','en_retard'=>'text-red-600',default=>'text-gray-500'};
                                $ech_icon = match($ech['statut']){'payee'=>'✅','en_retard'=>'⚠️',default=>'⏳'};
                            ?>
                            <div class="text-[9px] <?=$ech_color?>"><?=$ech_icon?> <?=number_format($ech['montant'],2)?> DT — <?=date('d/m',strtotime($ech['date_echeance']))?></div>
                            <?php endforeach; ?>
                        </div>
                    <?php else: ?>
                        <span class="inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100">
                            <?=match($f['mode_paiement']){'especes'=>'💵 Espèces','carte'=>'💳 Carte','virement'=>'🏦 Virement','cheque'=>'📝 Chèque','mixte'=>'🔀 Mixte',default=>$f['mode_paiement']}?>
                        </span>
                    <?php endif; ?>
                </td>
                <td class="px-3 py-2"><span class="inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium <?=$stat_b[$f['statut']]??''?>"><?=$f['statut']?></span></td>
                <td class="px-3 py-2">
                    <div class="flex gap-1 items-center">
                        <a href="pdf.php?type=facture&id=<?=$f['id']?>" target="_blank" class="text-asel hover:text-asel-dark p-0.5" title="PDF"><i class="bi bi-file-pdf text-sm"></i></a>
                        <button onclick="previewReceipt(<?=$f['id']?>)" class="text-gray-400 hover:text-gray-600 p-0.5" title="Aperçu ticket"><i class="bi bi-receipt text-sm"></i></button>
                        <?php if($f['statut']==='en_attente' && can('pay_facture')): ?>
                        <form method="POST" class="inline">
                            <input type="hidden" name="_csrf" value="<?=$csrf?>">
                            <input type="hidden" name="action" value="pay_facture">
                            <input type="hidden" name="facture_id" value="<?=$f['id']?>">
                            <button type="submit" class="text-green-500 hover:text-green-700 p-0.5" title="Marquer payée"><i class="bi bi-check-circle text-sm"></i></button>
                        </form>
                        <?php endif; ?>
                        <?php if(isAdmin() && $f['statut']==='payee'): ?>
                        <form method="POST" class="inline" id="cancelFact<?=$f['id']?>"><input type="hidden" name="_csrf" value="<?=$csrf?>"><input type="hidden" name="action" value="cancel_facture"><input type="hidden" name="facture_id" value="<?=$f['id']?>">
                        <button type="button" onclick="confirmCancelFacture('cancelFact<?=$f['id']?>','<?=ejs($f['numero'])?>')" class="text-red-400 hover:text-red-600" title="Annuler"><i class="bi bi-x-circle"></i></button></form>
                        <?php endif; ?>
                    </div>
                </td>
            </tr>
        <?php endforeach; ?></tbody>
    </table></div>
</div>
<script>function filterFact(){const q=document.getElementById('factSearch').value.toLowerCase();document.querySelectorAll('.fact-row').forEach(r=>{r.style.display=(!q||r.dataset.search.includes(q))?'':'none';});}</script>

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
    $total_du = array_sum(array_column(array_filter($echeances, fn($e) => $e['statut']!=='payee'), 'montant'));
    $total_encaisse = array_sum(array_column(array_filter($echeances, fn($e) => $e['statut']==='payee'), 'montant'));
    // Next 30-day forecast
    $next30 = array_filter($echeances, fn($e) => $e['statut']==='en_attente' && strtotime($e['date_echeance']) <= strtotime('+30 days'));
    $next30_total = array_sum(array_column($next30, 'montant'));
    // Next 7 days
    $next7 = array_filter($echeances, fn($e) => $e['statut']==='en_attente' && strtotime($e['date_echeance']) <= strtotime('+7 days'));
    $next7_total = array_sum(array_column($next7, 'montant'));
?>
<div class="flex justify-between items-center mb-4">
    <h1 class="text-2xl font-bold text-asel-dark flex items-center gap-2"><i class="bi bi-credit-card text-asel"></i> Échéances <span class="text-sm font-normal text-gray-400">(<?=count($echeances)?>)</span></h1>
    <?php if(count($en_retard)): ?>
    <button onclick="bulkWhatsAppReminder()" class="bg-green-600 text-white text-xs font-bold px-3 py-2 rounded-xl hover:bg-green-700 transition-colors flex items-center gap-1">
        <i class="bi bi-whatsapp"></i> Rappel (<?=count($en_retard)?> en retard)
    </button>
    <?php endif; ?>
</div>
<!-- KPIs -->
<div class="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-4">
    <div class="bg-white rounded-xl p-3 shadow-sm border-l-4 border-red-400">
        <div class="text-[10px] text-gray-400 uppercase font-bold">Total dû</div>
        <div class="text-xl font-black text-red-600"><?=number_format($total_du,2)?> DT</div>
        <div class="text-xs text-gray-400"><?=count($en_attente)+count($en_retard)?> lots en attente</div>
    </div>
    <div class="bg-white rounded-xl p-3 shadow-sm border-l-4 border-green-500">
        <div class="text-[10px] text-gray-400 uppercase font-bold">Encaissé</div>
        <div class="text-xl font-black text-green-700"><?=number_format($total_encaisse,2)?> DT</div>
    </div>
    <div class="bg-white rounded-xl p-3 shadow-sm border-l-4 border-red-600">
        <div class="text-[10px] text-gray-400 uppercase font-bold">En retard</div>
        <div class="text-xl font-black <?=count($en_retard)?'text-red-600':'text-gray-400'?>"><?=count($en_retard)?></div>
    </div>
    <div class="bg-white rounded-xl p-3 shadow-sm border-l-4 border-orange-400">
        <div class="text-[10px] text-gray-400 uppercase font-bold">Dans 7 jours</div>
        <div class="text-xl font-black text-orange-600"><?=number_format($next7_total,2)?> DT</div>
        <div class="text-xs text-gray-400"><?=count($next7)?> lot(s)</div>
    </div>
    <div class="bg-white rounded-xl p-3 shadow-sm border-l-4 border-blue-500">
        <div class="text-[10px] text-gray-400 uppercase font-bold">Dans 30 jours</div>
        <div class="text-xl font-black text-blue-600"><?=number_format($next30_total,2)?> DT</div>
        <div class="text-xs text-gray-400"><?=count($next30)?> lot(s)</div>
    </div>
</div>

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
                    <div class="flex gap-1">
                    <form method="POST" class="inline"><input type="hidden" name="_csrf" value="<?=$csrf?>"><input type="hidden" name="action" value="pay_echeance"><input type="hidden" name="echeance_id" value="<?=$e['id']?>">
                    <button class="bg-green-500 text-white px-2 py-1 rounded text-xs font-bold">💰</button></form>
                    <?php if($e['client_tel']): ?>
                    <a href="https://wa.me/<?=preg_replace('/[^0-9]/','',$e['client_tel'])?>?text=<?=rawurlencode('Bonjour '.($e['client_nom']??'').', votre versement de '.number_format($e['montant'],2).' DT est dû le '.date('d/m/Y',strtotime($e['date_echeance'])).' — ASEL Mobile')?>" target="_blank" class="bg-green-600 text-white px-2 py-1 rounded text-xs font-bold" title="WhatsApp">
                        <i class="bi bi-whatsapp text-xs"></i>
                    </a>
                    <?php endif; ?>
                    </div>
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
<?php if ($page === 'mon_compte'):
    $login_time = $_SESSION['login_time'] ?? time();
    $session_duration = time() - $login_time;
    $session_hours = floor($session_duration / 3600);
    $session_mins = floor(($session_duration % 3600) / 60);
    // My stats today
    $mes_ventes_today = queryOne("SELECT COALESCE(SUM(prix_total),0) as ca, COUNT(*) as nb FROM ventes WHERE utilisateur_id=? AND date_vente=CURDATE()", [$user['id']]);
    $mes_ventes_mois = queryOne("SELECT COALESCE(SUM(prix_total),0) as ca, COUNT(*) as nb FROM ventes WHERE utilisateur_id=? AND MONTH(date_vente)=MONTH(CURDATE()) AND YEAR(date_vente)=YEAR(CURDATE())", [$user['id']]);
    // Pointage today
    try {
        $mon_pointage_today = query("SELECT * FROM pointages WHERE utilisateur_id=? AND DATE(heure)=? ORDER BY heure ASC", [$user['id'], date('Y-m-d')]);
    } catch(Exception $e) { $mon_pointage_today = []; }
?>
<h1 class="text-2xl font-bold text-asel-dark mb-6 flex items-center gap-2"><i class="bi bi-person-gear text-asel"></i> Mon compte</h1>

<!-- Session info -->
<div class="bg-gradient-to-r from-asel to-asel-dark rounded-xl p-4 mb-6 text-white flex flex-wrap items-center justify-between gap-3">
    <div class="flex items-center gap-3">
        <div class="w-12 h-12 bg-white/20 rounded-full flex items-center justify-center text-xl font-black"><?=mb_substr($user['nom_complet'],0,1)?></div>
        <div>
            <div class="font-bold"><?=e($user['nom_complet'])?></div>
            <div class="text-white/60 text-xs">@<?=e($user['nom_utilisateur'])?> · <?=roleBadge($user['role'])?></div>
        </div>
    </div>
    <div class="text-right text-xs text-white/50">
        <div>Session: <?=$session_hours?>h<?=str_pad($session_mins,2,'0',STR_PAD_LEFT)?></div>
        <div>Depuis <?=date('H:i', $login_time)?></div>
    </div>
</div>

<!-- My today stats -->
<div class="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
    <div class="bg-white rounded-xl p-3 shadow-sm border-l-4 border-asel">
        <div class="text-[10px] text-gray-400 font-bold uppercase">Mes ventes aujourd'hui</div>
        <div class="text-xl font-black text-asel-dark"><?=number_format($mes_ventes_today['ca'],2)?> DT</div>
        <div class="text-xs text-gray-400"><?=$mes_ventes_today['nb']?> transaction(s)</div>
    </div>
    <div class="bg-white rounded-xl p-3 shadow-sm border-l-4 border-purple-500">
        <div class="text-[10px] text-gray-400 font-bold uppercase">Mes ventes ce mois</div>
        <div class="text-xl font-black text-asel-dark"><?=number_format($mes_ventes_mois['ca'],2)?> DT</div>
        <div class="text-xs text-gray-400"><?=$mes_ventes_mois['nb']?> transaction(s)</div>
    </div>
    <?php if($mon_pointage_today): ?>
    <div class="bg-white rounded-xl p-3 shadow-sm border-l-4 border-green-500 col-span-2">
        <div class="text-[10px] text-gray-400 font-bold uppercase">Mon pointage aujourd'hui</div>
        <div class="flex gap-2 flex-wrap mt-1">
        <?php foreach($mon_pointage_today as $pt): $label=match($pt['type_pointage']){'entree'=>'Entrée','sortie'=>'Sortie','pause_debut'=>'Pause','pause_fin'=>'Retour',default=>$pt['type_pointage']}; $col=match($pt['type_pointage']){'entree'=>'bg-green-100 text-green-700','sortie'=>'bg-red-100 text-red-700','pause_debut'=>'bg-yellow-100 text-yellow-700',default=>'bg-blue-100 text-blue-700'}; ?>
        <span class="inline-flex items-center gap-1 text-xs font-bold px-2 py-1 rounded-lg <?=$col?>"><?=$label?> <?=date('H:i',strtotime($pt['heure']))?></span>
        <?php endforeach; ?>
        </div>
    </div>
    <?php endif; ?>
</div>

<div class="grid lg:grid-cols-2 gap-6">
    <!-- Infos -->
    <div class="bg-white rounded-xl shadow-sm p-6">
        <h3 class="font-bold text-asel-dark mb-4 flex items-center gap-2"><i class="bi bi-person text-asel"></i> Mes informations</h3>
        <div class="space-y-3 text-sm">
            <div class="flex justify-between py-2 border-b"><span class="text-gray-500">Nom complet</span><span class="font-semibold"><?=e($user['nom_complet'])?></span></div>
            <div class="flex justify-between py-2 border-b"><span class="text-gray-500">Identifiant</span><span class="font-mono bg-gray-100 px-2 py-0.5 rounded text-xs"><?=e($user['nom_utilisateur'])?></span></div>
            <div class="flex justify-between py-2 border-b"><span class="text-gray-500">Rôle</span><span><?=roleBadge($user['role'])?></span></div>
            <?php if($user['franchise_id']): $mf = queryOne("SELECT nom FROM franchises WHERE id=?",[$user['franchise_id']]); ?>
            <div class="flex justify-between py-2 border-b"><span class="text-gray-500">Franchise</span><span class="font-semibold"><?=shortF($mf['nom']??'')?></span></div>
            <?php endif; ?>
            <div class="flex justify-between py-2"><span class="text-gray-500">Membre depuis</span><span class="text-gray-600"><?=date('d/m/Y',strtotime($user['date_creation']))?></span></div>
        </div>
    </div>
    
    <!-- Change password -->
    <div class="bg-white rounded-xl shadow-sm p-6">
        <h3 class="font-bold text-asel-dark mb-4 flex items-center gap-2"><i class="bi bi-shield-lock text-asel"></i> Sécurité</h3>
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
    
    try {
        $audit_logs = query("SELECT * FROM audit_logs WHERE " . implode(' AND ', $where) . " ORDER BY date_creation DESC LIMIT 200", $params);
        $all_users_audit = query("SELECT DISTINCT utilisateur_id, utilisateur_nom FROM audit_logs ORDER BY utilisateur_nom");
        $all_actions_audit = query("SELECT DISTINCT action FROM audit_logs ORDER BY action");
        $audit_table_exists = true;
    } catch(Exception $e) {
        $audit_logs = []; $all_users_audit = []; $all_actions_audit = [];
        $audit_table_exists = false;
    }
?>
<div class="flex justify-between items-center mb-4">
    <h1 class="text-2xl font-bold text-asel-dark flex items-center gap-2"><i class="bi bi-journal-text text-asel"></i> Journal d'audit</h1>
    <?php if($audit_table_exists): ?>
    <span class="text-xs text-gray-400"><?=count($audit_logs)?> entrée(s)</span>
    <?php endif; ?>
</div>

<?php if(!$audit_table_exists): ?>
<div class="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-4">
    <div class="flex items-center gap-3">
        <i class="bi bi-exclamation-triangle text-amber-500 text-xl"></i>
        <div><div class="font-bold text-amber-800">Table audit_logs non trouvée</div>
        <div class="text-sm text-amber-700">Les logs d'audit sont enregistrés mais la table n'existe pas encore. <a href="setup.php" class="underline font-bold">Exécuter setup.php</a> pour la créer.</div></div>
    </div>
</div>
<?php else: ?>

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
<!-- Quick search on audit log -->
<div class="relative mb-3">
    <i class="bi bi-search absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"></i>
    <input type="text" id="auditSearch" class="w-full pl-10 pr-4 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-asel" placeholder="Rechercher utilisateur, action, cible..." oninput="filterAudit()">
</div>

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
<?php endif; // audit_table_exists ?>
<?php endif; // audit_log ?>


<!-- FRANCHISE LOCATION EDITOR (admin only) -->
<?php if ($page === 'franchise_locations' && isAdmin()):
    try { $all_franchises = query("SELECT * FROM franchises WHERE actif=1 ORDER BY type_franchise DESC, nom"); }
    catch (Exception $e) { $all_franchises = query("SELECT * FROM franchises WHERE actif=1 ORDER BY nom"); }
?>
<h1 class="text-2xl font-bold text-asel-dark mb-6 flex items-center gap-2"><i class="bi bi-geo-alt text-asel"></i> Coordonnées des franchises</h1>

<div class="bg-white rounded-xl shadow-sm overflow-hidden mb-6">
    <div class="px-4 py-3 border-b font-semibold text-sm text-asel-dark"><i class="bi bi-map text-asel"></i> Aperçu carte</div>
    <div id="locationPreviewMap" style="height:300px"></div>
</div>

<div class="grid sm:grid-cols-2 gap-4 mb-6">
    <?php foreach ($all_franchises as $f): if (($f['type_franchise'] ?? '') === 'central') continue; ?>
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
<?php foreach ($all_franchises as $f): if ($f['latitude'] && $f['longitude'] && ($f['type_franchise'] ?? '') !== 'central'): ?>
L.marker([<?=$f['latitude']?>, <?=$f['longitude']?>], {icon: aselIcon}).addTo(locMap).bindPopup('<strong><?=ejs(shortF($f["nom"]))?></strong>');
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

<!-- POINTS RESEAU & CARTE PAGE -->
<?php if ($page === 'points_reseau' && can('points_reseau')):
    $filter_type = $_GET['pt'] ?? '';
    $filter_statut = $_GET['ps'] ?? '';
    $filter_ville = $_GET['pv'] ?? '';
    
    $pw = ["1=1"]; $pp = [];
    if ($filter_type) { $pw[] = "type_point=?"; $pp[] = $filter_type; }
    if ($filter_statut) { $pw[] = "statut=?"; $pp[] = $filter_statut; }
    if ($filter_ville) { $pw[] = "ville LIKE ?"; $pp[] = "%$filter_ville%"; }
    
    try {
        $points = query("SELECT * FROM points_reseau WHERE actif=1 AND " . implode(' AND ', $pw) . " ORDER BY type_point, nom", $pp);
    } catch (Exception $e) {
        $points = [];
    }
    $points_map = array_filter($points, fn($p) => $p['latitude'] && $p['longitude']);
    
    $type_labels = ['franchise'=>'Franchise','activation'=>'Point d\'activation','recharge'=>'Point de recharge','activation_recharge'=>'Activation & Recharge'];
    $type_icons = ['franchise'=>'bi-shop','activation'=>'bi-phone','recharge'=>'bi-credit-card-2-front','activation_recharge'=>'bi-sim'];
    $type_colors = ['franchise'=>'#2AABE2','activation'=>'#10B981','recharge'=>'#F59E0B','activation_recharge'=>'#8B5CF6'];
    $statut_badges = [
        'prospect'=>'bg-gray-100 text-gray-800',
        'contact'=>'bg-blue-100 text-blue-800',
        'contrat_non_signe'=>'bg-yellow-100 text-yellow-800',
        'contrat_signe'=>'bg-indigo-100 text-indigo-800',
        'actif'=>'bg-green-100 text-green-800',
        'suspendu'=>'bg-orange-100 text-orange-800',
        'resilie'=>'bg-red-100 text-red-800',
    ];
    $statut_labels = ['prospect'=>'Prospect','contact'=>'Contacté','contrat_non_signe'=>'Contrat non signé','contrat_signe'=>'Contrat signé','actif'=>'Actif','suspendu'=>'Suspendu','resilie'=>'Résilié'];
    $gouvernorats = ['Tunis','Ariana','Ben Arous','Manouba','Nabeul','Zaghouan','Bizerte','Béja','Jendouba','Le Kef','Siliana','Sousse','Monastir','Mahdia','Sfax','Kairouan','Kasserine','Sidi Bouzid','Gabès','Médenine','Tataouine','Gafsa','Tozeur','Kébili'];
?>
<div class="flex justify-between items-center mb-6">
    <h1 class="text-2xl font-bold text-asel-dark flex items-center gap-2"><i class="bi bi-geo-alt text-asel"></i> Réseau ASEL — Points & Carte</h1>
    <span class="text-sm text-gray-400"><?=count($points)?> point(s)</span>
</div>

<!-- Map -->
<div class="bg-white rounded-2xl shadow-lg overflow-hidden mb-6">
    <div id="networkMap" style="height:400px"></div>
</div>

<!-- Legend -->
<div class="flex flex-wrap gap-3 mb-4">
    <?php foreach ($type_labels as $tk => $tl): $count = count(array_filter($points, fn($p)=>$p['type_point']===$tk)); ?>
    <div class="flex items-center gap-1.5 text-xs">
        <span class="w-3 h-3 rounded-full" style="background:<?=$type_colors[$tk]?>"></span>
        <span class="font-medium"><?=$tl?></span>
        <span class="text-gray-400">(<?=$count?>)</span>
    </div>
    <?php endforeach; ?>
</div>

<!-- Filters -->
<form class="bg-white rounded-xl shadow-sm p-4 mb-4 flex flex-wrap gap-3 items-end">
    <input type="hidden" name="page" value="points_reseau">
    <div>
        <label class="text-xs font-bold text-gray-500 block mb-1">Type</label>
        <select name="pt" class="border-2 border-gray-200 rounded-lg px-3 py-2 text-sm">
            <option value="">Tous</option>
            <?php foreach ($type_labels as $tk=>$tl): ?><option value="<?=$tk?>" <?=$filter_type===$tk?'selected':''?>><?=$tl?></option><?php endforeach; ?>
        </select>
    </div>
    <div>
        <label class="text-xs font-bold text-gray-500 block mb-1">Statut</label>
        <select name="ps" class="border-2 border-gray-200 rounded-lg px-3 py-2 text-sm">
            <option value="">Tous</option>
            <?php foreach ($statut_labels as $sk=>$sl): ?><option value="<?=$sk?>" <?=$filter_statut===$sk?'selected':''?>><?=$sl?></option><?php endforeach; ?>
        </select>
    </div>
    <div>
        <label class="text-xs font-bold text-gray-500 block mb-1">Ville</label>
        <input type="text" name="pv" value="<?=htmlspecialchars($filter_ville)?>" class="border-2 border-gray-200 rounded-lg px-3 py-2 text-sm" placeholder="Rechercher...">
    </div>
    <button class="bg-asel text-white px-4 py-2 rounded-lg text-sm font-semibold"><i class="bi bi-funnel"></i> Filtrer</button>
    <a href="?page=points_reseau" class="text-gray-400 hover:text-gray-600 text-sm px-2 py-2">Réinitialiser</a>
</form>

<?php if (can('add_point')): ?>
<!-- Add Point Form -->
<div class="form-card mb-6">
    <h3><i class="bi bi-plus-circle text-asel"></i> Ajouter un point au réseau</h3>
    <form method="POST" class="space-y-3">
        <input type="hidden" name="_csrf" value="<?=$csrf?>">
        <input type="hidden" name="action" value="add_point">
        <div class="form-row form-row-3">
            <div><label class="form-label">Nom *</label><input name="nom" class="form-input" required placeholder="Nom du point / boutique"></div>
            <div><label class="form-label">Type *</label>
                <select name="type_point" class="form-input" required>
                    <option value="activation_recharge">Activation & Recharge</option>
                    <option value="activation">Point d'activation</option>
                    <option value="recharge">Point de recharge</option>
                    <option value="franchise">Franchise</option>
                </select>
            </div>
            <div><label class="form-label">Statut</label>
                <select name="statut" class="form-input">
                    <?php foreach ($statut_labels as $sk=>$sl): ?><option value="<?=$sk?>"><?=$sl?></option><?php endforeach; ?>
                </select>
            </div>
        </div>
        <div class="form-row form-row-3">
            <div><label class="form-label">Adresse</label><input name="adresse" class="form-input" placeholder="Rue, quartier..."></div>
            <div><label class="form-label">Ville</label><input name="ville" class="form-input" placeholder="Ex: Mourouj"></div>
            <div><label class="form-label">Gouvernorat</label>
                <select name="gouvernorat" class="form-input">
                    <option value="">—</option>
                    <?php foreach ($gouvernorats as $g): ?><option value="<?=$g?>"><?=$g?></option><?php endforeach; ?>
                </select>
            </div>
        </div>
        <div class="form-row form-row-4">
            <div><label class="form-label">Téléphone</label><input name="telephone" class="form-input" placeholder="+216..."></div>
            <div><label class="form-label">Tél 2</label><input name="telephone2" class="form-input" placeholder="Optionnel"></div>
            <div><label class="form-label">Email</label><input name="email" class="form-input" type="email" placeholder="email@..."></div>
            <div><label class="form-label">Responsable</label><input name="responsable" class="form-input" placeholder="Nom"></div>
        </div>
        <div class="form-row form-row-4">
            <div><label class="form-label">Latitude</label><input name="latitude" type="number" step="0.000001" class="form-input font-mono" placeholder="36.XXXX" id="new_pt_lat"></div>
            <div><label class="form-label">Longitude</label><input name="longitude" type="number" step="0.000001" class="form-input font-mono" placeholder="10.XXXX" id="new_pt_lng"></div>
            <div><label class="form-label">Commission %</label><input name="commission_pct" type="number" step="0.1" class="form-input" placeholder="0"></div>
            <div><label class="form-label">Date contact</label><input name="date_contact" type="date" class="form-input"></div>
        </div>
        <div class="form-row form-row-2">
            <div><label class="form-label">Horaires</label><input name="horaires" class="form-input" value="Lun-Sam: 09:00-19:00"></div>
            <div class="flex items-end gap-2">
                <button type="button" onclick="getNewPointLocation()" class="bg-green-500 text-white px-4 py-2.5 rounded-lg text-xs font-bold"><i class="bi bi-crosshair"></i> Ma position</button>
                <button type="button" onclick="togglePickerMap()" class="bg-purple-500 text-white px-4 py-2.5 rounded-lg text-xs font-bold"><i class="bi bi-pin-map"></i> Choisir sur carte</button>
            </div>
        </div>
        <!-- Interactive map picker -->
        <div id="pickerMapContainer" class="hidden mt-2">
            <div class="bg-blue-50 border border-blue-200 rounded-xl p-2 mb-2">
                <div class="flex items-center justify-between">
                    <span class="text-xs text-blue-700 font-semibold"><i class="bi bi-hand-index"></i> Cliquez sur la carte pour placer le point</span>
                    <button type="button" onclick="togglePickerMap()" class="text-xs text-blue-500 hover:text-blue-700"><i class="bi bi-x-lg"></i> Fermer</button>
                </div>
                <!-- Search box for location -->
                <div class="mt-2 flex gap-2">
                    <input type="text" id="pickerSearch" class="flex-1 border-2 border-blue-200 rounded-lg px-3 py-1.5 text-sm" placeholder="🔍 Chercher une adresse, ville..." 
                        onkeypress="if(event.key==='Enter'){event.preventDefault();searchPickerLocation();}">
                    <button type="button" onclick="searchPickerLocation()" class="bg-blue-500 text-white px-3 py-1.5 rounded-lg text-xs font-bold"><i class="bi bi-search"></i></button>
                </div>
            </div>
            <div id="pickerMap" style="height:350px;border-radius:12px;overflow:hidden;border:2px solid #e5e7eb"></div>
            <div id="pickerCoords" class="text-xs text-gray-400 mt-1 text-center"></div>
        </div>
        <div><label class="form-label">Notes internes</label><textarea name="notes_internes" class="form-input" rows="2" placeholder="Notes confidentielles (visibles uniquement par l'équipe)..."></textarea></div>
        <button type="submit" class="btn-submit"><i class="bi bi-plus-circle"></i> Ajouter le point</button>
    </form>
</div>
<?php endif; ?>

<!-- Points list -->
<div class="bg-white rounded-xl shadow-sm overflow-hidden">
    <div class="overflow-x-auto"><table class="w-full text-sm">
        <thead><tr class="bg-asel-dark text-white text-xs uppercase tracking-wider">
            <th class="px-3 py-3 text-left">Point</th>
            <th class="px-3 py-3">Type</th>
            <th class="px-3 py-3">Statut</th>
            <th class="px-3 py-3 text-left hidden sm:table-cell">Ville</th>
            <th class="px-3 py-3 text-left hidden md:table-cell">Contact</th>
            <th class="px-3 py-3 hidden lg:table-cell">Notes</th>
            <?php if (can('edit_point')): ?><th class="px-3 py-3">Actions</th><?php endif; ?>
        </tr></thead>
        <tbody class="divide-y divide-gray-100">
        <?php foreach ($points as $pt): ?>
            <tr class="hover:bg-gray-50">
                <td class="px-3 py-2">
                    <div class="font-medium flex items-center gap-1.5">
                        <i class="bi <?=$type_icons[$pt['type_point']]??'bi-geo-alt'?>" style="color:<?=$type_colors[$pt['type_point']]??'#666'?>"></i>
                        <?=htmlspecialchars($pt['nom'])?>
                    </div>
                    <div class="text-xs text-gray-400"><?=$pt['responsable']?></div>
                </td>
                <td class="px-3 py-2 text-center"><span class="inline-flex px-2 py-0.5 rounded text-[10px] font-medium" style="background:<?=$type_colors[$pt['type_point']]??'#eee'?>20;color:<?=$type_colors[$pt['type_point']]??'#666'?>"><?=$type_labels[$pt['type_point']]??$pt['type_point']?></span></td>
                <td class="px-3 py-2 text-center"><span class="inline-flex px-2 py-0.5 rounded text-[10px] font-medium <?=$statut_badges[$pt['statut']]??'bg-gray-100'?>"><?=$statut_labels[$pt['statut']]??$pt['statut']?></span></td>
                <td class="px-3 py-2 text-xs text-gray-500 hidden sm:table-cell"><?=$pt['ville']?> <?=$pt['gouvernorat']?'('.$pt['gouvernorat'].')':''?></td>
                <td class="px-3 py-2 text-xs hidden md:table-cell"><?=$pt['telephone']?></td>
                <td class="px-3 py-2 text-xs text-gray-400 hidden lg:table-cell max-w-[200px] truncate" title="<?=htmlspecialchars($pt['notes_internes'])?>"><?=$pt['notes_internes']?htmlspecialchars(substr($pt['notes_internes'],0,60)).'...':'—'?></td>
                <?php if (can('edit_point')): ?>
                <td class="px-3 py-2 flex gap-1">
                    <button onclick="document.getElementById('ept<?=$pt['id']?>').classList.toggle('hidden')" class="text-asel hover:text-asel-dark" title="Modifier"><i class="bi bi-pencil"></i></button>
                    <?php if (can('delete_point')): ?>
                    <form method="POST" class="inline" onsubmit="return confirm('Désactiver ce point?')"><input type="hidden" name="_csrf" value="<?=$csrf?>"><input type="hidden" name="action" value="delete_point"><input type="hidden" name="point_id" value="<?=$pt['id']?>"><button class="text-red-400 hover:text-red-600" title="Supprimer"><i class="bi bi-trash"></i></button></form>
                    <?php endif; ?>
                </td>
                <?php endif; ?>
            </tr>
            <?php if (can('edit_point')): ?>
            <tr id="ept<?=$pt['id']?>" class="hidden bg-blue-50/50">
                <td colspan="7" class="px-4 py-3">
                    <form method="POST" class="space-y-2">
                        <input type="hidden" name="_csrf" value="<?=$csrf?>">
                        <input type="hidden" name="action" value="edit_point">
                        <input type="hidden" name="point_id" value="<?=$pt['id']?>">
                        <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
                            <div><label class="text-xs font-bold">Nom</label><input name="nom" value="<?=htmlspecialchars($pt['nom'])?>" class="w-full border rounded px-2 py-1 text-sm"></div>
                            <div><label class="text-xs font-bold">Type</label><select name="type_point" class="w-full border rounded px-2 py-1 text-sm"><?php foreach($type_labels as $tk=>$tl):?><option value="<?=$tk?>" <?=$pt['type_point']===$tk?'selected':''?>><?=$tl?></option><?php endforeach;?></select></div>
                            <div><label class="text-xs font-bold">Statut</label><select name="statut" class="w-full border rounded px-2 py-1 text-sm"><?php foreach($statut_labels as $sk=>$sl):?><option value="<?=$sk?>" <?=$pt['statut']===$sk?'selected':''?>><?=$sl?></option><?php endforeach;?></select></div>
                            <div><label class="text-xs font-bold">Actif</label><select name="actif" class="w-full border rounded px-2 py-1 text-sm"><option value="1" <?=$pt['actif']?'selected':''?>>Oui</option><option value="0" <?=!$pt['actif']?'selected':''?>>Non</option></select></div>
                        </div>
                        <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
                            <div><label class="text-xs font-bold">Adresse</label><input name="adresse" value="<?=htmlspecialchars($pt['adresse'])?>" class="w-full border rounded px-2 py-1 text-sm"></div>
                            <div><label class="text-xs font-bold">Ville</label><input name="ville" value="<?=htmlspecialchars($pt['ville']??'')?>" class="w-full border rounded px-2 py-1 text-sm"></div>
                            <div><label class="text-xs font-bold">Gouvernorat</label><select name="gouvernorat" class="w-full border rounded px-2 py-1 text-sm"><option value="">—</option><?php foreach($gouvernorats as $g):?><option value="<?=$g?>" <?=($pt['gouvernorat']??'')===$g?'selected':''?>><?=$g?></option><?php endforeach;?></select></div>
                            <div><label class="text-xs font-bold">Horaires</label><input name="horaires" value="<?=htmlspecialchars($pt['horaires']??'')?>" class="w-full border rounded px-2 py-1 text-sm"></div>
                        </div>
                        <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
                            <div><label class="text-xs font-bold">Tél</label><input name="telephone" value="<?=$pt['telephone']?>" class="w-full border rounded px-2 py-1 text-sm"></div>
                            <div><label class="text-xs font-bold">Tél 2</label><input name="telephone2" value="<?=$pt['telephone2']??''?>" class="w-full border rounded px-2 py-1 text-sm"></div>
                            <div><label class="text-xs font-bold">Email</label><input name="email" value="<?=$pt['email']??''?>" class="w-full border rounded px-2 py-1 text-sm"></div>
                            <div><label class="text-xs font-bold">Responsable</label><input name="responsable" value="<?=htmlspecialchars($pt['responsable'])?>" class="w-full border rounded px-2 py-1 text-sm"></div>
                        </div>
                        <div class="grid grid-cols-2 sm:grid-cols-5 gap-2">
                            <div><label class="text-xs font-bold">Lat</label><input name="latitude" type="number" step="0.000001" value="<?=$pt['latitude']?>" class="w-full border rounded px-2 py-1 text-sm font-mono"></div>
                            <div><label class="text-xs font-bold">Lng</label><input name="longitude" type="number" step="0.000001" value="<?=$pt['longitude']?>" class="w-full border rounded px-2 py-1 text-sm font-mono"></div>
                            <div><label class="text-xs font-bold">Comm. %</label><input name="commission_pct" type="number" step="0.1" value="<?=$pt['commission_pct']?>" class="w-full border rounded px-2 py-1 text-sm"></div>
                            <div><label class="text-xs font-bold">Date contact</label><input name="date_contact" type="date" value="<?=$pt['date_contact']?>" class="w-full border rounded px-2 py-1 text-sm"></div>
                            <div><label class="text-xs font-bold">Date contrat</label><input name="date_contrat" type="date" value="<?=$pt['date_contrat']??''?>" class="w-full border rounded px-2 py-1 text-sm"></div>
                        </div>
                        <div class="grid grid-cols-2 gap-2">
                            <div><label class="text-xs font-bold">Date activation</label><input name="date_activation" type="date" value="<?=$pt['date_activation']??''?>" class="w-full border rounded px-2 py-1 text-sm"></div>
                            <div></div>
                        </div>
                        <div><label class="text-xs font-bold">Notes internes</label><textarea name="notes_internes" class="w-full border rounded px-2 py-1 text-sm" rows="2"><?=htmlspecialchars($pt['notes_internes']??'')?></textarea></div>
                        <button class="bg-asel text-white px-4 py-1.5 rounded-lg text-sm font-bold w-full"><i class="bi bi-check-circle"></i> Enregistrer</button>
                    </form>
                </td>
            </tr>
            <?php endif; ?>
        <?php endforeach; ?>
        <?php if (empty($points)): ?>
            <tr><td colspan="7" class="px-4 py-8 text-center text-gray-400"><i class="bi bi-geo-alt text-3xl"></i><p class="mt-2">Aucun point trouvé</p></td></tr>
        <?php endif; ?>
        </tbody>
    </table></div>
</div>

<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
const nMap = L.map('networkMap').setView([36.79, 10.17], 8);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap' }).addTo(nMap);

const typeColors = <?=json_encode($type_colors)?>;
const typeLabels = <?=json_encode($type_labels)?>;
const statutLabels = <?=json_encode($statut_labels)?>;
const bounds = [];

<?php foreach ($points_map as $pt): ?>
(function(){
    const color = typeColors['<?=$pt['type_point']?>'] || '#666';
    const icon = L.divIcon({
        html: '<div style="background:'+color+';color:white;width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:11px;box-shadow:0 2px 6px rgba(0,0,0,0.3);border:2px solid white"><?=substr($type_labels[$pt['type_point']]??'?',0,1)?></div>',
        className: '', iconSize: [28, 28], iconAnchor: [14, 14]
    });
    bounds.push([<?=$pt['latitude']?>, <?=$pt['longitude']?>]);
    L.marker([<?=$pt['latitude']?>, <?=$pt['longitude']?>], {icon})
        .addTo(nMap)
        .bindPopup('<div style="font-family:Inter,sans-serif;min-width:180px"><strong style="color:#1B3A5C"><?=ejs($pt['nom'])?></strong><br><span style="font-size:11px;color:'+color+';font-weight:600">'+(typeLabels['<?=$pt['type_point']?>']||'')+'</span><br><span style="font-size:11px;color:#666"><?=ejs($pt['adresse']??'')?></span><?=$pt['telephone']?'<br><span style="font-size:11px">'.ejs($pt['telephone']).'</span>':''?><br><span style="font-size:10px;background:#f3f4f6;padding:1px 6px;border-radius:4px">'+(statutLabels['<?=$pt['statut']?>']||'<?=$pt['statut']?>')+'</span></div>');
})();
<?php endforeach; ?>

if (bounds.length > 0) nMap.fitBounds(bounds, {padding: [30, 30]});
else nMap.setView([36.79, 10.17], 7);

function getNewPointLocation() {
    if (!navigator.geolocation) { alert('Non supporté'); return; }
    navigator.geolocation.getCurrentPosition(pos => {
        document.getElementById('new_pt_lat').value = pos.coords.latitude.toFixed(6);
        document.getElementById('new_pt_lng').value = pos.coords.longitude.toFixed(6);
        // If picker map is open, move marker there
        if(pickerMapInstance && pickerMarker) {
            pickerMarker.setLatLng([pos.coords.latitude, pos.coords.longitude]);
            pickerMapInstance.setView([pos.coords.latitude, pos.coords.longitude], 15);
        }
        // Also add to main map
        L.marker([pos.coords.latitude, pos.coords.longitude], {icon: L.divIcon({
            html: '<div style="background:#10B981;color:white;width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:14px;box-shadow:0 2px 6px rgba(0,0,0,0.3);border:2px solid white">📍</div>',
            className:'', iconSize:[28,28], iconAnchor:[14,14]
        })}).addTo(nMap).bindPopup('Ma position');
        nMap.setView([pos.coords.latitude, pos.coords.longitude], 14);
    }, err => { alert('Erreur: ' + err.message); }, {enableHighAccuracy:true,timeout:15000});
}

// === INTERACTIVE MAP PICKER ===
let pickerMapInstance = null;
let pickerMarker = null;

function togglePickerMap() {
    const container = document.getElementById('pickerMapContainer');
    const isHidden = container.classList.contains('hidden');
    container.classList.toggle('hidden');
    
    if (isHidden && !pickerMapInstance) {
        // Initialize picker map
        setTimeout(() => {
            pickerMapInstance = L.map('pickerMap').setView([36.79, 10.17], 8);
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { 
                attribution: '© OpenStreetMap',
                maxZoom: 19
            }).addTo(pickerMapInstance);
            
            // Add existing points as reference
            <?php foreach ($points_map as $pt): ?>
            L.circleMarker([<?=$pt['latitude']?>, <?=$pt['longitude']?>], {
                radius: 6, fillColor: typeColors['<?=$pt['type_point']?>']||'#666', 
                color: '#fff', weight: 2, fillOpacity: 0.8
            }).addTo(pickerMapInstance).bindTooltip('<?=ejs($pt['nom'])?>');
            <?php endforeach; ?>
            
            // Draggable marker
            const pickIcon = L.divIcon({
                html: '<div style="background:#E63946;color:white;width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:18px;box-shadow:0 3px 10px rgba(0,0,0,0.4);border:3px solid white;cursor:grab">📍</div>',
                className: '', iconSize: [36, 36], iconAnchor: [18, 36]
            });
            
            // Check if we already have coords
            const existLat = parseFloat(document.getElementById('new_pt_lat').value);
            const existLng = parseFloat(document.getElementById('new_pt_lng').value);
            const startPos = (existLat && existLng) ? [existLat, existLng] : [36.79, 10.17];
            
            pickerMarker = L.marker(startPos, {icon: pickIcon, draggable: true}).addTo(pickerMapInstance);
            if (existLat && existLng) pickerMapInstance.setView(startPos, 14);
            
            // Update coords on drag
            pickerMarker.on('dragend', function(e) {
                const pos = e.target.getLatLng();
                setPickerCoords(pos.lat, pos.lng);
            });
            
            // Click on map to move marker
            pickerMapInstance.on('click', function(e) {
                pickerMarker.setLatLng(e.latlng);
                setPickerCoords(e.latlng.lat, e.latlng.lng);
            });
            
            pickerMapInstance.invalidateSize();
        }, 100);
    } else if (isHidden && pickerMapInstance) {
        // Just re-invalidate when reopening
    } else if (!isHidden && pickerMapInstance) {
        setTimeout(() => pickerMapInstance.invalidateSize(), 100);
    }
}

function setPickerCoords(lat, lng) {
    document.getElementById('new_pt_lat').value = lat.toFixed(6);
    document.getElementById('new_pt_lng').value = lng.toFixed(6);
    document.getElementById('pickerCoords').innerHTML = 
        '<span class="text-green-600 font-semibold"><i class="bi bi-check-circle-fill"></i> ' + lat.toFixed(6) + ', ' + lng.toFixed(6) + '</span>' +
        ' — <a href="https://www.google.com/maps?q='+lat+','+lng+'" target="_blank" class="text-asel hover:underline">Google Maps ↗</a>';
    
    // Reverse geocode to auto-fill address/city
    fetch('https://nominatim.openstreetmap.org/reverse?format=json&lat='+lat+'&lon='+lng+'&accept-language=fr')
        .then(r => r.json())
        .then(d => {
            if (d.address) {
                // Auto-fill ville if empty
                const villeInput = document.querySelector('input[name="ville"]');
                const adresseInput = document.querySelector('input[name="adresse"]');
                if (villeInput && !villeInput.value) {
                    villeInput.value = d.address.city || d.address.town || d.address.village || d.address.suburb || '';
                }
                if (adresseInput && !adresseInput.value) {
                    adresseInput.value = (d.display_name || '').substring(0, 250);
                }
                // Update coords display with address
                document.getElementById('pickerCoords').innerHTML = 
                    '<span class="text-green-600 font-semibold"><i class="bi bi-check-circle-fill"></i> ' + 
                    (d.display_name||'').substring(0, 80) + '</span>';
            }
        })
        .catch(() => {});
}

function searchPickerLocation() {
    const q = document.getElementById('pickerSearch').value.trim();
    if (!q || !pickerMapInstance) return;
    
    // Add Tunisia context for better results
    const searchQ = q.includes('Tunis') ? q : q + ', Tunisia';
    
    fetch('https://nominatim.openstreetmap.org/search?format=json&q=' + encodeURIComponent(searchQ) + '&limit=1&accept-language=fr')
        .then(r => r.json())
        .then(results => {
            if (results.length > 0) {
                const r = results[0];
                const lat = parseFloat(r.lat);
                const lng = parseFloat(r.lon);
                pickerMarker.setLatLng([lat, lng]);
                pickerMapInstance.setView([lat, lng], 15);
                setPickerCoords(lat, lng);
            } else {
                document.getElementById('pickerCoords').innerHTML = '<span class="text-red-500"><i class="bi bi-x-circle"></i> Aucun résultat pour "' + q + '"</span>';
            }
        })
        .catch(() => {
            document.getElementById('pickerCoords').innerHTML = '<span class="text-red-500"><i class="bi bi-x-circle"></i> Erreur de recherche</span>';
        });
}

// Also allow clicking on the main network map to pick location
nMap.on('click', function(e) {
    // Only if the add form exists
    if (document.getElementById('new_pt_lat')) {
        document.getElementById('new_pt_lat').value = e.latlng.lat.toFixed(6);
        document.getElementById('new_pt_lng').value = e.latlng.lng.toFixed(6);
        // Visual feedback
        if (window._mainMapPickMarker) nMap.removeLayer(window._mainMapPickMarker);
        window._mainMapPickMarker = L.marker(e.latlng, {icon: L.divIcon({
            html: '<div style="background:#E63946;color:white;width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:14px;box-shadow:0 2px 8px rgba(0,0,0,0.3);border:2px solid white">+</div>',
            className:'', iconSize:[28,28], iconAnchor:[14,14]
        })}).addTo(nMap).bindPopup('Nouveau point: ' + e.latlng.lat.toFixed(4) + ', ' + e.latlng.lng.toFixed(4)).openPopup();
        // Sync with picker map if open
        if (pickerMarker) pickerMarker.setLatLng(e.latlng);
    }
});
</script>
<?php endif; ?>

<!-- STOCK CENTRAL PAGE -->
<?php if ($page === 'stock_central' && can('stock_central')):
    $cid = getCentralId();
    $central_stock = query("SELECT s.*,p.nom as pnom,p.prix_vente,p.prix_achat,p.reference,p.marque,c.nom as cnom FROM stock s JOIN produits p ON s.produit_id=p.id JOIN categories c ON p.categorie_id=c.id WHERE s.franchise_id=? AND p.actif=1 ORDER BY c.nom,p.nom", [$cid]);
    $central_total_qty = array_sum(array_column($central_stock, 'quantite'));
    $central_total_val = 0;
    foreach ($central_stock as $cs) $central_total_val += $cs['quantite'] * $cs['prix_vente'];
    $recent_dispatches = query("SELECT t.*,p.nom as pnom,fd.nom as dest_nom FROM transferts t JOIN produits p ON t.produit_id=p.id JOIN franchises fd ON t.franchise_dest=fd.id WHERE t.franchise_source=? ORDER BY t.date_demande DESC LIMIT 20", [$cid]);
    $pending_central_demands = query("SELECT d.*,p.nom as pnom,f.nom as fnom,COALESCE(s.quantite,0) as stock_central FROM demandes_produits d LEFT JOIN produits p ON d.produit_id=p.id JOIN franchises f ON d.franchise_id=f.id LEFT JOIN stock s ON s.produit_id=d.produit_id AND s.franchise_id=? WHERE d.statut='en_attente' ORDER BY FIELD(d.urgence,'critique','urgent','normal'), d.date_demande ASC LIMIT 10", [$cid]);
?>

    <div class="flex justify-between items-center mb-4">
        <h1 class="text-2xl font-bold text-asel-dark flex items-center gap-2">
            <i class="bi bi-building text-asel"></i> Stock Central (Entrepôt)
            <?php if(count($pending_central_demands)): ?>
            <span class="bg-amber-100 text-amber-800 text-xs font-bold px-2 py-0.5 rounded-full"><?=count($pending_central_demands)?> demandes</span>
            <?php endif; ?>
        </h1>
        <div class="flex gap-2">
            <?php if(can('add_produit')): ?>
            <button onclick="openQuickAddProduct('stock_central')" class="bg-green-500 hover:bg-green-600 text-white text-xs font-bold px-3 py-2 rounded-xl transition-colors flex items-center gap-1"><i class="bi bi-plus-circle"></i> Nouveau produit</button>
            <?php endif; ?>
            <a href="?page=entree&fid=<?=$cid?>" class="bg-white border-2 border-asel text-asel text-xs font-bold px-3 py-2 rounded-xl hover:bg-asel hover:text-white transition-colors flex items-center gap-1"><i class="bi bi-box-arrow-in-down"></i> Entrée stock</a>
            <a href="api.php?action=export_stock&fid=<?=$cid?>" class="bg-white border-2 border-gray-200 text-gray-600 text-xs font-bold px-3 py-2 rounded-xl hover:border-asel hover:text-asel transition-colors"><i class="bi bi-download"></i> Export</a>
        </div>
    </div>
    
    <?php if($pending_central_demands): ?>
    <!-- Pending demands alert -->
    <div class="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-4">
        <div class="flex items-center gap-2 mb-2"><i class="bi bi-megaphone-fill text-amber-500"></i><span class="font-bold text-amber-800 text-sm">Demandes en attente — à dispatcher</span></div>
        <div class="grid sm:grid-cols-2 gap-2">
        <?php foreach($pending_central_demands as $pd): $urgency_col=['critique'=>'text-red-600','urgent'=>'text-amber-600','normal'=>'text-gray-500']; ?>
        <div class="flex items-center justify-between bg-white rounded-lg px-3 py-2 border border-amber-100">
            <div>
                <span class="text-sm font-semibold"><?=e($pd['pnom']?:'Produit libre')?></span>
                <span class="text-xs text-gray-400 ml-1">← <?=shortF($pd['fnom'])?></span>
                <span class="text-xs font-bold <?=$urgency_col[$pd['urgence']]??'text-gray-500'?> ml-1">[<?=$pd['urgence']?>]</span>
            </div>
            <div class="flex items-center gap-2">
                <span class="text-xs font-bold <?=$pd['stock_central']>=$pd['quantite']?'text-green-600':'text-red-500'?>"><?=$pd['stock_central']?>/<?=$pd['quantite']?></span>
                <?php if($pd['produit_id'] && $pd['stock_central']>0): ?>
                <button onclick="openQuickDispatch(<?=$pd['produit_id']?>,'<?=ejs($pd['pnom']??'')?>')" class="bg-indigo-500 text-white text-[10px] font-bold px-2 py-1 rounded-lg hover:bg-indigo-600"><i class="bi bi-truck"></i></button>
                <?php endif; ?>
            </div>
        </div>
        <?php endforeach; ?>
        </div>
    </div>
    <?php endif; ?>
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
                <thead><tr class="bg-indigo-900 text-white text-xs uppercase tracking-wider"><th class="px-3 py-3 text-left">Catégorie</th><th class="px-3 py-3 text-left">Produit</th><th class="px-3 py-3 text-left hidden sm:table-cell">Marque</th><th class="px-3 py-3 text-center">Qté</th><th class="px-3 py-3 text-right">P.V.</th><th class="px-3 py-3 text-right hidden sm:table-cell">Valeur</th><th class="px-3 py-3 text-center">Dispatch</th></tr></thead>
                <tbody class="divide-y divide-gray-100"><?php foreach ($central_stock as $s): $v=$s['quantite']*$s['prix_vente']; ?>
                    <tr class="hover:bg-gray-50 <?=$s['quantite']<=0?'bg-red-50/50':($s['quantite']<=3?'bg-amber-50/30':'')?>">
                        <td class="px-3 py-2 text-xs"><?=e($s['cnom'])?></td>
                        <td class="px-3 py-2 font-medium"><?=e($s['pnom'])?></td>
                        <td class="px-3 py-2 text-xs text-gray-400 hidden sm:table-cell"><?=e($s['marque'])?></td>
                        <td class="px-3 py-2 text-center"><span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold <?=$s['quantite']<=0?'bg-red-100 text-red-800':($s['quantite']<=3?'bg-amber-100 text-amber-800':'bg-green-100 text-green-800')?>"><?=$s['quantite']?></span></td>
                        <td class="px-3 py-2 text-right"><?=number_format($s['prix_vente'],2)?></td>
                        <td class="px-3 py-2 text-right font-medium hidden sm:table-cell"><?=number_format($v,0)?></td>
                        <td class="px-3 py-2 text-center">
                            <?php if($s['quantite']>0 && count($franchises)>0): ?>
                            <button onclick="openQuickDispatch(<?=$s['produit_id']?>,'<?=ejs($s['pnom'])?>')" 
                                class="text-indigo-500 hover:text-indigo-700 p-1 text-sm" title="Dispatcher vers une franchise">
                                <i class="bi bi-truck"></i>
                            </button>
                            <?php endif; ?>
                        </td>
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
    
<?php endif; ?>

    </div>
<div class="p-4 lg:p-6 max-w-7xl mx-auto pb-20">
<!-- ====================== FOURNISSEURS PAGE ====================== -->
<?php if ($page === 'fournisseurs' && can('fournisseurs')): 
    $all_fournisseurs = query("SELECT f.*,
        (SELECT COUNT(*) FROM produits WHERE fournisseur_id=f.id AND actif=1) as nb_produits,
        (SELECT COUNT(*) FROM bons_reception WHERE fournisseur_id=f.id) as nb_bons,
        (SELECT COALESCE(SUM(total_ttc),0) FROM bons_reception WHERE fournisseur_id=f.id) as total_achats
        FROM fournisseurs f ORDER BY f.actif DESC, f.nom");
?>
<div class="flex justify-between items-center mb-4">
    <h1 class="text-2xl font-bold text-asel-dark flex items-center gap-2"><i class="bi bi-truck text-asel"></i> Fournisseurs <span class="text-sm font-normal text-gray-400">(<?=count($all_fournisseurs)?>)</span></h1>
    <button onclick="openAddFournisseur()" class="bg-asel text-white px-4 py-2 rounded-xl text-sm font-bold"><i class="bi bi-plus-lg"></i> Ajouter</button>
</div>
<div class="bg-white rounded-xl shadow-sm overflow-hidden">
    <table class="w-full text-sm">
        <thead><tr class="bg-asel-dark text-white text-xs uppercase"><th class="px-3 py-2 text-left">Nom</th><th class="px-3 py-2">Tél.</th><th class="px-3 py-2 hidden md:table-cell">Email</th><th class="px-3 py-2 hidden lg:table-cell">Adresse</th><th class="px-3 py-2 hidden sm:table-cell">ICE</th><th class="px-3 py-2 text-center">Produits</th><th class="px-3 py-2 text-center hidden sm:table-cell">Achats</th><th class="px-3 py-2">Statut</th><th class="px-3 py-2">Act.</th></tr></thead>
        <tbody class="divide-y">
        <?php foreach($all_fournisseurs as $f): ?>
        <tr class="hover:bg-gray-50 <?=$f['actif']?'':'opacity-60'?>">
            <td class="px-3 py-2">
                <div class="font-semibold"><?=e($f['nom'])?></div>
                <?php if($f['nb_bons']>0): ?><div class="text-[10px] text-gray-400"><?=$f['nb_bons']?> bon(s) réception</div><?php endif; ?>
            </td>
            <td class="px-3 py-2 text-center text-xs"><a href="tel:<?=e($f['telephone'])?>" class="text-asel"><?=e($f['telephone'])?></a></td>
            <td class="px-3 py-2 text-center text-xs hidden md:table-cell"><?=e($f['email']??'')?></td>
            <td class="px-3 py-2 text-center text-xs hidden lg:table-cell"><?=e(mb_substr($f['adresse']??'',0,25))?></td>
            <td class="px-3 py-2 text-center text-xs font-mono hidden sm:table-cell"><?=e($f['ice'] ?? '')?></td>
            <td class="px-3 py-2 text-center">
                <?php if($f['nb_produits']>0): ?>
                <span class="inline-flex items-center gap-1 bg-asel/10 text-asel text-xs font-bold px-2 py-0.5 rounded-full"><?=$f['nb_produits']?> 🏷️</span>
                <?php else: ?><span class="text-gray-300 text-xs">—</span><?php endif; ?>
            </td>
            <td class="px-3 py-2 text-center hidden sm:table-cell">
                <?php if($f['total_achats']>0): ?><span class="text-xs font-bold text-asel-dark"><?=number_format($f['total_achats'],2)?> DT</span><?php else: ?><span class="text-gray-300 text-xs">—</span><?php endif; ?>
            </td>
            <td class="px-3 py-2 text-center"><?=$f['actif']?'<span class="bg-green-100 text-green-700 text-xs font-bold px-2 py-0.5 rounded-full">Actif</span>':'<span class="bg-red-100 text-red-600 text-xs font-bold px-2 py-0.5 rounded-full">Inactif</span>'?></td>
            <td class="px-3 py-2 text-center"><button onclick="openEditFournisseur(this)" 
    data-id="<?=$f['id']?>" data-nom="<?=e($f['nom'])?>" data-tel="<?=e($f['telephone']??'')?>"
    data-email="<?=e($f['email']??'')?>" data-adresse="<?=e($f['adresse']??'')?>" 
    data-ice="<?=e($f['ice']??'')?>" data-actif="<?=$f['actif']?>"
    class="text-asel hover:text-asel-dark p-1"><i class="bi bi-pencil"></i></button></td>
        </tr>
        <?php endforeach; ?>
        </tbody>
    </table>
</div>

<script>
function openAddFournisseur() {
    openModal(modalHeader('bi-plus-circle','Nouveau fournisseur','') +
        `<form method="post" class="p-6 space-y-3">
        <input type="hidden" name="_csrf" value="<?=$csrf?>"><input type="hidden" name="action" value="add_fournisseur">
        ${modalField('Nom *','nom','text','','Nom du fournisseur')}
        ${modalRow([modalField('Téléphone','telephone','tel','',''),modalField('Email','email','email','','')])}
        ${modalField('Adresse','adresse','text','','')}
        ${modalField('ICE / Matricule fiscal','ice','text','','')}
        <button type="submit" class="w-full py-2.5 rounded-xl bg-asel text-white font-bold text-sm">Enregistrer</button>
        </form>`, {size:'max-w-md'});
}
function openEditFournisseur(btn) {
    const d = btn.dataset;
    openModal(modalHeader('bi-pencil','Modifier fournisseur',d.nom) +
        `<form method="post" class="p-6 space-y-3">
        <input type="hidden" name="_csrf" value="<?=$csrf?>"><input type="hidden" name="action" value="edit_fournisseur"><input type="hidden" name="id" value="${d.id}">
        ${modalField('Nom *','nom','text',d.nom,'')}
        ${modalRow([modalField('Téléphone','telephone','tel',d.tel,''),modalField('Email','email','email',d.email,'')])}
        ${modalField('Adresse','adresse','text',d.adresse,'')}
        ${modalField('ICE','ice','text',d.ice,'')}
        <div><label class="text-xs font-bold text-gray-500 uppercase tracking-wider block mb-1">Statut</label>
        <select name="actif" class="w-full border-2 border-gray-200 rounded-xl px-4 py-2.5 text-sm">
            <option value="1" ${d.actif=='1'?'selected':''}>Actif</option>
            <option value="0" ${d.actif=='0'?'selected':''}>Inactif</option>
        </select></div>
        <button type="submit" class="w-full py-2.5 rounded-xl bg-asel text-white font-bold text-sm">Enregistrer</button>
        </form>`, {size:'max-w-md'});
}
</script>
<?php endif; ?>
</div>

<div class="p-4 lg:p-6 max-w-7xl mx-auto pb-20">
<!-- ====================== BONS DE RECEPTION PAGE ====================== -->
<?php if ($page === 'bons_reception' && can('bons_reception')):
    try {
        $bons = query("SELECT br.*,f.nom as fnom,fo.nom as fourn_nom,u.nom_complet as unom FROM bons_reception br JOIN franchises f ON br.franchise_id=f.id LEFT JOIN fournisseurs fo ON br.fournisseur_id=fo.id LEFT JOIN utilisateurs u ON br.utilisateur_id=u.id ORDER BY br.date_creation DESC LIMIT 100");
    } catch(Exception $e) { $bons = []; }
?>
<div class="flex justify-between items-center mb-4">
    <h1 class="text-2xl font-bold text-asel-dark flex items-center gap-2"><i class="bi bi-receipt text-asel"></i> Bons de réception <span class="text-sm font-normal text-gray-400">(<?=count($bons)?>)</span></h1>
    <button onclick="openBonReception()" class="bg-asel text-white px-4 py-2 rounded-xl text-sm font-bold"><i class="bi bi-plus-lg"></i> Nouveau bon</button>
</div>
<!-- KPIs -->
<?php
$total_bons = array_sum(array_column($bons,'total_ttc'));
$total_bons_ht = array_sum(array_column($bons,'total_ht'));
$bons_ce_mois = count(array_filter($bons, fn($b) => date('Y-m', strtotime($b['date_reception'])) === date('Y-m')));
?>
<div class="grid grid-cols-3 gap-3 mb-4">
    <div class="bg-white rounded-xl p-3 shadow-sm border-l-4 border-asel"><div class="text-[10px] text-gray-400 font-bold uppercase">Total TTC</div><div class="text-lg font-black text-asel-dark"><?=number_format($total_bons,2)?> DT</div><div class="text-xs text-gray-400">HT: <?=number_format($total_bons_ht,2)?></div></div>
    <div class="bg-white rounded-xl p-3 shadow-sm border-l-4 border-blue-500"><div class="text-[10px] text-gray-400 font-bold uppercase">Ce mois</div><div class="text-lg font-black text-asel-dark"><?=$bons_ce_mois?> bons</div></div>
    <div class="bg-white rounded-xl p-3 shadow-sm border-l-4 border-green-500"><div class="text-[10px] text-gray-400 font-bold uppercase">Total</div><div class="text-lg font-black text-asel-dark"><?=count($bons)?> bons</div></div>
</div>
<div class="bg-white rounded-xl shadow-sm overflow-hidden">
    <table class="w-full text-sm">
        <thead><tr class="bg-asel-dark text-white text-xs uppercase"><th class="px-3 py-2 text-left">N°</th><th class="px-3 py-2">Statut</th><th class="px-3 py-2">Date</th><th class="px-3 py-2 hidden sm:table-cell">Franchise</th><th class="px-3 py-2 hidden md:table-cell">Fournisseur</th><th class="px-3 py-2 text-right">TTC</th><th class="px-3 py-2 hidden sm:table-cell">Par</th><th class="px-3 py-2">Actions</th></tr></thead>
        <tbody class="divide-y">
        <?php foreach($bons as $b): 
            $is_draft = ($b['statut'] ?? 'valide') === 'brouillon';
            $statut_badge = $is_draft 
                ? '<span class="inline-flex items-center gap-1 bg-amber-100 text-amber-700 text-[10px] font-bold px-2 py-0.5 rounded-full"><i class="bi bi-pencil-square"></i> Brouillon</span>'
                : '<span class="inline-flex items-center gap-1 bg-green-100 text-green-700 text-[10px] font-bold px-2 py-0.5 rounded-full"><i class="bi bi-check-circle-fill"></i> Validé</span>';
        ?>
        <tr class="hover:bg-asel-light/20 <?=$is_draft?'bg-amber-50/30':''?>">
            <td class="px-3 py-2 font-mono font-bold text-asel text-xs"><?=e($b['numero'])?></td>
            <td class="px-3 py-2 text-center"><?=$statut_badge?></td>
            <td class="px-3 py-2 text-center text-xs"><?=date('d/m/Y', strtotime($b['date_reception']))?></td>
            <td class="px-3 py-2 text-center text-xs hidden sm:table-cell"><?=e(shortF($b['fnom']))?></td>
            <td class="px-3 py-2 text-center text-xs hidden md:table-cell"><?=e($b['fourn_nom'] ?? '—')?></td>
            <td class="px-3 py-2 text-right font-mono font-bold"><?=number_format($b['total_ttc'],2)?> <span class="text-xs text-gray-400">DT</span></td>
            <td class="px-3 py-2 text-center text-xs hidden sm:table-cell"><?=e($b['unom'] ?? '')?></td>
            <td class="px-3 py-2">
                <div class="flex gap-1">
                    <button onclick="viewBon(<?=$b['id']?>,'<?=ejs($b['numero'])?>','<?=ejs($b['fourn_nom']??'')?>','<?=ejs($b['fnom'])?>','<?=date('d/m/Y',strtotime($b['date_reception']))?>',<?=floatval($b['total_ht'])?>,<?=floatval($b['tva'])?>,<?=floatval($b['total_ttc'])?>,'<?=ejs($b['note']??'')?>')" 
                        class="text-asel hover:text-asel-dark p-1" title="Voir détails"><i class="bi bi-eye text-sm"></i></button>
                    <a href="pdf.php?type=bon_reception&id=<?=$b['id']?>" target="_blank" class="text-gray-400 hover:text-asel p-1" title="Imprimer"><i class="bi bi-printer text-sm"></i></a>
                    <?php if($is_draft): ?>
                    <button onclick="editBonReception(<?=$b['id']?>)" class="text-asel hover:text-asel-dark p-1" title="Modifier brouillon"><i class="bi bi-pencil text-sm"></i></button>
                    <form method="POST" class="inline" onsubmit="return confirm('Valider ce bon et mettre à jour le stock?')">
                        <input type="hidden" name="_csrf" value="<?=$csrf?>">
                        <input type="hidden" name="action" value="validate_bon_reception">
                        <input type="hidden" name="bon_id" value="<?=$b['id']?>">
                        <button class="text-green-500 hover:text-green-700 p-1" title="Valider & mettre à jour stock"><i class="bi bi-check-circle text-sm"></i></button>
                    </form>
                    <form method="POST" class="inline" onsubmit="return confirm('Supprimer ce brouillon?')">
                        <input type="hidden" name="_csrf" value="<?=$csrf?>">
                        <input type="hidden" name="action" value="delete_bon_reception">
                        <input type="hidden" name="bon_id" value="<?=$b['id']?>">
                        <button class="text-red-400 hover:text-red-600 p-1" title="Supprimer brouillon"><i class="bi bi-trash text-sm"></i></button>
                    </form>
                    <?php endif; ?>
                </div>
            </td>
        </tr>
        <?php endforeach; ?>
        <?php if(empty($bons)): ?><tr><td colspan="9" class="px-3 py-8 text-center text-gray-400"><i class="bi bi-inbox text-2xl block mb-2 opacity-30"></i>Aucun bon de réception</td></tr><?php endif; ?>
        </tbody>
    </table>
</div>
<script>
function viewBon(id, numero, fourn, franchise, date, ht, tva, ttc, note) {
    fetch('api.php?action=get_bon_lines&bon_id=' + id)
        .then(function(r){ return r.json(); })
        .then(function(data){
            // API returns {lignes: [...]} or [{...}] (legacy)
            var lines = Array.isArray(data) ? data : (data.lignes || []);
            var lignesHtml = '';
            if(lines && lines.length) {
                lignesHtml = lines.map(function(l){
                    return '<tr class="border-b"><td class="py-2 text-sm">' + (l.produit_nom||'Produit #'+l.produit_id) + '</td><td class="py-2 text-center text-sm">' + l.quantite + '</td><td class="py-2 text-right text-sm">' + parseFloat(l.prix_unitaire_ht||0).toFixed(2) + ' HT</td><td class="py-2 text-right text-sm font-bold">' + parseFloat(l.total_ttc||0).toFixed(2) + ' TTC</td></tr>';
                }).join('');
            } else {
                lignesHtml = '<tr><td colspan="4" class="py-4 text-center text-gray-400 text-sm">Aucune ligne</td></tr>';
            }
            openModal(
                modalHeader('bi-receipt', 'Bon ' + numero, franchise + ' — ' + date) +
                '<div class="p-5"><div class="grid grid-cols-2 gap-3 mb-4 text-sm"><div><span class="text-gray-400">Fournisseur:</span> <b>' + (fourn||'—') + '</b></div><div><span class="text-gray-400">Date:</span> <b>' + date + '</b></div></div>' +
                '<table class="w-full text-sm mb-4"><thead><tr class="bg-gray-50 text-xs uppercase"><th class="py-1.5 text-left">Produit</th><th class="py-1.5 text-center">Qté</th><th class="py-1.5 text-right">P.U. HT</th><th class="py-1.5 text-right">Total TTC</th></tr></thead><tbody>' + lignesHtml + '</tbody></table>' +
                '<div class="bg-gray-50 rounded-xl p-3 text-sm space-y-1"><div class="flex justify-between"><span class="text-gray-500">Total HT</span><span class="font-semibold">' + ht.toFixed(2) + ' DT</span></div><div class="flex justify-between"><span class="text-gray-500">TVA</span><span>' + tva.toFixed(2) + ' DT</span></div><div class="flex justify-between text-base border-t pt-2"><span class="font-bold">Total TTC</span><span class="font-black text-asel">' + ttc.toFixed(2) + ' DT</span></div></div>' +
                (note ? '<div class="mt-3 text-xs text-gray-500"><i class="bi bi-chat-square-text"></i> ' + note + '</div>' : '') +
                '</div>',
                {size: 'max-w-lg'}
            );
        })
        .catch(function(){
            openModal(modalHeader('bi-receipt', 'Bon ' + numero, franchise + ' — ' + date) +
                '<div class="p-5 text-center text-gray-400">Erreur lors du chargement des lignes</div>',
                {size:'max-w-lg'});
        });
}

function openBonReception() {
    window._brLignes = [];
    const prods = <?=json_encode(array_map(function($p) {
        $tva = floatval($p['tva_rate'] ?? 19);
        $pa_ht = floatval($p['prix_achat_ht'] ?? 0);
        $pa_ttc = floatval($p['prix_achat_ttc'] ?? $p['prix_achat'] ?? 0);
        // If HT is 0 or missing, calculate from TTC
        if ($pa_ht <= 0 && $pa_ttc > 0) $pa_ht = round($pa_ttc / (1 + $tva/100), 2);
        return ['id'=>$p['id'],'nom'=>$p['nom'],'ref'=>$p['reference']??'','cat'=>$p['cat_nom'],'marque'=>$p['marque']??'','pa_ht'=>$pa_ht,'pa_ttc'=>$pa_ttc,'pv_ttc'=>floatval($p['prix_vente_ttc']??$p['prix_vente']??0),'tva'=>$tva];
    }, $produits ?? []))?>;
    const fournList = <?=json_encode(array_map(fn($f)=>['id'=>$f['id'],'nom'=>$f['nom']], $fournisseurs ?? []))?>;
    const franchList = <?=json_encode(array_map(fn($f)=>['id'=>$f['id'],'nom'=>shortF($f['nom'])], $allFranchises ?? []))?>;
    
    // Product-fournisseur mapping: which products belong to which fournisseur
    const prodFournMap = <?php
        $pf_map = [];
        try {
            $pf_links = query("SELECT produit_id, fournisseur_id, prix_achat_ht FROM produit_fournisseurs WHERE actif=1");
            foreach ($pf_links as $link) {
                $fid_key = $link['fournisseur_id'];
                if (!isset($pf_map[$fid_key])) $pf_map[$fid_key] = [];
                $pf_map[$fid_key][] = ['pid' => $link['produit_id'], 'pa_ht' => floatval($link['prix_achat_ht'])];
            }
        } catch(Exception $e) { /* table might not exist yet */ }
        // Also add products linked via the old fournisseur_id field
        foreach ($produits ?? [] as $p) {
            if (!empty($p['fournisseur_id'])) {
                $fk = $p['fournisseur_id'];
                if (!isset($pf_map[$fk])) $pf_map[$fk] = [];
                // Check if already added
                $exists = false;
                foreach ($pf_map[$fk] as $existing) {
                    if ($existing['pid'] == $p['id']) { $exists = true; break; }
                }
                if (!$exists) {
                    $pf_map[$fk][] = ['pid' => $p['id'], 'pa_ht' => floatval($p['prix_achat_ht'] ?? 0)];
                }
            }
        }
        echo json_encode($pf_map);
    ?>;
    window.renderBR = function(){
        const lignes = window._brLignes;
        let total_ht=0, total_tva=0, total_ttc=0;
        let rows = lignes.map((l,i)=>{
            const lht = l.qty * l.prix_ht;
            const ltva = lht * l.tva_rate / 100;
            const lttc = lht + ltva;
            total_ht += lht; total_tva += ltva; total_ttc += lttc;
            return `<tr class="border-b border-gray-100 hover:bg-gray-50">
                <td class="px-3 py-2">
                    <div class="font-semibold text-sm">${l.nom}</div>
                    <div class="text-[10px] text-gray-400">${l.marque||''} · ${l.ref||''}</div>
                </td>
                <td class="px-3 py-2 text-center">
                    <input type="number" value="${l.qty}" min="1" class="w-14 border border-gray-200 rounded-lg text-center text-sm font-bold py-1" 
                        onchange="window._brLignes[${i}].qty=parseInt(this.value)||1;renderBR()">
                </td>
                <td class="px-3 py-2 text-right">
                    <input type="number" value="${l.prix_ht.toFixed(2)}" step="0.01" class="w-20 border border-gray-200 rounded-lg text-right text-sm py-1 px-2"
                        onchange="window._brLignes[${i}].prix_ht=parseFloat(this.value)||0;renderBR()">
                </td>
                <td class="px-3 py-2 text-right text-xs text-gray-500">${lttc.toFixed(2)}</td>
                <td class="px-3 py-2 text-center">
                    <button type="button" onclick="window._brLignes.splice(${i},1);renderBR()" class="text-red-400 hover:text-red-600 transition-colors"><i class="bi bi-trash text-sm"></i></button>
                </td>
            </tr>`;
        }).join('');
        
        const lignesEl = document.getElementById('brLignes');
        if(!rows) {
            lignesEl.innerHTML = '<tr><td colspan="5" class="px-3 py-8 text-center text-gray-300"><i class="bi bi-box-seam text-2xl block mb-2"></i>Ajoutez des produits ci-dessus</td></tr>';
        } else {
            lignesEl.innerHTML = rows;
        }
        document.getElementById('brTotalHT').textContent = total_ht.toFixed(2);
        document.getElementById('brTotalTVA').textContent = total_tva.toFixed(2);
        document.getElementById('brTotalTTC').textContent = total_ttc.toFixed(2);
        document.getElementById('brCount').textContent = lignes.length + ' produit' + (lignes.length>1?'s':'');
        document.getElementById('brLignesInput').value = JSON.stringify(lignes);
    }
    
    openModal(modalHeader('bi-receipt','Nouveau bon de réception','Entrée de stock avec bon') +
        `<form method="POST" class="space-y-0" onsubmit="if(!window._brLignes.length){event.preventDefault();showToast('Ajoutez au moins un produit','error');return false;}">
        <input type="hidden" name="_csrf" value="<?=$csrf?>">
        <input type="hidden" name="action" value="create_bon_reception">
        <input type="hidden" name="lignes" id="brLignesInput" value="[]">
        
        <!-- Header fields -->
        <div class="px-5 pt-4 pb-3 grid grid-cols-2 gap-3">
            <div>
                <label class="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-1">Franchise *</label>
                <select name="franchise_id" class="w-full border-2 border-gray-200 rounded-xl px-3 py-2.5 text-sm font-medium focus:border-asel outline-none">
                    ${franchList.map(f=>'<option value="'+f.id+'">'+f.nom+'</option>').join('')}
                </select>
            </div>
            <div>
                <label class="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-1">Fournisseur</label>
                <select name="fournisseur_id" id="brFournSelect" onchange="filterProductsByFournisseur()" class="w-full border-2 border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:border-asel outline-none">
                    <option value="">— Tous les produits —</option>
                    ${fournList.map(f=>'<option value="'+f.id+'">'+f.nom+'</option>').join('')}
                </select>
            </div>
        </div>
        
        <!-- Product selector -->
        <div class="mx-5 bg-gradient-to-br from-gray-50 to-blue-50/30 rounded-xl border-2 border-dashed border-gray-200 p-4">
            <div class="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <i class="bi bi-box-seam text-asel"></i> Ajouter des produits
                <span class="ml-auto bg-asel/10 text-asel font-bold px-2 py-0.5 rounded-full text-[10px]" id="brCount">0 produit</span>
            </div>
            
            <!-- Search -->
            <div class="relative mb-3">
                <i class="bi bi-search absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs"></i>
                <input id="brSearch" type="text" placeholder="Rechercher nom, référence, marque..." 
                    class="w-full pl-9 pr-4 border-2 border-gray-200 rounded-xl py-2.5 text-sm focus:border-asel outline-none bg-white"
                    oninput="filterBRProducts()" autocomplete="off">
            </div>
            
            <!-- Product + Qty + Price row -->
            <div class="flex gap-2 items-end flex-wrap">
                <div class="flex-1 min-w-[200px]">
                    <select id="brProd" class="w-full border-2 border-gray-200 rounded-xl px-3 py-2.5 text-sm bg-white focus:border-asel outline-none">
                        ${prods.map(p=>'<option value="'+p.id+'" data-pa-ht="'+p.pa_ht+'" data-pa-ttc="'+p.pa_ttc+'" data-tva="'+p.tva+'" data-ref="'+(p.ref||'')+'" data-marque="'+(p.marque||'')+'" data-search="'+(p.nom+' '+p.ref+' '+p.marque+' '+p.cat).toLowerCase()+'">'+p.nom+(p.ref?' ['+p.ref+']':'')+' — '+p.cat+'</option>').join('')}
                    </select>
                </div>
                <div class="w-20">
                    <label class="text-[10px] font-bold text-gray-400 block mb-0.5">Quantité</label>
                    <input id="brQty" type="number" value="1" min="1" class="w-full border-2 border-gray-200 rounded-xl px-2 py-2.5 text-sm text-center font-bold focus:border-asel outline-none">
                </div>
                <div class="w-28">
                    <label class="text-[10px] font-bold text-gray-400 block mb-0.5">Prix achat HT</label>
                    <input id="brPrix" type="number" step="0.01" placeholder="P.A. HT" class="w-full border-2 border-gray-200 rounded-xl px-2 py-2.5 text-sm text-right font-mono focus:border-asel outline-none">
                </div>
                <button type="button" onclick="addBRLine()" class="bg-green-500 hover:bg-green-600 text-white px-4 py-2.5 rounded-xl text-sm font-bold transition-colors flex items-center gap-1.5 shrink-0">
                    <i class="bi bi-plus-lg"></i> Ajouter
                </button>
            </div>
            
            <!-- Price info -->
            <div id="brPriceInfo" class="mt-2 text-xs text-gray-400 hidden">
                <span>HT: <b id="brInfoHT">0</b></span> · 
                <span>TVA <span id="brInfoTVA">19</span>%: <b id="brInfoTVAmt">0</b></span> · 
                <span>TTC: <b class="text-asel" id="brInfoTTC">0</b></span>
            </div>
        </div>
        
        <!-- Lines table -->
        <div class="mx-5 mt-3 bg-white rounded-xl border overflow-hidden">
            <table class="w-full text-sm">
                <thead>
                    <tr class="bg-gray-50 text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                        <th class="px-3 py-2.5 text-left">Produit</th>
                        <th class="px-3 py-2.5 text-center w-20">Qté</th>
                        <th class="px-3 py-2.5 text-right w-24">P.U. HT</th>
                        <th class="px-3 py-2.5 text-right w-20">Total TTC</th>
                        <th class="px-3 py-2.5 w-10"></th>
                    </tr>
                </thead>
                <tbody id="brLignes">
                    <tr><td colspan="5" class="px-3 py-8 text-center text-gray-300"><i class="bi bi-box-seam text-2xl block mb-2"></i>Ajoutez des produits ci-dessus</td></tr>
                </tbody>
                <tfoot>
                    <tr class="border-t-2 border-gray-200 bg-gray-50">
                        <td colspan="2" class="px-3 py-3 font-bold text-sm">Totaux</td>
                        <td class="px-3 py-3 text-right text-sm">
                            <div class="font-semibold" id="brTotalHT">0.00</div>
                            <div class="text-[10px] text-gray-400">TVA: <span id="brTotalTVA">0.00</span></div>
                        </td>
                        <td class="px-3 py-3 text-right">
                            <div class="text-lg font-black text-asel" id="brTotalTTC">0.00</div>
                            <div class="text-[10px] text-gray-400">DT TTC</div>
                        </td>
                        <td></td>
                    </tr>
                </tfoot>
            </table>
        </div>
        
        <!-- Note + Submit -->
        <div class="px-5 pt-3 pb-5 space-y-3">
            <div>
                <label class="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-1">Note / Référence BL</label>
                <input name="note" class="w-full border-2 border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:border-asel outline-none" placeholder="BL-2024-XXX ou note libre...">
            </div>
            <input type="hidden" name="save_as" id="brSaveAs" value="valide">
            <div class="grid grid-cols-2 gap-3">
                <button type="button" onclick="document.getElementById('brSaveAs').value='brouillon';this.closest('form').submit()" 
                    class="py-3 rounded-xl border-2 border-amber-400 text-amber-700 font-bold text-sm hover:bg-amber-50 transition-colors flex items-center justify-center gap-2">
                    <i class="bi bi-pencil-square"></i> Sauvegarder brouillon
                </button>
                <button type="submit" onclick="document.getElementById('brSaveAs').value='valide'" 
                    class="py-3 rounded-xl bg-asel hover:bg-asel-dark text-white font-bold text-sm transition-colors flex items-center justify-center gap-2">
                    <i class="bi bi-check-circle"></i> Valider & stock
                </button>
            </div>
        </div>
        </form>`, {size:'max-w-2xl'});
    
    // Auto-fill price on product change
    const prodSel = document.getElementById('brProd');
    const priceInput = document.getElementById('brPrix');
    const priceInfo = document.getElementById('brPriceInfo');
    
    function updatePricePreview() {
        const opt = prodSel.options[prodSel.selectedIndex];
        if(!opt) return;
        let pa_ht = parseFloat(opt.dataset.paHt) || 0;
        const tva = parseFloat(opt.dataset.tva) || 19;
        const pa_ttc = parseFloat(opt.dataset.paTtc) || 0;
        // Calculate HT from TTC if missing
        if(pa_ht <= 0 && pa_ttc > 0) pa_ht = Math.round(pa_ttc / (1 + tva/100) * 100) / 100;
        priceInput.value = pa_ht > 0 ? pa_ht.toFixed(2) : (pa_ttc > 0 ? pa_ttc.toFixed(2) : '');
        priceInput.placeholder = pa_ttc > 0 ? 'TTC: ' + pa_ttc.toFixed(2) : 'P.A. HT';
        // Show price info
        if(pa_ht > 0) {
            const tva_mt = pa_ht * tva / 100;
            document.getElementById('brInfoHT').textContent = pa_ht.toFixed(2);
            document.getElementById('brInfoTVA').textContent = tva;
            document.getElementById('brInfoTVAmt').textContent = tva_mt.toFixed(2);
            document.getElementById('brInfoTTC').textContent = (pa_ht + tva_mt).toFixed(2);
            priceInfo.classList.remove('hidden');
        } else { priceInfo.classList.add('hidden'); }
    }
    
    prodSel.addEventListener('change', updatePricePreview);
    updatePricePreview();
    
    // Product search filter
    // Track which products belong to selected fournisseur
    window._brSelectedFourn = '';
    
    window.filterProductsByFournisseur = function() {
        window._brSelectedFourn = document.getElementById('brFournSelect').value;
        filterBRProducts(); // Re-apply product filter with fournisseur constraint
    };
    
    window.filterBRProducts = function(){
        const q = document.getElementById('brSearch').value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
        const words = q.split(/\s+/).filter(Boolean);
        const fournId = window._brSelectedFourn;
        
        // Get product IDs for selected fournisseur
        let fournProdIds = null;
        if (fournId && prodFournMap[fournId]) {
            fournProdIds = new Set(prodFournMap[fournId].map(function(p){ return String(p.pid); }));
        }
        
        for(let opt of prodSel.options){
            const s = (opt.dataset.search || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'');
            const matchSearch = !q || words.every(w => s.includes(w));
            const matchFourn = !fournProdIds || fournProdIds.has(opt.value);
            const visible = matchSearch && matchFourn;
            opt.style.display = visible ? '' : 'none';
            opt.hidden = !visible;
            
            // If fournisseur selected, update the price to fournisseur-specific price
            if (visible && fournId && prodFournMap[fournId]) {
                const fournProd = prodFournMap[fournId].find(function(p){ return String(p.pid) === opt.value; });
                if (fournProd && fournProd.pa_ht > 0) {
                    opt.dataset.paHt = fournProd.pa_ht;
                    opt.dataset.paTtc = (fournProd.pa_ht * (1 + (parseFloat(opt.dataset.tva)||19)/100)).toFixed(2);
                }
            }
        }
        // Select first visible option
        for(let opt of prodSel.options){
            if(!opt.hidden){ prodSel.value = opt.value; updatePricePreview(); break; }
        }
    };
    
    window.addBRLine = function(){
        const lignes = window._brLignes;
        const opt = prodSel.options[prodSel.selectedIndex];
        if(!opt) { showToast('Sélectionnez un produit', 'error'); return; }
        const qty = parseInt(document.getElementById('brQty').value) || 1;
        const tva = parseFloat(opt.dataset.tva) || 19;
        let prix_ht = parseFloat(priceInput.value) || parseFloat(opt.dataset.paHt) || 0;
        // If HT is still 0, calculate from TTC
        if(prix_ht <= 0) {
            const pa_ttc = parseFloat(opt.dataset.paTtc) || 0;
            if(pa_ttc > 0) prix_ht = Math.round(pa_ttc / (1 + tva/100) * 100) / 100;
        }
        if(prix_ht <= 0) { showToast('Saisissez un prix d\'achat', 'warning'); priceInput.focus(); return; }
        
        // Check for duplicate — add to existing line
        const existing = lignes.findIndex(l => l.produit_id === parseInt(prodSel.value));
        if(existing >= 0) {
            lignes[existing].qty += qty;
            lignes[existing].prix_ht = prix_ht; // update price
            showToast('Quantité mise à jour: ' + lignes[existing].nom.split('[')[0].trim(), 'info');
        } else {
            lignes.push({
                produit_id: parseInt(prodSel.value), 
                nom: opt.text.split('—')[0].trim(),
                ref: opt.dataset.ref || '',
                marque: opt.dataset.marque || '',
                qty, prix_ht, tva_rate: tva
            });
            showToast('Ajouté: ' + opt.text.split('—')[0].trim(), 'success');
        }
        renderBR();
        // Reset qty and focus search for next product
        document.getElementById('brQty').value = 1;
        document.getElementById('brSearch').value = '';
        filterBRProducts();
        document.getElementById('brSearch').focus();
    };
}

function editBonReception(bonId) {
    // Fetch bon lines from API, then open the modal pre-filled
    fetch('api.php?action=get_bon_lines&bon_id=' + bonId)
        .then(r => r.json())
        .then(data => {
            if (data.error) { showToast(data.error, 'error'); return; }
            
            // Open the bon creation modal
            openBonReception();
            
            // Wait for modal to render, then pre-fill with existing data
            setTimeout(() => {
                // Set franchise
                const franchiseSelect = document.querySelector('select[name="franchise_id"]');
                if (franchiseSelect && data.franchise_id) franchiseSelect.value = data.franchise_id;
                
                // Set fournisseur
                const fournSelect = document.querySelector('select[name="fournisseur_id"]');
                if (fournSelect && data.fournisseur_id) fournSelect.value = data.fournisseur_id;
                
                // Set note
                const noteInput = document.querySelector('input[name="note"]');
                if (noteInput && data.note) noteInput.value = data.note;
                
                // Add existing lines
                window._brLignes = [];
                if (data.lignes) {
                    data.lignes.forEach(l => {
                        window._brLignes.push({
                            produit_id: l.produit_id,
                            nom: l.produit_nom || 'Produit #' + l.produit_id,
                            ref: l.reference || '',
                            marque: l.marque || '',
                            qty: l.quantite,
                            prix_ht: l.prix_unitaire_ht,
                            tva_rate: l.tva_rate || 19
                        });
                    });
                    renderBR();
                }
                
                // Change form action to update instead of create
                const actionInput = document.querySelector('input[name="action"]');
                if (actionInput) actionInput.value = 'edit_bon_reception';
                
                // Add bon_id hidden field
                const form = actionInput.closest('form');
                if (form && !form.querySelector('input[name="bon_id"]')) {
                    const hiddenId = document.createElement('input');
                    hiddenId.type = 'hidden';
                    hiddenId.name = 'bon_id';
                    hiddenId.value = bonId;
                    form.appendChild(hiddenId);
                }
                
                // Update button text
                const submitBtns = form.querySelectorAll('button[type="submit"], button[onclick*="brSaveAs"]');
                submitBtns.forEach(btn => {
                    if (btn.textContent.includes('Valider')) btn.innerHTML = '<i class="bi bi-check-circle"></i> Mettre à jour & stock';
                    if (btn.textContent.includes('brouillon')) btn.innerHTML = '<i class="bi bi-pencil-square"></i> Sauvegarder les modifications';
                });
                
                showToast('Brouillon chargé — ' + data.lignes.length + ' produit(s)', 'info');
            }, 300);
        })
        .catch(e => showToast('Erreur: ' + e.message, 'error'));
}
</script>
<?php endif; ?>
</div>

<div class="p-4 lg:p-6 max-w-7xl mx-auto pb-20">
<!-- ====================== TRESORERIE PAGE ====================== -->
<?php if ($page === 'tresorerie' && can('tresorerie')):
    $tr_fid = $fid ?: ($franchises[0]['id'] ?? 1);
    $tr_mois = $_GET['mois'] ?? date('Y-m');
    try { $mouvements_tresorerie = query("SELECT t.*,u.nom_complet as unom FROM tresorerie t LEFT JOIN utilisateurs u ON t.utilisateur_id=u.id WHERE t.franchise_id=? AND t.date_mouvement LIKE ? ORDER BY t.date_mouvement DESC, t.id DESC", [$tr_fid, "$tr_mois%"]); } catch(Exception $e) { $mouvements_tresorerie = []; }
    $total_enc = 0; $total_dec = 0;
    foreach($mouvements_tresorerie as $mt){ if($mt['type_mouvement']==='encaissement') $total_enc+=$mt['montant']; else $total_dec+=$mt['montant']; }
    $solde = $total_enc - $total_dec;
    // Ventes du mois
    $ventes_mois = queryOne("SELECT COALESCE(SUM(prix_total),0) as total FROM ventes WHERE franchise_id=? AND DATE_FORMAT(date_creation,'%Y-%m')=?", [$tr_fid, $tr_mois])['total'];
?>
<div class="flex justify-between items-center mb-4">
    <h1 class="text-2xl font-bold text-asel-dark flex items-center gap-2"><i class="bi bi-cash-stack text-asel"></i> Trésorerie</h1>
    <div class="flex gap-2">
        <a href="api.php?action=export_tresorerie&mois=<?=e($tr_mois)?><?=$tr_fid?"&fid=$tr_fid":''?>" class="bg-white border-2 border-gray-200 text-gray-600 text-xs font-bold px-3 py-2 rounded-xl hover:border-asel hover:text-asel transition-colors"><i class="bi bi-download"></i> Export CSV</a>
    </div>
    <button onclick="openModal(modalHeader('bi-plus-circle','Mouvement de trésorerie','Encaissement ou décaissement')+`<form method=post class='p-6 space-y-3'><input type=hidden name=_csrf value='<?=$csrf?>'><input type=hidden name=action value=add_tresorerie><input type=hidden name=franchise_id value=<?=$tr_fid?>><div><label class='text-xs font-bold text-gray-500'>Type *</label><select name=type_mouvement required class='w-full border-2 rounded-xl px-3 py-2 text-sm'><option value=encaissement>💰 Encaissement</option><option value=decaissement>💸 Décaissement</option></select></div><div><label class='text-xs font-bold text-gray-500'>Montant (DT) *</label><input name=montant type=number step=0.01 required class='w-full border-2 rounded-xl px-3 py-2 text-sm'></div><div><label class='text-xs font-bold text-gray-500'>Motif</label><input name=motif class='w-full border-2 rounded-xl px-3 py-2 text-sm'></div><div><label class='text-xs font-bold text-gray-500'>Référence</label><input name=reference class='w-full border-2 rounded-xl px-3 py-2 text-sm' placeholder='N° facture, etc.'></div><div><label class='text-xs font-bold text-gray-500'>Date</label><input name=date_mouvement type=date value='<?=date('Y-m-d')?>' class='w-full border-2 rounded-xl px-3 py-2 text-sm'></div><button type=submit class='w-full py-2.5 rounded-xl bg-asel text-white font-bold text-sm'>Enregistrer</button></form>`)" class="bg-asel text-white px-4 py-2 rounded-xl text-sm font-bold"><i class="bi bi-plus-lg"></i> Nouveau</button>
</div>
<!-- Franchise + mois selector -->
<form class="flex gap-2 mb-4 items-end">
    <input type=hidden name=page value=tresorerie>
    <?php if(can('view_all_franchises')): ?>
    <select name=fid class="border-2 rounded-xl px-3 py-2 text-sm"><?php foreach($allFranchises as $af): ?><option value="<?=$af['id']?>" <?=$tr_fid==$af['id']?'selected':''?>><?=e(shortF($af['nom']))?></option><?php endforeach; ?></select>
    <?php endif; ?>
    <input type=month name=mois value="<?=e($tr_mois)?>" class="border-2 rounded-xl px-3 py-2 text-sm">
    <button class="bg-asel text-white px-4 py-2 rounded-xl text-sm font-bold">Filtrer</button>
</form>
<!-- KPIs -->
<div class="grid grid-cols-3 gap-3 mb-4">
    <div class="bg-green-50 border-2 border-green-200 rounded-xl p-4 text-center"><div class="text-xs text-green-600 font-bold">Encaissements</div><div class="text-xl font-black text-green-700"><?=number_format($total_enc,2)?> <span class="text-xs">DT</span></div></div>
    <div class="bg-red-50 border-2 border-red-200 rounded-xl p-4 text-center"><div class="text-xs text-red-600 font-bold">Décaissements</div><div class="text-xl font-black text-red-700"><?=number_format($total_dec,2)?> <span class="text-xs">DT</span></div></div>
    <div class="<?=$solde>=0?'bg-blue-50 border-blue-200':'bg-red-50 border-red-200'?> border-2 rounded-xl p-4 text-center"><div class="text-xs <?=$solde>=0?'text-blue-600':'text-red-600'?> font-bold">Solde</div><div class="text-xl font-black <?=$solde>=0?'text-blue-700':'text-red-700'?>"><?=number_format($solde,2)?> <span class="text-xs">DT</span></div></div>
</div>
<div class="bg-yellow-50 border border-yellow-200 rounded-xl p-3 mb-4 text-sm"><i class="bi bi-info-circle text-yellow-600"></i> Ventes système du mois: <b><?=number_format($ventes_mois,2)?> DT</b> — Écart avec encaissements: <b class="<?=abs($total_enc-$ventes_mois)>1?'text-red-600':'text-green-600'?>"><?=number_format($total_enc - $ventes_mois,2)?> DT</b></div>
<!-- Mouvements -->
<div class="bg-white rounded-xl shadow-sm overflow-hidden">
    <table class="w-full text-sm">
        <thead><tr class="bg-asel-dark text-white text-xs uppercase"><th class="px-3 py-2 text-left">Date</th><th class="px-3 py-2">Type</th><th class="px-3 py-2 text-right">Montant</th><th class="px-3 py-2">Motif</th><th class="px-3 py-2">Réf.</th><th class="px-3 py-2">Par</th></tr></thead>
        <tbody class="divide-y">
        <?php foreach($mouvements_tresorerie as $mt): ?>
        <tr>
            <td class="px-3 py-2"><?=date('d/m/Y', strtotime($mt['date_mouvement']))?></td>
            <td class="px-3 py-2 text-center"><?=$mt['type_mouvement']==='encaissement'?'<span class="bg-green-100 text-green-700 px-2 py-0.5 rounded text-xs font-bold">💰 Encaissement</span>':'<span class="bg-red-100 text-red-700 px-2 py-0.5 rounded text-xs font-bold">💸 Décaissement</span>'?></td>
            <td class="px-3 py-2 text-right font-mono font-bold <?=$mt['type_mouvement']==='encaissement'?'text-green-600':'text-red-600'?>"><?=$mt['type_mouvement']==='decaissement'?'-':''?><?=number_format($mt['montant'],2)?> DT</td>
            <td class="px-3 py-2 text-xs"><?=e($mt['motif'])?></td>
            <td class="px-3 py-2 text-xs font-mono"><?=e($mt['reference'])?></td>
            <td class="px-3 py-2 text-xs"><?=e($mt['unom'] ?? '')?></td>
        </tr>
        <?php endforeach; ?>
        <?php if(empty($mouvements_tresorerie)): ?><tr><td colspan="6" class="px-3 py-8 text-center text-gray-400">Aucun mouvement ce mois</td></tr><?php endif; ?>
        </tbody>
    </table>
</div>
<?php endif; ?>
</div>

<div class="p-4 lg:p-6 max-w-7xl mx-auto pb-20">
<!-- ====================== FAMILLES & CATEGORIES PAGE ====================== -->
<?php if ($page === 'familles_categories' && can('familles_categories')):
    try { $all_familles = query("SELECT * FROM familles WHERE actif=1 ORDER BY nom") ?? []; } catch(Exception $e) { $all_familles = []; }
    $all_cats = query("SELECT c.*,f.nom as fnom FROM categories c LEFT JOIN familles f ON c.famille_id=f.id ORDER BY f.nom,c.nom");
    try { $all_scats = query("SELECT sc.*,c.nom as cnom FROM sous_categories sc JOIN categories c ON sc.categorie_id=c.id ORDER BY c.nom,sc.nom") ?? []; } catch(Exception $e) { $all_scats = []; }
?>
<h1 class="text-2xl font-bold text-asel-dark mb-4"><i class="bi bi-diagram-3 text-asel"></i> Familles, Catégories & Sous-catégories</h1>
<div class="grid md:grid-cols-3 gap-4">
    <!-- Familles -->
    <div class="bg-white rounded-xl shadow-sm p-4">
        <div class="flex justify-between items-center mb-3"><h2 class="font-bold text-asel-dark">Familles</h2>
        <button onclick="openModal(modalHeader('bi-plus','Nouvelle famille','')+`<form method=post class='p-6 space-y-3'><input type=hidden name=_csrf value='<?=$csrf?>'><input type=hidden name=action value=add_famille><div><label class='text-xs font-bold text-gray-500'>Nom *</label><input name=nom required class='w-full border-2 rounded-xl px-3 py-2 text-sm'></div><div><label class='text-xs font-bold text-gray-500'>Description</label><input name=description class='w-full border-2 rounded-xl px-3 py-2 text-sm'></div><button type=submit class='w-full py-2.5 rounded-xl bg-asel text-white font-bold text-sm'>Ajouter</button></form>`)" class="text-xs bg-asel text-white px-2 py-1 rounded-lg"><i class="bi bi-plus"></i></button></div>
        <div class="space-y-1">
        <?php foreach($all_familles as $fam): ?>
            <div class="flex justify-between items-center bg-asel-light/30 rounded-lg px-3 py-2 text-sm"><span class="font-semibold"><?=e($fam['nom'])?></span><span class="text-xs text-gray-400"><?=e($fam['description'] ?? '')?></span></div>
        <?php endforeach; ?>
        <?php if(empty($all_familles)): ?><p class="text-gray-400 text-xs text-center py-4">Aucune famille</p><?php endif; ?>
        </div>
    </div>
    <!-- Catégories -->
    <div class="bg-white rounded-xl shadow-sm p-4">
        <div class="flex justify-between items-center mb-3"><h2 class="font-bold text-asel-dark">Catégories</h2>
        <button onclick="openAddCategory()" class="text-xs bg-asel text-white px-2 py-1 rounded-lg"><i class="bi bi-plus"></i></button></div>
        <div class="space-y-1">
        <?php foreach($all_cats as $ac): ?>
            <div class="flex justify-between items-center bg-gray-50 rounded-lg px-3 py-2 text-sm"><span class="font-semibold"><?=e($ac['nom'])?></span><span class="text-xs text-gray-400"><?=e($ac['fnom'] ?? 'Sans famille')?></span></div>
        <?php endforeach; ?>
        </div>
    </div>
    <!-- Sous-catégories -->
    <div class="bg-white rounded-xl shadow-sm p-4">
        <div class="flex justify-between items-center mb-3"><h2 class="font-bold text-asel-dark">Sous-catégories</h2>
        <button onclick="openModal(modalHeader('bi-plus','Nouvelle sous-catégorie','')+`<form method=post class='p-6 space-y-3'><input type=hidden name=_csrf value='<?=$csrf?>'><input type=hidden name=action value=add_sous_categorie><div><label class='text-xs font-bold text-gray-500'>Catégorie *</label><select name=categorie_id required class='w-full border-2 rounded-xl px-3 py-2 text-sm'><?php foreach($categories as $c): ?><option value=<?=$c['id']?>><?=e($c['nom'])?></option><?php endforeach; ?></select></div><div><label class='text-xs font-bold text-gray-500'>Nom *</label><input name=nom required class='w-full border-2 rounded-xl px-3 py-2 text-sm'></div><button type=submit class='w-full py-2.5 rounded-xl bg-asel text-white font-bold text-sm'>Ajouter</button></form>`)" class="text-xs bg-asel text-white px-2 py-1 rounded-lg"><i class="bi bi-plus"></i></button></div>
        <div class="space-y-1">
        <?php foreach($all_scats as $sc): ?>
            <div class="flex justify-between items-center bg-gray-50 rounded-lg px-3 py-2 text-sm"><span class="font-semibold"><?=e($sc['nom'])?></span><span class="text-xs text-gray-400"><?=e($sc['cnom'])?></span></div>
        <?php endforeach; ?>
        <?php if(empty($all_scats)): ?><p class="text-gray-400 text-xs text-center py-4">Aucune sous-catégorie</p><?php endif; ?>
        </div>
    </div>
</div>
<?php endif; ?>
</div>

<!-- ====================== IMPORT PHONES (admin only) ====================== -->
<?php if ($page === '__import_phones__'):
    $excel_phones = [
        ['Evertek E28', 'Evertek', 52.52, 62.50, 57.98, 69.00],
        ['Geniphone A2mini', 'Geniphone', 31.85, 37.90, 37.82, 45.00],
        ['Logicom P197E', 'Logicom', 31.51, 37.50, 37.82, 45.00],
        ['Nokia 105 2024', 'Nokia', 45.71, 54.40, 54.62, 65.00],
        ['Honor X5C 4/64', 'Honor', 273.95, 326.00, 302.52, 360.00],
        ['Honor X6C 6/128', 'Honor', 353.78, 421.00, 415.97, 495.00],
        ['Honor X5C Plus 4/128', 'Honor', 300.00, 357.00, 390.76, 465.00],
        ['Realme C61 8/256', 'Realme', 433.61, 516.00, 478.99, 570.00],
        ['Realme Note 60X 3/64', 'Realme', 236.97, 282.00, 268.91, 320.00],
        ['Xiaomi Redmi 13 6/128', 'Xiaomi', 394.96, 470.00, 436.97, 520.00],
        ['Xiaomi Redmi 15C 4/128', 'Xiaomi', 339.50, 404.00, 373.95, 445.00],
        ['Xiaomi Redmi 15C 6/128', 'Xiaomi', 370.59, 441.00, 415.97, 495.00],
        ['Xiaomi Redmi A5 3/64', 'Xiaomi', 228.57, 272.00, 294.12, 350.00],
        ['Samsung A04 3/32', 'Samsung', 346.22, 412.00, 382.35, 455.00],
        ['Samsung A04 S 4/128', 'Samsung', 416.30, 495.40, 457.98, 545.00],
        ['Samsung A07 4/64', 'Samsung', 298.32, 355.00, 335.29, 399.00],
        ['Samsung Galaxy A14 4/128', 'Samsung', 409.24, 487.00, 453.78, 540.00],
        ['Vivo Y04 4/64', 'Vivo', 263.87, 314.00, 319.33, 380.00],
    ];
    
    $cat_row = queryOne("SELECT id FROM categories WHERE nom LIKE '%phone%' OR nom LIKE '%Télé%' LIMIT 1");
    if (!$cat_row) { execute("INSERT IGNORE INTO categories (nom) VALUES ('Téléphones')"); $cat_id = db()->lastInsertId(); }
    else { $cat_id = $cat_row['id']; }
    
    $fourn_row = queryOne("SELECT id FROM fournisseurs WHERE nom LIKE '%Actelo%' LIMIT 1");
    if (!$fourn_row) { execute("INSERT INTO fournisseurs (nom, adresse) VALUES ('Actelo', 'Tunisie')"); $fourn_id = db()->lastInsertId(); }
    else { $fourn_id = $fourn_row['id']; }
    
    $all_fids = array_column(query("SELECT id FROM franchises WHERE actif=1"), 'id');
    $existing_prods = query("SELECT id, LOWER(nom) as nom_l, LOWER(COALESCE(marque,'')) as marque_l FROM produits");
    
    $results = [];
    $added = 0; $updated = 0; $skipped = 0;
    
    foreach ($excel_phones as $phone) {
        [$nom, $marque, $pa_ht, $pa_ttc, $pv_ht, $pv_ttc] = $phone;
        $nom_l = mb_strtolower(trim($nom));
        $marque_l = mb_strtolower(trim($marque));
        
        $found_id = null;
        foreach ($existing_prods as $ex) {
            if ($ex['nom_l'] === $nom_l) { $found_id = $ex['id']; break; }
            if (mb_strlen($nom_l) >= 5 && (mb_strpos($ex['nom_l'], $nom_l) !== false || mb_strpos($nom_l, $ex['nom_l']) !== false)) { $found_id = $ex['id']; break; }
            if ($marque_l === $ex['marque_l'] && $marque_l) {
                $skip_words = [$marque_l,'4','3','6','8','32','64','128','256','black','white','blue','green','red','gold','cyan','cooper','silver','violet'];
                $nom_words = array_filter(preg_split('/[\s\/\-]+/', $nom_l), fn($w) => mb_strlen($w) >= 2 && !in_array($w, $skip_words));
                $ex_words = array_filter(preg_split('/[\s\/\-]+/', $ex['nom_l']), fn($w) => mb_strlen($w) >= 2 && !in_array($w, $skip_words));
                $matches = 0;
                foreach ($nom_words as $w) { foreach ($ex_words as $ew) { if ($w === $ew || mb_strpos($ew, $w) !== false || mb_strpos($w, $ew) !== false) { $matches++; break; } } }
                if ($matches >= max(1, min(count($nom_words), count($ex_words))) && count($nom_words) > 0) { $found_id = $ex['id']; break; }
            }
        }
        
        if ($found_id) {
            $cur = queryOne("SELECT prix_achat_ttc, prix_vente_ttc FROM produits WHERE id=?", [$found_id]);
            if ($cur && (abs(($cur['prix_achat_ttc'] ?? 0) - $pa_ttc) > 1 || abs(($cur['prix_vente_ttc'] ?? 0) - $pv_ttc) > 1)) {
                execute("UPDATE produits SET prix_achat=?, prix_vente=?, prix_achat_ht=?, prix_achat_ttc=?, prix_vente_ht=?, prix_vente_ttc=?, fournisseur_id=? WHERE id=?",
                    [$pa_ttc, $pv_ttc, $pa_ht, $pa_ttc, $pv_ht, $pv_ttc, $fourn_id, $found_id]);
                $results[] = ['nom'=>$nom,'marque'=>$marque,'pa'=>$pa_ttc,'pv'=>$pv_ttc,'status'=>'updated','id'=>$found_id];
                $updated++;
            } else {
                $results[] = ['nom'=>$nom,'marque'=>$marque,'pa'=>$pa_ttc,'pv'=>$pv_ttc,'status'=>'skip','id'=>$found_id];
                $skipped++;
            }
        } else {
            execute("INSERT INTO produits (nom, categorie_id, prix_achat, prix_vente, prix_achat_ht, prix_achat_ttc, prix_vente_ht, prix_vente_ttc, tva_rate, marque, fournisseur_id, seuil_alerte) VALUES (?,?,?,?,?,?,?,?,19,?,?,1)",
                [$nom, $cat_id, $pa_ttc, $pv_ttc, $pa_ht, $pa_ttc, $pv_ht, $pv_ttc, $marque, $fourn_id]);
            $new_id = db()->lastInsertId();
            foreach ($all_fids as $fid_s) execute("INSERT IGNORE INTO stock (franchise_id, produit_id, quantite) VALUES (?,?,0)", [$fid_s, $new_id]);
            $existing_prods[] = ['id'=>$new_id, 'nom_l'=>$nom_l, 'marque_l'=>$marque_l];
            $results[] = ['nom'=>$nom,'marque'=>$marque,'pa'=>$pa_ttc,'pv'=>$pv_ttc,'status'=>'added','id'=>$new_id];
            $added++;
        }
    }
?>
<h1 class="text-2xl font-bold text-asel-dark mb-6 flex items-center gap-2"><i class="bi bi-phone text-asel"></i> Import Smartphones — Résultat</h1>

<!-- KPIs -->
<div class="grid grid-cols-3 gap-3 mb-6">
    <div class="bg-green-50 border-2 border-green-200 rounded-xl p-4 text-center">
        <div class="text-3xl font-black text-green-600"><?=$added?></div>
        <div class="text-xs font-bold text-green-700">Créés</div>
    </div>
    <div class="bg-amber-50 border-2 border-amber-200 rounded-xl p-4 text-center">
        <div class="text-3xl font-black text-amber-600"><?=$updated?></div>
        <div class="text-xs font-bold text-amber-700">Prix mis à jour</div>
    </div>
    <div class="bg-gray-50 border-2 border-gray-200 rounded-xl p-4 text-center">
        <div class="text-3xl font-black text-gray-500"><?=$skipped?></div>
        <div class="text-xs font-bold text-gray-600">Déjà existants</div>
    </div>
</div>

<div class="bg-white rounded-xl shadow-sm overflow-hidden">
    <table class="w-full text-sm">
        <thead><tr class="bg-asel-dark text-white text-xs uppercase"><th class="px-4 py-3 text-left">#</th><th class="px-4 py-3 text-left">Produit</th><th class="px-4 py-3">Marque</th><th class="px-4 py-3 text-right">PA TTC</th><th class="px-4 py-3 text-right">PV TTC</th><th class="px-4 py-3 text-center">Statut</th></tr></thead>
        <tbody class="divide-y">
        <?php foreach ($results as $i => $r):
            $bg = match($r['status']) { 'added'=>'bg-green-50', 'updated'=>'bg-amber-50', default=>'bg-gray-50/50' };
            $badge = match($r['status']) { 'added'=>'<span class="bg-green-100 text-green-700 text-xs font-bold px-2 py-1 rounded-full">✅ Créé #'.$r['id'].'</span>', 'updated'=>'<span class="bg-amber-100 text-amber-700 text-xs font-bold px-2 py-1 rounded-full">📝 MAJ #'.$r['id'].'</span>', default=>'<span class="bg-gray-100 text-gray-500 text-xs font-bold px-2 py-1 rounded-full">⏭️ Existe #'.$r['id'].'</span>' };
        ?>
        <tr class="<?=$bg?>">
            <td class="px-4 py-3 text-xs text-gray-400"><?=$i+1?></td>
            <td class="px-4 py-3 font-semibold"><?=e($r['nom'])?></td>
            <td class="px-4 py-3 text-center text-xs"><?=e($r['marque'])?></td>
            <td class="px-4 py-3 text-right font-mono"><?=number_format($r['pa'],2)?></td>
            <td class="px-4 py-3 text-right font-mono font-bold"><?=number_format($r['pv'],2)?></td>
            <td class="px-4 py-3 text-center"><?=$badge?></td>
        </tr>
        <?php endforeach; ?>
        </tbody>
    </table>
</div>

<?php if ($added > 0): ?>
<div class="mt-6 bg-green-50 border-2 border-green-200 rounded-xl p-5 flex items-center gap-4">
    <i class="bi bi-check-circle-fill text-green-500 text-3xl"></i>
    <div>
        <div class="font-bold text-green-800 text-lg"><?=$added?> produit(s) créé(s) avec stock = 0</div>
        <div class="text-sm text-green-700">Allez dans <b>Entrée stock</b> ou <b>Bons de réception</b> pour ajouter les quantités pour Soukra.</div>
    </div>
    <a href="?page=entree" class="ml-auto bg-green-600 text-white font-bold px-5 py-2.5 rounded-xl text-sm hover:bg-green-700 transition-colors shrink-0"><i class="bi bi-box-arrow-in-down"></i> Entrée stock</a>
</div>
<?php endif; ?>

<div class="mt-4 flex gap-3">
    <a href="?page=produits" class="bg-white border-2 border-asel text-asel font-bold px-4 py-2 rounded-xl text-sm hover:bg-asel hover:text-white transition-colors"><i class="bi bi-tags"></i> Voir les produits</a>
    <a href="?page=dashboard" class="bg-white border-2 border-gray-200 text-gray-600 font-bold px-4 py-2 rounded-xl text-sm hover:border-asel hover:text-asel transition-colors"><i class="bi bi-house"></i> Dashboard</a>
</div>

<?php endif; ?>

<!-- ====================== ADD INVOICE PRODUCTS ====================== -->
<?php if ($page === '__add_invoice_products__'):
    $fourn = queryOne("SELECT id FROM fournisseurs WHERE nom LIKE '%Infogenie%' OR nom LIKE '%infogenie%' LIMIT 1");
    if (!$fourn) { execute("INSERT INTO fournisseurs (nom, telephone, adresse) VALUES ('Infogenie', '+216 53 193 192', 'Galerie Soula Parc Lafayette, Tunis')"); $fourn_id = db()->lastInsertId(); }
    else { $fourn_id = $fourn['id']; }
    
    $cat_row = queryOne("SELECT id FROM categories WHERE nom LIKE '%phone%' OR nom LIKE '%Télé%' LIMIT 1");
    $cat_id = $cat_row ? $cat_row['id'] : 1;
    $all_fids = array_column(query("SELECT id FROM franchises WHERE actif=1"), 'id');
    
    $products = [
        ['Tecno Lion AL', 'Tecno', 36.975, 19],
        ['Lava Power 1L', 'Lava', 47.899, 19],
        ['Lava A1 Vibe', 'Lava', 27.731, 19],
        ['iPro A1', 'iPro', 27.731, 19],
        ['Nokia A6', 'Nokia', 40.00, 19],
        ['Centre Fone A1 Plus', 'Centre Fone', 27.731, 19],
        ['Tablette Infinix 8/256', 'Infinix', 397.196, 7],
        ['Vivo Y21D 8/256', 'Vivo', 420.168, 19],
        ['Alcatel A31 Pro NC', 'Alcatel', 222.689, 19],
        ['Itel A50', 'Itel', 201.681, 19],
        ['Itel A50C 64G', 'Itel', 201.681, 19],
    ];
    
    $results = []; $added = 0; $skipped = 0;
    foreach ($products as $p) {
        [$nom, $marque, $pa_ht, $tva] = $p;
        $pa_ttc = round($pa_ht * (1 + $tva/100), 2);
        $pv_ht = round($pa_ht * 1.15, 2);
        $pv_ttc = round($pv_ht * (1 + $tva/100), 2);
        
        $existing = queryOne("SELECT id FROM produits WHERE LOWER(nom) LIKE ?", ['%'.strtolower($nom).'%']);
        if ($existing) {
            $results[] = ['nom'=>$nom,'marque'=>$marque,'pa_ttc'=>$pa_ttc,'pv_ttc'=>$pv_ttc,'status'=>'skip','id'=>$existing['id']];
            $skipped++;
        } else {
            execute("INSERT INTO produits (nom, categorie_id, prix_achat, prix_vente, prix_achat_ht, prix_achat_ttc, prix_vente_ht, prix_vente_ttc, tva_rate, marque, fournisseur_id, seuil_alerte) VALUES (?,?,?,?,?,?,?,?,?,?,?,1)",
                [$nom, $cat_id, $pa_ttc, $pv_ttc, $pa_ht, $pa_ttc, $pv_ht, $pv_ttc, $tva, $marque, $fourn_id]);
            $new_id = db()->lastInsertId();
            foreach ($all_fids as $fid_s) execute("INSERT IGNORE INTO stock (franchise_id, produit_id, quantite) VALUES (?,?,0)", [$fid_s, $new_id]);
            $results[] = ['nom'=>$nom,'marque'=>$marque,'pa_ttc'=>$pa_ttc,'pv_ttc'=>$pv_ttc,'status'=>'added','id'=>$new_id];
            $added++;
        }
    }
?>
<h1 class="text-2xl font-bold text-asel-dark mb-4"><i class="bi bi-phone text-asel"></i> Import Factures Infogenie</h1>
<div class="grid grid-cols-3 gap-3 mb-4">
    <div class="bg-green-50 border-2 border-green-200 rounded-xl p-4 text-center"><div class="text-3xl font-black text-green-600"><?=$added?></div><div class="text-xs font-bold text-green-700">Créés</div></div>
    <div class="bg-gray-50 border-2 border-gray-200 rounded-xl p-4 text-center"><div class="text-3xl font-black text-gray-500"><?=$skipped?></div><div class="text-xs font-bold text-gray-600">Existants</div></div>
    <div class="bg-asel/10 border-2 border-asel/30 rounded-xl p-4 text-center"><div class="text-3xl font-black text-asel"><?=count($products)?></div><div class="text-xs font-bold text-asel-dark">Total</div></div>
</div>
<div class="bg-white rounded-xl shadow-sm overflow-hidden">
    <table class="w-full text-sm">
        <thead><tr class="bg-asel-dark text-white text-xs uppercase"><th class="px-4 py-3 text-left">Produit</th><th class="px-4 py-3">Marque</th><th class="px-4 py-3 text-right">PA TTC</th><th class="px-4 py-3 text-right">PV TTC</th><th class="px-4 py-3 text-center">Statut</th></tr></thead>
        <tbody class="divide-y">
        <?php foreach ($results as $r):
            $bg = $r['status']==='added' ? 'bg-green-50' : 'bg-gray-50/50';
            $badge = $r['status']==='added' 
                ? '<span class="bg-green-100 text-green-700 text-xs font-bold px-2 py-1 rounded-full">✅ Créé #'.$r['id'].'</span>'
                : '<span class="bg-gray-100 text-gray-500 text-xs font-bold px-2 py-1 rounded-full">⏭️ Existe #'.$r['id'].'</span>';
        ?>
        <tr class="<?=$bg?>">
            <td class="px-4 py-3 font-semibold"><?=e($r['nom'])?></td>
            <td class="px-4 py-3 text-center text-xs"><?=e($r['marque'])?></td>
            <td class="px-4 py-3 text-right font-mono"><?=number_format($r['pa_ttc'],2)?></td>
            <td class="px-4 py-3 text-right font-mono font-bold"><?=number_format($r['pv_ttc'],2)?></td>
            <td class="px-4 py-3 text-center"><?=$badge?></td>
        </tr>
        <?php endforeach; ?>
        </tbody>
    </table>
</div>
<div class="mt-4 flex gap-3">
    <a href="?page=bons_reception" class="bg-asel text-white font-bold px-5 py-2.5 rounded-xl text-sm"><i class="bi bi-receipt"></i> Créer bon de réception</a>
    <a href="?page=produits" class="bg-white border-2 border-asel text-asel font-bold px-4 py-2 rounded-xl text-sm"><i class="bi bi-tags"></i> Produits</a>
</div>
<?php endif; ?>

<!-- ====================== POINTAGE PAGE ====================== -->
<?php if ($page === 'pointage' && can('pointage')):
    $pt_fid = $fid ?: currentFranchise();
    $today = date('Y-m-d');
    $pt_date = $_GET['date'] ?? $today;
    $pt_user_filter = intval($_GET['uid'] ?? 0);
    
    // Last pointage for current user today
    try { $mon_dernier = queryOne("SELECT * FROM pointages WHERE utilisateur_id=? AND DATE(heure)=? ORDER BY heure DESC LIMIT 1", [$user['id'], date('Y-m-d')]); } catch(Exception $e) { $mon_dernier = null; }
    $mon_prochain = match($mon_dernier['type_pointage'] ?? '') {
        'entree', 'pause_fin' => 'sortie',
        'sortie' => 'entree',
        'pause_debut' => 'pause_fin',
        default => 'entree',
    };
    
    // My pointages today (timeline for current user)
    try {
        $mes_pointages_today = query("SELECT * FROM pointages WHERE utilisateur_id=? AND DATE(heure)=? ORDER BY heure ASC", [$user['id'], date('Y-m-d')]);
    } catch(Exception $e) { $mes_pointages_today = []; }
    // My hours worked today
    $mes_entrees = []; $mes_sorties = [];
    foreach($mes_pointages_today as $mp) {
        if($mp['type_pointage'] === 'entree') $mes_entrees[] = strtotime($mp['heure']);
        if($mp['type_pointage'] === 'sortie') $mes_sorties[] = strtotime($mp['heure']);
    }
    $mes_pairs = min(count($mes_entrees), count($mes_sorties));
    $mes_total_min = 0;
    for($i=0;$i<$mes_pairs;$i++) $mes_total_min += round(($mes_sorties[$i]-$mes_entrees[$i])/60);
    // If clocked in and no sortie yet, count from last entree to now
    if(count($mes_entrees) > count($mes_sorties)) $mes_total_min += round((time()-end($mes_entrees))/60);
    $mes_h = floor($mes_total_min/60); $mes_m = $mes_total_min % 60;
    
    // All pointages for the selected day (admin view)
    $pt_where = "DATE(p.heure)=?";
    $pt_params = [$pt_date];
    if($pt_fid && can('view_all_franchises')) { $pt_where .= " AND p.franchise_id=?"; $pt_params[] = $pt_fid; }
    elseif(!can('view_all_franchises')) { $pt_where .= " AND p.utilisateur_id=?"; $pt_params[] = $user['id']; }
    if($pt_user_filter) { $pt_where .= " AND p.utilisateur_id=?"; $pt_params[] = $pt_user_filter; }
    
    try {
        $pointages_list = query("SELECT p.*,u.nom_complet,u.role,f.nom as fnom FROM pointages p JOIN utilisateurs u ON p.utilisateur_id=u.id LEFT JOIN franchises f ON p.franchise_id=f.id WHERE $pt_where ORDER BY p.heure ASC", $pt_params);
    } catch(Exception $e) { $pointages_list = []; }
    
    // Compute hours worked per employee for the selected day
    $heures_par_employe = [];
    foreach ($pointages_list as $pt) {
        $uid = $pt['utilisateur_id'];
        if (!isset($heures_par_employe[$uid])) {
            $heures_par_employe[$uid] = ['nom'=>$pt['nom_complet'],'role'=>$pt['role'],'franchise'=>$pt['fnom']??'','entrees'=>[],'sorties'=>[],'pauses'=>[],'total_min'=>0,'pointages'=>[]];
        }
        $heures_par_employe[$uid]['pointages'][] = $pt;
        if ($pt['type_pointage'] === 'entree') $heures_par_employe[$uid]['entrees'][] = strtotime($pt['heure']);
        if ($pt['type_pointage'] === 'sortie') $heures_par_employe[$uid]['sorties'][] = strtotime($pt['heure']);
        if ($pt['type_pointage'] === 'pause_debut') $heures_par_employe[$uid]['pauses'][] = strtotime($pt['heure']);
    }
    foreach ($heures_par_employe as $uid => &$emp) {
        $pairs = min(count($emp['entrees']), count($emp['sorties']));
        for ($i = 0; $i < $pairs; $i++) {
            $emp['total_min'] += round(($emp['sorties'][$i] - $emp['entrees'][$i]) / 60);
        }
        // If still clocked in (has entree without sortie), show live hours
        if(count($emp['entrees']) > count($emp['sorties']) && $pt_date === $today) {
            $emp['total_min'] += round((time() - end($emp['entrees'])) / 60);
            $emp['is_live'] = true;
        }
    }
    unset($emp);
    
    // Get employees for filter (admin only)
    $employees_list = can('view_all_franchises') ? query("SELECT id, nom_complet FROM utilisateurs WHERE actif=1 ORDER BY nom_complet") : [];
    
    // KPIs
    $total_employes_today = count($heures_par_employe);
    $total_heures_today = array_sum(array_column($heures_par_employe, 'total_min'));
    $employes_en_poste = count(array_filter($heures_par_employe, fn($e) => isset($e['is_live'])));
    $employes_absents_count = 0;
    if(can('view_all_franchises')) {
        $total_employes = queryOne("SELECT COUNT(*) as c FROM utilisateurs WHERE actif=1 AND role NOT IN ('admin')")['c'] ?? 0;
        $employes_absents_count = max(0, $total_employes - $total_employes_today);
    }
?>
<div class="flex flex-wrap justify-between items-center gap-3 mb-4">
    <h1 class="text-2xl font-bold text-asel-dark flex items-center gap-2"><i class="bi bi-clock-history text-asel"></i> Pointage employés</h1>
    <div class="flex items-center gap-3">
        <?php if(can('view_all_franchises')): ?>
        <a href="api.php?action=export_pointage&date=<?=e($pt_date)?>" class="bg-white border-2 border-gray-200 text-gray-600 text-xs font-bold px-3 py-1.5 rounded-lg hover:border-asel hover:text-asel transition-colors"><i class="bi bi-download"></i> Export</a>
        <?php endif; ?>
        <div class="text-sm text-gray-400 bg-white px-3 py-1.5 rounded-lg border"><?=date('d/m/Y H:i')?></div>
    </div>
</div>

<!-- MY PUNCH CARD -->
<div class="bg-gradient-to-br from-asel via-asel to-asel-dark rounded-2xl p-6 mb-6 text-white shadow-xl">
    <div class="flex flex-wrap justify-between items-start gap-4 mb-5">
        <div class="flex-1 min-w-0">
            <div class="text-[10px] text-white/50 font-bold uppercase tracking-widest mb-1">Mon pointage</div>
            <div class="text-xl font-black"><?=e($user['nom_complet'])?></div>
            <div class="text-sm text-white/70 mt-1.5">
                <?php if($mon_dernier): ?>
                <span class="inline-flex items-center gap-1.5 bg-white/15 px-3 py-1 rounded-full text-xs">
                    <?php $last_icon = match($mon_dernier['type_pointage']){'entree'=>'bi-box-arrow-in-right','sortie'=>'bi-box-arrow-right','pause_debut'=>'bi-cup-hot','pause_fin'=>'bi-play-circle',default=>'bi-clock'}; ?>
                    <i class="bi <?=$last_icon?>"></i>
                    <?=match($mon_dernier['type_pointage']){'entree'=>'Entrée','sortie'=>'Sortie','pause_debut'=>'Pause','pause_fin'=>'Retour',default=>$mon_dernier['type_pointage']}?> à <?=date('H:i', strtotime($mon_dernier['heure']))?>
                </span>
                <?php else: ?>
                <span class="text-white/50">Pas encore pointé aujourd'hui</span>
                <?php endif; ?>
            </div>
        </div>
        <div class="text-right">
            <div class="text-4xl font-black tracking-tight" id="currentTime"><?=date('H:i')?></div>
            <div class="text-xs text-white/50 mt-0.5"><?php
                if(class_exists('IntlDateFormatter')) {
                    $fmt = new IntlDateFormatter('fr_TN', IntlDateFormatter::FULL, IntlDateFormatter::NONE, 'Africa/Tunis', null, 'EEEE dd MMMM');
                    echo $fmt->format(new DateTime());
                } else {
                    $jours = ['Dimanche','Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi'];
                    $mois = ['','Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
                    echo $jours[date('w')].' '.date('d').' '.$mois[intval(date('m'))];
                }
            ?></div>
            <?php if($mes_total_min > 0): ?>
            <div class="mt-2 bg-white/15 rounded-lg px-3 py-1.5 text-center">
                <div class="text-lg font-black"><?=$mes_h?>h<?=str_pad($mes_m,2,'0',STR_PAD_LEFT)?></div>
                <div class="text-[10px] text-white/60">travaillées</div>
            </div>
            <?php endif; ?>
        </div>
    </div>
    
    <!-- Punch buttons -->
    <form method="POST" id="pointageForm">
        <input type="hidden" name="_csrf" value="<?=$csrf?>">
        <input type="hidden" name="action" value="add_pointage">
        <input type="hidden" name="type_pointage" id="punchType" value="<?=$mon_prochain?>">
        <input type="hidden" name="latitude" id="punchLat" value="">
        <input type="hidden" name="longitude" id="punchLng" value="">
        <input type="hidden" name="adresse" id="punchAddr" value="">
        <input type="hidden" name="device_info" value="<?=e($_SERVER['HTTP_USER_AGENT'] ?? '')?>">
        <?php if($pt_fid): ?><input type="hidden" name="franchise_id" value="<?=$pt_fid?>"><?php endif; ?>
        <input type="hidden" name="note" id="punchNote" value="">
        
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <button type="button" onclick="doPunch('entree')" class="py-4 rounded-xl font-bold text-sm transition-all text-center <?=$mon_prochain==='entree'?'bg-green-400 text-white shadow-lg ring-2 ring-green-300 ring-offset-2 ring-offset-asel scale-[1.03]':'bg-white/15 text-white/70 hover:bg-white/25 hover:text-white'?>">
                <i class="bi bi-box-arrow-in-right text-2xl block mb-1"></i>
                Entrée
            </button>
            <button type="button" onclick="doPunch('pause_debut')" class="py-4 rounded-xl font-bold text-sm transition-all text-center <?=$mon_prochain==='pause_debut'?'bg-yellow-400 text-yellow-900 shadow-lg ring-2 ring-yellow-300 ring-offset-2 ring-offset-asel scale-[1.03]':'bg-white/15 text-white/70 hover:bg-white/25 hover:text-white'?>">
                <i class="bi bi-cup-hot text-2xl block mb-1"></i>
                Pause
            </button>
            <button type="button" onclick="doPunch('pause_fin')" class="py-4 rounded-xl font-bold text-sm transition-all text-center <?=$mon_prochain==='pause_fin'?'bg-blue-400 text-white shadow-lg ring-2 ring-blue-300 ring-offset-2 ring-offset-asel scale-[1.03]':'bg-white/15 text-white/70 hover:bg-white/25 hover:text-white'?>">
                <i class="bi bi-play-circle text-2xl block mb-1"></i>
                Retour
            </button>
            <button type="button" onclick="doPunch('sortie')" class="py-4 rounded-xl font-bold text-sm transition-all text-center <?=$mon_prochain==='sortie'?'bg-red-400 text-white shadow-lg ring-2 ring-red-300 ring-offset-2 ring-offset-asel scale-[1.03]':'bg-white/15 text-white/70 hover:bg-white/25 hover:text-white'?>">
                <i class="bi bi-box-arrow-right text-2xl block mb-1"></i>
                Sortie
            </button>
        </div>
        
        <!-- Optional note -->
        <div class="mt-3">
            <input type="text" id="punchNoteInput" placeholder="📝 Note optionnelle (ex: réunion, livraison...)" 
                class="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-2.5 text-sm text-white placeholder-white/30 focus:bg-white/15 focus:border-white/40 outline-none transition-all"
                oninput="document.getElementById('punchNote').value=this.value" maxlength="250">
        </div>
        
        <div id="locationStatus" class="mt-3 text-xs text-white/50 text-center flex items-center justify-center gap-1.5">
            <i class="bi bi-geo-alt-fill"></i> <span id="locationText">Localisation non activée</span>
        </div>
    </form>
    
    <!-- My today's timeline (compact) -->
    <?php if($mes_pointages_today): ?>
    <div class="mt-4 pt-4 border-t border-white/15">
        <div class="text-[10px] text-white/40 font-bold uppercase tracking-wider mb-2">Mon historique aujourd'hui</div>
        <div class="flex flex-wrap gap-2">
            <?php foreach($mes_pointages_today as $mp): 
                $mp_cfg = match($mp['type_pointage']) {
                    'entree' => ['bg'=>'bg-green-400/20 text-green-300 border-green-400/30', 'icon'=>'bi-box-arrow-in-right'],
                    'sortie' => ['bg'=>'bg-red-400/20 text-red-300 border-red-400/30', 'icon'=>'bi-box-arrow-right'],
                    'pause_debut' => ['bg'=>'bg-yellow-400/20 text-yellow-300 border-yellow-400/30', 'icon'=>'bi-cup-hot'],
                    'pause_fin' => ['bg'=>'bg-blue-400/20 text-blue-300 border-blue-400/30', 'icon'=>'bi-play-circle'],
                    default => ['bg'=>'bg-white/10 text-white/70 border-white/20', 'icon'=>'bi-clock'],
                };
            ?>
            <span class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border <?=$mp_cfg['bg']?>">
                <i class="bi <?=$mp_cfg['icon']?> text-sm"></i>
                <?=date('H:i', strtotime($mp['heure']))?>
                <?php if($mp['latitude']): ?><i class="bi bi-geo-alt-fill text-[10px] opacity-50"></i><?php endif; ?>
            </span>
            <?php endforeach; ?>
        </div>
    </div>
    <?php endif; ?>
</div>

<!-- KPI CARDS (admin) -->
<?php if(can('view_all_franchises')): ?>
<div class="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
    <div class="bg-white rounded-xl p-4 shadow-sm border-l-4 border-green-500">
        <div class="text-[10px] text-gray-400 font-bold uppercase tracking-wider">En poste</div>
        <div class="text-2xl font-black text-green-600"><?=$employes_en_poste?></div>
        <div class="text-xs text-gray-400">actuellement</div>
    </div>
    <div class="bg-white rounded-xl p-4 shadow-sm border-l-4 border-asel">
        <div class="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Ont pointé</div>
        <div class="text-2xl font-black text-asel-dark"><?=$total_employes_today?></div>
        <div class="text-xs text-gray-400">aujourd'hui</div>
    </div>
    <div class="bg-white rounded-xl p-4 shadow-sm border-l-4 border-amber-500">
        <div class="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Absents</div>
        <div class="text-2xl font-black <?=$employes_absents_count>0?'text-amber-600':'text-gray-300'?>"><?=$employes_absents_count?></div>
        <div class="text-xs text-gray-400">sans pointage</div>
    </div>
    <div class="bg-white rounded-xl p-4 shadow-sm border-l-4 border-purple-500">
        <div class="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Heures totales</div>
        <div class="text-2xl font-black text-asel-dark"><?=floor($total_heures_today/60)?>h<?=str_pad($total_heures_today%60,2,'0',STR_PAD_LEFT)?></div>
        <div class="text-xs text-gray-400">cumulées</div>
    </div>
</div>
<?php endif; ?>

<!-- FILTER BAR -->
<div class="bg-white rounded-xl shadow-sm p-4 mb-6">
    <form class="flex flex-wrap gap-3 items-end">
        <input type="hidden" name="page" value="pointage">
        <div>
            <label class="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-1">Date</label>
            <div class="flex gap-1">
                <a href="?page=pointage&date=<?=date('Y-m-d',strtotime('-1 day',$pt_date === $today ? time() : strtotime($pt_date)))?>" class="border-2 border-gray-200 rounded-lg px-2 py-1.5 text-sm hover:border-asel hover:text-asel transition-colors" title="Jour précédent"><i class="bi bi-chevron-left"></i></a>
                <input type="date" name="date" value="<?=e($pt_date)?>" class="border-2 border-gray-200 rounded-lg px-3 py-1.5 text-sm font-medium">
                <a href="?page=pointage&date=<?=date('Y-m-d',strtotime('+1 day',$pt_date === $today ? time() : strtotime($pt_date)))?>" class="border-2 border-gray-200 rounded-lg px-2 py-1.5 text-sm hover:border-asel hover:text-asel transition-colors <?=$pt_date >= $today ? 'opacity-30 pointer-events-none' : ''?>" title="Jour suivant"><i class="bi bi-chevron-right"></i></a>
            </div>
        </div>
        <div class="flex gap-1">
            <a href="?page=pointage&date=<?=date('Y-m-d')?>" class="px-3 py-1.5 rounded-lg text-xs font-bold <?=$pt_date===$today?'bg-asel text-white':'bg-gray-100 text-gray-600 hover:bg-gray-200'?>">Aujourd'hui</a>
            <a href="?page=pointage&date=<?=date('Y-m-d',strtotime('-1 day'))?>" class="px-3 py-1.5 rounded-lg text-xs font-bold bg-gray-100 text-gray-600 hover:bg-gray-200">Hier</a>
        </div>
        <?php if($employees_list): ?>
        <div>
            <label class="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-1">Employé</label>
            <select name="uid" class="border-2 border-gray-200 rounded-lg px-3 py-1.5 text-sm">
                <option value="">👥 Tous</option>
                <?php foreach($employees_list as $emp): ?>
                <option value="<?=$emp['id']?>" <?=$pt_user_filter==$emp['id']?'selected':''?>><?=e($emp['nom_complet'])?></option>
                <?php endforeach; ?>
            </select>
        </div>
        <?php endif; ?>
        <button class="bg-asel text-white px-4 py-1.5 rounded-lg text-sm font-bold"><i class="bi bi-funnel"></i> Filtrer</button>
    </form>
</div>

<!-- EMPLOYEE CARDS — grouped by employee -->
<?php if($heures_par_employe): ?>
<div class="space-y-4 mb-6">
    <div class="flex items-center justify-between">
        <h2 class="font-bold text-lg text-asel-dark flex items-center gap-2">
            <i class="bi bi-people text-asel"></i> 
            Pointages du <?=date('d/m/Y', strtotime($pt_date))?>
        </h2>
        <span class="text-xs bg-gray-100 text-gray-600 font-bold px-3 py-1 rounded-full"><?=count($pointages_list)?> enregistrements</span>
    </div>
    
    <?php foreach($heures_par_employe as $uid => $emp): 
        $h = floor($emp['total_min'] / 60);
        $m = $emp['total_min'] % 60;
        $is_live = isset($emp['is_live']);
        $first_in = $emp['entrees'] ? date('H:i', $emp['entrees'][0]) : '—';
        $last_out = $emp['sorties'] ? date('H:i', end($emp['sorties'])) : ($is_live ? 'En cours' : '—');
    ?>
    <div class="bg-white rounded-2xl shadow-sm overflow-hidden border <?=$is_live?'border-green-200':'border-transparent'?>">
        <!-- Employee header -->
        <div class="px-5 py-4 flex flex-wrap items-center gap-4 <?=$is_live?'bg-green-50/50':''?>">
            <!-- Avatar -->
            <div class="w-12 h-12 rounded-xl flex items-center justify-center font-black text-base <?=$is_live?'bg-green-500 text-white':'bg-asel/10 text-asel'?> shrink-0">
                <?=mb_strtoupper(mb_substr($emp['nom'],0,2))?>
            </div>
            <!-- Name & status -->
            <div class="flex-1 min-w-0">
                <div class="font-bold text-base text-asel-dark flex items-center gap-2">
                    <?=e($emp['nom'])?>
                    <?php if($is_live): ?>
                    <span class="inline-flex items-center gap-1 bg-green-100 text-green-700 text-[10px] font-bold px-2 py-0.5 rounded-full">
                        <span class="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse"></span> En poste
                    </span>
                    <?php endif; ?>
                </div>
                <div class="text-xs text-gray-400 flex items-center gap-3 mt-0.5">
                    <?php if($emp['franchise']): ?><span><i class="bi bi-shop"></i> <?=e(shortF($emp['franchise']))?></span><?php endif; ?>
                    <span><i class="bi bi-arrow-right-circle"></i> Arrivée: <b class="text-gray-600"><?=$first_in?></b></span>
                    <span><i class="bi bi-arrow-left-circle"></i> Départ: <b class="text-gray-600"><?=$last_out?></b></span>
                </div>
            </div>
            <!-- Hours badge -->
            <div class="text-center shrink-0">
                <div class="text-2xl font-black <?=$emp['total_min']>=480?'text-green-600':($emp['total_min']>=240?'text-asel':($emp['total_min']>0?'text-amber-600':'text-gray-300'))?>"><?=$h?>h<?=str_pad($m,2,'0',STR_PAD_LEFT)?></div>
                <div class="text-[10px] text-gray-400 font-bold uppercase"><?=count($emp['entrees'])?> pointage<?=count($emp['entrees'])>1?'s':''?></div>
            </div>
            <!-- Progress bar (8h = 100%) -->
            <div class="w-full mt-1">
                <?php $pct = min(100, round($emp['total_min'] / 480 * 100)); ?>
                <div class="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div class="h-full rounded-full transition-all duration-500 <?=$pct>=100?'bg-green-500':($pct>=50?'bg-asel':'bg-amber-400')?>" style="width:<?=$pct?>%"></div>
                </div>
                <div class="flex justify-between text-[10px] text-gray-400 mt-0.5">
                    <span><?=$pct?>% de 8h</span>
                    <?php if($emp['total_min']<480 && $emp['total_min']>0): ?>
                    <span>Reste: <?=floor((480-$emp['total_min'])/60)?>h<?=str_pad((480-$emp['total_min'])%60,2,'0',STR_PAD_LEFT)?></span>
                    <?php endif; ?>
                </div>
            </div>
        </div>
        
        <!-- Employee timeline -->
        <div class="border-t border-gray-100 px-5 py-3">
            <div class="flex flex-wrap gap-2">
                <?php foreach($emp['pointages'] as $pt): 
                    $type_cfg = match($pt['type_pointage']) {
                        'entree' => ['color'=>'bg-green-100 text-green-700 border-green-200', 'icon'=>'bi-box-arrow-in-right', 'label'=>'Entrée'],
                        'sortie' => ['color'=>'bg-red-100 text-red-700 border-red-200', 'icon'=>'bi-box-arrow-right', 'label'=>'Sortie'],
                        'pause_debut' => ['color'=>'bg-yellow-100 text-yellow-700 border-yellow-200', 'icon'=>'bi-cup-hot', 'label'=>'Pause'],
                        'pause_fin' => ['color'=>'bg-blue-100 text-blue-700 border-blue-200', 'icon'=>'bi-play-circle', 'label'=>'Retour'],
                        default => ['color'=>'bg-gray-100 text-gray-700 border-gray-200', 'icon'=>'bi-clock', 'label'=>$pt['type_pointage']],
                    };
                ?>
                <div class="inline-flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-semibold <?=$type_cfg['color']?> hover:shadow-sm transition-shadow" title="<?=e($pt['adresse']??'')?>">
                    <i class="bi <?=$type_cfg['icon']?> text-sm"></i>
                    <div>
                        <div class="font-black text-sm leading-none"><?=date('H:i', strtotime($pt['heure']))?></div>
                        <div class="text-[10px] opacity-70 leading-tight"><?=$type_cfg['label']?></div>
                    </div>
                    <?php if($pt['latitude']): ?>
                    <a href="https://maps.google.com?q=<?=$pt['latitude']?>,<?=$pt['longitude']?>" target="_blank" class="opacity-50 hover:opacity-100 ml-1" title="Voir sur carte"><i class="bi bi-geo-alt-fill text-xs"></i></a>
                    <?php endif; ?>
                </div>
                <?php endforeach; ?>
            </div>
            <?php if($emp['pointages'][0]['note'] ?? ''): ?>
            <div class="text-xs text-gray-400 mt-2"><i class="bi bi-chat-square-text"></i> <?=e($emp['pointages'][0]['note'])?></div>
            <?php endif; ?>
        </div>
    </div>
    <?php endforeach; ?>
</div>
<?php else: ?>
<div class="bg-white rounded-2xl shadow-sm p-10 text-center mb-6">
    <i class="bi bi-clock text-5xl text-gray-200 block mb-3"></i>
    <p class="text-gray-400 font-medium">Aucun pointage pour le <?=date('d/m/Y', strtotime($pt_date))?></p>
    <p class="text-xs text-gray-300 mt-1">Les employés peuvent pointer en haut de cette page</p>
</div>
<?php endif; ?>

<!-- MONTHLY SUMMARY TABLE (admin only) -->
<?php if(can('view_all_franchises')): ?>
<?php
$pt_mois = $_GET['mois'] ?? date('Y-m');
try {
    $monthly_summary = query("SELECT u.nom_complet, u.id, u.role,
        COUNT(CASE WHEN p.type_pointage='entree' THEN 1 END) as nb_entrees,
        COUNT(CASE WHEN p.type_pointage='sortie' THEN 1 END) as nb_sorties,
        COUNT(DISTINCT DATE(p.heure)) as jours_travailles,
        MIN(TIME(p.heure)) as premiere_arrivee,
        MAX(CASE WHEN p.type_pointage='sortie' THEN TIME(p.heure) END) as dernier_depart
        FROM pointages p JOIN utilisateurs u ON p.utilisateur_id=u.id
        WHERE DATE_FORMAT(p.heure,'%Y-%m')=?
        GROUP BY u.id, u.nom_complet, u.role ORDER BY u.nom_complet", [$pt_mois]);
    
    // Calculate hours worked per employee for the month
    $monthly_hours = [];
    try {
        $all_punches_month = query("SELECT p.utilisateur_id, p.type_pointage, p.heure FROM pointages p WHERE DATE_FORMAT(p.heure,'%Y-%m')=? ORDER BY p.utilisateur_id, p.heure", [$pt_mois]);
        $emp_punches = [];
        foreach($all_punches_month as $punch) {
            $uid = $punch['utilisateur_id'];
            if(!isset($emp_punches[$uid])) $emp_punches[$uid] = ['entrees'=>[],'sorties'=>[]];
            if($punch['type_pointage']==='entree') $emp_punches[$uid]['entrees'][] = strtotime($punch['heure']);
            if($punch['type_pointage']==='sortie') $emp_punches[$uid]['sorties'][] = strtotime($punch['heure']);
        }
        foreach($emp_punches as $uid => $ep) {
            $pairs = min(count($ep['entrees']), count($ep['sorties']));
            $total_min = 0;
            for($i=0;$i<$pairs;$i++) $total_min += round(($ep['sorties'][$i]-$ep['entrees'][$i])/60);
            // If still clocked in today (more entrees than sorties), add live time
            if(count($ep['entrees']) > count($ep['sorties']) && $pt_mois === date('Y-m')) {
                $total_min += round((time() - end($ep['entrees'])) / 60);
            }
            $monthly_hours[$uid] = $total_min;
        }
    } catch(Exception $e) { $monthly_hours = []; }
} catch(Exception $e) { $monthly_summary = []; $monthly_hours = []; }
?>
<div class="bg-white rounded-2xl shadow-sm overflow-hidden">
    <div class="px-5 py-4 border-b flex flex-wrap items-center justify-between gap-3">
        <h3 class="font-bold text-base text-asel-dark flex items-center gap-2"><i class="bi bi-calendar-month text-asel"></i> Récap mensuel</h3>
        <div class="flex gap-3 items-center">
            <a href="api.php?action=export_pointage&mois=<?=e($pt_mois)?>" class="text-xs text-gray-400 hover:text-asel font-semibold"><i class="bi bi-download"></i> Export CSV</a>
            <form class="flex gap-2 items-center">
                <input type="hidden" name="page" value="pointage">
                <input type="month" name="mois" value="<?=e($pt_mois)?>" class="border-2 border-gray-200 rounded-lg px-3 py-1.5 text-sm font-medium">
                <button class="bg-asel text-white px-3 py-1.5 rounded-lg text-sm font-bold"><i class="bi bi-funnel"></i></button>
            </form>
        </div>
    </div>
    <?php if($monthly_summary): ?>
    <div class="overflow-x-auto">
    <table class="w-full text-sm">
        <thead><tr class="bg-gray-50 text-[10px] uppercase font-bold text-gray-400 tracking-wider">
            <th class="px-5 py-3 text-left">Employé</th>
            <th class="px-4 py-3 text-center">Jours</th>
            <th class="px-4 py-3 text-center">Heures totales</th>
            <th class="px-4 py-3 text-center hidden sm:table-cell">Moy/jour</th>
            <th class="px-4 py-3 text-center hidden md:table-cell">Entrées</th>
            <th class="px-4 py-3 text-center hidden md:table-cell">Sorties</th>
            <th class="px-4 py-3 text-center hidden lg:table-cell">1ère arrivée</th>
            <th class="px-4 py-3 text-center">Progression</th>
        </tr></thead>
        <tbody class="divide-y">
        <?php foreach($monthly_summary as $ms): 
            $tm = $monthly_hours[$ms['id']] ?? 0;
            $th = floor($tm/60); $tmin = $tm%60;
            $moy_h = $ms['jours_travailles'] > 0 ? round($tm / $ms['jours_travailles']) : 0;
            $moy_hh = floor($moy_h/60); $moy_mm = $moy_h%60;
            // Target: ~22 working days, 8h/day = 176h
            $target_h = 176 * 60; // minutes
            $progress = $target_h > 0 ? min(100, round($tm / $target_h * 100)) : 0;
        ?>
        <tr class="hover:bg-gray-50">
            <td class="px-5 py-3">
                <div class="flex items-center gap-3">
                    <div class="w-9 h-9 rounded-lg bg-asel/10 flex items-center justify-center font-black text-asel text-xs shrink-0"><?=mb_strtoupper(mb_substr($ms['nom_complet'],0,2))?></div>
                    <div>
                        <div class="font-semibold text-asel-dark"><?=e($ms['nom_complet'])?></div>
                        <div class="text-[10px] text-gray-400"><?=roleBadge($ms['role'])?></div>
                    </div>
                </div>
            </td>
            <td class="px-4 py-3 text-center">
                <span class="inline-flex px-2.5 py-1 rounded-lg text-xs font-bold <?=$ms['jours_travailles']>=22?'bg-green-100 text-green-700':($ms['jours_travailles']>=15?'bg-yellow-100 text-yellow-700':'bg-gray-100 text-gray-600')?>"><?=$ms['jours_travailles']?> j</span>
            </td>
            <td class="px-4 py-3 text-center">
                <?php if($tm>0): ?>
                <span class="text-base font-black <?=$th>=160?'text-green-600':($th>=80?'text-asel':'text-amber-600')?>"><?=$th?>h<?=$tmin>0?str_pad($tmin,2,'0',STR_PAD_LEFT):''?></span>
                <?php else: ?><span class="text-gray-300">—</span><?php endif; ?>
            </td>
            <td class="px-4 py-3 text-center hidden sm:table-cell">
                <?php if($moy_h>0): ?>
                <span class="text-xs font-semibold <?=$moy_hh>=8?'text-green-600':($moy_hh>=6?'text-asel':'text-amber-600')?>"><?=$moy_hh?>h<?=$moy_mm>0?str_pad($moy_mm,2,'0',STR_PAD_LEFT):''?></span>
                <?php else: ?><span class="text-gray-300 text-xs">—</span><?php endif; ?>
            </td>
            <td class="px-4 py-3 text-center hidden md:table-cell text-xs"><?=$ms['nb_entrees']?></td>
            <td class="px-4 py-3 text-center hidden md:table-cell text-xs <?=$ms['nb_entrees']!=$ms['nb_sorties']?'text-red-500 font-bold':''?>"><?=$ms['nb_sorties']?> <?=$ms['nb_entrees']!=$ms['nb_sorties']?'⚠️':''?></td>
            <td class="px-4 py-3 text-center hidden lg:table-cell text-xs text-gray-500"><?=$ms['premiere_arrivee']?substr($ms['premiere_arrivee'],0,5):'—'?></td>
            <td class="px-4 py-3">
                <div class="flex items-center gap-2">
                    <div class="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                        <div class="h-full rounded-full <?=$progress>=90?'bg-green-500':($progress>=50?'bg-asel':'bg-amber-400')?>" style="width:<?=$progress?>%"></div>
                    </div>
                    <span class="text-[10px] font-bold text-gray-400 w-8 text-right"><?=$progress?>%</span>
                </div>
            </td>
        </tr>
        <?php endforeach; ?>
        </tbody>
    </table>
    </div>
    <?php else: ?>
    <div class="px-5 py-10 text-center text-gray-400">
        <i class="bi bi-calendar-x text-3xl block mb-2 opacity-30"></i>
        Aucun pointage pour <?=e($pt_mois)?>
    </div>
    <?php endif; ?>
</div>
<?php endif; // monthly view_all_franchises ?>

<?php endif; // pointage page ?>

</div><!-- /wrapper -->
</main>

<!-- Footer -->
<footer class="lg:ml-64 bg-white border-t py-3 px-6 text-center text-xs text-gray-400">
    <span>&copy; <?=date('Y')?> ASEL Mobile</span> &middot; 
    <a href="map.php" class="text-asel hover:underline"><i class="bi bi-map"></i> Carte</a> &middot; 
    <button onclick="showShortcuts()" class="text-gray-400 hover:text-asel">Raccourcis <kbd class="bg-gray-100 px-1 rounded text-[10px]">?</kbd></button> &middot;
    <span>v15.5</span>
</footer>

<?php if (can('pos')): ?>
<!-- Mobile FAB -->
<div class="lg:hidden fixed bottom-6 right-6 z-40 flex flex-col gap-2 items-end" id="fabMenu">
    <div class="hidden flex-col gap-2 items-end mb-2" id="fabActions">
        <a href="?page=pos" class="bg-asel text-white shadow-lg rounded-full px-4 py-2 text-sm font-semibold flex items-center gap-2" onclick="closeFab()"><i class="bi bi-cart3"></i> Vente</a>
        <?php if(can('entree_stock')): ?>
        <button onclick="closeFab();location.href='?page=entree'" class="bg-emerald-500 text-white shadow-lg rounded-full px-4 py-2 text-sm font-semibold flex items-center gap-2"><i class="bi bi-box-arrow-in-down"></i> Entrée stock</button>
        <?php endif; ?>
        <button onclick="openBarcodeLookup();closeFab()" class="bg-purple-500 text-white shadow-lg rounded-full px-4 py-2 text-sm font-semibold flex items-center gap-2"><i class="bi bi-upc-scan"></i> Scanner</button>
        <?php if(can('pointage')): ?>
        <a href="?page=pointage" class="bg-orange-500 text-white shadow-lg rounded-full px-4 py-2 text-sm font-semibold flex items-center gap-2" onclick="closeFab()"><i class="bi bi-clock-history"></i> Pointage</a>
        <?php endif; ?>
        <a href="?page=rapports" class="bg-gray-600 text-white shadow-lg rounded-full px-4 py-2 text-sm font-semibold flex items-center gap-2" onclick="closeFab()"><i class="bi bi-graph-up"></i> Rapports</a>
    </div>
    <button onclick="toggleFab()" class="bg-asel hover:bg-asel-dark text-white shadow-xl w-14 h-14 rounded-full flex items-center justify-center transition-transform" id="fabBtn">
        <i class="bi bi-plus-lg text-2xl" id="fabIcon"></i>
    </button>
</div>
<script>
function toggleFab(){const a=document.getElementById('fabActions');const i=document.getElementById('fabIcon');a.classList.toggle('hidden');a.classList.toggle('flex');i.style.transform=a.classList.contains('hidden')?'':'rotate(45deg)';}
function closeFab(){document.getElementById('fabActions').classList.add('hidden');document.getElementById('fabActions').classList.remove('flex');document.getElementById('fabIcon').style.transform='';}
</script>
<?php endif; ?>

<script>
// Real-time clock
setInterval(() => {
    const now = new Date();
    const el = document.getElementById('currentTime');
    if(el) el.textContent = now.toLocaleTimeString('fr-TN', {hour:'2-digit', minute:'2-digit'});
}, 1000);

// Geolocation + punch
function doPunch(type) {
    document.getElementById('punchType').value = type;
    document.getElementById('locationText').textContent = 'Récupération de la localisation...';
    
    if(navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                document.getElementById('punchLat').value = pos.coords.latitude.toFixed(7);
                document.getElementById('punchLng').value = pos.coords.longitude.toFixed(7);
                document.getElementById('locationText').textContent = `📍 ${pos.coords.latitude.toFixed(4)}, ${pos.coords.longitude.toFixed(4)} (±${Math.round(pos.coords.accuracy)}m)`;
                
                // Reverse geocode via free API
                fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${pos.coords.latitude}&lon=${pos.coords.longitude}`)
                    .then(r => r.json())
                    .then(d => {
                        const addr = d.display_name || `${pos.coords.latitude.toFixed(4)}, ${pos.coords.longitude.toFixed(4)}`;
                        document.getElementById('punchAddr').value = addr.substring(0, 299);
                        document.getElementById('locationText').textContent = '📍 ' + addr.substring(0, 60) + '...';
                        submitPunch();
                    })
                    .catch(() => submitPunch());
            },
            (err) => {
                document.getElementById('locationText').textContent = '⚠️ Localisation non disponible — pointage sans GPS';
                submitPunch();
            },
            {timeout: 8000, maximumAge: 30000, enableHighAccuracy: true}
        );
    } else {
        document.getElementById('locationText').textContent = '⚠️ GPS non supporté';
        submitPunch();
    }
}

function submitPunch() {
    const btn = event?.target?.closest('button');
    if(btn) { btn.innerHTML = '<i class="bi bi-hourglass-split"></i> Enregistrement...'; btn.disabled = true; }
    document.getElementById('pointageForm').submit();
}
</script>
<!-- Global Scanner Modal (hidden by default) -->
<div id="scannerModal" class="fixed inset-0 z-50 bg-black/60 items-center justify-center p-4" style="display:none">
    <div class="bg-white rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl">
        <div class="bg-asel-dark text-white px-4 py-3 flex justify-between items-center">
            <span class="font-bold text-sm"><i class="bi bi-upc-scan"></i> Scanner code-barres</span>
            <button onclick="closeScanner()" class="text-white/70 hover:text-white text-xl leading-none">&times;</button>
        </div>
        <div class="p-4">
            <div class="relative rounded-xl overflow-hidden bg-black">
                <div id="globalReader" class="rounded-xl overflow-hidden"></div>
                <!-- Scan guide -->
                <div class="absolute inset-0 pointer-events-none flex items-center justify-center">
                    <div class="border-2 border-white/40 rounded-lg" style="width:240px;height:100px;box-shadow:0 0 0 9999px rgba(0,0,0,0.5)"></div>
                </div>
            </div>
            <p class="text-xs text-gray-400 text-center mt-2"><i class="bi bi-lightbulb"></i> Alignez le code-barres dans le cadre</p>
            <div id="scannerResult" class="mt-2 text-center text-sm"></div>
        </div>
        <div class="px-4 pb-4">
            <div class="text-center text-xs text-gray-400 mb-2">ou saisir manuellement</div>
            <div class="flex gap-2">
                <input type="text" id="manualBarcodeInput" class="flex-1 border-2 border-gray-200 rounded-lg px-3 py-2 text-center font-mono text-sm focus:border-asel" placeholder="Taper le code..." onkeypress="if(event.key==='Enter'){manualBarcodeDone();event.preventDefault();}">
                <button onclick="manualBarcodeDone()" class="bg-asel text-white px-4 py-2 rounded-lg text-sm font-bold hover:bg-asel-dark transition-colors">OK</button>
            </div>
        </div>
    </div>
</div><!-- /scannerModal -->

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
        {
            fps: 15,
            qrbox: { width: 240, height: 100 },
            aspectRatio: 1.777,
            experimentalFeatures: { useBarCodeDetectorIfSupported: true },
            formatsToSupport: [0, 2, 3, 4, 7, 8, 10, 11, 12],
        },
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
function initTomSelect() {
    document.querySelectorAll('.ts-select:not(.tomselected)').forEach(el => {
        new TomSelect(el, {
            create: false,
            sortField: { field: "text", direction: "asc" },
            maxOptions: 50,
            placeholder: el.dataset.placeholder || 'Rechercher...',
        });
    });
}
document.addEventListener('DOMContentLoaded', initTomSelect);
// Re-init after page load for dynamically rendered sections
setTimeout(initTomSelect, 500);
</script>
<script src="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.js"></script>
<!-- ============================================== -->
<!-- GLOBAL MODAL SYSTEM -->
<!-- ============================================== -->
<div id="modal" class="fixed inset-0 z-[9998] hidden" role="dialog" aria-modal="true">
    <div class="absolute inset-0 bg-black/60 backdrop-blur-sm" onclick="closeModal()"></div>
    <div class="absolute inset-0 flex items-center justify-center p-4 pointer-events-none">
        <div id="modalContent" class="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto pointer-events-auto transform transition-all duration-200 scale-95 opacity-0" id="modalBox">
            <!-- Dynamic content injected here -->
        </div>
    </div>
</div>

<!-- Confirm Dialog -->
<div id="confirmDialog" class="fixed inset-0 z-[9999] hidden">
    <div class="absolute inset-0 bg-black/60" onclick="closeConfirm()"></div>
    <div class="absolute inset-0 flex items-center justify-center p-4 pointer-events-none">
        <div class="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 pointer-events-auto text-center">
            <div id="confirmIcon" class="w-16 h-16 mx-auto mb-4 rounded-full flex items-center justify-center text-3xl"></div>
            <h3 id="confirmTitle" class="font-bold text-lg text-asel-dark mb-2"></h3>
            <p id="confirmMsg" class="text-sm text-gray-500 mb-6"></p>
            <div class="flex gap-3">
                <button onclick="closeConfirm()" class="flex-1 py-2.5 rounded-xl border-2 border-gray-200 text-gray-600 font-semibold text-sm hover:bg-gray-50">Annuler</button>
                <button id="confirmBtn" class="flex-1 py-2.5 rounded-xl text-white font-semibold text-sm">Confirmer</button>
            </div>
        </div>
    </div>
</div>

<script>
// === CORE MODAL SYSTEM (isolated) ===
function openModal(html, options) {
    options = options || {};
    var modal = document.getElementById('modal');
    var content = document.getElementById('modalContent');
    if (!modal || !content) { alert('Modal system error'); return; }
    content.innerHTML = html;
    content.className = 'bg-white rounded-2xl shadow-2xl w-full ' + (options.size || 'max-w-lg') + ' max-h-[90vh] overflow-y-auto pointer-events-auto';
    modal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    setTimeout(function(){ var fi = content.querySelector('input:not([type=hidden]), select, textarea'); if(fi) fi.focus(); }, 200);
}
function closeModal() {
    var modal = document.getElementById('modal');
    if(modal) modal.classList.add('hidden');
    document.body.style.overflow = '';
}
function modalHeader(icon, title, subtitle) {
    return '<div class="bg-gradient-to-r from-asel-dark to-asel text-white px-6 py-4 rounded-t-2xl"><h3 class="font-bold text-lg flex items-center gap-2"><i class="bi ' + icon + '"></i> ' + title + '</h3>' + (subtitle ? '<p class="text-white/60 text-xs mt-0.5">' + subtitle + '</p>' : '') + '</div>';
}
function modalField(label, name, type, value, placeholder, options) {
    if (type === 'select' && options) {
        var opts = options.map(function(o){ return '<option value="' + o.value + '"' + (o.selected ? ' selected' : '') + '>' + o.label + '</option>'; }).join('');
        return '<div><label class="text-xs font-bold text-gray-500 uppercase tracking-wider block mb-1">' + label + '</label><select name="' + name + '" class="w-full border-2 border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:border-asel">' + opts + '</select></div>';
    }
    if (type === 'textarea') {
        return '<div><label class="text-xs font-bold text-gray-500 uppercase tracking-wider block mb-1">' + label + '</label><textarea name="' + name + '" class="w-full border-2 border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:border-asel" rows="3" placeholder="' + (placeholder || '') + '">' + (value || '') + '</textarea></div>';
    }
    return '<div><label class="text-xs font-bold text-gray-500 uppercase tracking-wider block mb-1">' + label + '</label><input type="' + (type || 'text') + '" name="' + name + '" value="' + (value || '') + '" placeholder="' + (placeholder || '') + '" class="w-full border-2 border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:border-asel"></div>';
}
function modalRow(cols) { return '<div class="grid grid-cols-' + cols.length + ' gap-3">' + cols.join('') + '</div>'; }
document.addEventListener('keydown', function(e){ if(e.key==='Escape') closeModal(); });
window._modalReady = true;
</script>

<script>
// === EXTENDED MODAL SYSTEM + BUSINESS LOGIC ===

// Close on Escape (backup)
document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeModal(); if(typeof closeConfirm==='function') closeConfirm(); } });

// === CONFIRM DIALOG ===
let confirmCallback = null;
function showConfirm(title, msg, type, callback) {
    const icons = {
        danger: '<i class="bi bi-exclamation-triangle-fill text-red-500"></i>',
        warning: '<i class="bi bi-question-circle-fill text-amber-500"></i>',
        success: '<i class="bi bi-check-circle-fill text-green-500"></i>',
        info: '<i class="bi bi-info-circle-fill text-asel"></i>',
    };
    const btnColors = {
        danger: 'bg-red-500 hover:bg-red-600',
        warning: 'bg-amber-500 hover:bg-amber-600',
        success: 'bg-green-500 hover:bg-green-600',
        info: 'bg-asel hover:bg-asel-dark',
    };
    document.getElementById('confirmIcon').innerHTML = icons[type] || icons.info;
    document.getElementById('confirmIcon').className = `w-16 h-16 mx-auto mb-4 rounded-full flex items-center justify-center text-3xl ${type === 'danger' ? 'bg-red-50' : type === 'warning' ? 'bg-amber-50' : 'bg-blue-50'}`;
    document.getElementById('confirmTitle').textContent = title;
    document.getElementById('confirmMsg').textContent = msg;
    document.getElementById('confirmBtn').className = `flex-1 py-2.5 rounded-xl text-white font-semibold text-sm ${btnColors[type] || btnColors.info}`;
    confirmCallback = callback;
    document.getElementById('confirmBtn').onclick = () => { closeConfirm(); if (confirmCallback) confirmCallback(); };
    document.getElementById('confirmDialog').classList.remove('hidden');
}

function closeConfirm() {
    document.getElementById('confirmDialog').classList.add('hidden');
    confirmCallback = null;
}

// modalForm helper (extends the core modal system)
function modalForm(action, csrf, fields, submitText, submitColor) {
    return '<form method="POST" class="p-6 space-y-4" onsubmit="this.querySelector(\'button[type=submit]\').disabled=true"><input type="hidden" name="_csrf" value="' + csrf + '"><input type="hidden" name="action" value="' + action + '">' + fields + '<div class="flex gap-3 pt-2"><button type="button" onclick="closeModal()" class="flex-1 py-2.5 rounded-xl border-2 border-gray-200 text-gray-600 font-semibold text-sm hover:bg-gray-50">Annuler</button><button type="submit" class="flex-1 py-2.5 rounded-xl text-white font-semibold text-sm ' + (submitColor || 'bg-asel hover:bg-asel-dark') + ' flex items-center justify-center gap-2"><i class="bi bi-check-circle"></i> ' + (submitText || 'Enregistrer') + '</button></div></form>';
}

// === BUSINESS LOGIC HELPERS ===

// Stock check before sale
function checkStockBeforeSale() {
    // Stock validation is handled server-side (pre-check before facture insert)
    // No client-side blocking — just let the sale through
    return true;
}

// Quick product add modal
function openQuickAddProduct(returnPage) {
    const csrf = '<?=$csrf?>';
    const cats = <?=json_encode(array_map(fn($c) => ['value' => $c['id'], 'label' => $c['nom']], $categories ?? []))?>;
    const fourns = <?=json_encode(array_map(fn($f) => ['value' => $f['id'], 'label' => $f['nom']], $fournisseurs ?? []))?>;
    fourns.unshift({value:'', label:'— Aucun —'});
    const franchAll = <?=json_encode(array_map(fn($f)=>['value'=>$f['id'],'label'=>shortF($f['nom'])], $allFranchises ?? []))?>;
    
    openModal(
        modalHeader('bi-plus-circle', 'Nouveau produit', 'Avec prix HT / TVA / TTC') +
        `<form method="POST" enctype="multipart/form-data" class="p-6 space-y-3">
        <input type=hidden name=_csrf value="${csrf}">
        <input type=hidden name=action value=add_produit_v2>
        <input type=hidden name=return_page value="${returnPage||'produits'}">
        ${modalField('Nom du produit *', 'nom', 'text', '', 'Ex: Câble USB-C 1m')}
        ${modalRow([
            modalField('Catégorie *', 'categorie_id', 'select', '', '', cats),
            modalField('Marque', 'marque', 'text', '', 'Ex: Samsung'),
        ])}
        ${modalRow([
            modalField('Référence', 'reference', 'text', '', 'REF-001'),
            modalField('Code-barres', 'code_barre', 'text', '', 'Scan ou saisir'),
        ])}
        <div class="bg-blue-50 rounded-xl p-3 border border-blue-200">
            <div class="text-xs font-bold text-blue-700 mb-2"><i class="bi bi-calculator"></i> Prix d'achat</div>
            <div class="grid grid-cols-3 gap-2">
                <div><label class="text-xs font-bold text-gray-500">TTC (DT) *</label><input name="prix_achat_ttc_input" type="number" step="0.01" placeholder="0.00" class="w-full border-2 border-blue-300 rounded-xl px-3 py-2 text-sm font-bold focus:border-asel" id="pa_ttc_input"></div>
                ${modalField('TVA %', 'tva_rate', 'number', '19', '')}
                <div><label class="text-xs font-bold text-gray-500">HT (auto)</label><input name="prix_achat_ht" id="pa_ht_display" readonly class="w-full border-2 border-gray-200 rounded-xl px-3 py-2 text-sm bg-gray-100"></div>
            </div>
        </div>
        <div class="bg-green-50 rounded-xl p-3 border border-green-200">
            <div class="text-xs font-bold text-green-700 mb-2"><i class="bi bi-tag"></i> Prix de vente</div>
            <div class="grid grid-cols-3 gap-2">
                <div><label class="text-xs font-bold text-gray-500">TTC (DT) *</label><input name="prix_vente_ttc_input" type="number" step="0.01" placeholder="0.00" class="w-full border-2 border-green-300 rounded-xl px-3 py-2 text-sm font-bold text-green-700 focus:border-asel" id="pv_ttc_input"></div>
                <div><label class="text-xs font-bold text-gray-500">TVA %</label><input readonly class="w-full border-2 border-gray-200 rounded-xl px-3 py-2 text-sm bg-gray-100" id="tva_display"></div>
                <div><label class="text-xs font-bold text-gray-500">HT (auto)</label><input name="prix_vente_ht" id="pv_ht_display" readonly class="w-full border-2 border-gray-200 rounded-xl px-3 py-2 text-sm bg-gray-100"></div>
            </div>
        </div>
        ${modalRow([
            modalField('Fournisseur', 'fournisseur_id', 'select', '', '', fourns),
            modalField('Seuil alerte', 'seuil_alerte', 'number', '3', ''),
        ])}
        <div class="bg-yellow-50 rounded-xl p-3 border border-yellow-200">
            <div class="text-xs font-bold text-yellow-700 mb-2"><i class="bi bi-box-seam"></i> Stock initial (optionnel)</div>
            <div class="grid grid-cols-2 gap-2">
                ${modalField('Franchise', 'init_franchise_id', 'select', '', '', franchAll)}
                ${modalField('Quantité', 'stock_initial', 'number', '0', '0')}
            </div>
        </div>
        <button type=submit class="w-full py-2.5 rounded-xl bg-gradient-to-r from-asel to-asel-dark text-white font-bold text-sm">✅ Ajouter le produit</button>
        </form>`,
        {size: 'max-w-lg'}
    );
    
    // Auto-calc HT from TTC + TVA
    function recalcPrices(){
        const tva = parseFloat(document.querySelector('[name=tva_rate]')?.value || 19);
        const pa_ttc = parseFloat(document.getElementById('pa_ttc_input')?.value || 0);
        const pv_ttc = parseFloat(document.getElementById('pv_ttc_input')?.value || 0);
        const pa_ht = (pa_ttc / (1 + tva/100)).toFixed(2);
        const pv_ht = (pv_ttc / (1 + tva/100)).toFixed(2);
        document.getElementById('pa_ht_display').value = pa_ht;
        document.getElementById('pv_ht_display').value = pv_ht;
        document.getElementById('tva_display').value = tva + '%';
    }
    setTimeout(()=>{
        document.getElementById('pa_ttc_input')?.addEventListener('input', recalcPrices);
        document.getElementById('pv_ttc_input')?.addEventListener('input', recalcPrices);
        document.querySelector('[name=tva_rate]')?.addEventListener('input', recalcPrices);
        recalcPrices();
    }, 100);
}

// Quick client add modal
</script>
<script>
function openQuickAddClient() {
    const csrf = '<?=$csrf?>';
    const isAdmin = <?=can('view_all_franchises')?'true':'false'?>;
    const franchises = <?=json_encode(array_map(fn($f)=>['value'=>$f['id'],'label'=>shortF($f['nom'])], $allFranchises ?? []))?>;
    
    let franchiseField = '';
    if (isAdmin) {
        franchiseField = modalField('Franchise', 'franchise_id', 'select', '', '', franchises);
    }
    
    openModal(
        modalHeader('bi-person-plus', 'Nouveau client', 'Ajouter un client au répertoire') +
        modalForm('add_client', csrf,
            franchiseField +
            modalRow([
                modalField('Nom *', 'nom', 'text', '', 'Nom de famille'),
                modalField('Prénom', 'prenom', 'text', '', 'Prénom'),
            ]) +
            modalField('Type', 'type_client', 'select', '', '', [
                {value: 'passager', label: 'Passager'},
                {value: 'boutique', label: 'Client boutique'},
                {value: 'entreprise', label: 'Entreprise'},
            ]) +
            modalRow([
                modalField('Téléphone', 'telephone', 'tel', '', '+216 XX XXX XXX'),
                modalField('Email', 'email', 'email', '', 'email@exemple.com'),
            ]) +
            modalRow([
                modalField('Entreprise', 'entreprise', 'text', '', 'Nom entreprise'),
                modalField('Matricule fiscal', 'matricule_fiscal', 'text', '', '0000000/X/X/X/000'),
            ]) +
            modalField('Adresse', 'adresse', 'text', '', 'Adresse complète') +
            modalField('Notes', 'notes', 'textarea', '', 'Notes internes...'),
            'Ajouter le client'
        )
    );
}

// Edit client click handler (uses data attributes to avoid quote issues)
document.addEventListener('click', function(e) {
    const btn = e.target.closest('.edit-client-btn');
    if (!btn) return;
    openEditClient(
        btn.dataset.id, btn.dataset.nom, btn.dataset.prenom,
        btn.dataset.tel, btn.dataset.email, btn.dataset.type,
        btn.dataset.entreprise, btn.dataset.mf, btn.dataset.adresse,
        btn.dataset.notes, btn.dataset.actif
    );
});

function openEditClient(id, nom, prenom, tel, email, type, entreprise, mf, adresse, notes, actif) {
    const csrf = '<?=$csrf?>';
    openModal(
        modalHeader('bi-pencil-square', 'Modifier client', nom + ' ' + prenom) +
        `<form method="POST" class="p-6 space-y-4" onsubmit="this.querySelector('button[type=submit]').disabled=true">
        <input type="hidden" name="_csrf" value="${csrf}">
        <input type="hidden" name="action" value="edit_client">
        <input type="hidden" name="client_id" value="${id}">` +
        modalRow([
            modalField('Nom *', 'nom', 'text', nom, ''),
            modalField('Prénom', 'prenom', 'text', prenom, ''),
        ]) +
        modalField('Type', 'type_client', 'select', '', '', [
            {value: 'passager', label: 'Passager', selected: type==='passager'},
            {value: 'boutique', label: 'Client boutique', selected: type==='boutique'},
            {value: 'entreprise', label: 'Entreprise', selected: type==='entreprise'},
        ]) +
        modalRow([
            modalField('Téléphone', 'telephone', 'tel', tel, ''),
            modalField('Email', 'email', 'email', email, ''),
        ]) +
        modalRow([
            modalField('Entreprise', 'entreprise', 'text', entreprise, ''),
            modalField('Matricule fiscal', 'matricule_fiscal', 'text', mf, ''),
        ]) +
        modalField('Adresse', 'adresse', 'text', adresse, '') +
        modalField('Notes', 'notes', 'textarea', notes, '') +
        modalField('Actif', 'actif', 'select', '', '', [
            {value: '1', label: 'Oui', selected: actif==1},
            {value: '0', label: 'Non', selected: actif==0},
        ]) +
        `<div class="flex gap-3 pt-2">
            <button type="button" onclick="closeModal()" class="flex-1 py-2.5 rounded-xl border-2 border-gray-200 text-gray-600 font-semibold text-sm hover:bg-gray-50">Annuler</button>
            <button type="submit" class="flex-1 py-2.5 rounded-xl bg-asel hover:bg-asel-dark text-white font-semibold text-sm flex items-center justify-center gap-2">
                <i class="bi bi-check-circle"></i> Enregistrer
            </button>
        </div></form>`,
        {size: 'max-w-lg'}
    );
}
</script>
<script>
// Quick stock entry modal
function openQuickDispatch(produitId, produitNom) {
    const csrf = '<?=$csrf?>';
    const franchises = <?=json_encode(array_map(fn($f) => ['value' => $f['id'], 'label' => shortF($f['nom'])], $franchises ?? []))?>;
    openModal(
        modalHeader('bi-truck', 'Dispatch rapide', produitNom) +
        `<form method="POST" class="p-6 space-y-4">
            <input type="hidden" name="_csrf" value="${csrf}">
            <input type="hidden" name="action" value="dispatch_stock">
            <input type="hidden" name="produit_id" value="${produitId}">
            ${modalField('Franchise destination *', 'franchise_id', 'select', '', '', franchises)}
            ${modalRow([
                modalField('Quantité *', 'quantite', 'number', '1', '1'),
                modalField('Note', 'note', 'text', '', 'Optionnel'),
            ])}
            <div class="flex gap-3">
                <button type="button" onclick="closeModal()" class="flex-1 py-2.5 rounded-xl border-2 border-gray-200 text-gray-600 font-semibold text-sm">Annuler</button>
                <button type="submit" class="flex-1 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-sm flex items-center justify-center gap-2 transition-colors">
                    <i class="bi bi-truck"></i> Dispatcher
                </button>
            </div>
        </form>`,
        {size: 'max-w-sm'}
    );
}

function openQuickStockEntry(franchiseId, franchiseName) {
    const csrf = '<?=$csrf?>';
    const prods = <?=json_encode(array_map(fn($p) => ['value' => $p['id'], 'label' => $p['nom'].' ('.$p['cat_nom'].')'], $produits ?? []))?>;
    openModal(
        modalHeader('bi-box-arrow-in-down', 'Entrée de stock', franchiseName ? 'Franchise: ' + franchiseName : '') +
        `<form method="POST" class="p-6 space-y-4">
            <input type="hidden" name="_csrf" value="${csrf}">
            <input type="hidden" name="action" value="entree_stock">
            <input type="hidden" name="franchise_id" value="${franchiseId}">
            ${modalField('Produit', 'produit_id', 'select', '', '', prods)}
            ${modalRow([
                modalField('Quantité', 'quantite', 'number', '1', ''),
                modalField('Note / BL', 'note', 'text', '', 'Fournisseur, BL...'),
            ])}
            <div class="flex gap-3 pt-2">
                <button type="button" onclick="closeModal()" class="flex-1 py-2.5 rounded-xl border-2 border-gray-200 text-gray-600 font-semibold text-sm">Annuler</button>
                <button type="submit" class="flex-1 py-2.5 rounded-xl bg-asel hover:bg-asel-dark text-white font-semibold text-sm flex items-center justify-center gap-2">
                    <i class="bi bi-check-circle"></i> Enregistrer
                </button>
            </div>
        </form>`
    );
}

// Confirm delete with proper dialog
function confirmDelete(formId, itemName) {
    showConfirm(
        'Supprimer ?',
        `Voulez-vous vraiment supprimer "${itemName}" ? Cette action est irréversible.`,
        'danger',
        () => document.getElementById(formId).submit()
    );
}

// Confirm cancel facture
function confirmCancelFacture(formId, numero) {
    showConfirm(
        'Annuler la facture ?',
        `Facture ${numero} sera annulée et le stock restauré. Cette action est irréversible.`,
        'danger',
        () => document.getElementById(formId).submit()
    );
}

// Quick transfer request modal
function openQuickTransfer() {
    const csrf = '<?=$csrf?>';
    const franchises = <?=json_encode(array_map(fn($f) => ['value' => $f['id'], 'label' => shortF($f['nom'])], $allFranchises ?? []))?>;
    const prods = <?=json_encode(array_map(fn($p) => ['value' => $p['id'], 'label' => $p['nom'].' ('.$p['cat_nom'].')'], $produits ?? []))?>;
    openModal(
        modalHeader('bi-arrow-left-right', 'Demander un transfert', 'Transférer du stock entre franchises') +
        modalForm('transfert', csrf,
            modalRow([
                modalField('Source', 'source', 'select', '', '', franchises),
                modalField('Destination', 'dest', 'select', '', '', franchises),
            ]) +
            modalField('Produit', 'produit_id', 'select', '', '', prods) +
            modalRow([
                modalField('Quantité', 'quantite', 'number', '1', ''),
                modalField('Note', 'note', 'text', '', 'Raison du transfert'),
            ]),
            'Envoyer la demande', 'bg-blue-500 hover:bg-blue-600'
        )
    );
}

// Quick retour modal
function openQuickRetour(franchiseId) {
    const csrf = '<?=$csrf?>';
    const prods = <?=json_encode(array_map(fn($p) => ['value' => $p['id'], 'label' => $p['nom'].' ('.$p['cat_nom'].')'], $produits ?? []))?>;
    openModal(
        modalHeader('bi-arrow-counterclockwise', 'Retour / Échange', 'Enregistrer un retour produit') +
        modalForm('retour', csrf,
            `<input type="hidden" name="franchise_id" value="${franchiseId}">` +
            modalField('Produit', 'produit_id', 'select', '', '', prods) +
            modalRow([
                modalField('Quantité', 'quantite', 'number', '1', ''),
                modalField('Type', 'type_retour', 'select', '', '', [
                    {value: 'retour', label: 'Retour (stock récupéré)'},
                    {value: 'echange', label: 'Échange (remplacement)'},
                ]),
            ]) +
            modalField('Raison', 'raison', 'text', '', 'Produit défectueux, erreur...'),
            'Enregistrer', 'bg-amber-500 hover:bg-amber-600'
        )
    );
}

// View product details modal
function viewProductDetails(id, nom, ref, marque, cat, pa, pv, code, seuil) {
    const marge = pv > 0 ? ((pv - pa) / pv * 100).toFixed(1) : 0;
    const margeColor = marge >= 30 ? 'text-green-600' : marge >= 15 ? 'text-amber-600' : 'text-red-600';
    openModal(
        modalHeader('bi-box-seam', nom, ref + ' · ' + marque) +
        `<div class="p-6 space-y-4">
            <div id="prodDetailImg${id}" class="hidden w-full h-32 rounded-xl overflow-hidden bg-gray-100 mb-3"></div>
            <div class="grid grid-cols-2 gap-4">
                <div class="bg-gray-50 rounded-xl p-3 text-center">
                    <div class="text-[10px] text-gray-400 uppercase font-bold">Prix achat</div>
                    <div class="text-xl font-black text-gray-600">${pa.toFixed(1)} DT</div>
                </div>
                <div class="bg-gray-50 rounded-xl p-3 text-center">
                    <div class="text-[10px] text-gray-400 uppercase font-bold">Prix vente</div>
                    <div class="text-xl font-black text-asel">${pv.toFixed(1)} DT</div>
                </div>
            </div>
            <div class="grid grid-cols-3 gap-3">
                <div class="text-center">
                    <div class="text-[10px] text-gray-400 uppercase font-bold">Marge</div>
                    <div class="text-lg font-black ${margeColor}">${marge}%</div>
                </div>
                <div class="text-center">
                    <div class="text-[10px] text-gray-400 uppercase font-bold">Bénéfice/unité</div>
                    <div class="text-lg font-black text-green-600">${(pv - pa).toFixed(1)} DT</div>
                </div>
                <div class="text-center">
                    <div class="text-[10px] text-gray-400 uppercase font-bold">Seuil alerte</div>
                    <div class="text-lg font-black text-gray-600">${seuil}</div>
                </div>
            </div>
            <div class="pt-2 border-t border-gray-100 text-xs text-gray-400 space-y-1">
                <div><strong>Catégorie:</strong> ${cat}</div>
                <div><strong>Référence:</strong> ${ref || '—'}</div>
                <div><strong>Code-barres:</strong> <span class="font-mono">${code || '—'}</span></div>
            </div>
            <div class="border-t pt-3">
                <div class="flex justify-between items-center mb-2">
                    <h4 class="font-bold text-sm text-asel-dark"><i class="bi bi-truck"></i> Fournisseurs</h4>
                    <button onclick="showAddFournisseurForm(${id})" class="text-xs text-asel hover:underline"><i class="bi bi-plus-circle"></i> Ajouter</button>
                </div>
                <div id="prodFournList${id}" class="text-xs text-gray-400">Chargement...</div>
            </div>
            <div id="addFournForm${id}" class="hidden border-t pt-3"></div>
            <button onclick="closeModal()" class="w-full py-2.5 rounded-xl border-2 border-gray-200 text-gray-600 font-semibold text-sm hover:bg-gray-50">Fermer</button>
        </div>`,
        {size: 'max-w-md'}
    );
    // Load product image
    loadProductImage(id, function(imgSrc) {
        var imgDiv = document.getElementById('prodDetailImg' + id);
        if (imgDiv) {
            imgDiv.innerHTML = '<img src="' + imgSrc + '" class="w-full h-full object-contain">';
            imgDiv.classList.remove('hidden');
        }
    });
    // Load fournisseurs for this product
    fetch('api.php?action=get_product_fournisseurs&produit_id=' + id)
        .then(function(r){ return r.json(); })
        .then(function(links){
            var el = document.getElementById('prodFournList' + id);
            if (!links || !links.length) {
                el.innerHTML = '<p class="text-gray-400 text-xs py-2">Aucun fournisseur lié</p>';
                return;
            }
            var html = '<div class="space-y-2">';
            links.forEach(function(l){
                html += '<div class="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2">' +
                    '<div class="flex-1"><span class="font-semibold text-sm">' + l.fournisseur_nom + '</span>' +
                    (l.is_default == 1 ? ' <span class="bg-asel text-white text-[9px] px-1.5 py-0.5 rounded-full">Défaut</span>' : '') +
                    '<div class="text-[10px] text-gray-400">PA HT: ' + parseFloat(l.prix_achat_ht).toFixed(2) + ' · TTC: ' + parseFloat(l.prix_achat_ttc).toFixed(2) + '</div>' +
                    (l.reference_fournisseur ? '<div class="text-[10px] text-gray-400">Réf: ' + l.reference_fournisseur + '</div>' : '') +
                    '</div>' +
                    '<form method="POST" class="inline" onsubmit="return confirm(\'Dissocier ce fournisseur?\')">' +
                    '<input type="hidden" name="_csrf" value="<?=$csrf?>">' +
                    '<input type="hidden" name="action" value="remove_product_fournisseur">' +
                    '<input type="hidden" name="produit_id" value="' + id + '">' +
                    '<input type="hidden" name="link_id" value="' + l.id + '">' +
                    '<button class="text-red-400 hover:text-red-600"><i class="bi bi-x-circle"></i></button>' +
                    '</form></div>';
            });
            html += '</div>';
            el.innerHTML = html;
        })
        .catch(function(){ document.getElementById('prodFournList' + id).innerHTML = '<p class="text-red-400 text-xs">Erreur</p>'; });
}

function showAddFournisseurForm(prodId) {
    var fourns = <?=json_encode(array_map(fn($f)=>['id'=>$f['id'],'nom'=>$f['nom']], $fournisseurs ?? []))?>;
    var opts = fourns.map(function(f){ return '<option value="' + f.id + '">' + f.nom + '</option>'; }).join('');
    var el = document.getElementById('addFournForm' + prodId);
    el.classList.remove('hidden');
    el.innerHTML = '<form method="POST" class="space-y-2">' +
        '<input type="hidden" name="_csrf" value="<?=$csrf?>">' +
        '<input type="hidden" name="action" value="add_product_fournisseur">' +
        '<input type="hidden" name="produit_id" value="' + prodId + '">' +
        '<input type="hidden" name="tva_rate" value="19">' +
        '<div class="grid grid-cols-2 gap-2">' +
        '<div><label class="text-[10px] font-bold text-gray-400">Fournisseur *</label><select name="fournisseur_id" required class="w-full border rounded-lg px-2 py-1.5 text-xs">' + opts + '</select></div>' +
        '<div><label class="text-[10px] font-bold text-gray-400">Prix achat HT</label><input name="prix_achat_ht" type="number" step="0.01" class="w-full border rounded-lg px-2 py-1.5 text-xs" required></div>' +
        '</div>' +
        '<div class="grid grid-cols-2 gap-2">' +
        '<div><label class="text-[10px] font-bold text-gray-400">Réf fournisseur</label><input name="reference_fournisseur" class="w-full border rounded-lg px-2 py-1.5 text-xs"></div>' +
        '<div><label class="text-[10px] font-bold text-gray-400">Défaut?</label><select name="is_default" class="w-full border rounded-lg px-2 py-1.5 text-xs"><option value="0">Non</option><option value="1">Oui</option></select></div>' +
        '</div>' +
        '<button type="submit" class="bg-asel text-white px-4 py-1.5 rounded-lg text-xs font-bold w-full"><i class="bi bi-link-45deg"></i> Lier le fournisseur</button>' +
        '</form>';
}

// Receipt preview modal
function previewReceipt(factureId) {
    openModal(
        modalHeader('bi-receipt', 'Aperçu ticket', 'Ticket de caisse') +
        `<div class="p-6"><div class="text-center text-gray-400 py-8"><i class="bi bi-hourglass-split text-3xl"></i><p class="mt-2 text-sm">Chargement...</p></div></div>`,
        {size: 'max-w-sm'}
    );
    fetch('api.php?action=receipt&id=' + factureId)
        .then(r => r.json())
        .then(data => {
            if (data.error) { document.getElementById('modalContent').querySelector('.p-6').innerHTML = '<p class="text-red-500 text-center">Erreur: ' + data.error + '</p>'; return; }
            const f = data.facture;
            const lignes = data.lignes;
            let html = `<div class="p-6 font-mono text-xs">
                <div class="text-center mb-4">
                    <div class="font-bold text-base">ASEL MOBILE</div>
                    <div>${f.franchise_nom || ''}</div>
                    <div>${f.franchise_tel || ''}</div>
                    <div class="mt-2 border-b border-dashed border-gray-300 pb-2">
                        <strong>${f.numero}</strong><br>
                        ${new Date(f.date_facture).toLocaleString('fr-TN')}
                    </div>
                </div>
                <table class="w-full"><tbody>`;
            lignes.forEach(l => {
                html += `<tr><td class="py-0.5">${l.designation}</td><td class="text-right">${l.quantite}×${parseFloat(l.prix_unitaire).toFixed(1)}</td><td class="text-right font-bold">${parseFloat(l.total).toFixed(1)}</td></tr>`;
            });
            html += `</tbody></table>
                <div class="border-t border-dashed border-gray-300 mt-2 pt-2 text-right">
                    <div class="text-base font-bold">TOTAL: ${parseFloat(f.total_ttc).toFixed(2)} DT</div>
                    ${f.mode_paiement ? '<div class="text-gray-400">Paiement: ' + f.mode_paiement + '</div>' : ''}
                </div>
                <div class="text-center mt-4 text-gray-400">Merci pour votre achat!</div>
                <div class="flex gap-2 mt-4">
                    <a href="receipt.php?id=${f.id}" target="_blank" class="flex-1 py-2 rounded-lg bg-asel text-white text-center text-xs font-bold">🖨️ Imprimer</a>
                    <a href="pdf.php?type=facture&id=${f.id}" target="_blank" class="flex-1 py-2 rounded-lg bg-gray-100 text-gray-600 text-center text-xs font-bold">📄 PDF</a>
                </div>
            </div>`;
            document.getElementById('modalContent').innerHTML = modalHeader('bi-receipt', 'Ticket ' + f.numero, f.franchise_nom || '') + html;
        })
        .catch(e => {
            document.getElementById('modalContent').querySelector('.p-6').innerHTML = '<p class="text-red-500 text-center">Erreur de chargement</p>';
        });
}

// === CATEGORY MODAL ===
function openAddCategory() {
    const csrf = '<?=$csrf?>';
    openModal(
        modalHeader('bi-folder-plus', 'Nouvelle catégorie', 'Ajouter une catégorie de produits') +
        modalForm('add_category', csrf,
            modalField('Nom de la catégorie *', 'nom', 'text', '', 'Ex: Câbles, Chargeurs, Écouteurs...') +
            modalField('Description', 'description', 'textarea', '', 'Description optionnelle...'),
            'Créer la catégorie'
        ),
        {size: 'max-w-md'}
    );
}

// === EDIT PRODUCT MODAL (with barcode scanner) ===
function openEditProduct(id, nom, catId, marque, ref, code, pa, pv, seuil, pa_ht, pv_ht, tva_rate, description) {
    pa_ht = pa_ht || parseFloat((pa / 1.19).toFixed(2));
    pv_ht = pv_ht || parseFloat((pv / 1.19).toFixed(2));
    tva_rate = tva_rate || 19;
    description = description || '';
    const csrf = '<?=$csrf?>';
    const cats = <?=json_encode(array_map(fn($c) => ['value' => $c['id'], 'label' => $c['nom']], $categories ?? []))?>;
    const fourns = <?=json_encode(array_map(fn($f) => ['value' => $f['id'], 'label' => $f['nom']], $fournisseurs ?? []))?>;
    cats.forEach(c => c.selected = (c.value == catId));
    
    openModal(
        modalHeader('bi-pencil', 'Modifier le produit', nom) +
        `<form method="POST" enctype="multipart/form-data" class="p-5 space-y-3" id="editProdForm_${id}">
            <input type="hidden" name="_csrf" value="${csrf}">
            <input type="hidden" name="action" value="edit_produit">
            <input type="hidden" name="produit_id" value="${id}">
            ${modalField('Nom *', 'nom', 'text', nom, 'Nom du produit')}
            ${modalRow([
                modalField('Catégorie', 'categorie_id', 'select', '', '', cats),
                modalField('Marque', 'marque', 'text', marque, 'Marque'),
            ])}
            ${modalRow([
                modalField('Référence', 'reference', 'text', ref, 'REF-001'),
                `<div><label class="text-xs font-bold text-gray-500 uppercase tracking-wider block mb-1">Code-barres</label>
                <div class="flex gap-1">
                    <input type="text" name="code_barre" value="${code}" placeholder="Scan..."
                        class="flex-1 border-2 border-gray-200 rounded-xl px-3 py-2.5 text-sm font-mono focus:border-asel outline-none" id="editBarcode_${id}">
                    <button type="button" onclick="openScanner('editBarcode_${id}')" class="px-2.5 bg-asel/10 text-asel rounded-xl hover:bg-asel hover:text-white transition-colors" title="Scanner">
                        <i class="bi bi-upc-scan text-sm"></i>
                    </button>
                </div></div>`
            ])}
            <!-- Prix avec HT/TVA/TTC — both editable -->
            <div class="grid grid-cols-3 gap-2 bg-blue-50 rounded-xl p-3 border border-blue-200">
                <div class="col-span-3 text-xs font-bold text-blue-700 mb-1"><i class="bi bi-calculator"></i> Prix d'achat</div>
                <div><label class="text-[10px] font-bold text-gray-400">HT (DT)</label>
                    <input type="number" name="prix_achat_ht" id="ep_pa_ht_${id}" value="${pa_ht}" step="0.01" min="0"
                        class="w-full border-2 border-gray-200 rounded-lg px-2 py-2 text-sm focus:border-asel outline-none" oninput="epRecalcFromHT(${id})"></div>
                <div><label class="text-[10px] font-bold text-gray-400">TVA %</label>
                    <input type="number" name="tva_rate" id="ep_tva_${id}" value="${tva_rate}" step="0.01" min="0"
                        class="w-full border-2 border-gray-200 rounded-lg px-2 py-2 text-sm focus:border-asel outline-none" oninput="epRecalcFromHT(${id})"></div>
                <div><label class="text-[10px] font-bold text-gray-400">TTC (DT)</label>
                    <input type="number" id="ep_pa_ttc_${id}" step="0.01" min="0" value="${(pa_ht * (1 + tva_rate/100)).toFixed(2)}"
                        class="w-full border-2 border-blue-300 rounded-lg px-2 py-2 text-sm font-bold text-blue-700 focus:border-asel outline-none" oninput="epRecalcFromTTC(${id},'pa')"></div>
            </div>
            <div class="grid grid-cols-3 gap-2 bg-green-50 rounded-xl p-3 border border-green-200">
                <div class="col-span-3 text-xs font-bold text-green-700 mb-1"><i class="bi bi-tag"></i> Prix de vente</div>
                <div><label class="text-[10px] font-bold text-gray-400">HT (DT)</label>
                    <input type="number" name="prix_vente_ht" id="ep_pv_ht_${id}" value="${pv_ht}" step="0.01" min="0"
                        class="w-full border-2 border-gray-200 rounded-lg px-2 py-2 text-sm focus:border-asel outline-none" oninput="epRecalcFromHT(${id})"></div>
                <div><label class="text-[10px] font-bold text-gray-400">Marge</label>
                    <div id="ep_marge_${id}" class="w-full border-2 border-gray-100 bg-gray-50 rounded-lg px-2 py-2 text-sm font-bold text-center text-green-700 mt-0">—</div></div>
                <div><label class="text-[10px] font-bold text-gray-400">TTC (DT)</label>
                    <input type="number" id="ep_pv_ttc_${id}" step="0.01" min="0" value="${(pv_ht * (1 + tva_rate/100)).toFixed(2)}"
                        class="w-full border-2 border-green-300 rounded-lg px-2 py-2 text-sm font-bold text-green-700 focus:border-asel outline-none" oninput="epRecalcFromTTC(${id},'pv')"></div>
            </div>
            <!-- Hidden fields for compat -->
            <input type="hidden" name="prix_achat" id="ep_pa_${id}" value="${pa}">
            <input type="hidden" name="prix_vente" id="ep_pv_${id}" value="${pv}">
            ${modalRow([
                modalField('Seuil alerte', 'seuil', 'number', seuil, '3'),
                modalField('Description', 'description', 'text', description, 'Optionnel'),
            ])}
            <div class="bg-gray-50 rounded-xl p-3 border">
                <label class="text-[10px] font-bold text-gray-400 uppercase block mb-1">📸 Image produit</label>
                <div class="flex items-center gap-3">
                    <div id="ep_img_preview_${id}" class="w-16 h-16 rounded-lg bg-gray-200 flex items-center justify-center text-gray-400 text-2xl overflow-hidden shrink-0">
                        ${window._prodImages && window._prodImages[id] ? '<img src="'+window._prodImages[id]+'" class="w-full h-full object-cover">' : '<i class="bi bi-image"></i>'}
                    </div>
                    <div class="flex-1">
                        <input type="file" name="product_image" accept="image/jpeg,image/png,image/webp" class="text-xs w-full" onchange="previewImg(this, 'ep_img_preview_${id}')">
                        <div class="text-[9px] text-gray-400 mt-1">Max 2MB · JPG, PNG, WebP</div>
                    </div>
                    ${window._prodImages && window._prodImages[id] ? '<label class="text-xs text-red-400 cursor-pointer"><input type="checkbox" name="remove_image" value="1" class="mr-1">Supprimer</label>' : ''}
                </div>
            </div>
            <div class="flex gap-3 pt-2">
                <button type="button" onclick="closeModal()" class="flex-1 py-2.5 rounded-xl border-2 border-gray-200 text-gray-600 font-semibold text-sm">Annuler</button>
                <button type="submit" class="flex-1 py-2.5 rounded-xl bg-asel hover:bg-asel-dark text-white font-bold text-sm flex items-center justify-center gap-2 transition-colors">
                    <i class="bi bi-check-circle"></i> Sauvegarder
                </button>
            </div>
        </form>`,
        {size: 'max-w-lg'}
    );
    
    // Init calculations
    setTimeout(() => { epRecalc(id); }, 50);
}

// Recalc TTC from HT (user edited HT)
function epRecalcFromHT(id) {
    var pa_ht = parseFloat(document.getElementById('ep_pa_ht_'+id).value || 0);
    var pv_ht = parseFloat(document.getElementById('ep_pv_ht_'+id).value || 0);
    var tva = parseFloat(document.getElementById('ep_tva_'+id).value || 19);
    var pa_ttc = (pa_ht * (1 + tva/100)).toFixed(2);
    var pv_ttc = (pv_ht * (1 + tva/100)).toFixed(2);
    document.getElementById('ep_pa_ttc_'+id).value = pa_ttc;
    document.getElementById('ep_pv_ttc_'+id).value = pv_ttc;
    epUpdateMarge(id, pa_ht, pv_ht, pa_ttc, pv_ttc);
}

// Recalc HT from TTC (user edited TTC)
function epRecalcFromTTC(id, which) {
    var tva = parseFloat(document.getElementById('ep_tva_'+id).value || 19);
    if (which === 'pa') {
        var pa_ttc = parseFloat(document.getElementById('ep_pa_ttc_'+id).value || 0);
        var pa_ht = (pa_ttc / (1 + tva/100)).toFixed(2);
        document.getElementById('ep_pa_ht_'+id).value = pa_ht;
    } else {
        var pv_ttc = parseFloat(document.getElementById('ep_pv_ttc_'+id).value || 0);
        var pv_ht = (pv_ttc / (1 + tva/100)).toFixed(2);
        document.getElementById('ep_pv_ht_'+id).value = pv_ht;
    }
    var pa_ht_f = parseFloat(document.getElementById('ep_pa_ht_'+id).value || 0);
    var pv_ht_f = parseFloat(document.getElementById('ep_pv_ht_'+id).value || 0);
    var pa_ttc_f = parseFloat(document.getElementById('ep_pa_ttc_'+id).value || 0);
    var pv_ttc_f = parseFloat(document.getElementById('ep_pv_ttc_'+id).value || 0);
    epUpdateMarge(id, pa_ht_f, pv_ht_f, pa_ttc_f, pv_ttc_f);
}

function epUpdateMarge(id, pa_ht, pv_ht, pa_ttc, pv_ttc) {
    var marge = pv_ht > 0 ? Math.round((pv_ht - pa_ht) / pv_ht * 100) : 0;
    var marge_el = document.getElementById('ep_marge_'+id);
    var pa_el = document.getElementById('ep_pa_'+id);
    var pv_el = document.getElementById('ep_pv_'+id);
    if(marge_el) { marge_el.textContent = marge + '%'; marge_el.className = 'w-full border-2 border-gray-100 bg-gray-50 rounded-lg px-2 py-2 text-sm font-bold text-center mt-0 ' + (marge >= 20 ? 'text-green-700' : marge >= 10 ? 'text-yellow-600' : 'text-red-600'); }
    if(pa_el) pa_el.value = pa_ttc;
    if(pv_el) pv_el.value = pv_ttc;
}

// Legacy compat
function epRecalc(id) { epRecalcFromHT(id); }

// Image preview for file inputs
function previewImg(input, previewId) {
    var preview = document.getElementById(previewId);
    if (!preview) return;
    if (input.files && input.files[0]) {
        var reader = new FileReader();
        reader.onload = function(e) {
            preview.innerHTML = '<img src="' + e.target.result + '" class="w-full h-full object-cover">';
        };
        reader.readAsDataURL(input.files[0]);
    }
}

// Product images — loaded on demand via API
window._prodImages = {};
function loadProductImage(pid, callback) {
    if (window._prodImages[pid]) { callback(window._prodImages[pid]); return; }
    fetch('api.php?action=get_product_image&id=' + pid)
        .then(function(r){ return r.json(); })
        .then(function(d){
            if (d.image) { window._prodImages[pid] = d.image; callback(d.image); }
        }).catch(function(){});
}

// === ADD USER MODAL ===
function openAddUser() {
    const csrf = '<?=$csrf?>';
    const franchises = <?=json_encode(array_map(fn($f) => ['value' => $f['id'], 'label' => shortF($f['nom'])], $franchises ?? []))?>;
    franchises.unshift({value: '', label: '— Aucune (admin) —'});
    openModal(
        modalHeader('bi-person-plus', 'Nouvel utilisateur', 'Créer un compte employé') +
        modalForm('add_user', csrf,
            modalRow([
                modalField('Login *', 'username', 'text', '', 'Identifiant unique'),
                modalField('Mot de passe *', 'password', 'password', '', 'Min. 6 caractères'),
            ]) +
            modalRow([
                modalField('Nom *', 'nom_complet', 'text', '', 'Nom de famille'),
                modalField('Prénom', 'prenom', 'text', '', 'Prénom'),
            ]) +
            modalRow([
                modalField('🪪 CIN', 'cin', 'text', '', '12345678'),
                modalField('📞 Téléphone', 'telephone', 'tel', '', '+216 XX XXX XXX'),
            ]) +
            modalRow([
                modalField('Rôle', 'role', 'select', '', '', [
                    {value: 'vendeur', label: '🛒 Vendeur (POS + caisse)'},
                    {value: 'franchise', label: '🏪 Franchise (gestion complète)'},
                    {value: 'gestionnaire', label: '📦 Gestionnaire (stock central)'},
                    {value: 'admin', label: '👑 Administrateur'},
                    {value: 'superadmin', label: '🔐 Super Admin (lecture seule)'},
                    {value: 'viewer', label: '👁️ Viewer (lecture seule basique)'},
                ]),
                modalField('Franchise', 'franchise_id', 'select', '', '', franchises),
            ]),
            'Créer le compte'
        )
    );
}

// === EDIT USER MODAL ===
function openEditUser(id, nom, role, franchiseId, actif) {
    const csrf = '<?=$csrf?>';
    const franchises = <?=json_encode(array_map(fn($f) => ['value' => $f['id'], 'label' => shortF($f['nom'])], $franchises ?? []))?>;
    franchises.unshift({value: '', label: '— Aucune —'});
    franchises.forEach(f => f.selected = (f.value == franchiseId));
    const roles = [
        {value: 'vendeur', label: '🛒 Vendeur', selected: role === 'vendeur'},
        {value: 'franchise', label: '🏪 Franchise', selected: role === 'franchise'},
        {value: 'gestionnaire', label: '📦 Gestionnaire', selected: role === 'gestionnaire'},
        {value: 'admin', label: '👑 Admin', selected: role === 'admin'},
        {value: 'superadmin', label: '🔐 Super Admin', selected: role === 'superadmin'},
        {value: 'viewer', label: '👁️ Viewer', selected: role === 'viewer'},
    ];
    openModal(
        modalHeader('bi-person-gear', 'Modifier utilisateur', nom) +
        `<form method="POST" class="p-6 space-y-4">
            <input type="hidden" name="_csrf" value="${csrf}">
            <input type="hidden" name="action" value="edit_user">
            <input type="hidden" name="user_id" value="${id}">
            ${modalField('Nom complet', 'nom_complet', 'text', nom, '')}
            ${modalRow([
                modalField('Rôle', 'role', 'select', '', '', roles),
                modalField('Franchise', 'franchise_id', 'select', '', '', franchises),
            ])}
            ${modalField('Nouveau mot de passe', 'new_password', 'password', '', 'Laisser vide pour garder l\'ancien')}
            ${modalField('Actif', 'actif', 'select', '', '', [
                {value: '1', label: 'Oui — actif', selected: actif == 1},
                {value: '0', label: 'Non — désactivé', selected: actif == 0},
            ])}
            <div class="flex gap-3 pt-2">
                <button type="button" onclick="closeModal()" class="flex-1 py-2.5 rounded-xl border-2 border-gray-200 text-gray-600 font-semibold text-sm">Annuler</button>
                <button type="submit" class="flex-1 py-2.5 rounded-xl bg-asel hover:bg-asel-dark text-white font-semibold text-sm flex items-center justify-center gap-2">
                    <i class="bi bi-check-circle"></i> Sauvegarder
                </button>
            </div>
        </form>`
    );
}

// === ADD SERVICE MODAL ===
function openAddService() {
    const csrf = '<?=$csrf?>';
    openModal(
        modalHeader('bi-wrench-adjustable', 'Nouveau service', 'Ajouter un service technique') +
        modalForm('add_service', csrf,
            modalField('Nom du service *', 'nom', 'text', '', 'Ex: Remplacement écran iPhone') +
            modalRow([
                modalField('Catégorie', 'categorie_service', 'select', '', '', [
                    {value: 'technique', label: 'Technique (réparation)'},
                    {value: 'compte', label: 'Compte (configuration)'},
                    {value: 'autre', label: 'Autre'},
                ]),
                modalField('Prix (DT)', 'prix', 'number', '', '0.00'),
            ]) +
            modalRow([
                modalField('Durée (minutes)', 'duree_minutes', 'number', '15', ''),
                modalField('', '', 'hidden', '', ''),
            ]) +
            modalField('Description', 'description', 'textarea', '', 'Description du service...'),
            'Ajouter le service'
        )
    );
}

// === ADD ASEL PRODUCT MODAL ===
function openAddAselProduct() {
    const csrf = '<?=$csrf?>';
    openModal(
        modalHeader('bi-sim', 'Nouvelle offre ASEL', 'Ajouter une recharge ou forfait') +
        modalForm('add_asel_product', csrf,
            modalField('Nom *', 'nom', 'text', '', 'Ex: Recharge 10 DT') +
            modalRow([
                modalField('Type', 'type_produit', 'select', '', '', [
                    {value: 'recharge_solde', label: 'Recharge solde'},
                    {value: 'recharge_internet', label: 'Forfait internet'},
                    {value: 'carte_sim', label: 'Carte SIM'},
                    {value: 'autre', label: 'Autre'},
                ]),
                modalField('Valeur nominale', 'valeur_nominale', 'number', '', '0.00'),
            ]) +
            modalRow([
                modalField('Prix vente (DT)', 'prix_vente', 'number', '', '0.00'),
                modalField('Commission (DT)', 'commission', 'number', '', '0.00'),
            ]),
            'Ajouter l\'offre'
        )
    );
}

// === SMART BARCODE SCAN & LOOKUP ===
function openBulkPriceModal() {
    const csrf = '<?=$csrf?>';
    const cats = <?=json_encode(array_map(fn($c) => ['value'=>$c['id'],'label'=>$c['nom']], $categories ?? []))?>;
    cats.unshift({value:0, label:'— Tous les produits —'});
    openModal(
        modalHeader('bi-percent','Ajustement global des prix','Modifier les prix en %') +
        `<form method="POST" class="p-6 space-y-4">
            <input type="hidden" name="_csrf" value="${csrf}">
            <input type="hidden" name="action" value="bulk_price_adjust">
            <div class="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-800">
                ⚠️ Cette action modifie les prix en base de données. Non réversible sans Export/Import.
            </div>
            ${modalField('Catégorie','cat_id','select','','',cats)}
            ${modalRow([
                modalField('Type de prix','price_type','select','','vente',[
                    {value:'vente',label:'Prix de vente'},
                    {value:'achat',label:"Prix d'achat"},
                    {value:'both',label:'Les deux'},
                ]),
                modalField('Direction','direction','select','','increase',[
                    {value:'increase',label:'Augmenter ↑'},
                    {value:'decrease',label:'Diminuer ↓'},
                ])
            ])}
            <div>
                <label class="text-xs font-bold text-gray-500 uppercase block mb-1">Pourcentage *</label>
                <div class="flex gap-2 items-center">
                    <input type="number" name="pct_change" min="0.1" max="100" step="0.1" value="5" required class="flex-1 border-2 border-gray-200 rounded-xl px-3 py-2.5 text-sm font-bold">
                    <span class="text-lg font-black text-purple-600">%</span>
                </div>
                <div class="flex gap-2 mt-2">
                    ${[2,5,10,15,20].map(v=>`<button type="button" onclick="this.form.pct_change.value=${v}" class="text-xs bg-purple-50 hover:bg-purple-100 text-purple-700 font-bold px-2 py-1 rounded-lg">${v}%</button>`).join('')}
                </div>
            </div>
            <button type="submit" class="w-full py-2.5 rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-bold text-sm flex items-center justify-center gap-2 transition-colors">
                <i class="bi bi-percent"></i> Appliquer l'ajustement
            </button>
        </form>`,
        {size: 'max-w-md'}
    );
}

function openImportModal() {
    openModal(
        modalHeader('bi-upload', 'Import produits CSV', 'Importer depuis un fichier Excel/CSV') +
        `<div class="p-6 space-y-4">
            <div class="bg-blue-50 rounded-xl p-3 text-xs text-blue-700">
                <div class="font-bold mb-1">Format CSV attendu (séparateur: virgule ou point-virgule):</div>
                <code class="text-[10px]">nom;categorie_id;prix_achat_ht;prix_vente_ht;tva_rate;reference;code_barre;marque;seuil_alerte</code>
                <div class="mt-2"><a href="api.php?action=export_produits" class="underline">Télécharger le template</a> — ou importer un export existant</div>
            </div>
            <form method="POST" enctype="multipart/form-data" onsubmit="this.querySelector('button').disabled=true;this.querySelector('button').innerHTML='<i class=\'bi bi-hourglass-split\'></i> Import...'">
                <input type="hidden" name="_csrf" value="<?=$csrf?>">
                <input type="hidden" name="action" value="import_produits">
                <div>
                    <label class="text-xs font-bold text-gray-500 block mb-1">Fichier CSV</label>
                    <input type="file" name="csv_file" accept=".csv,.txt" required class="w-full border-2 border-gray-200 rounded-xl px-3 py-2 text-sm">
                </div>
                <div class="flex items-center gap-2">
                    <input type="checkbox" name="skip_header" id="skipH" value="1" checked>
                    <label for="skipH" class="text-xs text-gray-600">Ignorer la 1ère ligne (en-tête)</label>
                </div>
                <div class="flex items-center gap-2">
                    <input type="checkbox" name="update_existing" id="updateE" value="1">
                    <label for="updateE" class="text-xs text-gray-600">Mettre à jour les produits existants (par référence)</label>
                </div>
                <button type="submit" class="w-full py-2.5 rounded-xl bg-green-500 hover:bg-green-600 text-white font-bold text-sm transition-colors flex items-center justify-center gap-2">
                    <i class="bi bi-upload"></i> Importer
                </button>
            </form>
        </div>`,
        {size: 'max-w-lg'}
    );
}

function openBarcodeLookup() {
    openModal(
        modalHeader('bi-upc-scan', 'Scanner & Rechercher', 'Scannez un code-barres pour vérifier le produit') +
        `<div class="p-6 space-y-4">
            <div>
                <label class="text-xs font-bold text-gray-500 uppercase tracking-wider block mb-1">Code-barres ou référence</label>
                <div class="flex gap-2">
                    <input type="text" id="lookupCode" class="flex-1 border-2 border-asel/30 rounded-xl px-4 py-3 text-center font-mono text-lg focus:border-asel bg-asel-light/20" 
                        placeholder="Scannez ou tapez..." autofocus
                        onkeypress="if(event.key==='Enter'){event.preventDefault();doBarcodeLookup();}">
                    <button type="button" onclick="openScanner('lookupCode')" class="px-4 bg-asel text-white rounded-xl hover:bg-asel-dark"><i class="bi bi-camera text-xl"></i></button>
                </div>
            </div>
            <button type="button" onclick="doBarcodeLookup()" class="w-full py-2.5 rounded-xl bg-asel hover:bg-asel-dark text-white font-semibold text-sm flex items-center justify-center gap-2">
                <i class="bi bi-search"></i> Rechercher
            </button>
            <div id="lookupResult"></div>
        </div>`,
        {size: 'max-w-lg'}
    );
    setTimeout(() => document.getElementById('lookupCode')?.focus(), 300);
}

function doBarcodeLookup() {
    const code = document.getElementById('lookupCode')?.value.trim();
    if (!code) return;
    const resultDiv = document.getElementById('lookupResult');
    resultDiv.innerHTML = '<div class="text-center py-4"><i class="bi bi-hourglass-split text-2xl text-gray-300 animate-spin"></i><p class="text-sm text-gray-400 mt-2">Recherche...</p></div>';
    
    fetch('api.php?action=barcode_full_lookup&code=' + encodeURIComponent(code))
        .then(r => r.json())
        .then(data => {
            if (data.found) {
                const p = data.product;
                const margeColor = p.margin >= 30 ? 'text-green-600' : p.margin >= 15 ? 'text-amber-600' : 'text-red-600';
                let stockHtml = data.stock.map(s => {
                    const color = s.quantite <= 0 ? 'text-red-500' : s.quantite <= p.seuil_alerte ? 'text-amber-600' : 'text-green-600';
                    const bg = s.quantite <= 0 ? 'bg-red-50' : s.quantite <= p.seuil_alerte ? 'bg-amber-50' : 'bg-green-50';
                    return `<div class="${bg} rounded-lg p-2 text-center">
                        <div class="text-[10px] text-gray-500 font-medium">${s.franchise}</div>
                        <div class="text-lg font-black ${color}">${s.quantite}</div>
                    </div>`;
                }).join('');
                
                resultDiv.innerHTML = `
                    <div class="border-t border-gray-100 pt-4">
                        <div class="flex items-start justify-between mb-3">
                            <div>
                                <h4 class="font-bold text-asel-dark text-lg">${p.nom}</h4>
                                <p class="text-xs text-gray-400">${p.marque} · ${p.reference} · ${p.categorie}</p>
                            </div>
                            <span class="bg-green-100 text-green-800 text-xs font-bold px-2 py-1 rounded">Trouvé</span>
                        </div>
                        <div class="grid grid-cols-4 gap-2 mb-4">
                            <div class="bg-gray-50 rounded-lg p-2 text-center">
                                <div class="text-[10px] text-gray-400">P.A.</div>
                                <div class="font-bold">${p.prix_achat.toFixed(1)}</div>
                            </div>
                            <div class="bg-gray-50 rounded-lg p-2 text-center">
                                <div class="text-[10px] text-gray-400">P.V.</div>
                                <div class="font-bold text-asel">${p.prix_vente.toFixed(1)}</div>
                            </div>
                            <div class="bg-gray-50 rounded-lg p-2 text-center">
                                <div class="text-[10px] text-gray-400">Marge</div>
                                <div class="font-bold ${margeColor}">${p.margin}%</div>
                            </div>
                            <div class="bg-gray-50 rounded-lg p-2 text-center">
                                <div class="text-[10px] text-gray-400">Total</div>
                                <div class="font-bold ${data.total_stock <= 0 ? 'text-red-500' : 'text-green-600'}">${data.total_stock}</div>
                            </div>
                        </div>
                        <div class="mb-4">
                            <div class="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Stock par franchise</div>
                            <div class="grid grid-cols-${Math.min(data.stock.length, 4)} gap-2">${stockHtml}</div>
                        </div>
                        <div class="flex gap-2">
                            <button onclick="closeModal();openEditProduct(${p.id},'${p.nom.replace(/'/g,"\\'")}',${p.categorie_id},'${(p.marque||'').replace(/'/g,"\\'")}','${(p.reference||'').replace(/'/g,"\\'")}','${(p.code_barre||'').replace(/'/g,"\\'")}',${p.prix_achat},${p.prix_vente},${p.seuil_alerte},${p.prix_achat_ht||0},${p.prix_vente_ht||0},${p.tva_rate||19},'${(p.description||'').replace(/'/g,"\\'")}'" 
                                class="flex-1 py-2 rounded-xl bg-asel hover:bg-asel-dark text-white text-sm font-bold flex items-center justify-center gap-1">
                                <i class="bi bi-pencil"></i> Modifier
                            </button>
                            <button onclick="closeModal();viewProductDetails(${p.id},'${p.nom.replace(/'/g,"\\'")}','${(p.reference||'').replace(/'/g,"\\'")}','${(p.marque||'').replace(/'/g,"\\'")}','${p.categorie}',${p.prix_achat},${p.prix_vente},'${(p.code_barre||'').replace(/'/g,"\\'")}',${p.seuil_alerte})"
                                class="flex-1 py-2 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-bold flex items-center justify-center gap-1">
                                <i class="bi bi-eye"></i> Détails
                            </button>
                        </div>
                    </div>`;
            } else {
                resultDiv.innerHTML = `
                    <div class="border-t border-gray-100 pt-4 text-center">
                        <div class="w-16 h-16 mx-auto bg-amber-50 rounded-full flex items-center justify-center mb-3">
                            <i class="bi bi-question-circle text-amber-500 text-3xl"></i>
                        </div>
                        <h4 class="font-bold text-asel-dark">Produit non trouvé</h4>
                        <p class="text-sm text-gray-400 mt-1">Code: <span class="font-mono">${code}</span></p>
                        <p class="text-sm text-gray-400">Ce code-barres n'existe pas dans le catalogue.</p>
                        <button onclick="closeModal();openQuickAddProduct()" 
                            class="mt-4 w-full py-2.5 rounded-xl bg-green-500 hover:bg-green-600 text-white text-sm font-bold flex items-center justify-center gap-2">
                            <i class="bi bi-plus-circle"></i> Créer ce produit
                        </button>
                    </div>`;
            }
        })
        .catch(e => {
            resultDiv.innerHTML = '<p class="text-red-500 text-center text-sm">Erreur de connexion</p>';
        });
}

// === DEMANDE PRODUIT MODAL ===
function openDemandeProduit(franchiseId) {
    const csrf = '<?=$csrf?>';
    const prods = <?=json_encode(array_map(fn($p) => ['value' => $p['id'], 'label' => $p['nom'].' ('.$p['cat_nom'].')'], $produits ?? []))?>;
    prods.unshift({value: '', label: '— Nouveau produit (écrire ci-dessous) —'});
    openModal(
        modalHeader('bi-megaphone', 'Demande au stock central', 'Commander des produits pour votre franchise') +
        `<form method="POST" class="p-6 space-y-4">
            <input type="hidden" name="_csrf" value="${csrf}">
            <input type="hidden" name="action" value="demande_produit">
            <input type="hidden" name="franchise_id" value="${franchiseId}">
            ${modalField('Produit existant', 'produit_id', 'select', '', '', prods)}
            ${modalField('Ou nouveau produit', 'nom_produit', 'text', '', 'Nom du produit si non listé')}
            ${modalRow([
                modalField('Quantité', 'quantite', 'number', '1', ''),
                modalField('Urgence', 'urgence', 'select', '', '', [
                    {value: 'normal', label: 'Normal'},
                    {value: 'urgent', label: 'Urgent'},
                    {value: 'critique', label: 'Critique'},
                ]),
            ])}
            ${modalField('Détails', 'note', 'textarea', '', 'Raison de la demande...')}
            <div class="flex gap-3 pt-2">
                <button type="button" onclick="closeModal()" class="flex-1 py-2.5 rounded-xl border-2 border-gray-200 text-gray-600 font-semibold text-sm">Annuler</button>
                <button type="submit" class="flex-1 py-2.5 rounded-xl bg-indigo-500 hover:bg-indigo-600 text-white font-semibold text-sm flex items-center justify-center gap-2">
                    <i class="bi bi-send"></i> Envoyer la demande
                </button>
            </div>
        </form>`
    );
}
// Keyboard shortcut: ? to show help
document.addEventListener('keydown', e => {
    if (e.key === '?' && !['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)) {
        e.preventDefault();
        showShortcuts();
    }
});

// F3 = global search
document.addEventListener('keydown', e => {
    if(e.key === 'F3') {
        e.preventDefault();
        const bar = document.getElementById('globalSearchBar');
        if(bar) { bar.classList.remove('hidden'); document.getElementById('globalSearchInput')?.focus(); }
    }
});

let globalSearchTimer = null;
function doGlobalSearch(q) {
    clearTimeout(globalSearchTimer);
    const res = document.getElementById('globalSearchResults');
    if(!q || q.length < 2) { res.classList.add('hidden'); return; }
    globalSearchTimer = setTimeout(() => {
        fetch('api.php?action=global_search&q=' + encodeURIComponent(q))
            .then(r => r.json())
            .then(data => {
                if(!data.results?.length) {
                    res.innerHTML = '<div class="text-xs text-gray-400 text-center py-2">Aucun résultat</div>';
                } else {
                    res.innerHTML = data.results.map(r => 
                        `<a href="${r.url}" class="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-asel-light text-sm">
                            <i class="bi ${r.icon} text-asel"></i>
                            <span class="flex-1">${r.title}</span>
                            <span class="text-[10px] text-gray-400">${r.type}</span>
                        </a>`
                    ).join('');
                }
                res.classList.remove('hidden');
            });
    }, 250);
}

function showShortcuts() {
    openModal(
        modalHeader('bi-keyboard', 'Raccourcis clavier', 'Accélérez votre workflow') +
        `<div class="p-6">
            <div class="space-y-2 text-sm">
                <div class="font-bold text-gray-600 text-xs uppercase tracking-wider mb-2">Point de vente</div>
                <div class="flex justify-between py-1.5 border-b border-gray-100"><span class="text-gray-600">Focus scanner barcode</span><kbd class="bg-gray-100 px-2 py-0.5 rounded text-xs font-mono">F2</kbd></div>
                <div class="flex justify-between py-1.5 border-b border-gray-100"><span class="text-gray-600">Ouvrir caméra QR</span><kbd class="bg-gray-100 px-2 py-0.5 rounded text-xs font-mono">F4</kbd></div>
                <div class="flex justify-between py-1.5 border-b border-gray-100"><span class="text-gray-600">Montant exact (règle)</span><kbd class="bg-gray-100 px-2 py-0.5 rounded text-xs font-mono">F6</kbd></div>
                <div class="flex justify-between py-1.5 border-b border-gray-100"><span class="text-gray-600">Valider vente</span><kbd class="bg-gray-100 px-2 py-0.5 rounded text-xs font-mono">F8</kbd></div>
                <div class="flex justify-between py-1.5 border-b border-gray-100"><span class="text-gray-600">Vider panier</span><kbd class="bg-gray-100 px-2 py-0.5 rounded text-xs font-mono">Esc</kbd></div>
                <div class="font-bold text-gray-600 text-xs uppercase tracking-wider mt-4 mb-2">Entrée de stock</div>
                <div class="flex justify-between py-1.5 border-b border-gray-100"><span class="text-gray-600">Rechercher produit</span><kbd class="bg-gray-100 px-2 py-0.5 rounded text-xs font-mono">Tapez…</kbd></div>
                <div class="flex justify-between py-1.5 border-b border-gray-100"><span class="text-gray-600">Naviguer résultats</span><kbd class="bg-gray-100 px-2 py-0.5 rounded text-xs font-mono">↑ ↓</kbd></div>
                <div class="flex justify-between py-1.5 border-b border-gray-100"><span class="text-gray-600">Ajouter / sélectionner</span><kbd class="bg-gray-100 px-2 py-0.5 rounded text-xs font-mono">Entrée</kbd></div>
                <div class="flex justify-between py-1.5 border-b border-gray-100"><span class="text-gray-600">Aller à la quantité</span><kbd class="bg-gray-100 px-2 py-0.5 rounded text-xs font-mono">Tab</kbd></div>
                <div class="font-bold text-gray-600 text-xs uppercase tracking-wider mt-4 mb-2">Global</div>
                <div class="flex justify-between py-1.5 border-b border-gray-100"><span class="text-gray-600">Recherche produits</span><kbd class="bg-gray-100 px-2 py-0.5 rounded text-xs font-mono">/</kbd></div>
                <div class="flex justify-between py-1.5 border-b border-gray-100"><span class="text-gray-600">Fermer modal / menu</span><kbd class="bg-gray-100 px-2 py-0.5 rounded text-xs font-mono">Esc</kbd></div>
                <div class="flex justify-between py-1.5"><span class="text-gray-600">Afficher cette aide</span><kbd class="bg-gray-100 px-2 py-0.5 rounded text-xs font-mono">?</kbd></div>
            </div>
            <button onclick="closeModal()" class="w-full mt-6 py-2.5 rounded-xl border-2 border-gray-200 text-gray-600 font-semibold text-sm hover:bg-gray-50">Fermer</button>
        </div>`,
        {size: 'max-w-sm'}
    );
}

// ===================================================================
// ASEL DESIGN SYSTEM v2 — Global Table Enhancement + Toast + UX
// ===================================================================

// --- TOAST SYSTEM (enhanced) ---
(function(){
    // Create toast container
    let tc = document.querySelector('.toast-container');
    if(!tc) { tc = document.createElement('div'); tc.className = 'toast-container'; document.body.appendChild(tc); }
    
    window.showToast = function(msg, type='success', duration=3500) {
        const t = document.createElement('div');
        t.className = 'toast-item toast-' + type;
        const icons = {success:'✓',error:'✕',warning:'⚠',info:'ℹ'};
        t.innerHTML = `<span>${icons[type]||''} ${msg}</span><div class="toast-progress" style="width:100%"></div>`;
        tc.appendChild(t);
        requestAnimationFrame(() => { t.classList.add('show'); });
        // Progress bar
        const prog = t.querySelector('.toast-progress');
        if(prog) { prog.style.transitionDuration = duration+'ms'; requestAnimationFrame(() => prog.style.width = '0%'); }
        const timer = setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, duration);
        t.onclick = () => { clearTimeout(timer); t.classList.remove('show'); setTimeout(() => t.remove(), 300); };
    };
})();

// --- ASEL TABLE ENHANCEMENT ---
class AselTable {
    constructor(table, opts = {}) {
        this.table = table;
        this.perPage = opts.perPage || 15;
        this.page = 1;
        this.sortCol = -1;
        this.sortDir = 'asc';
        this.searchQuery = '';
        this.tbody = table.querySelector('tbody');
        this.thead = table.querySelector('thead');
        if(!this.tbody || !this.thead) return;
        
        this.allRows = Array.from(this.tbody.querySelectorAll('tr'));
        this.filteredRows = [...this.allRows];
        if(this.allRows.length < 5) return; // Skip tiny tables
        
        this.table.classList.add('asel-enhanced');
        this.buildWrapper();
        this.makeSortable();
        this.render();
    }
    
    buildWrapper() {
        // Wrap table in container
        const wrapper = document.createElement('div');
        wrapper.className = 'asel-table-wrapper';
        this.table.parentNode.insertBefore(wrapper, this.table);
        wrapper.appendChild(this.table);
        
        // Toolbar with search + info
        const toolbar = document.createElement('div');
        toolbar.className = 'asel-table-toolbar';
        toolbar.innerHTML = `
            <input type="text" class="asel-table-search" placeholder="Rechercher..." aria-label="Rechercher">
            <div class="flex items-center gap-2">
                <span class="asel-table-meta" data-role="count">${this.allRows.length} lignes</span>
                <select class="text-xs border border-gray-200 rounded-md px-1 py-0.5 text-gray-500" data-role="perpage">
                    <option value="10" ${this.perPage===10?'selected':''}>10</option>
                    <option value="15" ${this.perPage===15?'selected':''}>15</option>
                    <option value="25" ${this.perPage===25?'selected':''}>25</option>
                    <option value="50" ${this.perPage===50?'selected':''}>50</option>
                    <option value="9999">Tout</option>
                </select>
            </div>
        `;
        wrapper.insertBefore(toolbar, this.table);
        
        // Search handler
        const search = toolbar.querySelector('.asel-table-search');
        search.addEventListener('input', () => { this.searchQuery = search.value; this.page = 1; this.filter(); this.render(); });
        
        // Per-page handler
        toolbar.querySelector('[data-role="perpage"]').addEventListener('change', (e) => {
            this.perPage = parseInt(e.target.value); this.page = 1; this.render();
        });
        
        // Pagination container
        this.pagination = document.createElement('div');
        this.pagination.className = 'asel-table-pagination';
        wrapper.appendChild(this.pagination);
        
        this.toolbar = toolbar;
        this.countEl = toolbar.querySelector('[data-role="count"]');
    }
    
    makeSortable() {
        const ths = this.thead.querySelectorAll('th');
        ths.forEach((th, idx) => {
            // Skip action columns (last column often has buttons)
            if(th.textContent.trim() === '' || th.textContent.trim().toLowerCase().includes('action') || th.textContent.trim().toLowerCase().includes('act.') || th.textContent.trim().toLowerCase().includes('edit')) return;
            th.setAttribute('data-sortable', idx);
            th.addEventListener('click', () => this.sort(idx, th));
        });
    }
    
    sort(colIdx, th) {
        // Toggle direction
        if(this.sortCol === colIdx) { this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc'; }
        else { this.sortCol = colIdx; this.sortDir = 'asc'; }
        
        // Update header indicators
        this.thead.querySelectorAll('th').forEach(h => h.removeAttribute('data-sort-dir'));
        th.setAttribute('data-sort-dir', this.sortDir);
        
        const dir = this.sortDir === 'asc' ? 1 : -1;
        this.filteredRows.sort((a, b) => {
            const ac = (a.cells[colIdx]?.textContent || '').trim();
            const bc = (b.cells[colIdx]?.textContent || '').trim();
            // Smart sort: try numeric first
            const an = parseFloat(ac.replace(/[^0-9.,-]/g, '').replace(',', '.'));
            const bn = parseFloat(bc.replace(/[^0-9.,-]/g, '').replace(',', '.'));
            if (!isNaN(an) && !isNaN(bn)) return (an - bn) * dir;
            // Date sort (dd/mm or dd/mm/yyyy)
            const ad = ac.match(/(\d{2})\/(\d{2})(?:\/(\d{4}))?/);
            const bd = bc.match(/(\d{2})\/(\d{2})(?:\/(\d{4}))?/);
            if(ad && bd) {
                const da = new Date((ad[3]||'2026')+'-'+(ad[2])+'-'+(ad[1]));
                const db = new Date((bd[3]||'2026')+'-'+(bd[2])+'-'+(bd[1]));
                if(!isNaN(da) && !isNaN(db)) return (da-db)*dir;
            }
            return ac.localeCompare(bc, 'fr', {sensitivity:'base'}) * dir;
        });
        this.page = 1;
        this.render();
    }
    
    filter() {
        if(!this.searchQuery.trim()) { this.filteredRows = [...this.allRows]; return; }
        const q = this.searchQuery.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
        const words = q.split(/\s+/).filter(Boolean);
        this.filteredRows = this.allRows.filter(row => {
            const text = row.textContent.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
            return words.every(w => text.includes(w));
        });
    }
    
    render() {
        const total = this.filteredRows.length;
        const totalPages = Math.max(1, Math.ceil(total / this.perPage));
        if(this.page > totalPages) this.page = totalPages;
        const start = (this.page - 1) * this.perPage;
        const end = Math.min(start + this.perPage, total);
        
        // Show/hide rows
        this.allRows.forEach(r => r.style.display = 'none');
        this.filteredRows.slice(start, end).forEach(r => r.style.display = '');
        
        // Update count
        if(this.countEl) {
            this.countEl.textContent = this.searchQuery 
                ? `${total} résultat${total>1?'s':''} / ${this.allRows.length}`
                : `${total} ligne${total>1?'s':''}`;
        }
        
        // Render pagination
        if(totalPages <= 1 && !this.searchQuery) { this.pagination.style.display = 'none'; return; }
        this.pagination.style.display = 'flex';
        
        let html = `<button ${this.page<=1?'disabled':''} data-pg="${this.page-1}">‹ Préc</button>`;
        
        // Smart page numbers
        const range = [];
        if(totalPages <= 7) { for(let i=1;i<=totalPages;i++) range.push(i); }
        else {
            range.push(1);
            if(this.page > 3) range.push('...');
            for(let i=Math.max(2,this.page-1); i<=Math.min(totalPages-1,this.page+1); i++) range.push(i);
            if(this.page < totalPages-2) range.push('...');
            range.push(totalPages);
        }
        
        for(const p of range) {
            if(p === '...') { html += `<span class="pg-info">…</span>`; }
            else { html += `<button class="${p===this.page?'pg-active':''}" data-pg="${p}">${p}</button>`; }
        }
        
        html += `<button ${this.page>=totalPages?'disabled':''} data-pg="${this.page+1}">Suiv ›</button>`;
        html += `<span class="pg-info">${start+1}-${end} sur ${total}</span>`;
        
        this.pagination.innerHTML = html;
        this.pagination.querySelectorAll('button[data-pg]').forEach(btn => {
            btn.addEventListener('click', () => { this.page = parseInt(btn.dataset.pg); this.render(); });
        });
    }
}

// --- AUTO-ENHANCE ALL TABLES ---
document.addEventListener('DOMContentLoaded', () => {
    // Skip tables that have custom JS handling
    const skipParents = ['prodGrid','cartBody','entreeLines','saleForm','entreeForm','pointageForm','inventaireForm'];
    
    document.querySelectorAll('table').forEach(table => {
        // Skip if inside a skipped container
        if(skipParents.some(id => table.closest('#'+id))) return;
        // Skip if already enhanced
        if(table.classList.contains('asel-enhanced')) return;
        // Skip tiny tables
        const tbody = table.querySelector('tbody');
        if(!tbody || tbody.querySelectorAll('tr').length < 5) return;
        // Skip tables without proper thead
        if(!table.querySelector('thead th')) return;
        
        new AselTable(table);
    });
});
</script>

</body>
</html>
