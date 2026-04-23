<?php
/**
 * Add missing smartphones/portables from Excel — STANDALONE (no login needed)
 * Visit: your-site.com/add_missing_phones.php
 */
require_once __DIR__ . '/config.php';
$pdo = db();

echo "<!DOCTYPE html><html><head><meta charset='utf-8'><title>Import Phones</title>
<style>body{font-family:sans-serif;padding:20px;max-width:900px;margin:auto}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ddd;padding:8px;text-align:left;font-size:13px}th{background:#2AABE2;color:white}.added{background:#D4EDDA}.updated{background:#FFF3CD}.skip{background:#F5F5F5}h2{color:#1B3A5C}</style></head><body>";

// === PHONE PRODUCTS FROM EXCEL (exact prices) ===
$excel_phones = [
    // [nom, marque, pa_ht, pa_ttc, pv_ht, pv_ttc]
    ['Evertek E28', 'Evertek', 52.52, 62.50, 57.98, 69.00],
    ['Geniphone A2mini', 'Geniphone', 31.85, 37.90, 37.82, 45.00],
    ['Logicom P197E', 'Logicom', 31.51, 37.50, 37.82, 45.00],
    ['Nokia 105 2024', 'Nokia', 45.71, 54.40, 54.62, 65.00],
    ['Honor X5C 4/64', 'Honor', 273.95, 326.00, 302.52, 360.00],
    ['Honor X6C 6/128', 'Honor', 353.78, 421.00, 415.97, 495.00],
    ['Honor X5C Plus 4/128', 'Honor', 300.00, 357.00, 390.76, 465.00],
    ['Realme C61 8/256', 'Realme', 433.61, 516.00, 478.99, 570.00],
    ['Realme Note 60X 3/64', 'Realme', 236.97, 282.00, 268.91, 320.00],
    ['Xiaomi Redmi 13 6/128', 'Xiaomi', 394.96, 470.00, 436.97, 520.00],
    ['Xiaomi Redmi 15C 4/128', 'Xiaomi', 339.50, 404.00, 373.95, 445.00],
    ['Xiaomi Redmi 15C 6/128', 'Xiaomi', 370.59, 441.00, 415.97, 495.00],
    ['Xiaomi Redmi A5 3/64', 'Xiaomi', 228.57, 272.00, 294.12, 350.00],
    ['Samsung A04 3/32', 'Samsung', 346.22, 412.00, 382.35, 455.00],
    ['Samsung A04 S 4/128', 'Samsung', 416.30, 495.40, 457.98, 545.00],
    ['Samsung A07 4/64', 'Samsung', 298.32, 355.00, 335.29, 399.00],
    ['Samsung Galaxy A14 4/128', 'Samsung', 409.24, 487.00, 453.78, 540.00],
    ['Vivo Y04 4/64', 'Vivo', 263.87, 314.00, 319.33, 380.00],
];

// Get or create "Téléphones" category
$cat = $pdo->query("SELECT id FROM categories WHERE nom LIKE '%phone%' OR nom LIKE '%Télé%' LIMIT 1")->fetch();
if (!$cat) {
    $pdo->exec("INSERT IGNORE INTO categories (nom) VALUES ('Téléphones')");
    $cat_id = $pdo->lastInsertId() ?: $pdo->query("SELECT id FROM categories WHERE nom='Téléphones'")->fetchColumn();
} else {
    $cat_id = $cat['id'];
}
echo "<p>📁 Catégorie Téléphones: ID #$cat_id</p>";

// Get or create Actelo fournisseur
$fourn = $pdo->query("SELECT id FROM fournisseurs WHERE nom LIKE '%Actelo%' LIMIT 1")->fetch();
if (!$fourn) {
    $pdo->exec("INSERT INTO fournisseurs (nom, adresse) VALUES ('Actelo', 'Tunisie')");
    $fourn_id = $pdo->lastInsertId();
    echo "<p>🏭 Fournisseur Actelo créé: ID #$fourn_id</p>";
} else {
    $fourn_id = $fourn['id'];
    echo "<p>🏭 Fournisseur Actelo: ID #$fourn_id</p>";
}

// All franchise IDs for stock creation
$all_fids = $pdo->query("SELECT id FROM franchises WHERE actif=1")->fetchAll(PDO::FETCH_COLUMN);
echo "<p>🏪 Franchises actives: " . implode(', ', $all_fids) . "</p>";

// Get ALL existing products for comparison
$existing = $pdo->query("SELECT id, nom, LOWER(nom) as nom_l, marque, LOWER(COALESCE(marque,'')) as marque_l FROM produits")->fetchAll();
echo "<p>📦 Produits existants: " . count($existing) . "</p><hr>";

// Helper: check if a product already exists
function findExisting($nom, $marque, $existing) {
    $nom_l = mb_strtolower(trim($nom));
    $marque_l = mb_strtolower(trim($marque));
    
    foreach ($existing as $ex) {
        $ex_nom = $ex['nom_l'];
        $ex_marque = $ex['marque_l'];
        
        // Exact name match
        if ($ex_nom === $nom_l) return $ex['id'];
        
        // Name contains or is contained
        if (mb_strlen($nom_l) >= 5 && (mb_strpos($ex_nom, $nom_l) !== false || mb_strpos($nom_l, $ex_nom) !== false)) return $ex['id'];
        
        // Same brand + key model identifier
        if ($marque_l && $marque_l === $ex_marque) {
            // Extract model identifiers (e.g. "X5C", "A04", "105", "Redmi 13")
            // Check if the important parts match
            $nom_words = preg_split('/[\s\/\-]+/', $nom_l);
            $ex_words = preg_split('/[\s\/\-]+/', $ex_nom);
            
            // Find significant words (not brand, not memory specs)
            $skip = [$marque_l, '4', '3', '6', '8', '32', '64', '128', '256', 'black', 'white', 'blue', 'green', 'red', 'gold', 'cyan', 'cooper', 'silver', 'violet', 'noir', 'rouge', 'dark'];
            $nom_sig = array_filter($nom_words, fn($w) => mb_strlen($w) >= 2 && !in_array($w, $skip));
            $ex_sig = array_filter($ex_words, fn($w) => mb_strlen($w) >= 2 && !in_array($w, $skip));
            
            // If all significant words from the shorter name are in the longer name
            $match_count = 0;
            foreach ($nom_sig as $w) {
                foreach ($ex_sig as $ew) {
                    if ($w === $ew || mb_strpos($ew, $w) !== false || mb_strpos($w, $ew) !== false) {
                        $match_count++;
                        break;
                    }
                }
            }
            
            $min_needed = max(1, min(count($nom_sig), count($ex_sig)));
            if ($match_count >= $min_needed && $min_needed > 0) return $ex['id'];
        }
    }
    return null;
}

echo "<h2>🔍 Processing " . count($excel_phones) . " phone products...</h2>";
echo "<table><tr><th>#</th><th>Produit</th><th>Marque</th><th>PA TTC</th><th>PV TTC</th><th>Statut</th></tr>";

$added = 0;
$skipped = 0;
$updated = 0;

foreach ($excel_phones as $i => $phone) {
    [$nom, $marque, $pa_ht, $pa_ttc, $pv_ht, $pv_ttc] = $phone;
    $n = $i + 1;
    
    $existing_id = findExisting($nom, $marque, $existing);
    
    if ($existing_id) {
        // Check if prices need updating
        $cur = $pdo->prepare("SELECT prix_achat_ttc, prix_vente_ttc FROM produits WHERE id=?");
        $cur->execute([$existing_id]);
        $c = $cur->fetch();
        
        if ($c && (abs(($c['prix_achat_ttc'] ?? 0) - $pa_ttc) > 1 || abs(($c['prix_vente_ttc'] ?? 0) - $pv_ttc) > 1)) {
            $upd = $pdo->prepare("UPDATE produits SET prix_achat=?, prix_vente=?, prix_achat_ht=?, prix_achat_ttc=?, prix_vente_ht=?, prix_vente_ttc=?, fournisseur_id=? WHERE id=?");
            $upd->execute([$pa_ttc, $pv_ttc, $pa_ht, $pa_ttc, $pv_ht, $pv_ttc, $fourn_id, $existing_id]);
            $updated++;
            echo "<tr class='updated'><td>$n</td><td>$nom</td><td>$marque</td><td>$pa_ttc</td><td>$pv_ttc</td><td>📝 Prix MAJ (#$existing_id)</td></tr>";
        } else {
            $skipped++;
            echo "<tr class='skip'><td>$n</td><td>$nom</td><td>$marque</td><td>$pa_ttc</td><td>$pv_ttc</td><td>⏭️ Existe (#$existing_id)</td></tr>";
        }
        continue;
    }
    
    // CREATE NEW
    $ins = $pdo->prepare("INSERT INTO produits (nom, categorie_id, prix_achat, prix_vente, prix_achat_ht, prix_achat_ttc, prix_vente_ht, prix_vente_ttc, tva_rate, marque, fournisseur_id, seuil_alerte) VALUES (?,?,?,?,?,?,?,?,19,?,?,1)");
    $ins->execute([$nom, $cat_id, $pa_ttc, $pv_ttc, $pa_ht, $pa_ttc, $pv_ht, $pv_ttc, $marque, $fourn_id]);
    $new_id = $pdo->lastInsertId();
    
    // Create stock=0 for all franchises
    foreach ($all_fids as $fid) {
        $pdo->prepare("INSERT IGNORE INTO stock (franchise_id, produit_id, quantite) VALUES (?,?,0)")->execute([$fid, $new_id]);
    }
    
    // Add to existing list so we don't create duplicates within this run
    $existing[] = ['id' => $new_id, 'nom' => $nom, 'nom_l' => mb_strtolower($nom), 'marque' => $marque, 'marque_l' => mb_strtolower($marque)];
    
    $added++;
    echo "<tr class='added'><td>$n</td><td><b>$nom</b></td><td>$marque</td><td>$pa_ttc</td><td>$pv_ttc</td><td>✅ CRÉÉ (#$new_id)</td></tr>";
}

echo "</table>";
echo "<br><h3>📊 Résultat:</h3>";
echo "<ul><li><b>$added</b> créé(s)</li><li><b>$updated</b> prix mis à jour</li><li><b>$skipped</b> inchangé(s)</li></ul>";

if ($added > 0) {
    echo "<p style='color:green;font-size:16px;font-weight:bold'>✅ $added produit(s) créé(s) avec stock = 0</p>";
    echo "<p>👉 Allez dans <b>Entrée stock</b> ou <b>Bons de réception</b> pour ajouter les quantités pour Soukra.</p>";
}

echo "<br><p><a href='index.php?page=produits' style='color:#2AABE2;font-weight:bold'>← Retour aux Produits</a></p>";
echo "</body></html>";
