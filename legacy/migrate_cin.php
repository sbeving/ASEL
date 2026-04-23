<?php
require_once __DIR__ . '/config.php';
$pdo = db();

$migrations = [
    "ALTER TABLE clients ADD COLUMN cin VARCHAR(8) DEFAULT NULL AFTER matricule_fiscal",
    "ALTER TABLE clients ADD COLUMN telephone2 VARCHAR(20) DEFAULT NULL AFTER telephone",
    "ALTER TABLE fournisseurs ADD COLUMN telephone2 VARCHAR(20) DEFAULT NULL AFTER telephone",
];

foreach ($migrations as $sql) {
    try {
        $pdo->exec($sql);
        echo "✅ $sql\n";
    } catch (Exception $e) {
        if (str_contains($e->getMessage(), 'Duplicate column')) {
            echo "⏭️ Already exists: $sql\n";
        } else {
            echo "❌ Error: " . $e->getMessage() . "\n";
        }
    }
}
echo "\nDone!\n";
