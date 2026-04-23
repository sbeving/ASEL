<?php
require_once __DIR__ . '/config.php';
$pdo = db();
try {
    $pdo->exec("ALTER TABLE produits ADD COLUMN image_base64 MEDIUMTEXT DEFAULT NULL AFTER description");
    echo "✅ Added image_base64 column to produits\n";
} catch (Exception $e) {
    if (str_contains($e->getMessage(), 'Duplicate column')) echo "⏭️ Column already exists\n";
    else echo "❌ " . $e->getMessage() . "\n";
}
echo "Done!\n";
