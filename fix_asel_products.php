<?php
/**
 * Fix ASEL products — remove competitors, keep only ASEL
 */
require_once 'config.php';
$pdo = db();

// Delete non-ASEL products
$pdo->exec("DELETE FROM produits_asel WHERE operateur != 'ASEL'");

// Update existing ASEL products
$pdo->exec("DELETE FROM produits_asel");

// Insert correct ASEL-only products
$products = [
    // Cartes SIM ASEL
    ['Carte SIM ASEL Mobile', 'carte_sim', 'ASEL', 2.5, 2.5, 1.00],
    
    // Recharges solde ASEL
    ['Recharge ASEL 1 DT', 'recharge_solde', 'ASEL', 1, 1, 0.05],
    ['Recharge ASEL 2 DT', 'recharge_solde', 'ASEL', 2, 2, 0.10],
    ['Recharge ASEL 3 DT', 'recharge_solde', 'ASEL', 3, 3, 0.15],
    ['Recharge ASEL 5 DT', 'recharge_solde', 'ASEL', 5, 5, 0.25],
    ['Recharge ASEL 10 DT', 'recharge_solde', 'ASEL', 10, 10, 0.50],
    ['Recharge ASEL 20 DT', 'recharge_solde', 'ASEL', 20, 20, 1.00],
    ['Recharge ASEL 50 DT', 'recharge_solde', 'ASEL', 50, 50, 2.50],
    
    // Forfaits internet ASEL
    ['ASEL 1Go / 1 jour', 'recharge_internet', 'ASEL', 1, 1, 0.05],
    ['ASEL 1Go / 3 jours', 'recharge_internet', 'ASEL', 2, 2, 0.10],
    ['ASEL 3Go / 7 jours', 'recharge_internet', 'ASEL', 5, 5, 0.25],
    ['ASEL 5Go / 15 jours', 'recharge_internet', 'ASEL', 8, 8, 0.40],
    ['ASEL 10Go / 30 jours', 'recharge_internet', 'ASEL', 15, 15, 0.75],
    ['ASEL 20Go / 30 jours', 'recharge_internet', 'ASEL', 25, 25, 1.25],
    ['ASEL 50Go / 30 jours', 'recharge_internet', 'ASEL', 40, 40, 2.00],
    ['ASEL Illimité / 30 jours', 'recharge_internet', 'ASEL', 60, 60, 3.00],
];

$stmt = $pdo->prepare("INSERT INTO produits_asel (nom,type_produit,operateur,valeur_nominale,prix_vente,commission) VALUES (?,?,?,?,?,?)");
foreach ($products as $p) {
    $stmt->execute($p);
}

$count = $pdo->query("SELECT COUNT(*) FROM produits_asel")->fetchColumn();
echo "✅ Fixed! $count produits ASEL Mobile uniquement.\n";
echo "- Carte SIM: 2.5 DT\n";
echo "- Recharges solde: 1-50 DT\n";
echo "- Forfaits internet: 1-60 DT\n";
echo "- Opérateurs concurrents supprimés\n";
