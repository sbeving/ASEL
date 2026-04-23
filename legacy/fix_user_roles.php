<?php
require_once __DIR__ . '/config.php';
$pdo = db();
header('Content-Type: text/plain');

// Fix vsoukra → vendeur
$pdo->exec("UPDATE utilisateurs SET role='vendeur' WHERE nom_utilisateur='vsoukra' AND (role IS NULL OR role='')");
echo "Fixed vsoukra → vendeur\n";

// Fix superadmin → superadmin
$pdo->exec("UPDATE utilisateurs SET role='superadmin' WHERE nom_utilisateur='superadmin' AND (role IS NULL OR role='')");
echo "Fixed superadmin → superadmin\n";

// Verify
$users = $pdo->query("SELECT id, nom_utilisateur, role FROM utilisateurs ORDER BY id")->fetchAll(PDO::FETCH_ASSOC);
foreach ($users as $u) echo "{$u['nom_utilisateur']}: {$u['role']}\n";
