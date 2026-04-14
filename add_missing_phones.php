<?php
/**
 * Add missing smartphones/portables from Excel data
 * Only adds products that don't already exist (checks by description/name similarity)
 * Creates products with exact HT/TTC prices, assigns to Soukra franchise stock
 * 
 * RUN ONCE: php add_missing_phones.php (or visit via browser)
 */
require_once 'config.php';
require_once 'helpers.php';

// Start session if not started (needed for helpers)
if (session_status() === PHP_SESSION_NONE) session_start();

$pdo = db();

// === PHONE PRODUCTS FROM EXCEL (exact prices) ===
$excel_phones = [
    // [description, marque, pa_ht, pa_ttc, pv_ht, pv_ttc, fournisseur]
    ['Evertek E28', 'Evertek', 52.52, 62.50, 57.98, 69.00, 'Actelo'],
    ['Geniphone A2mini', 'Geniphone', 31.85, 37.90, 37.82, 45.00, 'Actelo'],
    ['Logicom P197E', 'Logicom', 31.51, 37.50, 37.82, 45.00, 'Actelo'],
    ['Nokia 105 2024', 'Nokia', 45.71, 54.40, 54.62, 65.00, 'Actelo'],
    ['Honor X5C 4/64', 'Honor', 273.95, 326.00, 302.52, 360.00, 'Actelo'],
    ['Honor X6C 6/128', 'Honor', 353.78, 421.00, 415.97, 495.00, 'Actelo'],
    ['Honor X5C Plus 4/128', 'Honor', 300.00, 357.00, 390.76, 465.00, 'Actelo'],
    ['Realme C61 8/256', 'Realme', 433.61, 516.00, 478.99, 570.00, 'Actelo'],
    ['Realme Note 60X 3/64', 'Realme', 236.97, 282.00, 268.91, 320.00, 'Actelo'],
    ['Xiaomi Redmi 13 6/128', 'Xiaomi', 394.96, 470.00, 436.97, 520.00, 'Actelo'],
    ['Xiaomi Redmi 15C 4/128', 'Xiaomi', 339.50, 404.00, 373.95, 445.00, 'Actelo'],
    ['Xiaomi Redmi 15C 6/128', 'Xiaomi', 370.59, 441.00, 415.97, 495.00, 'Actelo'],
    ['Xiaomi Redmi A5 3/64', 'Xiaomi', 228.57, 272.00, 294.12, 350.00, 'Actelo'],
    ['Samsung A04 3/32', 'Samsung', 346.22, 412.00, 382.35, 455.00, 'Actelo'],
    ['Samsung A04 S 4/128', 'Samsung', 416.30, 495.40, 457.98, 545.00, 'Actelo'],
    ['Samsung A07 4/64', 'Samsung', 298.32, 355.00, 335.29, 399.00, 'Actelo'],
    ['Samsung Galaxy A14 4/128', 'Samsung', 409.24, 487.00, 453.78, 540.00, 'Actelo'],
    ['Vivo Y04 4/64', 'Vivo', 263.87, 314.00, 319.33, 380.00, 'Actelo'],
];

// Get Téléphones category ID
$cat = $pdo->query("SELECT id FROM categories WHERE nom LIKE '%phone%' OR nom LIKE '%Télé%' LIMIT 1")->fetch();
if (!$cat) {
    // Create it
    $pdo->exec("INSERT IGNORE INTO categories (nom, description) VALUES ('Téléphones', 'Smartphones et téléphones portables')");
    $cat_id = $pdo->lastInsertId() ?: $pdo->query("SELECT id FROM categories WHERE nom='Téléphones'")->fetchColumn();
} else {
    $cat_id = $cat['id'];
}

// Get Actelo fournisseur ID
$fourn = $pdo->query("SELECT id FROM fournisseurs WHERE nom LIKE '%Actelo%' LIMIT 1")->fetch();
$fourn_id = $fourn ? $fourn['id'] : null;
if (!$fourn_id) {
    $pdo->exec("INSERT INTO fournisseurs (nom, telephone, adresse) VALUES ('Actelo', '', 'Tunisie')");
    $fourn_id = $pdo->lastInsertId();
}

// Get Soukra franchise ID
$soukra = $pdo->query("SELECT id FROM franchises WHERE nom LIKE '%Soukra%' LIMIT 1")->fetch();
$soukra_id = $soukra ? $soukra['id'] : null;

// Get all active franchise IDs for stock rows
$all_franchises = $pdo->query("SELECT id FROM franchises WHERE actif=1")->fetchAll(PDO::FETCH_COLUMN);

// Get existing product names for duplicate check
$existing = $pdo->query("SELECT id, LOWER(nom) as nom_lower, LOWER(reference) as ref_lower, marque FROM produits WHERE actif=1")->fetchAll();

$added = 0;
$skipped = 0;
$updated_prices = 0;

echo "<h2>🔍 Checking " . count($excel_phones) . " phone products from Excel...</h2>\n";
echo "<table border='1' cellpadding='5' style='border-collapse:collapse; font-family:sans-serif; font-size:13px'>\n";
echo "<tr style='background:#2AABE2;color:white'><th>Produit</th><th>Marque</th><th>PA TTC</th><th>PV TTC</th><th>Statut</th></tr>\n";

