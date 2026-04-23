<?php
require_once __DIR__ . '/config.php';
$pdo = db();
header('Content-Type: text/plain');

$users = $pdo->query("SELECT id, nom_utilisateur, nom_complet, role, franchise_id, actif, custom_permissions FROM utilisateurs ORDER BY id")->fetchAll(PDO::FETCH_ASSOC);
foreach ($users as $u) {
    echo "ID:{$u['id']} login:{$u['nom_utilisateur']} role:[{$u['role']}] fid:{$u['franchise_id']} actif:{$u['actif']} custom:{$u['custom_permissions']}\n";
}
