<?php
require_once __DIR__ . '/config.php';
$pdo = db();

$migrations = [
    // Many-to-many: product can have multiple fournisseurs, each with their own prices
    "CREATE TABLE IF NOT EXISTS produit_fournisseurs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        produit_id INT NOT NULL,
        fournisseur_id INT NOT NULL,
        prix_achat_ht DECIMAL(12,2) DEFAULT 0,
        prix_achat_ttc DECIMAL(12,2) DEFAULT 0,
        reference_fournisseur VARCHAR(50) DEFAULT '',
        is_default TINYINT(1) DEFAULT 0,
        date_derniere_commande DATE DEFAULT NULL,
        notes VARCHAR(255) DEFAULT '',
        actif TINYINT(1) DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY unique_prod_fourn (produit_id, fournisseur_id),
        KEY idx_produit (produit_id),
        KEY idx_fournisseur (fournisseur_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
    
    // Migrate existing fournisseur_id data from produits table
    "INSERT IGNORE INTO produit_fournisseurs (produit_id, fournisseur_id, prix_achat_ht, prix_achat_ttc, is_default)
     SELECT id, fournisseur_id, COALESCE(prix_achat_ht,0), COALESCE(prix_achat_ttc, prix_achat, 0), 1
     FROM produits WHERE fournisseur_id IS NOT NULL AND fournisseur_id > 0",
];

foreach ($migrations as $sql) {
    try {
        $pdo->exec($sql);
        echo "✅ " . substr($sql, 0, 80) . "...\n";
    } catch (Exception $e) {
        echo "⚠️ " . $e->getMessage() . "\n";
    }
}

// Count migrated
$count = $pdo->query("SELECT COUNT(*) FROM produit_fournisseurs")->fetchColumn();
echo "\n📊 produit_fournisseurs: $count entries\n";
echo "Done!\n";
