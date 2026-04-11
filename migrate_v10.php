<?php
require_once 'config.php';
$pdo = db();
$queries = [
    "ALTER TABLE clients ADD COLUMN IF NOT EXISTS notes TEXT DEFAULT NULL",
    "ALTER TABLE clients ADD COLUMN IF NOT EXISTS date_naissance DATE DEFAULT NULL",
    "ALTER TABLE produits ADD COLUMN IF NOT EXISTS notes_internes TEXT DEFAULT NULL",
    "ALTER TABLE produits ADD COLUMN IF NOT EXISTS image_url VARCHAR(300) DEFAULT NULL",
];
$success = 0; $errors = [];
foreach($queries as $q) {
    try { $pdo->exec($q); $success++; }
    catch(Exception $e) { if(strpos($e->getMessage(),'Duplicate')===false) $errors[]=$e->getMessage(); else $success++; }
}
echo "<h2>Migration v10</h2><p>✅ $success OK</p>";
if($errors) { echo "<ul>"; foreach($errors as $e) echo "<li style='color:red'>$e</li>"; echo "</ul>"; }
echo "<p><a href='index.php'>← Retour</a></p>";
