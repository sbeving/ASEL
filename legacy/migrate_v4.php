<?php
/**
 * ASEL Mobile — DB Migration v4
 * Payments, installments, notifications, inventory audit
 */
require_once 'config.php';
$pdo = db();

$migrations = [
    // Notifications
    "CREATE TABLE IF NOT EXISTS notifications (
        id INT AUTO_INCREMENT PRIMARY KEY,
        utilisateur_id INT,
        franchise_id INT,
        role_cible VARCHAR(20),
        titre VARCHAR(200) NOT NULL,
        message TEXT,
        type_notif ENUM('info','warning','danger','success') DEFAULT 'info',
        lien VARCHAR(200),
        lu TINYINT DEFAULT 0,
        date_creation DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_user (utilisateur_id, lu),
        INDEX idx_franchise (franchise_id, lu),
        INDEX idx_role (role_cible, lu)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

    // Paiements par lots / échéances
    "CREATE TABLE IF NOT EXISTS echeances (
        id INT AUTO_INCREMENT PRIMARY KEY,
        facture_id INT NOT NULL,
        franchise_id INT NOT NULL,
        client_id INT NOT NULL,
        montant DECIMAL(10,2) NOT NULL,
        date_echeance DATE NOT NULL,
        statut ENUM('en_attente','payee','en_retard') DEFAULT 'en_attente',
        date_paiement DATETIME,
        mode_paiement ENUM('especes','carte','virement','cheque') DEFAULT 'especes',
        rappel_7j_envoye TINYINT DEFAULT 0,
        rappel_3j_envoye TINYINT DEFAULT 0,
        note TEXT,
        utilisateur_id INT,
        date_creation DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (facture_id) REFERENCES factures(id),
        FOREIGN KEY (client_id) REFERENCES clients(id),
        INDEX idx_date (date_echeance, statut),
        INDEX idx_client (client_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

    // Inventaire mensuel
    "CREATE TABLE IF NOT EXISTS inventaires (
        id INT AUTO_INCREMENT PRIMARY KEY,
        franchise_id INT NOT NULL,
        mois VARCHAR(7) NOT NULL,
        statut ENUM('en_cours','soumis','valide','rejete') DEFAULT 'en_cours',
        date_debut DATETIME DEFAULT CURRENT_TIMESTAMP,
        date_soumission DATETIME,
        date_validation DATETIME,
        commentaire TEXT,
        utilisateur_id INT,
        validateur_id INT,
        ecarts_count INT DEFAULT 0,
        ecarts_valeur DECIMAL(10,2) DEFAULT 0,
        UNIQUE KEY uk_inv (franchise_id, mois),
        FOREIGN KEY (franchise_id) REFERENCES franchises(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

    // Lignes inventaire
    "CREATE TABLE IF NOT EXISTS inventaire_lignes (
        id INT AUTO_INCREMENT PRIMARY KEY,
        inventaire_id INT NOT NULL,
        produit_id INT NOT NULL,
        quantite_systeme INT DEFAULT 0,
        quantite_physique INT,
        ecart INT DEFAULT 0,
        note TEXT,
        FOREIGN KEY (inventaire_id) REFERENCES inventaires(id) ON DELETE CASCADE,
        FOREIGN KEY (produit_id) REFERENCES produits(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

    // Add mode_paiement to ventes if not exists
    "ALTER TABLE ventes ADD COLUMN mode_paiement ENUM('especes','carte','virement','cheque','echeance') DEFAULT 'especes' AFTER remise",
    "ALTER TABLE ventes ADD COLUMN montant_recu DECIMAL(10,2) DEFAULT 0 AFTER mode_paiement",
    "ALTER TABLE ventes ADD COLUMN monnaie DECIMAL(10,2) DEFAULT 0 AFTER montant_recu",
];

$ok = 0; $err = [];
foreach ($migrations as $sql) {
    try { $pdo->exec($sql); $ok++; }
    catch (Exception $e) {
        $msg = $e->getMessage();
        if (strpos($msg,'Duplicate')===false && strpos($msg,'already exists')===false) $err[] = $msg;
        else $ok++;
    }
}

echo json_encode(['success'=>true,'ok'=>$ok,'errors'=>$err]);