foreach ($excel_phones as $phone) {
    [$nom, $marque, $pa_ht, $pa_ttc, $pv_ht, $pv_ttc, $fournisseur_nom] = $phone;
    
    // Check for duplicates by name similarity
    $found = false;
    $found_id = null;
    $nom_lower = strtolower($nom);
    
    foreach ($existing as $ex) {
        $ex_nom = $ex['nom_lower'];
        // Check various matching strategies
        $match = false;
        
        // Direct substring match
        if (strpos($ex_nom, $nom_lower) !== false || strpos($nom_lower, $ex_nom) !== false) {
            $match = true;
        }
        
        // Match by key parts (brand + model)
        $nom_parts = explode(' ', $nom_lower);
        $brand_match = strtolower($marque) === strtolower($ex['marque'] ?? '');
        if ($brand_match) {
            // Check if model numbers match
            foreach ($nom_parts as $part) {
                if (strlen($part) >= 3 && strpos($ex_nom, $part) !== false && !in_array($part, ['4/64','3/64','6/128','4/128','8/256','3/32'])) {
                    $match = true;
                    break;
                }
            }
        }
        
        if ($match) {
            $found = true;
            $found_id = $ex['id'];
            break;
        }
    }
    
    if ($found) {
        // Update prices if they differ
        $current = $pdo->prepare("SELECT prix_achat, prix_vente, prix_achat_ht, prix_achat_ttc, prix_vente_ht, prix_vente_ttc FROM produits WHERE id=?");
        $current->execute([$found_id]);
        $cur = $current->fetch();
        
        if ($cur && (abs($cur['prix_achat_ttc'] - $pa_ttc) > 0.5 || abs($cur['prix_vente_ttc'] - $pv_ttc) > 0.5)) {
            // Update with new exact prices
            $stmt = $pdo->prepare("UPDATE produits SET prix_achat=?, prix_vente=?, prix_achat_ht=?, prix_achat_ttc=?, prix_vente_ht=?, prix_vente_ttc=?, fournisseur_id=? WHERE id=?");
            $stmt->execute([$pa_ttc, $pv_ttc, $pa_ht, $pa_ttc, $pv_ht, $pv_ttc, $fourn_id, $found_id]);
            $updated_prices++;
            echo "<tr style='background:#FFF3CD'><td>$nom</td><td>$marque</td><td>$pa_ttc</td><td>$pv_ttc</td><td>📝 PRIX MIS À JOUR (ID #$found_id)</td></tr>\n";
        } else {
            $skipped++;
            echo "<tr style='background:#F0F0F0'><td>$nom</td><td>$marque</td><td>$pa_ttc</td><td>$pv_ttc</td><td>✅ Existe déjà (ID #$found_id)</td></tr>\n";
        }
        continue;
    }
    
    // === CREATE NEW PRODUCT ===
    $tva = 19;
    $stmt = $pdo->prepare("INSERT INTO produits (nom, categorie_id, prix_achat, prix_vente, prix_achat_ht, prix_achat_ttc, prix_vente_ht, prix_vente_ttc, tva_rate, marque, fournisseur_id, seuil_alerte, description) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)");
    $stmt->execute([
        $nom,           // nom
        $cat_id,        // categorie_id (Téléphones)
        $pa_ttc,        // prix_achat (legacy, = TTC)
        $pv_ttc,        // prix_vente (legacy, = TTC)
        $pa_ht,         // prix_achat_ht
        $pa_ttc,        // prix_achat_ttc
        $pv_ht,         // prix_vente_ht
        $pv_ttc,        // prix_vente_ttc
        $tva,           // tva_rate
        $marque,        // marque
        $fourn_id,      // fournisseur_id
        1,              // seuil_alerte (phones = 1)
        "Fournisseur: $fournisseur_nom",
    ]);
    $new_pid = $pdo->lastInsertId();
    
    // Create stock rows for ALL franchises (qty 0)
    foreach ($all_franchises as $fid) {
        $pdo->prepare("INSERT IGNORE INTO stock (franchise_id, produit_id, quantite) VALUES (?,?,0)")->execute([$fid, $new_pid]);
    }
    
    $added++;
    echo "<tr style='background:#D4EDDA'><td><b>$nom</b></td><td>$marque</td><td>$pa_ttc</td><td>$pv_ttc</td><td>✅ CRÉÉ (ID #$new_pid)</td></tr>\n";
}

echo "</table>\n";
echo "<br><h3>📊 Résultat:</h3>\n";
echo "<ul>\n";
echo "<li><b>$added</b> produit(s) créé(s)</li>\n";
echo "<li><b>$updated_prices</b> prix mis à jour</li>\n";
echo "<li><b>$skipped</b> déjà existant(s) (inchangés)</li>\n";
echo "</ul>\n";

if ($added > 0) {
    echo "<p style='color:green;font-weight:bold'>✅ Les produits ont été créés avec stock = 0 sur toutes les franchises.</p>\n";
    echo "<p>👉 Allez dans <b>Bons de réception</b> pour ajouter les quantités avec un bon de réception pour la franchise Soukra.</p>\n";
}
