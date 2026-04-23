<?php
/**
 * ASEL Mobile — Database Migration v5
 * Adds: audit_logs, franchise coordinates, stock_central, points_acces fixes
 */
require_once 'config.php';
$pdo = db();

echo "<h2>ASEL Mobile — Migration v5</h2><pre>";

// 1. Add latitude/longitude to franchises
try {
    $pdo->exec("ALTER TABLE franchises ADD COLUMN latitude DECIMAL(10,8) NULL AFTER adresse");
    $pdo->exec("ALTER TABLE franchises ADD COLUMN longitude DECIMAL(11,8) NULL AFTER latitude");
    echo "✅ Added latitude/longitude to franchises\n";
} catch(Exception $e) {
    echo "⏭️ latitude/longitude already exist\n";
}

// 2. Set known franchise coordinates
$pdo->exec("UPDATE franchises SET latitude=36.7271, longitude=10.2256 WHERE nom LIKE '%Mourouj%' AND latitude IS NULL");
$pdo->exec("UPDATE franchises SET latitude=36.8671, longitude=10.2507 WHERE nom LIKE '%Soukra%' AND latitude IS NULL");
echo "✅ Updated franchise coordinates\n";

// 3. Create audit_logs table
$pdo->exec("
CREATE TABLE IF NOT EXISTS audit_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    utilisateur_id INT NOT NULL,
    utilisateur_nom VARCHAR(100),
    action VARCHAR(100) NOT NULL,
    cible VARCHAR(100),
    cible_id INT,
    details TEXT,
    ip_address VARCHAR(45),
    user_agent TEXT,
    franchise_id INT,
    date_creation DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_user (utilisateur_id),
    INDEX idx_action (action),
    INDEX idx_date (date_creation),
    INDEX idx_franchise (franchise_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
");
echo "✅ Created audit_logs table\n";

// 4. Add client_id and facture_id to ventes if missing
try { $pdo->exec("ALTER TABLE ventes ADD COLUMN client_id INT NULL AFTER utilisateur_id"); echo "✅ Added client_id to ventes\n"; } catch(Exception $e) { echo "⏭️ client_id already exists in ventes\n"; }
try { $pdo->exec("ALTER TABLE ventes ADD COLUMN facture_id INT NULL AFTER client_id"); echo "✅ Added facture_id to ventes\n"; } catch(Exception $e) { echo "⏭️ facture_id already exists in ventes\n"; }
try { $pdo->exec("ALTER TABLE ventes ADD COLUMN mode_paiement VARCHAR(30) DEFAULT 'especes' AFTER facture_id"); echo "✅ Added mode_paiement to ventes\n"; } catch(Exception $e) { echo "⏭️ mode_paiement already exists in ventes\n"; }
try { $pdo->exec("ALTER TABLE ventes ADD COLUMN montant_recu DECIMAL(10,2) DEFAULT 0 AFTER mode_paiement"); echo "✅ Added montant_recu to ventes\n"; } catch(Exception $e) { echo "⏭️ montant_recu already exists\n"; }
try { $pdo->exec("ALTER TABLE ventes ADD COLUMN monnaie DECIMAL(10,2) DEFAULT 0 AFTER montant_recu"); echo "✅ Added monnaie to ventes\n"; } catch(Exception $e) { echo "⏭️ monnaie already exists\n"; }

// 5. Create clients table if missing
$pdo->exec("
CREATE TABLE IF NOT EXISTS clients (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nom VARCHAR(100) NOT NULL,
    prenom VARCHAR(100),
    telephone VARCHAR(50),
    email VARCHAR(150),
    adresse TEXT,
    type_client ENUM('passager','boutique','entreprise') DEFAULT 'passager',
    entreprise VARCHAR(150),
    matricule_fiscal VARCHAR(50),
    franchise_id INT,
    actif TINYINT DEFAULT 1,
    date_creation DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_type (type_client),
    INDEX idx_franchise (franchise_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
");
echo "✅ clients table ready\n";

// 6. Create factures table if missing
$pdo->exec("
CREATE TABLE IF NOT EXISTS factures (
    id INT AUTO_INCREMENT PRIMARY KEY,
    numero VARCHAR(30) NOT NULL,
    franchise_id INT NOT NULL,
    client_id INT,
    type_facture ENUM('ticket','facture','devis') DEFAULT 'ticket',
    sous_total DECIMAL(10,2) DEFAULT 0,
    remise_totale DECIMAL(10,2) DEFAULT 0,
    total_ht DECIMAL(10,2) DEFAULT 0,
    tva DECIMAL(10,2) DEFAULT 0,
    total_ttc DECIMAL(10,2) DEFAULT 0,
    mode_paiement VARCHAR(30) DEFAULT 'especes',
    montant_recu DECIMAL(10,2) DEFAULT 0,
    monnaie DECIMAL(10,2) DEFAULT 0,
    statut ENUM('payee','en_attente','annulee') DEFAULT 'payee',
    utilisateur_id INT,
    date_facture DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_numero (numero),
    INDEX idx_franchise_date (franchise_id, date_facture)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
");
echo "✅ factures table ready\n";

// 7. Create facture_lignes if missing
$pdo->exec("
CREATE TABLE IF NOT EXISTS facture_lignes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    facture_id INT NOT NULL,
    type_ligne ENUM('produit','service') DEFAULT 'produit',
    produit_id INT,
    service_id INT,
    designation VARCHAR(200),
    quantite INT DEFAULT 1,
    prix_unitaire DECIMAL(10,2) DEFAULT 0,
    remise DECIMAL(10,2) DEFAULT 0,
    total DECIMAL(10,2) DEFAULT 0,
    INDEX idx_facture (facture_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
");
echo "✅ facture_lignes table ready\n";

// 8. Create echeances if missing
$pdo->exec("
CREATE TABLE IF NOT EXISTS echeances (
    id INT AUTO_INCREMENT PRIMARY KEY,
    facture_id INT NOT NULL,
    franchise_id INT NOT NULL,
    client_id INT NOT NULL,
    montant DECIMAL(10,2) NOT NULL,
    date_echeance DATE NOT NULL,
    statut ENUM('en_attente','payee','en_retard') DEFAULT 'en_attente',
    mode_paiement VARCHAR(30),
    date_paiement DATETIME,
    note TEXT,
    utilisateur_id INT,
    date_creation DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_date (date_echeance),
    INDEX idx_client (client_id),
    INDEX idx_statut (statut)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
");
echo "✅ echeances table ready\n";

// 9. Create inventaires + inventaire_lignes if missing
$pdo->exec("
CREATE TABLE IF NOT EXISTS inventaires (
    id INT AUTO_INCREMENT PRIMARY KEY,
    franchise_id INT NOT NULL,
    mois VARCHAR(7) NOT NULL,
    statut ENUM('brouillon','soumis','valide','rejete') DEFAULT 'brouillon',
    ecarts_count INT DEFAULT 0,
    ecarts_valeur INT DEFAULT 0,
    commentaire TEXT,
    utilisateur_id INT,
    validateur_id INT,
    date_soumission DATETIME,
    date_validation DATETIME,
    UNIQUE KEY uk_inv (franchise_id, mois)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
");
$pdo->exec("
CREATE TABLE IF NOT EXISTS inventaire_lignes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    inventaire_id INT NOT NULL,
    produit_id INT NOT NULL,
    quantite_systeme INT DEFAULT 0,
    quantite_physique INT DEFAULT 0,
    ecart INT DEFAULT 0,
    INDEX idx_inventaire (inventaire_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
");
echo "✅ inventaires + lignes tables ready\n";

// 10. Create notifications if missing
$pdo->exec("
CREATE TABLE IF NOT EXISTS notifications (
    id INT AUTO_INCREMENT PRIMARY KEY,
    franchise_id INT,
    utilisateur_id INT,
    role_cible VARCHAR(30),
    titre VARCHAR(200),
    message TEXT,
    type_notif ENUM('info','success','warning','danger') DEFAULT 'info',
    lien VARCHAR(255),
    lu TINYINT DEFAULT 0,
    date_creation DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_lu (lu),
    INDEX idx_franchise (franchise_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
");
echo "✅ notifications table ready\n";

// 11. Create services + prestations if missing
$pdo->exec("
CREATE TABLE IF NOT EXISTS services (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nom VARCHAR(150) NOT NULL,
    categorie_service ENUM('technique','compte','autre') DEFAULT 'technique',
    prix DECIMAL(10,2) DEFAULT 0,
    description TEXT,
    duree_minutes INT DEFAULT 15,
    actif TINYINT DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
");
$pdo->exec("
CREATE TABLE IF NOT EXISTS prestations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    service_id INT NOT NULL,
    franchise_id INT NOT NULL,
    client_id INT,
    prix_facture DECIMAL(10,2) DEFAULT 0,
    note TEXT,
    utilisateur_id INT,
    date_prestation DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
");
echo "✅ services + prestations tables ready\n";

// 12. Create produits_asel if missing
$pdo->exec("
CREATE TABLE IF NOT EXISTS produits_asel (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nom VARCHAR(150) NOT NULL,
    type_produit ENUM('recharge_solde','recharge_internet','carte_sim','autre') DEFAULT 'recharge_solde',
    operateur VARCHAR(50) DEFAULT 'ASEL',
    valeur_nominale DECIMAL(10,2) DEFAULT 0,
    prix_vente DECIMAL(10,2) DEFAULT 0,
    commission DECIMAL(10,2) DEFAULT 0,
    actif TINYINT DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
");
echo "✅ produits_asel table ready\n";

// 13. Create points_acces if missing (franchise management)
$pdo->exec("
CREATE TABLE IF NOT EXISTS points_acces (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nom VARCHAR(150) NOT NULL,
    adresse TEXT,
    latitude DECIMAL(10,8),
    longitude DECIMAL(11,8),
    telephone VARCHAR(50),
    responsable VARCHAR(100),
    image_url VARCHAR(500),
    franchise_id INT,
    actif TINYINT DEFAULT 1,
    date_creation DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
");
echo "✅ points_acces table ready\n";

// 14. Update overdue echeances
$updated = $pdo->exec("UPDATE echeances SET statut='en_retard' WHERE statut='en_attente' AND date_echeance < CURDATE()");
echo "✅ Updated $updated overdue echeances\n";

echo "\n🎉 Migration v5 complete!\n";
echo "</pre>";
echo "<p><a href='index.php'>← Retour</a></p>";
