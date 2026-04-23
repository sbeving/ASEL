<?php
// ASEL Mobile — Database Config
define('DB_HOST', 'sql211.infinityfree.com');
define('DB_USER', 'if0_41570853');
define('DB_PASS', 'dtqOrICDVV0p6');
define('DB_NAME', 'if0_41570853_asel');

// === TIMEZONE: Tunisia (GMT+1) ===
date_default_timezone_set('Africa/Tunis');

function db() {
    static $pdo = null;
    if (!$pdo) {
        $pdo = new PDO("mysql:host=".DB_HOST.";dbname=".DB_NAME.";charset=utf8mb4", DB_USER, DB_PASS, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC
        ]);
        // Set MySQL session timezone to Tunisia
        $pdo->exec("SET time_zone = '+01:00'");
    }
    return $pdo;
}

function init_db() {
    $pdo = db();
    
    $pdo->exec("
    CREATE TABLE IF NOT EXISTS franchises (
        id INT AUTO_INCREMENT PRIMARY KEY,
        nom VARCHAR(100) UNIQUE NOT NULL,
        adresse VARCHAR(255), telephone VARCHAR(50), responsable VARCHAR(100),
        actif TINYINT DEFAULT 1,
        date_creation DATETIME DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

    CREATE TABLE IF NOT EXISTS categories (
        id INT AUTO_INCREMENT PRIMARY KEY,
        nom VARCHAR(100) UNIQUE NOT NULL, description TEXT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

    CREATE TABLE IF NOT EXISTS fournisseurs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        nom VARCHAR(100) NOT NULL, telephone VARCHAR(50), email VARCHAR(100),
        adresse VARCHAR(255), actif TINYINT DEFAULT 1
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

    CREATE TABLE IF NOT EXISTS produits (
        id INT AUTO_INCREMENT PRIMARY KEY,
        nom VARCHAR(150) NOT NULL, categorie_id INT NOT NULL,
        prix_achat DECIMAL(10,2) DEFAULT 0, prix_vente DECIMAL(10,2) DEFAULT 0,
        reference VARCHAR(50), code_barre VARCHAR(50), description TEXT,
        marque VARCHAR(50), fournisseur_id INT,
        seuil_alerte INT DEFAULT 3, actif TINYINT DEFAULT 1,
        date_creation DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (categorie_id) REFERENCES categories(id),
        INDEX idx_code_barre (code_barre),
        INDEX idx_reference (reference)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

    CREATE TABLE IF NOT EXISTS utilisateurs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        nom_utilisateur VARCHAR(50) UNIQUE NOT NULL,
        mot_de_passe VARCHAR(255) NOT NULL,
        nom_complet VARCHAR(100) NOT NULL,
        role ENUM('admin','franchise','gestionnaire','viewer') NOT NULL,
        franchise_id INT, actif TINYINT DEFAULT 1,
        date_creation DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (franchise_id) REFERENCES franchises(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

    CREATE TABLE IF NOT EXISTS stock (
        id INT AUTO_INCREMENT PRIMARY KEY,
        franchise_id INT NOT NULL, produit_id INT NOT NULL,
        quantite INT DEFAULT 0,
        derniere_maj DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uk_stock (franchise_id, produit_id),
        FOREIGN KEY (franchise_id) REFERENCES franchises(id),
        FOREIGN KEY (produit_id) REFERENCES produits(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

    CREATE TABLE IF NOT EXISTS mouvements (
        id INT AUTO_INCREMENT PRIMARY KEY,
        franchise_id INT NOT NULL, produit_id INT NOT NULL,
        type_mouvement VARCHAR(20) NOT NULL,
        quantite INT NOT NULL, prix_unitaire DECIMAL(10,2) DEFAULT 0,
        note TEXT, utilisateur_id INT,
        date_mouvement DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (franchise_id) REFERENCES franchises(id),
        FOREIGN KEY (produit_id) REFERENCES produits(id),
        INDEX idx_date (date_mouvement)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

    CREATE TABLE IF NOT EXISTS ventes (
        id INT AUTO_INCREMENT PRIMARY KEY,
        franchise_id INT NOT NULL, produit_id INT NOT NULL,
        quantite INT NOT NULL, prix_unitaire DECIMAL(10,2) NOT NULL,
        prix_total DECIMAL(10,2) NOT NULL, remise DECIMAL(5,2) DEFAULT 0,
        date_vente DATE DEFAULT (CURDATE()),
        utilisateur_id INT, note TEXT,
        date_creation DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (franchise_id) REFERENCES franchises(id),
        FOREIGN KEY (produit_id) REFERENCES produits(id),
        INDEX idx_date_vente (date_vente),
        INDEX idx_franchise_date (franchise_id, date_vente)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

    CREATE TABLE IF NOT EXISTS transferts (
        id INT AUTO_INCREMENT PRIMARY KEY,
        franchise_source INT NOT NULL, franchise_dest INT NOT NULL,
        produit_id INT NOT NULL, quantite INT NOT NULL,
        statut ENUM('en_attente','accepte','rejete') DEFAULT 'en_attente',
        demandeur_id INT, validateur_id INT, note TEXT,
        date_demande DATETIME DEFAULT CURRENT_TIMESTAMP,
        date_validation DATETIME
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

    CREATE TABLE IF NOT EXISTS clotures (
        id INT AUTO_INCREMENT PRIMARY KEY,
        franchise_id INT NOT NULL, date_cloture DATE NOT NULL,
        total_ventes_declare DECIMAL(10,2) DEFAULT 0,
        total_articles_declare INT DEFAULT 0,
        total_ventes_systeme DECIMAL(10,2) DEFAULT 0,
        total_articles_systeme INT DEFAULT 0,
        commentaire TEXT, valide TINYINT DEFAULT 0,
        utilisateur_id INT, validateur_id INT,
        date_creation DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uk_cloture (franchise_id, date_cloture)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

    CREATE TABLE IF NOT EXISTS retours (
        id INT AUTO_INCREMENT PRIMARY KEY,
        franchise_id INT NOT NULL, produit_id INT NOT NULL,
        quantite INT NOT NULL,
        type_retour ENUM('retour','echange') DEFAULT 'retour',
        raison TEXT, note TEXT, utilisateur_id INT,
        date_retour DATETIME DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

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
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    ");
    
    // Audit logs table (always ensure it exists)
    $pdo->exec("CREATE TABLE IF NOT EXISTS audit_logs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        utilisateur_id INT,
        utilisateur_nom VARCHAR(100),
        action VARCHAR(50) NOT NULL,
        cible VARCHAR(50),
        cible_id INT,
        details TEXT,
        ip_address VARCHAR(45),
        user_agent VARCHAR(255),
        franchise_id INT,
        date_creation DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_date (date_creation),
        INDEX idx_user (utilisateur_id),
        INDEX idx_action (action)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    
    // Notifications table
    $pdo->exec("CREATE TABLE IF NOT EXISTS notifications (
        id INT AUTO_INCREMENT PRIMARY KEY,
        destinataire_id INT,
        franchise_id INT,
        role_cible VARCHAR(20),
        type_notif ENUM('info','warning','danger','success') DEFAULT 'info',
        titre VARCHAR(150) NOT NULL,
        message TEXT,
        lien VARCHAR(255),
        lu TINYINT DEFAULT 0,
        date_creation DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_dest (destinataire_id, lu),
        INDEX idx_franchise (franchise_id, lu)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    
    // Migrate old role column if needed
    try { $pdo->exec("ALTER TABLE utilisateurs MODIFY COLUMN role ENUM('admin','franchise','gestionnaire','viewer') NOT NULL"); } catch(Exception $e) {}
}

function seed_real_data() {
    $pdo = db();
    
    // Check if already seeded
    $count = $pdo->query("SELECT COUNT(*) FROM franchises")->fetchColumn();
    if ($count > 0) return "Already seeded";
    
    // Franchises
    $pdo->exec("INSERT INTO franchises (nom,adresse,telephone,responsable) VALUES
        ('ASEL Mobile — Mourouj','Mourouj, Ben Arous','52 123 456','Gérant Mourouj'),
        ('ASEL Mobile — Soukra','Soukra, Ariana','52 234 567','Gérant Soukra')
    ");
    
    // Categories
    $pdo->exec("INSERT INTO categories (nom) VALUES
        ('Câbles'),('Chargeurs'),('Chargeurs auto'),('Écouteurs'),('Casques'),
        ('Enceintes'),('Power Banks'),('Supports téléphone'),('Accessoires montre'),
        ('Montres connectées'),('Téléphones')
    ");
    
    // Fournisseurs
    $pdo->exec("INSERT INTO fournisseurs (nom,adresse) VALUES
        ('Actelo','Tunisie'),('Mokhtar','Tunisie')
    ");
    
    // Users — password_hash for security
    $admin_pw = password_hash('admin2024', PASSWORD_DEFAULT);
    $mourouj_pw = password_hash('mourouj2024', PASSWORD_DEFAULT);
    $soukra_pw = password_hash('soukra2024', PASSWORD_DEFAULT);
    
    $stmt = $pdo->prepare("INSERT INTO utilisateurs (nom_utilisateur,mot_de_passe,nom_complet,role,franchise_id) VALUES (?,?,?,?,?)");
    $stmt->execute(['admin', $admin_pw, 'Administrateur', 'admin', null]);
    $stmt->execute(['mourouj', $mourouj_pw, 'Gérant Mourouj', 'franchise', 1]);
    $stmt->execute(['soukra', $soukra_pw, 'Gérant Soukra', 'franchise', 2]);
    
    // Products from real Excel data
    $products = [
        // [nom, cat_id, prix_achat, prix_vente, reference, marque, fournisseur_id, stock_mourouj, stock_soukra]
        // CÂBLES (cat 1)
        ['2,4A 1M USB micro','1',0,0,'BC04M','Blackwave',null,0,0],
        ['USB TO type C 1M 3A','1',0,0,'BC04C','Blackwave',null,0,0],
        ['USB to lightning 1m 3A','1',0,0,'BC04L','Blackwave',null,0,0],
        ['Type C vers type C PD60W 1m','1',0,0,'BC03CC','Blackwave',null,0,0],
        ['Type C to Lightning PD 27W 1M','1',10,30,'BC03CL','Blackwave',null,0,0],
        ['Type C to Lightning 1m','1',0,20,'CK-123','INKAX',null,0,0],
        ['type C 2.4, 1 metre micro','1',5,15,'X163','WUW',2,0,5],
        ['type C 3.0, 1 metre','1',5.2,18,'A102','ASPOR',2,0,9],
        ['type C 2,4, 1 metre','1',5.5,15,'D3T','GERLAX',2,0,8],
        ['iphone 2.1, 1 metre','1',4.8,15,'XO-NB212','XO',2,0,1],
        ['iphone 2.4, 1 metre','1',5,15,'X163-IP','WUW',2,0,8],
        ['iphone 3.1, 1 metre','1',5.5,20,'CB-06-IP','INKAX',2,0,10],
        ['iphone 2.4, 3 Metres','1',10,30,'IC-UC1626','ICONIX',2,0,4],
        ['Micro 3.1, 1 metre','1',5.5,20,'CB-06-M','INKAX',2,0,4],
        ['cable usb-lightning 1m','1',5,15,'A1480','Apple',null,0,5],
        ['3,25 FT 3,4A','1',7,20,'IC-UC1622','ICONIX',2,0,5],
        ['TYPE C FAST CHARGING 4,0 MM','1',10,30,'CB-45','INKAX',2,0,9],
        ['Type C iphone 15+, 1 metre','1',10,30,'CK-123-TC','INKAX',2,0,4],
        ['Apple originale, 1 metre','1',15,45,'MQKJ3ZM/A','APPLE',2,0,5],
        ['Type C, 3,1A 1metre','1',7,22,'CB-36','Inkax',2,0,8],
        ['Type C iphone, 1 metre 20W','1',10,35,'MQGJ2ZM/A','Elektrum',2,0,5],
        ['cable usb-lightning 1m','1',5,15,'AL-32','INKAX',2,0,5],
        
        // CHARGEURS (cat 2)
        ['USB A 2,4A','2',0,25,'BL02','Blackwave',null,0,0],
        ['USB-C to lightning 25W iPhone 14 pro','2',22,45,'A2347','Apple',null,5,0],
        ['USB-C to USB-C 5A 45W white','2',0,45,'SAM-45W-W','Samsung',null,0,0],
        ['USB-C to USB-C 5A 45W black','2',0,45,'SAM-45W-B','Samsung',null,0,0],
        ['2,4A 1M USB micro','2',0,45,'BL02M','Blackwave',null,0,0],
        ['2,4A 1M USB lightning','2',0,45,'BL02L','Blackwave',null,0,0],
        ['Sortie type C / USB 35W','2',25,50,'S22','PD ADAPTER',null,0,4],
        ['2.4A avec sortie USB','2',10,30,'C06','INKAX',2,0,5],
        ['KAKOSIGA 2.4A','2',10,30,'KSC-1236','KAKOSIGA',2,0,5],
        ['18W','2',18,45,'QC-18W','ICONIX',2,0,4],
        ['Smart charger 2,4A','2',10,30,'A818','ASPOR',2,0,4],
        ['2.4 LIGHTING','2',10,30,'AG-04','AULEX',2,0,5],
        
        // CHARGEURS AUTO (cat 3)
        ['30W 2,4A double USB A','3',0,0,'CA-27','Inkax',null,0,0],
        ['360 rotating','3',0,25,'CH-57','INKAX',null,0,0],
        ['360 rotating retractable','3',12,30,'CH-62','INKAX',null,2,0],
        ['Metal car mount','3',25,45,'HC1508','VIDVIE',null,2,0],
        ['Dual USB car MP3 3,1A','3',0,30,'CM-12','INKAX',null,0,0],
        ['Sortie type C / USB 48W','3',18,30,'CA-32','INKAX',2,0,2],
        ['Sortie type C 2,4','3',18,30,'CR-69','GFUZ',2,0,2],
        
        // ÉCOUTEURS (cat 4)
        ['1,2m sans ventouse black','4',0,20,'E14','Inkax',null,0,0],
        ['1,2m avec ventouse white','4',0,20,'E20','INKAX',null,0,0],
        ['Stereo sans ventouse white','4',7,20,'R-3','BLUESPECTRUM',null,2,0],
        ['1,2m sans ventouse white','4',6,15,'G12-W','Celebrat',null,2,0],
        ['1,2m sans ventouse black','4',6,15,'G12-B','Celebrat',null,2,0],
        ['Sans ventouse 1,2m white','4',0,15,'AE-01-W','Inkax',null,0,0],
        ['Sans ventouse 1,2m black','4',5,15,'AE-01-B','Inkax',null,4,0],
        ['Sans ventouse stereo white','4',28,0,'EW43','HOCO',null,2,0],
        ['Avec ventouse white','4',0,45,'T03','Inkax',null,0,0],
        ['Avec ventouse white HOCO','4',0,45,'EW04','HOCO',null,0,0],
        ['Sans ventouse white','4',30,45,'T02','Inkax',null,2,0],
        ['ASPORT filaire','4',8,22,'A206','ASPORT',2,0,5],
        ['R12 Blue Spectrum','4',7,18,'R-12','Blue Spectrum',2,0,3],
        ['R9 Blue Spectrum','4',7,18,'R-09','Blue Spectrum',2,0,5],
        ['ANC Marshal','4',25,19,'ANC','Marshal',null,0,1],
        ['XO Wireless earphone','4',0,80,'XO-X33','XO',2,0,1],
        ['INKAX sans ventouse blanc','4',0,60,'T02-DF','INKAX',2,0,2],
        ['Yookie YKS18','4',0,49,'YKS18','Yookie',null,0,2],
        
        // CASQUES (cat 5)
        ['MAJOR IV Wireless','5',40,75,'MAJOR-IV','Marshal',2,0,1],
        ['P9 Normal','5',15,30,'16622','Generic',2,0,2],
        ['P9 Pro Max','5',18,45,'20984','Generic',2,0,2],
        ['HEADSET SONIC','5',0,29,'KR-9900','HEADSET',null,0,1],
        ['HEADSET KUROMI','5',0,29,'AH-806N','HEADSET',null,0,1],
        
        // ENCEINTES (cat 6)
        ['Portable wireless speaker','6',55,75,'SLC-061','Wireless',null,2,0],
        ['Wireless speaker bluetooth 5W','6',30,45,'JZ-200','Wireless',null,2,0],
        
        // POWER BANKS (cat 7)
        ['BAVIN 5000mAh','7',28,45,'PC-013','BAVIN',null,0,2],
        ['KAKUSIGA 10000mAh','7',25,45,'KSC-1083','KAKUSIGA',null,0,2],
        ['INKAX 10000mAh','7',28,55,'PB-01A','INKAX',null,0,0],
        
        // SUPPORTS TELEPHONE (cat 8)
        ['Holder rearview','8',15,35,'KSC-525','KAKUSIGA',2,0,2],
        
        // ACCESSOIRES MONTRE (cat 9)
        ['Xiaomi Leather Quick Release Strap','9',39,50,'ID-53473','Xiaomi',null,0,0],
        ['Xiaomi Leather Quick Release Strap','9',39,50,'ID-53472','Xiaomi',null,0,0],
        
        // MONTRES CONNECTÉES (cat 10)
        ['XO Kids Watch','10',62,80,'XO-H100','XO',2,0,1],
        ['Hainoteko G9 Mini','10',100,120,'G9','HAINOTEKO',2,0,1],
        
        // TÉLÉPHONES (cat 11)
        ['Honor X5C 4/64','11',326,360,'GPS50-HX5C','Honor',1,0,0],
        ['Honor X5C plus 4/128','11',357,395,'GPS50-HX5CP','Honor',1,0,0],
        ['Honor X6C 6/128','11',421,465,'GPS50-HX6C','Honor',1,0,1],
        ['Realme C61 8/256','11',516,570,'GPS50-RC61','Realme',1,0,0],
        ['Realme Note 60X 3/64','11',282,320,'GPS50-RN60X','Realme',1,0,0],
        ['Xiaomi Redmi 13 6/128','11',470,520,'GPS50-XR13','Xiaomi',1,0,0],
        ['Xiaomi Redmi 15C 4/128','11',404,445,'GPS50-XR15C4','Xiaomi',1,0,0],
        ['Xiaomi Redmi 15C 6/128','11',441,495,'GPS50-XR15C6','Xiaomi',1,0,0],
        ['Xiaomi Redmi A5 3/64','11',272,299,'GPS50-XRA5','Xiaomi',1,0,1],
        ['Samsung A07 4/64','11',355,399,'GPS50-SA07','Samsung',1,0,0],
        ['Vivo Y04 4/64','11',314,350,'GPS50-VY04','Vivo',1,0,1],
        ['Evertek E28','11',62.5,69,'EVR-E28','Evertek',1,0,1],
        ['Geniphone A2mini','11',37.9,45,'GEN-A2M','Geniphone',1,0,0],
        ['Logicom P197E','11',37.5,45,'LOG-P197E','Logicom',1,0,1],
        ['Nokia 105 2024','11',54.4,65,'NOK-105','Nokia',1,0,0],
        ['Samsung A04 3/32','11',412,455,'SAM-A04','Samsung',1,0,0],
        ['Samsung A04 S 4/128','11',495.4,545,'SAM-A04S','Samsung',1,0,1],
        ['Samsung Galaxy A14 4/128','11',487,540,'SAM-A14','Samsung',1,0,0],
    ];
    
    $stmt = $pdo->prepare("INSERT INTO produits (nom,categorie_id,prix_achat,prix_vente,reference,marque,fournisseur_id,seuil_alerte) VALUES (?,?,?,?,?,?,?,3)");
    $stock_stmt = $pdo->prepare("INSERT INTO stock (franchise_id,produit_id,quantite) VALUES (?,?,?) ON DUPLICATE KEY UPDATE quantite=quantite+VALUES(quantite)");
    
    foreach ($products as $p) {
        $stmt->execute([$p[0], $p[1], $p[2], $p[3], $p[4], $p[5], $p[6]]);
        $pid = $pdo->lastInsertId();
        
        // Stock Mourouj (franchise 1)
        $stock_stmt->execute([1, $pid, $p[7]]);
        // Stock Soukra (franchise 2)  
        $stock_stmt->execute([2, $pid, $p[8]]);
    }
    
    return "Seeded " . count($products) . " products";
}
