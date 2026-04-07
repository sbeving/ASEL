<?php
/**
 * ASEL Mobile — AJAX API
 * Handles all async operations: search, export, charts, quick actions
 */
require_once 'helpers.php';
requireLogin();
header('Content-Type: application/json');
header('X-Content-Type-Options: nosniff');

$action = $_GET['action'] ?? $_POST['action'] ?? '';
$user = currentUser();
$fid = scopedFranchiseId();

switch ($action) {

// === PRODUCT SEARCH (real-time) ===
case 'search_products':
    $q = '%' . ($_GET['q'] ?? '') . '%';
    $franchise_id = $_GET['fid'] ?? $fid;
    if (!$franchise_id) { echo json_encode([]); exit; }
    $results = query("SELECT s.quantite, p.id, p.nom, p.prix_vente, p.reference, p.code_barre, p.marque, c.nom as categorie
        FROM stock s JOIN produits p ON s.produit_id=p.id JOIN categories c ON p.categorie_id=c.id
        WHERE s.franchise_id=? AND p.actif=1 AND s.quantite>0 AND (p.nom LIKE ? OR p.reference LIKE ? OR p.code_barre LIKE ? OR p.marque LIKE ?)
        ORDER BY p.nom LIMIT 20", [$franchise_id, $q, $q, $q, $q]);
    echo json_encode($results);
    break;

// === CLIENT SEARCH ===
case 'search_clients':
    $q = '%' . ($_GET['q'] ?? '') . '%';
    $results = query("SELECT id, nom, prenom, telephone, type_client, entreprise FROM clients WHERE actif=1 AND (nom LIKE ? OR prenom LIKE ? OR telephone LIKE ? OR entreprise LIKE ?) ORDER BY nom LIMIT 15", [$q, $q, $q, $q]);
    echo json_encode($results);
    break;

// === BARCODE LOOKUP ===
case 'barcode_lookup':
    $code = $_GET['code'] ?? '';
    $franchise_id = $_GET['fid'] ?? $fid;
    $result = queryOne("SELECT s.quantite, p.id, p.nom, p.prix_vente, p.reference, p.code_barre, p.marque
        FROM stock s JOIN produits p ON s.produit_id=p.id
        WHERE s.franchise_id=? AND p.code_barre=? AND p.actif=1", [$franchise_id, $code]);
    echo json_encode($result ?: ['error' => 'not_found']);
    break;

// === DASHBOARD CHART DATA ===
case 'chart_sales':
    $days = intval($_GET['days'] ?? 30);
    $wf = $fid ? "AND franchise_id=".intval($fid) : "";
    $data = query("SELECT date_vente as date, SUM(prix_total) as total, SUM(quantite) as articles, COUNT(*) as transactions
        FROM ventes WHERE date_vente >= DATE_SUB(CURDATE(), INTERVAL ? DAY) $wf
        GROUP BY date_vente ORDER BY date_vente", [$days]);
    echo json_encode($data);
    break;

case 'chart_categories':
    $wf = $fid ? "AND v.franchise_id=".intval($fid) : "";
    $data = query("SELECT c.nom as categorie, SUM(v.prix_total) as total
        FROM ventes v JOIN produits p ON v.produit_id=p.id JOIN categories c ON p.categorie_id=c.id
        WHERE v.date_vente >= DATE_SUB(CURDATE(), INTERVAL 30 DAY) $wf
        GROUP BY c.nom ORDER BY total DESC", []);
    echo json_encode($data);
    break;

case 'chart_franchises':
    $data = query("SELECT f.nom as franchise, SUM(v.prix_total) as total
        FROM ventes v JOIN franchises f ON v.franchise_id=f.id
        WHERE v.date_vente >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
        GROUP BY f.id ORDER BY total DESC", []);
    foreach ($data as &$d) $d['franchise'] = str_replace('ASEL Mobile — ', '', $d['franchise']);
    echo json_encode($data);
    break;

case 'chart_top_products':
    $wf = $fid ? "AND v.franchise_id=".intval($fid) : "";
    $data = query("SELECT p.nom as produit, SUM(v.quantite) as quantite, SUM(v.prix_total) as ca
        FROM ventes v JOIN produits p ON v.produit_id=p.id
        WHERE v.date_vente >= DATE_SUB(CURDATE(), INTERVAL 30 DAY) $wf
        GROUP BY p.id ORDER BY ca DESC LIMIT 10", []);
    echo json_encode($data);
    break;

// === EXPORT CSV ===
case 'export_stock':
    header('Content-Type: text/csv; charset=utf-8');
    header('Content-Disposition: attachment; filename=stock_asel_'.date('Ymd').'.csv');
    $out = fopen('php://output', 'w');
    fputcsv($out, ['Franchise','Catégorie','Produit','Marque','Référence','Code-barres','Quantité','Prix vente','Valeur']);
    $wf = $fid ? "AND s.franchise_id=".intval($fid) : "";
    $rows = query("SELECT f.nom as fnom,c.nom as cnom,p.nom as pnom,p.marque,p.reference,p.code_barre,s.quantite,p.prix_vente
        FROM stock s JOIN produits p ON s.produit_id=p.id JOIN categories c ON p.categorie_id=c.id JOIN franchises f ON s.franchise_id=f.id WHERE p.actif=1 $wf ORDER BY f.nom,c.nom,p.nom");
    foreach ($rows as $r) fputcsv($out, [str_replace('ASEL Mobile — ','',$r['fnom']),$r['cnom'],$r['pnom'],$r['marque'],$r['reference'],$r['code_barre'],$r['quantite'],$r['prix_vente'],$r['quantite']*$r['prix_vente']]);
    fclose($out);
    exit;

case 'export_ventes':
    $d1 = $_GET['d1'] ?? date('Y-m-01');
    $d2 = $_GET['d2'] ?? date('Y-m-d');
    header('Content-Type: text/csv; charset=utf-8');
    header('Content-Disposition: attachment; filename=ventes_asel_'.$d1.'_'.$d2.'.csv');
    $out = fopen('php://output', 'w');
    fputcsv($out, ['Date','Franchise','Produit','Marque','Quantité','Prix unitaire','Remise','Total','Mode paiement','Vendeur']);
    $wf = $fid ? "AND v.franchise_id=".intval($fid) : "";
    $rows = query("SELECT v.*,p.nom as pnom,p.marque,f.nom as fnom,u.nom_complet as vendeur FROM ventes v JOIN produits p ON v.produit_id=p.id JOIN franchises f ON v.franchise_id=f.id LEFT JOIN utilisateurs u ON v.utilisateur_id=u.id WHERE v.date_vente BETWEEN ? AND ? $wf ORDER BY v.date_creation",[$d1,$d2]);
    foreach ($rows as $r) fputcsv($out, [date('d/m/Y H:i',strtotime($r['date_creation'])),str_replace('ASEL Mobile — ','',$r['fnom']),$r['pnom'],$r['marque'],$r['quantite'],$r['prix_unitaire'],$r['remise'],$r['prix_total'],$r['mode_paiement']??'especes',$r['vendeur']]);
    fclose($out);
    exit;

case 'export_clients':
    header('Content-Type: text/csv; charset=utf-8');
    header('Content-Disposition: attachment; filename=clients_asel_'.date('Ymd').'.csv');
    $out = fopen('php://output', 'w');
    fputcsv($out, ['Nom','Prénom','Téléphone','Email','Type','Entreprise','Matricule fiscal','Date']);
    $rows = query("SELECT * FROM clients WHERE actif=1 ORDER BY nom");
    foreach ($rows as $r) fputcsv($out, [$r['nom'],$r['prenom'],$r['telephone'],$r['email'],$r['type_client'],$r['entreprise'],$r['matricule_fiscal'],date('d/m/Y',strtotime($r['date_creation']))]);
    fclose($out);
    exit;

case 'export_produits':
    header('Content-Type: text/csv; charset=utf-8');
    header('Content-Disposition: attachment; filename=produits_asel_'.date('Ymd').'.csv');
    $out = fopen('php://output', 'w');
    fputcsv($out, ['Nom','Catégorie','Marque','Référence','Code-barres','Prix achat','Prix vente','Marge %']);
    $rows = query("SELECT p.*,c.nom as cnom FROM produits p JOIN categories c ON p.categorie_id=c.id WHERE p.actif=1 ORDER BY c.nom,p.nom");
    foreach ($rows as $r) { $m=$r['prix_vente']>0?(($r['prix_vente']-$r['prix_achat'])/$r['prix_vente']*100):0; fputcsv($out, [$r['nom'],$r['cnom'],$r['marque'],$r['reference'],$r['code_barre'],$r['prix_achat'],$r['prix_vente'],number_format($m,1)]); }
    fclose($out);
    exit;

// === QUICK STATS (for sidebar) ===
case 'quick_stats':
    $wf = $fid ? "AND franchise_id=".intval($fid) : "";
    $today_ca = queryOne("SELECT COALESCE(SUM(prix_total),0) as t FROM ventes WHERE date_vente=CURDATE() $wf")['t'];
    $today_tx = queryOne("SELECT COUNT(*) as c FROM ventes WHERE date_vente=CURDATE() $wf")['c'];
    $pending_transfers = queryOne("SELECT COUNT(*) as c FROM transferts WHERE statut='en_attente'")['c'];
    $pending_demands = queryOne("SELECT COUNT(*) as c FROM demandes_produits WHERE statut='en_attente'")['c'];
    $low_stock = queryOne("SELECT COUNT(*) as c FROM stock s JOIN produits p ON s.produit_id=p.id WHERE s.quantite<=p.seuil_alerte AND p.actif=1 ".($fid?"AND s.franchise_id=".intval($fid):""))['c'];
    echo json_encode(['today_ca'=>$today_ca, 'today_tx'=>$today_tx, 'pending_transfers'=>$pending_transfers, 'pending_demands'=>$pending_demands, 'low_stock'=>$low_stock]);
    break;

// === ACTIVITY LOG ===
case 'activity_log':
    $limit = intval($_GET['limit'] ?? 20);
    $wf = $fid ? "AND m.franchise_id=".intval($fid) : "";
    $data = query("SELECT m.*, p.nom as pnom, f.nom as fnom, u.nom_complet as unom
        FROM mouvements m JOIN produits p ON m.produit_id=p.id JOIN franchises f ON m.franchise_id=f.id LEFT JOIN utilisateurs u ON m.utilisateur_id=u.id
        WHERE 1=1 $wf ORDER BY m.date_mouvement DESC LIMIT ?", [$limit]);
    foreach ($data as &$d) $d['fnom'] = str_replace('ASEL Mobile — ', '', $d['fnom']);
    echo json_encode($data);
    break;

// === MY AUDIT LOG (for Mon Compte page) ===
case 'my_audit_log':
    $limit = intval($_GET['limit'] ?? 20);
    $data = query("SELECT * FROM audit_logs WHERE utilisateur_id=? ORDER BY date_creation DESC LIMIT ?", [$user['id'], $limit]);
    echo json_encode($data);
    break;

// === RECEIPT (thermal printer format) ===
case 'receipt':
    $facture_id = intval($_GET['id'] ?? 0);
    $f = queryOne("SELECT f.*,fr.nom as franchise_nom,fr.telephone as franchise_tel,c.nom as client_nom,c.prenom as client_prenom,u.nom_complet as vendeur
        FROM factures f JOIN franchises fr ON f.franchise_id=fr.id LEFT JOIN clients c ON f.client_id=c.id LEFT JOIN utilisateurs u ON f.utilisateur_id=u.id WHERE f.id=?", [$facture_id]);
    if (!$f) { echo json_encode(['error'=>'not_found']); break; }
    $lignes = query("SELECT * FROM facture_lignes WHERE facture_id=?", [$facture_id]);
    echo json_encode(['facture'=>$f, 'lignes'=>$lignes]);
    break;

// === MARK NOTIFICATION READ ===
case 'mark_notif_read':
    $nid = intval($_POST['id'] ?? 0);
    if ($nid) execute("UPDATE notifications SET lu=1 WHERE id=?", [$nid]);
    echo json_encode(['ok'=>true]);
    break;

// === CHANGE OWN PASSWORD ===
case 'change_password':
    $current = $_POST['current'] ?? '';
    $new = $_POST['new'] ?? '';
    if (strlen($new) < 6) { echo json_encode(['error'=>'Minimum 6 caractères']); break; }
    $check = queryOne("SELECT mot_de_passe FROM utilisateurs WHERE id=?", [$user['id']]);
    if (!$check || !password_verify($current, $check['mot_de_passe'])) { echo json_encode(['error'=>'Mot de passe actuel incorrect']); break; }
    execute("UPDATE utilisateurs SET mot_de_passe=? WHERE id=?", [password_hash($new, PASSWORD_DEFAULT), $user['id']]);
    echo json_encode(['success'=>true, 'msg'=>'Mot de passe changé!']);
    break;

// === BARCODE LABEL GENERATION (SVG) ===
case 'barcode_label':
    $code = $_GET['code'] ?? '';
    $name = $_GET['name'] ?? '';
    $price = $_GET['price'] ?? '';
    header('Content-Type: image/svg+xml');
    // Generate Code128-style barcode as SVG
    $bars = '';
    $x = 10;
    for ($i = 0; $i < strlen($code); $i++) {
        $char = ord($code[$i]);
        $width = ($char % 3) + 1;
        if ($i % 2 == 0) {
            $bars .= "<rect x='$x' y='10' width='$width' height='50' fill='black'/>";
        }
        $x += $width + 1;
    }
    echo "<?xml version='1.0'?><svg xmlns='http://www.w3.org/2000/svg' width='" . ($x+10) . "' height='90'>
    <rect width='100%' height='100%' fill='white'/>
    $bars
    <text x='" . (($x+10)/2) . "' y='75' text-anchor='middle' font-family='monospace' font-size='10'>$code</text>
    <text x='" . (($x+10)/2) . "' y='87' text-anchor='middle' font-family='sans-serif' font-size='8' fill='#666'>$name - $price DT</text>
    </svg>";
    exit;

default:
    echo json_encode(['error' => 'Unknown action']);
}
