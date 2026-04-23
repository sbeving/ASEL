<?php
require_once __DIR__ . '/config.php';
$pdo = db();

$migrations = [
    "ALTER TABLE utilisateurs ADD COLUMN prenom VARCHAR(100) DEFAULT '' AFTER nom_complet",
    "ALTER TABLE utilisateurs ADD COLUMN cin VARCHAR(8) DEFAULT NULL AFTER prenom",
    "ALTER TABLE utilisateurs ADD COLUMN telephone VARCHAR(20) DEFAULT '' AFTER cin",
    "ALTER TABLE utilisateurs ADD COLUMN custom_permissions TEXT DEFAULT NULL AFTER role",
];

foreach ($migrations as $sql) {
    try {
        $pdo->exec($sql);
        echo "✅ $sql\n";
    } catch (Exception $e) {
        if (str_contains($e->getMessage(), 'Duplicate column')) echo "⏭️ Already exists\n";
        else echo "❌ " . $e->getMessage() . "\n";
    }
}
echo "\nDone! Now refresh the app.\n";
