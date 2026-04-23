<?php
require_once 'config.php';
$pdo = db();

// Fix Soukra location
$pdo->exec("UPDATE franchises SET latitude=36.867139, longitude=10.250722 WHERE nom LIKE '%Soukra%'");
echo "✅ Soukra: 36.867139, 10.250722\n";

// Verify
$f = $pdo->query("SELECT nom,latitude,longitude FROM franchises WHERE actif=1")->fetchAll(PDO::FETCH_ASSOC);
foreach ($f as $r) echo $r['nom'] . ": " . $r['latitude'] . ", " . $r['longitude'] . "\n";
