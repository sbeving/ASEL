<?php
/**
 * ASEL Mobile — Facture API
 * Creates invoices with auto-generated numbers
 */
require_once 'helpers.php';
requireLogin();

function generateNumeroFacture($type = 'ticket') {
    $prefix = match($type) {
        'facture' => 'FA',
        'devis' => 'DV',
        default => 'TK',
    };
    $date = date('Ymd');
    $count = queryOne("SELECT COUNT(*)+1 as n FROM factures WHERE DATE(date_facture)=CURDATE() AND type_facture=?", [$type]);
    return $prefix . '-' . $date . '-' . str_pad($count['n'], 4, '0', STR_PAD_LEFT);
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    verifyCsrf();
    
    $data = json_decode(file_get_contents('php://input'), true) ?: $_POST;
    
    $type_facture = $data['type_facture'] ?? 'ticket';
    $franchise_id = $data['franchise_id'];
    $client_id = $data['client_id'] ?: null;
    $items = $data['items'] ?? [];
    $mode_paiement = $data['mode_paiement'] ?? 'especes';
    $montant_recu = floatval($data['montant_recu'] ?? 0);
    $note = $data['note'] ?? '';
    $tva_active = !empty($data['tva_active']);
    
    // Calculate totals
    $sous_total = 0;
    $remise_totale = 0;
    
    foreach ($items as $item) {
        $line_total = $item['qty'] * $item['prix'];
        $sous_total += $line_total;
        $remise_totale += floatval($item['remise'] ?? 0);
    }
    
    $total_ht = $sous_total - $remise_totale;
    $tva = $tva_active ? round($total_ht * 0.19, 2) : 0;
    $total_ttc = $total_ht + $tva;
    $monnaie = max(0, $montant_recu - $total_ttc);
    
    $numero = generateNumeroFacture($type_facture);
    
    // Create facture
    execute("INSERT INTO factures (numero,franchise_id,client_id,type_facture,sous_total,remise_totale,total_ht,tva,total_ttc,mode_paiement,montant_recu,monnaie,utilisateur_id,note) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        [$numero, $franchise_id, $client_id, $type_facture, $sous_total, $remise_totale, round($total_ht,2), $tva, round($total_ttc,2), $mode_paiement, $montant_recu, round($monnaie,2), currentUser()['id'], $note]);
    
    $facture_id = db()->lastInsertId();
    
    // Create lines + update stock + record sales
    foreach ($items as $item) {
        $line_remise = floatval($item['remise'] ?? 0);
        $line_total = ($item['qty'] * $item['prix']) - $line_remise;
        
        $type_ligne = $item['type'] ?? 'produit';
        $designation = $item['nom'];
        
        execute("INSERT INTO facture_lignes (facture_id,type_ligne,produit_id,service_id,designation,quantite,prix_unitaire,remise,total) VALUES (?,?,?,?,?,?,?,?,?)",
            [$facture_id, $type_ligne, $item['produit_id'] ?? null, $item['service_id'] ?? null, $designation, $item['qty'], $item['prix'], $line_remise, round($line_total,2)]);
        
        // Update stock for products
        if ($type_ligne === 'produit' && !empty($item['produit_id'])) {
            execute("INSERT INTO ventes (franchise_id,produit_id,quantite,prix_unitaire,prix_total,remise,utilisateur_id,client_id,facture_id) VALUES (?,?,?,?,?,?,?,?,?)",
                [$franchise_id, $item['produit_id'], $item['qty'], $item['prix'], round($line_total,2), $line_remise, currentUser()['id'], $client_id, $facture_id]);
            execute("INSERT INTO mouvements (franchise_id,produit_id,type_mouvement,quantite,prix_unitaire,utilisateur_id) VALUES (?,?,'vente',?,?,?)",
                [$franchise_id, $item['produit_id'], $item['qty'], $item['prix'], currentUser()['id']]);
            execute("UPDATE stock SET quantite=GREATEST(0,quantite-?) WHERE franchise_id=? AND produit_id=?",
                [$item['qty'], $franchise_id, $item['produit_id']]);
        }
        
        // Record service
        if ($type_ligne === 'service' && !empty($item['service_id'])) {
            execute("INSERT INTO prestations (service_id,franchise_id,client_id,prix_facture,utilisateur_id) VALUES (?,?,?,?,?)",
                [$item['service_id'], $franchise_id, $client_id, round($line_total,2), currentUser()['id']]);
        }
        
        // Record ASEL product sale
        if ($type_ligne === 'recharge' && !empty($item['produit_asel_id'])) {
            execute("INSERT INTO ventes_asel (produit_asel_id,franchise_id,client_id,prix_vente,utilisateur_id,facture_id) VALUES (?,?,?,?,?,?)",
                [$item['produit_asel_id'], $franchise_id, $client_id, round($line_total,2), currentUser()['id'], $facture_id]);
        }
    }
    
    header('Content-Type: application/json');
    echo json_encode([
        'success' => true,
        'facture_id' => $facture_id,
        'numero' => $numero,
        'total_ttc' => $total_ttc,
        'monnaie' => $monnaie,
        'pdf_url' => "pdf.php?type=facture&id=$facture_id"
    ]);
    exit;
}
