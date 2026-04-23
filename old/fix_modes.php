<?php
require_once __DIR__ . '/config.php';
$pdo = db();
header('Content-Type: text/plain');

// Fix all factures that have echeances but mode_paiement is empty or wrong
$fixed = $pdo->exec("UPDATE factures SET mode_paiement='echeance' WHERE id IN (SELECT DISTINCT facture_id FROM echeances) AND (mode_paiement IS NULL OR mode_paiement = '' OR mode_paiement = 'especes')");
echo "Fixed $fixed facture(s) — set mode_paiement='echeance'\n";

// Verify
$check = $pdo->query("SELECT id, numero, mode_paiement, montant_recu FROM factures WHERE id IN (SELECT DISTINCT facture_id FROM echeances) ORDER BY id DESC LIMIT 20")->fetchAll(PDO::FETCH_ASSOC);
foreach ($check as $f) {
    echo "{$f['numero']} | mode: {$f['mode_paiement']} | recu: {$f['montant_recu']}\n";
}
echo "\nDone!\n";
