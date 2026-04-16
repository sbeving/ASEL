<?php
require_once __DIR__ . '/config.php';
$pdo = db();
header('Content-Type: text/plain');

echo "=== Factures Soukra (fid=2) 15/04/2026 ===\n";
$facs = $pdo->query("SELECT id, numero, total_ttc, montant_recu, mode_paiement FROM factures WHERE franchise_id=2 AND DATE(date_facture)='2026-04-15' ORDER BY id")->fetchAll(PDO::FETCH_ASSOC);
foreach ($facs as $f) {
    $has_ech = $pdo->prepare("SELECT COUNT(*) as c, SUM(montant) as t FROM echeances WHERE facture_id=?");
    $has_ech->execute([$f['id']]);
    $ech = $has_ech->fetch();
    echo "{$f['numero']} | TTC:{$f['total_ttc']} | recu:{$f['montant_recu']} | mode:{$f['mode_paiement']}";
    if ($ech['c'] > 0) echo " | ECH:{$ech['c']} tot:{$ech['t']}";
    echo "\n";
}

echo "\n=== Avances query ===\n";
$r = $pdo->query("SELECT COALESCE(SUM(montant_recu),0) as t FROM factures WHERE franchise_id=2 AND DATE(date_facture)='2026-04-15' AND mode_paiement='echeance' AND montant_recu > 0")->fetch();
echo "mode=echeance, montant_recu>0: {$r['t']}\n";

echo "\n=== All modes breakdown ===\n";
$modes = $pdo->query("SELECT mode_paiement, COUNT(*) as c, SUM(total_ttc) as ttc, SUM(montant_recu) as recu FROM factures WHERE franchise_id=2 AND DATE(date_facture)='2026-04-15' GROUP BY mode_paiement")->fetchAll();
foreach ($modes as $m) echo "{$m['mode_paiement']}: {$m['c']} factures, TTC={$m['ttc']}, recu={$m['recu']}\n";
