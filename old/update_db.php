<?php
require_once 'config.php';
$pdo = db();

// Add 'gestionnaire' role
$pdo->exec("ALTER TABLE utilisateurs MODIFY COLUMN role ENUM('admin','franchise','gestionnaire','viewer') NOT NULL");

// Create product requests table (franchise → gestionnaire)
$pdo->exec("
CREATE TABLE IF NOT EXISTS demandes_produits (
    id INT AUTO_INCREMENT PRIMARY KEY,
    franchise_id INT NOT NULL,
    produit_id INT,
    nom_produit VARCHAR(150),
    quantite INT NOT NULL DEFAULT 1,
    urgence ENUM('normal','urgent','critique') DEFAULT 'normal',
    statut ENUM('en_attente','en_cours','livre','rejete') DEFAULT 'en_attente',
    note TEXT,
    demandeur_id INT,
    gestionnaire_id INT,
    reponse TEXT,
    date_demande DATETIME DEFAULT CURRENT_TIMESTAMP,
    date_traitement DATETIME,
    FOREIGN KEY (franchise_id) REFERENCES franchises(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
");

// Create central stock user
$pw = password_hash('stock2024', PASSWORD_DEFAULT);
$existing = $pdo->query("SELECT COUNT(*) FROM utilisateurs WHERE nom_utilisateur='stock'")->fetchColumn();
if ($existing == 0) {
    $pdo->prepare("INSERT INTO utilisateurs (nom_utilisateur,mot_de_passe,nom_complet,role) VALUES (?,?,?,?)")
        ->execute(['stock', $pw, 'Gestionnaire Stock Central', 'gestionnaire']);
}

echo "✅ Database updated!\n";
echo "New account: stock / stock2024 (gestionnaire)\n";
