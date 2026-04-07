<?php
/**
 * ASEL Mobile — Database Migration v7
 * Adds: Points network (activation, recharge, franchise) + franchise status/notes
 */
require_once 'config.php';
$pdo = db();

echo "<h2>ASEL Mobile — Migration v7 (Points Network)</h2><pre>";

// 1. Create points_reseau table (all types of points on the map)
$pdo->exec("
CREATE TABLE IF NOT EXISTS points_reseau (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nom VARCHAR(200) NOT NULL,
    type_point ENUM('franchise','activation','recharge','activation_recharge') NOT NULL DEFAULT 'activation_recharge',
    statut ENUM('prospect','contact','contrat_non_signe','contrat_signe','actif','suspendu','resilie') DEFAULT 'prospect',
    adresse VARCHAR(255),
    ville VARCHAR(100),
    gouvernorat VARCHAR(100),
    telephone VARCHAR(50),
    telephone2 VARCHAR(50),
    email VARCHAR(150),
    responsable VARCHAR(150),
    horaires VARCHAR(255) DEFAULT 'Lun-Sam: 09:00-19:00',
    latitude DECIMAL(10,8),
    longitude DECIMAL(11,8),
    notes_internes TEXT,
    franchise_id INT NULL COMMENT 'Linked franchise if type=franchise',
    date_contact DATE,
    date_contrat DATE,
    date_activation DATE,
    commission_pct DECIMAL(5,2) DEFAULT 0,
    actif TINYINT DEFAULT 1,
    cree_par INT,
    date_creation DATETIME DEFAULT CURRENT_TIMESTAMP,
    date_modification DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_type (type_point),
    INDEX idx_statut (statut),
    INDEX idx_ville (ville),
    INDEX idx_actif (actif)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
");
echo "✅ Created points_reseau table\n";

// 2. Add notes_internes and statut_commercial to franchises
try { $pdo->exec("ALTER TABLE franchises ADD COLUMN notes_internes TEXT AFTER responsable"); echo "✅ Added notes_internes to franchises\n"; } catch(Exception $e) { echo "⏭️ notes_internes already exists\n"; }
try { $pdo->exec("ALTER TABLE franchises ADD COLUMN statut_commercial ENUM('prospect','contact','contrat_non_signe','contrat_signe','actif','suspendu','resilie') DEFAULT 'actif' AFTER notes_internes"); echo "✅ Added statut_commercial to franchises\n"; } catch(Exception $e) { echo "⏭️ statut_commercial already exists\n"; }
try { $pdo->exec("ALTER TABLE franchises ADD COLUMN horaires VARCHAR(255) DEFAULT 'Lun-Sam: 09:00-19:00' AFTER responsable"); echo "✅ Added horaires to franchises\n"; } catch(Exception $e) { echo "⏭️ horaires already exists\n"; }

// 3. Auto-import existing franchises into points_reseau (if not already there)
$existing = $pdo->query("SELECT * FROM franchises WHERE actif=1 AND latitude IS NOT NULL")->fetchAll(PDO::FETCH_ASSOC);
foreach ($existing as $f) {
    $check = $pdo->prepare("SELECT id FROM points_reseau WHERE franchise_id=?");
    $check->execute([$f['id']]);
    if (!$check->fetch()) {
        try {
            $type = ($f['type_franchise'] ?? '') === 'central' ? 'franchise' : 'franchise';
            $stmt = $pdo->prepare("INSERT INTO points_reseau (nom,type_point,statut,adresse,telephone,responsable,latitude,longitude,franchise_id,actif) VALUES (?,?,?,?,?,?,?,?,?,?)");
            $stmt->execute([$f['nom'], 'franchise', 'actif', $f['adresse'], $f['telephone'], $f['responsable'], $f['latitude'], $f['longitude'], $f['id'], $f['actif']]);
            echo "✅ Imported franchise: {$f['nom']}\n";
        } catch (Exception $e) {
            echo "⚠️ Could not import {$f['nom']}: {$e->getMessage()}\n";
        }
    }
}

// 4. Run v6 migrations if not done yet
try { $pdo->exec("ALTER TABLE franchises ADD COLUMN type_franchise ENUM('central','point_de_vente') DEFAULT 'point_de_vente' AFTER nom"); echo "✅ Added type_franchise\n"; } catch(Exception $e) { echo "⏭️ type_franchise already exists\n"; }
$central = $pdo->query("SELECT id FROM franchises WHERE nom='Stock Central'")->fetch();
if (!$central) {
    $pdo->exec("INSERT INTO franchises (nom, adresse, telephone, responsable, actif, type_franchise) VALUES ('Stock Central', 'Entrepôt principal', '', 'Administrateur', 1, 'central')");
    echo "✅ Created Stock Central\n";
} else {
    $pdo->exec("UPDATE franchises SET type_franchise='central' WHERE nom='Stock Central'");
    echo "⏭️ Stock Central exists\n";
}

// 5. Initialize stock for Stock Central
$central_id = $pdo->query("SELECT id FROM franchises WHERE nom='Stock Central'")->fetchColumn();
if ($central_id) {
    $pdo->exec("INSERT IGNORE INTO stock (franchise_id, produit_id, quantite) SELECT $central_id, id, 0 FROM produits WHERE actif=1");
    echo "✅ Stock Central stock rows initialized\n";
}

// 6. Add type_transfert if missing
try { $pdo->exec("ALTER TABLE transferts ADD COLUMN type_transfert ENUM('transfert','dispatch') DEFAULT 'transfert' AFTER quantite"); echo "✅ Added type_transfert\n"; } catch(Exception $e) { echo "⏭️ type_transfert exists\n"; }

// 7. Update overdue echeances
$updated = $pdo->exec("UPDATE echeances SET statut='en_retard' WHERE statut='en_attente' AND date_echeance < CURDATE()");
echo "✅ Updated $updated overdue echeances\n";

echo "\n🎉 Migration v7 complete!\n";
echo "</pre>";
echo "<p><a href='index.php'>← Retour</a></p>";
