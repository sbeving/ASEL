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

// === BARCODE FULL LOOKUP (all franchises + product details) ===
case 'barcode_full_lookup':
    $code = trim($_GET['code'] ?? '');
    if (!$code) { echo json_encode(['error' => 'no_code']); break; }
    
    // Find product by barcode or reference
    $product = queryOne("SELECT p.*, c.nom as cat_nom FROM produits p JOIN categories c ON p.categorie_id=c.id WHERE (p.code_barre=? OR p.reference=?) AND p.actif=1", [$code, $code]);
    
    if (!$product) {
        echo json_encode(['found' => false, 'code' => $code]);
        break;
    }
    
    // Get stock per franchise
    $stock = query("SELECT s.quantite, s.franchise_id, f.nom as franchise_nom FROM stock s JOIN franchises f ON s.franchise_id=f.id WHERE s.produit_id=? AND f.actif=1 ORDER BY f.nom", [$product['id']]);
    
    $total_stock = array_sum(array_column($stock, 'quantite'));
    $margin = $product['prix_vente'] > 0 ? round(($product['prix_vente'] - $product['prix_achat']) / $product['prix_vente'] * 100) : 0;
    
    echo json_encode([
        'found' => true,
        'product' => [
            'id' => $product['id'],
            'nom' => $product['nom'],
            'reference' => $product['reference'],
            'code_barre' => $product['code_barre'],
            'marque' => $product['marque'],
            'categorie' => $product['cat_nom'],
            'categorie_id' => $product['categorie_id'],
            'prix_achat' => floatval($product['prix_achat']),
            'prix_vente' => floatval($product['prix_vente']),
            'prix_achat_ht' => floatval($product['prix_achat_ht'] ?? $product['prix_achat']),
            'prix_vente_ht' => floatval($product['prix_vente_ht'] ?? $product['prix_vente']),
            'tva_rate' => floatval($product['tva_rate'] ?? 19),
            'description' => $product['description'] ?? '',
            'seuil_alerte' => intval($product['seuil_alerte']),
            'margin' => $margin,
            'profit_unit' => round($product['prix_vente'] - $product['prix_achat'], 2),
        ],
        'stock' => array_map(fn($s) => [
            'franchise_id' => $s['franchise_id'],
            'franchise' => str_replace(['ASEL Mobile — ', 'ASEL Mobile - '], '', $s['franchise_nom']),
            'quantite' => intval($s['quantite']),
        ], $stock),
        'total_stock' => $total_stock,
    ]);
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
    echo "\xEF\xBB\xBF"; // UTF-8 BOM for Excel
    $out = fopen('php://output', 'w');
    fputcsv($out, ['Nom','Catégorie','Sous-catégorie','Marque','Référence','Code-barres',
        'PA HT','PA TTC','PV HT','PV TTC','TVA %','Marge %','Seuil alerte','Fournisseur'], ';');
    $rows = query("SELECT p.*,c.nom as cnom,sc.nom as scnom,f.nom as fnom FROM produits p 
        JOIN categories c ON p.categorie_id=c.id 
        LEFT JOIN sous_categories sc ON p.sous_categorie_id=sc.id
        LEFT JOIN fournisseurs f ON p.fournisseur_id=f.id 
        WHERE p.actif=1 ORDER BY c.nom,p.nom");
    foreach ($rows as $r) {
        $pa_ht = floatval($r['prix_achat_ht'] ?: round($r['prix_achat']/1.19,2));
        $pa_ttc = floatval($r['prix_achat_ttc'] ?: $r['prix_achat']);
        $pv_ht = floatval($r['prix_vente_ht'] ?: round($r['prix_vente']/1.19,2));
        $pv_ttc = floatval($r['prix_vente_ttc'] ?: $r['prix_vente']);
        $tva = floatval($r['tva_rate'] ?: 19);
        $marge = $pv_ht > 0 ? round(($pv_ht-$pa_ht)/$pv_ht*100,1) : 0;
        fputcsv($out, [
            $r['nom'],$r['cnom'],$r['scnom']??'',$r['marque']??'',$r['reference']??'',$r['code_barre']??'',
            number_format($pa_ht,2,',',''),number_format($pa_ttc,2,',',''),
            number_format($pv_ht,2,',',''),number_format($pv_ttc,2,',',''),
            $tva,$marge,$r['seuil_alerte']??3,$r['fnom']??''
        ], ';');
    }
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

case 'global_search':
    $q = trim($_GET['q'] ?? '');
    if(strlen($q) < 2) { echo json_encode(['results'=>[]]); exit; }
    $results = [];
    $ql = "%$q%";
    
    // Products
    $prods = query("SELECT id,nom,reference,marque FROM produits WHERE actif=1 AND (nom LIKE ? OR reference LIKE ? OR code_barre LIKE ? OR marque LIKE ?) LIMIT 5", [$ql,$ql,$ql,$ql]);
    foreach($prods as $p) $results[] = ['title'=>$p['nom'].($p['marque']?" · {$p['marque']}":''),'type'=>'Produit','icon'=>'bi-tag','url'=>"index.php?page=produits&pf_q=".urlencode($p['nom'])];
    
    // Clients
    $clients = query("SELECT id,nom,prenom,telephone FROM clients WHERE actif=1 AND (nom LIKE ? OR prenom LIKE ? OR telephone LIKE ?) LIMIT 3", [$ql,$ql,$ql]);
    foreach($clients as $c) $results[] = ['title'=>$c['nom'].' '.($c['prenom']??'').($c['telephone']?" · {$c['telephone']}":''),'type'=>'Client','icon'=>'bi-person','url'=>"index.php?page=clients"];
    
    // Factures  
    $facts = query("SELECT id,numero,total_ttc FROM factures WHERE numero LIKE ? LIMIT 3", [$ql]);
    foreach($facts as $f) $results[] = ['title'=>$f['numero']." — ".number_format($f['total_ttc'],2)." DT",'type'=>'Facture','icon'=>'bi-file-earmark-text','url'=>"receipt.php?id={$f['id']}"];
    
    echo json_encode(['results'=>array_slice($results, 0, 10)]);
    exit;

case 'get_bon_lines':
    $bon_id = intval($_GET['bon_id'] ?? 0);
    if (!$bon_id) { echo json_encode([]); exit; }
    try {
        $lines = query("SELECT bl.*, p.nom as produit_nom FROM bon_reception_lignes bl LEFT JOIN produits p ON bl.produit_id=p.id WHERE bl.bon_id=?", [$bon_id]);
        echo json_encode($lines);
    } catch(Exception $e) { echo json_encode([]); }
    exit;

case 'client_profile':
    $cid = intval($_GET['id'] ?? 0);
    if (!$cid) { echo json_encode(['error'=>'no_id']); exit; }
    $client = queryOne("SELECT * FROM clients WHERE id=?", [$cid]);
    if (!$client) { echo json_encode(['error'=>'not_found']); exit; }
    
    $echeances_pending = query("SELECT e.montant, e.date_echeance, e.note, f.numero as facture_num 
        FROM echeances e LEFT JOIN factures f ON e.facture_id=f.id 
        WHERE e.client_id=? AND e.statut IN ('en_attente','en_retard') 
        ORDER BY e.date_echeance ASC LIMIT 10", [$cid]);
    
    $ventes = query("SELECT v.date_vente as date_label, SUM(v.prix_total) as total 
        FROM ventes v WHERE v.client_id=? GROUP BY DATE(v.date_vente) ORDER BY v.date_vente DESC LIMIT 5", [$cid]);
    
    $total_achats = queryOne("SELECT COALESCE(SUM(prix_total),0) as t FROM ventes WHERE client_id=?", [$cid])['t'];
    
    // Format dates
    foreach ($echeances_pending as &$e) {
        $e['date_label'] = date('d/m/Y', strtotime($e['date_echeance']));
    }
    foreach ($ventes as &$v) {
        $v['date_label'] = date('d/m/Y', strtotime($v['date_label']));
    }
    
    echo json_encode([
        'client' => $client,
        'echeances_pending' => $echeances_pending,
        'ventes' => $ventes,
        'total_achats' => $total_achats,
    ]);
    exit;

case 'export_tresorerie':
    if (!can('tresorerie')) { http_response_code(403); exit; }
    $tr_fid = $_GET['fid'] ?? null;
    $mois = $_GET['mois'] ?? date('Y-m');
    $where = $tr_fid ? "AND franchise_id=".intval($tr_fid) : "";
    $rows = query("SELECT t.*,f.nom as fnom,u.nom_complet as unom FROM tresorerie t JOIN franchises f ON t.franchise_id=f.id LEFT JOIN utilisateurs u ON t.utilisateur_id=u.id WHERE t.date_mouvement LIKE ? $where ORDER BY t.date_mouvement DESC", ["$mois%"]);
    header('Content-Type: text/csv; charset=utf-8');
    header('Content-Disposition: attachment; filename="tresorerie_'.$mois.'.csv"');
    echo "\xEF\xBB\xBF"; // BOM UTF-8
    echo "Date,Franchise,Type,Montant,Motif,Référence,Par\n";
    foreach($rows as $r) {
        echo implode(',', [
            $r['date_mouvement'],
            '"'.shortF($r['fnom']).'"',
            $r['type_mouvement'],
            number_format($r['montant'],2),
            '"'.str_replace('"','""',$r['motif']??'').'"',
            '"'.str_replace('"','""',$r['reference']??'').'"',
            '"'.str_replace('"','""',$r['unom']??'').'"',
        ])."\n";
    }
    exit;

case 'export_pointage':
    if (!can('view_all_franchises')) { http_response_code(403); exit; }
    $mois = $_GET['mois'] ?? date('Y-m');
    $fid_p = $_GET['fid'] ?? null;
    $where = "DATE_FORMAT(p.heure,'%Y-%m')=?";
    $params = [$mois];
    if ($fid_p) { $where .= " AND p.franchise_id=?"; $params[] = intval($fid_p); }
    
    try {
        $rows = query("SELECT p.heure, u.nom_complet, u.role, f.nom as franchise,
            p.type_pointage, p.latitude, p.longitude, p.adresse, p.note
            FROM pointages p JOIN utilisateurs u ON p.utilisateur_id=u.id
            LEFT JOIN franchises f ON p.franchise_id=f.id
            WHERE $where ORDER BY p.heure ASC", $params);
    } catch(Exception $e) { $rows = []; }
    
    header('Content-Type: text/csv; charset=utf-8');
    header('Content-Disposition: attachment; filename="pointage_'.$mois.'.csv"');
    echo "\xEF\xBB\xBF"; // UTF-8 BOM
    echo "Date,Heure,Employé,Rôle,Franchise,Type,Latitude,Longitude,Adresse,Note\n";
    foreach($rows as $r) {
        $dt = date('d/m/Y', strtotime($r['heure']));
        $hr = date('H:i', strtotime($r['heure']));
        $type_fr = match($r['type_pointage']) { 'entree'=>'Entrée','sortie'=>'Sortie','pause_debut'=>'Pause','pause_fin'=>'Retour pause', default=>$r['type_pointage'] };
        echo implode(',', [
            $dt, $hr,
            '"'.str_replace('"','""',$r['nom_complet']).'"',
            $r['role'],
            '"'.str_replace('"','""',str_replace(['ASEL Mobile — ','ASEL Mobile - '],'',$r['franchise']??'')).'"',
            $type_fr,
            $r['latitude'] ?? '',
            $r['longitude'] ?? '',
            '"'.str_replace('"','""',$r['adresse']??'').'"',
            '"'.str_replace('"','""',$r['note']??'').'"',
        ])."\n";
    }
    exit;

default:
    echo json_encode(['error' => 'Unknown action']);
}
