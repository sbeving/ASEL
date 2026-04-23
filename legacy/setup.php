<?php
// ASEL Mobile — Setup Script (run once)
require_once 'config.php';

echo "<h1>🏪 ASEL Mobile — Installation</h1>";

try {
    echo "<p>Initialisation de la base de données...</p>";
    init_db();
    echo "<p>✅ Tables créées (y compris demandes_produits)</p>";
    
    echo "<p>Import des données réelles...</p>";
    $result = seed_real_data();
    echo "<p>✅ $result</p>";
    
    // Create gestionnaire account if not exists
    $pdo = db();
    $existing = $pdo->query("SELECT COUNT(*) FROM utilisateurs WHERE nom_utilisateur='stock'")->fetchColumn();
    if ($existing == 0) {
        $pw = password_hash('stock2024', PASSWORD_DEFAULT);
        $pdo->prepare("INSERT INTO utilisateurs (nom_utilisateur,mot_de_passe,nom_complet,role) VALUES (?,?,?,?)")
            ->execute(['stock', $pw, 'Gestionnaire Stock Central', 'gestionnaire']);
        echo "<p>✅ Compte gestionnaire créé</p>";
    }
    
    echo "<hr>";
    echo "<h2>✅ Installation terminée!</h2>";
    echo "<p><strong>Comptes:</strong></p>";
    echo "<ul>";
    echo "<li>🔴 Admin: <code>admin</code> / <code>admin2024</code></li>";
    echo "<li>🟢 Mourouj: <code>mourouj</code> / <code>mourouj2024</code></li>";
    echo "<li>🟢 Soukra: <code>soukra</code> / <code>soukra2024</code></li>";
    echo "<li>🟡 Stock Central: <code>stock</code> / <code>stock2024</code></li>";
    echo "</ul>";
    echo "<p><a href='index.php'>→ Aller à l'application</a></p>";
    
} catch (Exception $e) {
    echo "<p>❌ Erreur: " . $e->getMessage() . "</p>";
}
