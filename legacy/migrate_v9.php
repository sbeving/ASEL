<?php
/**
 * ASEL Mobile — Migration v9
 * Pointage employés (time tracking with geolocation)
 */
require_once 'config.php';
$pdo = db();

$queries = [
    // Pointages table
    "CREATE TABLE IF NOT EXISTS pointages (
        id INT AUTO_INCREMENT PRIMARY KEY,
        utilisateur_id INT NOT NULL,
        franchise_id INT,
        type_pointage ENUM('entree','sortie','pause_debut','pause_fin') NOT NULL DEFAULT 'entree',
        heure DATETIME DEFAULT CURRENT_TIMESTAMP,
        latitude DECIMAL(10,7),
        longitude DECIMAL(10,7),
        adresse VARCHAR(300),
        distance_franchise INT DEFAULT NULL COMMENT 'Distance in meters from franchise',
        valide TINYINT DEFAULT 1,
        note VARCHAR(255),
        device_info VARCHAR(100),
        FOREIGN KEY (utilisateur_id) REFERENCES utilisateurs(id),
        INDEX idx_user_date (utilisateur_id, heure),
        INDEX idx_franchise_date (franchise_id, heure)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

    // Horaires de travail (work schedule)
    "CREATE TABLE IF NOT EXISTS horaires (
        id INT AUTO_INCREMENT PRIMARY KEY,
        utilisateur_id INT NOT NULL,
        franchise_id INT,
        heure_debut TIME DEFAULT '08:00:00',
        heure_fin TIME DEFAULT '17:00:00',
        jours_travail VARCHAR(20) DEFAULT '1,2,3,4,5',
        actif TINYINT DEFAULT 1,
        FOREIGN KEY (utilisateur_id) REFERENCES utilisateurs(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
];

$success = 0; $errors = [];
foreach ($queries as $q) {
    try {
        $pdo->exec($q);
        $success++;
    } catch (Exception $e) {
        if (strpos($e->getMessage(), 'already exists') !== false) { $success++; continue; }
        $errors[] = $e->getMessage();
    }
}

echo "<h2>Migration v9 Complete</h2>";
echo "<p>✅ $success queries OK</p>";
if ($errors) { echo "<ul>"; foreach ($errors as $e) echo "<li style='color:red'>$e</li>"; echo "</ul>"; }
echo "<p><a href='index.php'>← Retour</a></p>";
