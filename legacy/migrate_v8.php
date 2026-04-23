<?php
/**
 * ASEL Mobile — Migration v8
 * Prix HT/TVA/TTC, Familles/Sous-catégories, Bons de réception, Trésorerie
 */
require_once 'config.php';
$pdo = db();

$queries = [
    // === 1. Familles table ===
    "CREATE TABLE IF NOT EXISTS familles (
        id INT AUTO_INCREMENT PRIMARY KEY,
        nom VARCHAR(100) UNIQUE NOT NULL,
        description TEXT,
        actif TINYINT DEFAULT 1
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

    // === 2. Sous-catégories table ===
    "CREATE TABLE IF NOT EXISTS sous_categories (
        id INT AUTO_INCREMENT PRIMARY KEY,
        nom VARCHAR(100) NOT NULL,
        categorie_id INT NOT NULL,
        description TEXT,
        FOREIGN KEY (categorie_id) REFERENCES categories(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

    // === 3. Add famille_id to categories ===
    "ALTER TABLE categories ADD COLUMN IF NOT EXISTS famille_id INT DEFAULT NULL",

    // === 4. Products: TVA + sous_categorie + HT/TTC ===
    "ALTER TABLE produits ADD COLUMN IF NOT EXISTS tva_rate DECIMAL(5,2) DEFAULT 19.00",
    "ALTER TABLE produits ADD COLUMN IF NOT EXISTS prix_achat_ht DECIMAL(10,2) DEFAULT 0",
    "ALTER TABLE produits ADD COLUMN IF NOT EXISTS prix_achat_ttc DECIMAL(10,2) DEFAULT 0",
    "ALTER TABLE produits ADD COLUMN IF NOT EXISTS prix_vente_ht DECIMAL(10,2) DEFAULT 0",
    "ALTER TABLE produits ADD COLUMN IF NOT EXISTS prix_vente_ttc DECIMAL(10,2) DEFAULT 0",
    "ALTER TABLE produits ADD COLUMN IF NOT EXISTS sous_categorie_id INT DEFAULT NULL",

    // Backfill: existing prix_achat/prix_vente → treat as TTC (tva 19%)
    "UPDATE produits SET prix_achat_ht = ROUND(prix_achat / 1.19, 2), prix_achat_ttc = prix_achat, prix_vente_ht = ROUND(prix_vente / 1.19, 2), prix_vente_ttc = prix_vente WHERE prix_achat_ttc = 0 AND prix_achat > 0",
    "UPDATE produits SET prix_vente_ht = ROUND(prix_vente / 1.19, 2), prix_vente_ttc = prix_vente WHERE prix_vente_ttc = 0 AND prix_vente > 0",

    // === 5. Fournisseurs: add ICE (tax ID) ===
    "ALTER TABLE fournisseurs ADD COLUMN IF NOT EXISTS ice VARCHAR(50) DEFAULT NULL",

    // === 6. Bons de réception ===
    "CREATE TABLE IF NOT EXISTS bons_reception (
        id INT AUTO_INCREMENT PRIMARY KEY,
        numero VARCHAR(30) UNIQUE NOT NULL,
        franchise_id INT NOT NULL,
        fournisseur_id INT,
        date_reception DATE DEFAULT (CURDATE()),
        total_ht DECIMAL(10,2) DEFAULT 0,
        tva DECIMAL(10,2) DEFAULT 0,
        total_ttc DECIMAL(10,2) DEFAULT 0,
        statut ENUM('brouillon','valide','annule') DEFAULT 'brouillon',
        note TEXT,
        utilisateur_id INT,
        date_creation DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (franchise_id) REFERENCES franchises(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

    "CREATE TABLE IF NOT EXISTS bon_reception_lignes (
        id INT AUTO_INCREMENT PRIMARY KEY,
        bon_id INT NOT NULL,
        produit_id INT NOT NULL,
        quantite INT NOT NULL,
        prix_unitaire_ht DECIMAL(10,2) DEFAULT 0,
        tva_rate DECIMAL(5,2) DEFAULT 19.00,
        prix_unitaire_ttc DECIMAL(10,2) DEFAULT 0,
        total_ht DECIMAL(10,2) DEFAULT 0,
        total_ttc DECIMAL(10,2) DEFAULT 0,
        FOREIGN KEY (bon_id) REFERENCES bons_reception(id) ON DELETE CASCADE,
        FOREIGN KEY (produit_id) REFERENCES produits(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

    // === 7. Trésorerie ===
    "CREATE TABLE IF NOT EXISTS tresorerie (
        id INT AUTO_INCREMENT PRIMARY KEY,
        franchise_id INT NOT NULL,
        type_mouvement ENUM('encaissement','decaissement') NOT NULL,
        montant DECIMAL(10,2) NOT NULL,
        motif VARCHAR(255),
        reference VARCHAR(100),
        date_mouvement DATE DEFAULT (CURDATE()),
        utilisateur_id INT,
        date_creation DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (franchise_id) REFERENCES franchises(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

    // === 8. Clotures mensuelles ===
    "CREATE TABLE IF NOT EXISTS clotures_mensuelles (
        id INT AUTO_INCREMENT PRIMARY KEY,
        franchise_id INT NOT NULL,
        mois VARCHAR(7) NOT NULL,
        total_ventes DECIMAL(10,2) DEFAULT 0,
        total_encaissements DECIMAL(10,2) DEFAULT 0,
        total_decaissements DECIMAL(10,2) DEFAULT 0,
        solde DECIMAL(10,2) DEFAULT 0,
        commentaire TEXT,
        valide TINYINT DEFAULT 0,
        utilisateur_id INT,
        date_creation DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uk_cloture_mens (franchise_id, mois)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

    // === 9. Factures: add TVA fields ===
    "ALTER TABLE factures ADD COLUMN IF NOT EXISTS total_ht DECIMAL(10,2) DEFAULT 0",
    "ALTER TABLE factures ADD COLUMN IF NOT EXISTS tva_montant DECIMAL(10,2) DEFAULT 0",

    // === 10. Seed default familles ===
    "INSERT IGNORE INTO familles (nom) VALUES ('Accessoires Téléphone'),('Appareils Électroniques'),('Téléphonie')",

    // Link existing categories to familles
    "UPDATE categories SET famille_id = (SELECT id FROM familles WHERE nom='Accessoires Téléphone') WHERE nom IN ('Câbles','Chargeurs','Chargeurs auto','Supports téléphone')",
    "UPDATE categories SET famille_id = (SELECT id FROM familles WHERE nom='Appareils Électroniques') WHERE nom IN ('Écouteurs','Casques','Enceintes','Power Banks','Montres connectées','Accessoires montre')",
    "UPDATE categories SET famille_id = (SELECT id FROM familles WHERE nom='Téléphonie') WHERE nom IN ('Téléphones')",
];

$success = 0; $errors = [];
foreach ($queries as $q) {
    try {
        $pdo->exec($q);
        $success++;
    } catch (Exception $e) {
        // Ignore "column already exists" etc
        if (strpos($e->getMessage(), 'Duplicate column') === false && 
            strpos($e->getMessage(), 'Duplicate entry') === false) {
            $errors[] = $e->getMessage();
        } else {
            $success++;
        }
    }
}

echo "<h2>Migration v8 Complete</h2>";
echo "<p>✅ $success queries OK</p>";
if ($errors) {
    echo "<p>⚠️ Errors:</p><ul>";
    foreach ($errors as $e) echo "<li>$e</li>";
    echo "</ul>";
}
echo "<p><a href='index.php'>← Retour</a></p>";
