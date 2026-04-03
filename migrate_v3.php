<?php
/**
 * ASEL Mobile — DB Schema Update v3
 * New: Clients, Factures, Services, Recharges
 */
require_once 'config.php';

$pdo = db();

// Run migrations
$migrations = [
    // Clients
    "CREATE TABLE IF NOT EXISTS clients (
        id INT AUTO_INCREMENT PRIMARY KEY,
        nom VARCHAR(100) NOT NULL,
        prenom VARCHAR(100),
        telephone VARCHAR(50),
        email VARCHAR(100),
        adresse TEXT,
        type_client ENUM('passager','boutique','entreprise') DEFAULT 'passager',
        entreprise VARCHAR(150),
        matricule_fiscal VARCHAR(50),
        note TEXT,
        franchise_id INT,
        actif TINYINT DEFAULT 1,
        date_creation DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_tel (telephone),
        INDEX idx_type (type_client)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
    
    // Factures
    "CREATE TABLE IF NOT EXISTS factures (
        id INT AUTO_INCREMENT PRIMARY KEY,
        numero VARCHAR(30) UNIQUE NOT NULL,
        franchise_id INT NOT NULL,
        client_id INT,
        type_facture ENUM('ticket','facture','devis') DEFAULT 'ticket',
        sous_total DECIMAL(10,2) DEFAULT 0,
        remise_totale DECIMAL(10,2) DEFAULT 0,
        total_ht DECIMAL(10,2) DEFAULT 0,
        tva DECIMAL(10,2) DEFAULT 0,
        total_ttc DECIMAL(10,2) DEFAULT 0,
        mode_paiement ENUM('especes','carte','virement','cheque','mixte') DEFAULT 'especes',
        montant_recu DECIMAL(10,2) DEFAULT 0,
        monnaie DECIMAL(10,2) DEFAULT 0,
        statut ENUM('payee','en_attente','annulee') DEFAULT 'payee',
        utilisateur_id INT,
        note TEXT,
        date_facture DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (franchise_id) REFERENCES franchises(id),
        INDEX idx_numero (numero),
        INDEX idx_date (date_facture)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
    
    // Lignes facture
    "CREATE TABLE IF NOT EXISTS facture_lignes (
        id INT AUTO_INCREMENT PRIMARY KEY,
        facture_id INT NOT NULL,
        type_ligne ENUM('produit','service','recharge') DEFAULT 'produit',
        produit_id INT,
        service_id INT,
        designation VARCHAR(200) NOT NULL,
        quantite INT DEFAULT 1,
        prix_unitaire DECIMAL(10,2) NOT NULL,
        remise DECIMAL(10,2) DEFAULT 0,
        total DECIMAL(10,2) NOT NULL,
        FOREIGN KEY (facture_id) REFERENCES factures(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
    
    // Services
    "CREATE TABLE IF NOT EXISTS services (
        id INT AUTO_INCREMENT PRIMARY KEY,
        nom VARCHAR(150) NOT NULL,
        categorie_service ENUM('technique','compte','autre') DEFAULT 'technique',
        prix DECIMAL(10,2) DEFAULT 0,
        description TEXT,
        duree_minutes INT DEFAULT 15,
        actif TINYINT DEFAULT 1,
        date_creation DATETIME DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
    
    // Prestations (service rendu)
    "CREATE TABLE IF NOT EXISTS prestations (
        id INT AUTO_INCREMENT PRIMARY KEY,
        service_id INT NOT NULL,
        franchise_id INT NOT NULL,
        client_id INT,
        prix_facture DECIMAL(10,2) DEFAULT 0,
        note TEXT,
        utilisateur_id INT,
        date_prestation DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (service_id) REFERENCES services(id),
        FOREIGN KEY (franchise_id) REFERENCES franchises(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
    
    // Produits ASEL (recharges, SIM, etc)
    "CREATE TABLE IF NOT EXISTS produits_asel (
        id INT AUTO_INCREMENT PRIMARY KEY,
        nom VARCHAR(150) NOT NULL,
        type_produit ENUM('recharge_solde','recharge_internet','carte_sim','autre') NOT NULL,
        operateur VARCHAR(50),
        valeur_nominale DECIMAL(10,2) DEFAULT 0,
        prix_vente DECIMAL(10,2) DEFAULT 0,
        commission DECIMAL(10,2) DEFAULT 0,
        actif TINYINT DEFAULT 1,
        date_creation DATETIME DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
    
    // Ventes produits ASEL
    "CREATE TABLE IF NOT EXISTS ventes_asel (
        id INT AUTO_INCREMENT PRIMARY KEY,
        produit_asel_id INT NOT NULL,
        franchise_id INT NOT NULL,
        client_id INT,
        numero_telephone VARCHAR(20),
        prix_vente DECIMAL(10,2) NOT NULL,
        commission DECIMAL(10,2) DEFAULT 0,
        utilisateur_id INT,
        facture_id INT,
        note TEXT,
        date_vente DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (produit_asel_id) REFERENCES produits_asel(id),
        FOREIGN KEY (franchise_id) REFERENCES franchises(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
    
    // Add client_id + facture_id to ventes table
    "ALTER TABLE ventes ADD COLUMN client_id INT AFTER utilisateur_id",
    "ALTER TABLE ventes ADD COLUMN facture_id INT AFTER client_id",
    
    // Franchise coordinates for map
    "ALTER TABLE franchises ADD COLUMN latitude DECIMAL(10,8) AFTER responsable",
    "ALTER TABLE franchises ADD COLUMN longitude DECIMAL(11,8) AFTER latitude",
    
    // Update franchise coordinates
    "UPDATE franchises SET latitude=36.7340, longitude=10.1547 WHERE nom LIKE '%Mourouj%'",
    "UPDATE franchises SET latitude=36.8511, longitude=10.1942 WHERE nom LIKE '%Soukra%'",
];

$success = 0;
$errors = [];
foreach ($migrations as $sql) {
    try {
        $pdo->exec($sql);
        $success++;
    } catch (Exception $e) {
        $msg = $e->getMessage();
        if (strpos($msg, 'Duplicate column') === false && strpos($msg, 'already exists') === false) {
            $errors[] = $msg;
        } else {
            $success++; // Already applied
        }
    }
}

// Seed services
$svc_count = $pdo->query("SELECT COUNT(*) FROM services")->fetchColumn();
if ($svc_count == 0) {
    $services = [
        ['Création compte Google', 'compte', 10, 'Création et configuration Gmail', 15],
        ['Création compte iCloud', 'compte', 15, 'Création Apple ID + iCloud', 20],
        ['Création compte Samsung', 'compte', 10, 'Compte Samsung Galaxy', 10],
        ['Transfert de données', 'technique', 20, 'Transfert contacts, photos, apps', 30],
        ['Formatage téléphone', 'technique', 15, 'Reset usine + reconfiguration', 20],
        ['Installation applications', 'technique', 10, 'Installation et config apps', 15],
        ['Réparation écran', 'technique', 0, 'Devis selon modèle', 60],
        ['Déverrouillage FRP', 'technique', 30, 'Suppression verrou Google', 30],
        ['Mise à jour logicielle', 'technique', 10, 'Mise à jour OS', 20],
        ['Configuration email pro', 'compte', 15, 'Config Outlook/Exchange', 15],
        ['Sauvegarde données', 'technique', 15, 'Backup complet cloud/local', 20],
        ['Protection antivirus', 'technique', 10, 'Installation + config antivirus', 10],
    ];
    $stmt = $pdo->prepare("INSERT INTO services (nom,categorie_service,prix,description,duree_minutes) VALUES (?,?,?,?,?)");
    foreach ($services as $s) $stmt->execute($s);
}

// Seed produits ASEL
$asel_count = $pdo->query("SELECT COUNT(*) FROM produits_asel")->fetchColumn();
if ($asel_count == 0) {
    $prods_asel = [
        // Recharges solde
        ['Recharge Ooredoo 1 DT', 'recharge_solde', 'Ooredoo', 1, 1, 0.05],
        ['Recharge Ooredoo 2 DT', 'recharge_solde', 'Ooredoo', 2, 2, 0.10],
        ['Recharge Ooredoo 5 DT', 'recharge_solde', 'Ooredoo', 5, 5, 0.25],
        ['Recharge Ooredoo 10 DT', 'recharge_solde', 'Ooredoo', 10, 10, 0.50],
        ['Recharge Ooredoo 20 DT', 'recharge_solde', 'Ooredoo', 20, 20, 1.00],
        ['Recharge Orange 1 DT', 'recharge_solde', 'Orange', 1, 1, 0.05],
        ['Recharge Orange 2 DT', 'recharge_solde', 'Orange', 2, 2, 0.10],
        ['Recharge Orange 5 DT', 'recharge_solde', 'Orange', 5, 5, 0.25],
        ['Recharge Orange 10 DT', 'recharge_solde', 'Orange', 10, 10, 0.50],
        ['Recharge Orange 20 DT', 'recharge_solde', 'Orange', 20, 20, 1.00],
        ['Recharge Tunisie Telecom 1 DT', 'recharge_solde', 'Tunisie Telecom', 1, 1, 0.05],
        ['Recharge Tunisie Telecom 5 DT', 'recharge_solde', 'Tunisie Telecom', 5, 5, 0.25],
        ['Recharge Tunisie Telecom 10 DT', 'recharge_solde', 'Tunisie Telecom', 10, 10, 0.50],
        // Recharges internet
        ['Forfait Ooredoo 1Go 3j', 'recharge_internet', 'Ooredoo', 3, 3, 0.15],
        ['Forfait Ooredoo 3Go 7j', 'recharge_internet', 'Ooredoo', 7, 7, 0.35],
        ['Forfait Ooredoo 10Go 30j', 'recharge_internet', 'Ooredoo', 15, 15, 0.75],
        ['Forfait Orange 2Go 7j', 'recharge_internet', 'Orange', 5, 5, 0.25],
        ['Forfait Orange 5Go 30j', 'recharge_internet', 'Orange', 12, 12, 0.60],
        ['Forfait TT 1Go 3j', 'recharge_internet', 'Tunisie Telecom', 2.5, 2.5, 0.12],
        ['Forfait TT 5Go 30j', 'recharge_internet', 'Tunisie Telecom', 10, 10, 0.50],
        // Cartes SIM
        ['Carte SIM Ooredoo', 'carte_sim', 'Ooredoo', 5, 5, 1.00],
        ['Carte SIM Orange', 'carte_sim', 'Orange', 5, 5, 1.00],
        ['Carte SIM TT', 'carte_sim', 'Tunisie Telecom', 5, 5, 1.00],
        ['Carte SIM ASEL Mobile', 'carte_sim', 'ASEL', 10, 10, 3.00],
    ];
    $stmt = $pdo->prepare("INSERT INTO produits_asel (nom,type_produit,operateur,valeur_nominale,prix_vente,commission) VALUES (?,?,?,?,?,?)");
    foreach ($prods_asel as $p) $stmt->execute($p);
}

echo json_encode([
    'success' => true,
    'migrations' => $success,
    'errors' => $errors,
    'services' => $pdo->query("SELECT COUNT(*) FROM services")->fetchColumn(),
    'produits_asel' => $pdo->query("SELECT COUNT(*) FROM produits_asel")->fetchColumn(),
]);
