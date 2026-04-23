<?php
require_once __DIR__ . '/config.php';
$pdo = db();

// Get or create Infogenie fournisseur
$fourn = $pdo->query("SELECT id FROM fournisseurs WHERE nom LIKE '%Infogenie%' OR nom LIKE '%infogenie%' LIMIT 1")->fetch();
if (!$fourn) {
    $pdo->exec("INSERT INTO fournisseurs (nom, telephone, adresse) VALUES ('Infogenie', '+216 53 193 192', 'Galerie Soula Parc Lafayette, Tunis')");
    $fourn_id = $pdo->lastInsertId();
    echo "Created fournisseur Infogenie: ID #$fourn_id\n";
} else {
    $fourn_id = $fourn['id'];
    echo "Fournisseur Infogenie exists: ID #$fourn_id\n";
}

// Get Téléphones category
$cat = $pdo->query("SELECT id FROM categories WHERE nom LIKE '%phone%' OR nom LIKE '%Télé%' LIMIT 1")->fetch();
$cat_id = $cat ? $cat['id'] : 1;

// Get all franchise IDs for stock rows
$all_fids = $pdo->query("SELECT id FROM franchises WHERE actif=1")->fetchAll(PDO::FETCH_COLUMN);

// Products from both invoices
$products = [
    // FAC-2026-00019
    ['Tecno Lion AL', 'Tecno', 36.975, 19],
    ['Lava Power 1L', 'Lava', 47.899, 19],
    ['Lava A1 Vibe', 'Lava', 27.731, 19],
    ['iPro A1', 'iPro', 27.731, 19],
    ['Redmi 15C 6/128', 'Xiaomi', 361.345, 19],
    ['Honor Play 10 3/64', 'Honor', 235.294, 19],
    ['Vivo Y04 4/128', 'Vivo', 289.916, 19],
    ['Nokia A6', 'Nokia', 40.00, 19], // price unclear from OCR
    ['Centre Fone A1 Plus', 'Centre Fone', 27.731, 19],
    // FAC-2026-00020
    ['Tablette Infinix 8/256', 'Infinix', 397.196, 7],
    ['Vivo Y21D 8/256', 'Vivo', 420.168, 19],
    ['Alcatel A31 Pro NC', 'Alcatel', 222.689, 19],
    ['Itel A50', 'Itel', 201.681, 19],
    ['Itel A50C 64G', 'Itel', 201.681, 19],
];

$added = 0;
$skipped = 0;

foreach ($products as $p) {
    [$nom, $marque, $pa_ht, $tva] = $p;
    $pa_ttc = round($pa_ht * (1 + $tva/100), 2);
    // Sell price = ~15-20% margin
    $pv_ht = round($pa_ht * 1.15, 2);
    $pv_ttc = round($pv_ht * (1 + $tva/100), 2);
    
    // Check if exists
    $existing = $pdo->prepare("SELECT id FROM produits WHERE LOWER(nom) LIKE ?");
    $existing->execute(['%' . strtolower($nom) . '%']);
    $ex = $existing->fetch();
    
    if ($ex) {
        echo "⏭️  EXISTS: $nom (ID #{$ex['id']})\n";
        $skipped++;
        continue;
    }
    
    $stmt = $pdo->prepare("INSERT INTO produits (nom, categorie_id, prix_achat, prix_vente, prix_achat_ht, prix_achat_ttc, prix_vente_ht, prix_vente_ttc, tva_rate, marque, fournisseur_id, seuil_alerte) VALUES (?,?,?,?,?,?,?,?,?,?,?,1)");
    $stmt->execute([$nom, $cat_id, $pa_ttc, $pv_ttc, $pa_ht, $pa_ttc, $pv_ht, $pv_ttc, $tva, $marque, $fourn_id]);
    $new_id = $pdo->lastInsertId();
    
    // Create stock=0 for all franchises
    foreach ($all_fids as $fid) {
        $pdo->prepare("INSERT IGNORE INTO stock (franchise_id, produit_id, quantite) VALUES (?,?,0)")->execute([$fid, $new_id]);
    }
    
    echo "✅ CREATED: $nom | PA HT: $pa_ht | PA TTC: $pa_ttc | PV TTC: $pv_ttc | TVA: $tva% (ID #$new_id)\n";
    $added++;
}

echo "\n📊 Results: $added created, $skipped already existed\n";
