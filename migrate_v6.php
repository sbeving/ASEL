<?php
/**
 * ASEL Mobile — Database Migration v6
 * Adds: Stock Central franchise, enhanced audit, dispatch tracking
 */
require_once 'config.php';
$pdo = db();

echo "<h2>ASEL Mobile — Migration v6 (Stock Central + Enhanced Audit)</h2><pre>";

// 1. Create Stock Central franchise if not exists
$central = $pdo->query("SELECT id FROM franchises WHERE nom='Stock Central'")->fetch();
if (!$central) {
    $pdo->exec("INSERT INTO franchises (nom, adresse, telephone, responsable, actif) VALUES ('Stock Central', 'Entrepôt principal', '', 'Administrateur', 1)");
    echo "✅ Created 'Stock Central' franchise\n";
} else {
    echo "⏭️ Stock Central already exists (id={$central['id']})\n";
}

// 2. Add franchise type column (central vs point_de_vente)
try {
    $pdo->exec("ALTER TABLE franchises ADD COLUMN type_franchise ENUM('central','point_de_vente') DEFAULT 'point_de_vente' AFTER nom");
    echo "✅ Added type_franchise column\n";
} catch(Exception $e) {
    echo "⏭️ type_franchise already exists\n";
}
$pdo->exec("UPDATE franchises SET type_franchise='central' WHERE nom='Stock Central'");
echo "✅ Marked Stock Central as type=central\n";

// 3. Create stock rows for Stock Central for all products
$central_id = $pdo->query("SELECT id FROM franchises WHERE nom='Stock Central'")->fetchColumn();
if ($central_id) {
    $pdo->exec("INSERT IGNORE INTO stock (franchise_id, produit_id, quantite) SELECT $central_id, id, 0 FROM produits WHERE actif=1");
    echo "✅ Initialized stock rows for Stock Central\n";
}

// 4. Add dispatch tracking columns to transferts
try { $pdo->exec("ALTER TABLE transferts ADD COLUMN type_transfert ENUM('transfert','dispatch') DEFAULT 'transfert' AFTER quantite"); echo "✅ Added type_transfert to transferts\n"; } catch(Exception $e) { echo "⏭️ type_transfert already exists\n"; }

// 5. Add horaires to franchises for public map
try { $pdo->exec("ALTER TABLE franchises ADD COLUMN horaires VARCHAR(255) DEFAULT 'Lun-Sam: 09:00-19:00' AFTER responsable"); echo "✅ Added horaires to franchises\n"; } catch(Exception $e) { echo "⏭️ horaires already exists\n"; }
try { $pdo->exec("ALTER TABLE franchises ADD COLUMN services_offerts TEXT AFTER horaires"); echo "✅ Added services_offerts to franchises\n"; } catch(Exception $e) { echo "⏭️ services_offerts already exists\n"; }

// 6. Update overdue echeances
$updated = $pdo->exec("UPDATE echeances SET statut='en_retard' WHERE statut='en_attente' AND date_echeance < CURDATE()");
echo "✅ Updated $updated overdue echeances\n";

echo "\n🎉 Migration v6 complete!\n";
echo "Stock Central ID: $central_id\n";
echo "</pre>";
echo "<p><a href='index.php'>← Retour</a></p>";
