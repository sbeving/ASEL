<?php
require_once __DIR__ . '/config.php';
$pdo = db();

echo "<h2>Fixing old echeance factures — restoring avance data</h2>";

// Find all factures that have echeances but mode_paiement might be wrong
$factures_with_echeances = $pdo->query("
    SELECT f.id, f.numero, f.total_ttc, f.montant_recu, f.mode_paiement,
           COALESCE(SUM(e.montant), 0) as total_echeances,
           COUNT(e.id) as nb_echeances
    FROM factures f
    JOIN echeances e ON e.facture_id = f.id
    GROUP BY f.id
    ORDER BY f.date_facture DESC
")->fetchAll(PDO::FETCH_ASSOC);

echo "<p>Found " . count($factures_with_echeances) . " factures with écheances</p>";
echo "<table border='1' cellpadding='5' style='border-collapse:collapse;font-family:sans-serif;font-size:13px'>";
echo "<tr style='background:#2AABE2;color:white'><th>Facture</th><th>Total TTC</th><th>Échéances</th><th>Avance calculée</th><th>Mode avant</th><th>Action</th></tr>";

$fixed = 0;
foreach ($factures_with_echeances as $f) {
    $avance = round($f['total_ttc'] - $f['total_echeances'], 2);
    if ($avance < 0) $avance = 0;
    
    $needs_fix = false;
    $action = '';
    
    // Fix mode_paiement if not echeance
    if ($f['mode_paiement'] !== 'echeance') {
        $needs_fix = true;
        $action .= "mode→echeance ";
    }
    
    // Fix montant_recu if it doesn't match the avance
    if (abs($f['montant_recu'] - $avance) > 0.01 && $avance >= 0) {
        $needs_fix = true;
        $action .= "avance: {$f['montant_recu']}→{$avance} ";
    }
    
    $bg = $needs_fix ? '#FFF3CD' : '#D4EDDA';
    echo "<tr style='background:$bg'>";
    echo "<td>{$f['numero']}</td>";
    echo "<td>" . number_format($f['total_ttc'], 2) . "</td>";
    echo "<td>{$f['nb_echeances']} éch. = " . number_format($f['total_echeances'], 2) . "</td>";
    echo "<td><b>" . number_format($avance, 2) . "</b></td>";
    echo "<td>{$f['mode_paiement']}</td>";
    
    if ($needs_fix) {
        $pdo->prepare("UPDATE factures SET mode_paiement='echeance', montant_recu=?, monnaie=0 WHERE id=?")
            ->execute([$avance, $f['id']]);
        echo "<td style='color:green;font-weight:bold'>✅ FIXED: $action</td>";
        $fixed++;
    } else {
        echo "<td>✓ OK</td>";
    }
    echo "</tr>";
}

echo "</table>";
echo "<p><b>$fixed facture(s) corrigée(s)</b></p>";
echo "<p><a href='index.php?page=factures'>← Retour aux factures</a></p>";
