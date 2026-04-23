<?php
/**
 * ASEL Mobile — PDF Generator
 * Uses plain HTML → browser print (no external library needed on free hosting)
 */
require_once 'helpers.php';
requireLogin();

$type = $_GET['type'] ?? '';
$id = $_GET['id'] ?? '';

// === FACTURE PDF ===
if ($type === 'facture' && $id) {
    $f = queryOne("SELECT f.*,fr.nom as franchise_nom,fr.adresse as franchise_adresse,fr.telephone as franchise_tel,
                   c.nom as client_nom,c.prenom as client_prenom,c.telephone as client_tel,c.email as client_email,
                   c.type_client,c.entreprise,c.matricule_fiscal,u.nom_complet as vendeur
                   FROM factures f 
                   JOIN franchises fr ON f.franchise_id=fr.id 
                   LEFT JOIN clients c ON f.client_id=c.id
                   LEFT JOIN utilisateurs u ON f.utilisateur_id=u.id
                   WHERE f.id=?", [$id]);
    if (!$f) die('Facture non trouvée');
    
    $lignes = query("SELECT * FROM facture_lignes WHERE facture_id=?", [$id]);
    
    // Compute HT/TVA if not stored (backward compat with pre-v14 factures)
    if (!$f['total_ht'] || $f['total_ht'] == 0) {
        $f['total_ht'] = round($f['total_ttc'] / 1.19, 2);
        $f['tva'] = $f['total_ttc'] - $f['total_ht'];
    }
    
    $title = strtoupper($f['type_facture']) . ' N° ' . $f['numero'];
    
    ?>
<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <title><?=$title?></title>
    <style>
        @media print { body { margin: 0; } .no-print { display: none; } }
        * { font-family: 'Helvetica Neue', Arial, sans-serif; margin: 0; padding: 0; box-sizing: border-box; }
        body { padding: 20px; max-width: 800px; margin: auto; font-size: 12px; color: #333; }
        .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #2AABE2; padding-bottom: 15px; margin-bottom: 20px; }
        .logo { font-size: 28px; font-weight: 900; color: #1B3A5C; letter-spacing: 2px; }
        .logo span { background: linear-gradient(90deg,#E63946,#FF8C00,#FFD700,#28A745,#2AABE2); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
        .logo-sub { font-size: 10px; color: #888; letter-spacing: 4px; }
        .doc-type { text-align: right; }
        .doc-type h2 { font-size: 20px; color: #2AABE2; }
        .doc-type .num { font-size: 14px; color: #666; }
        .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 20px; }
        .info-box { background: #f8f9fa; padding: 12px; border-radius: 6px; }
        .info-box h4 { color: #2AABE2; font-size: 10px; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 6px; }
        .info-box p { font-size: 11px; line-height: 1.6; }
        table { width: 100%; border-collapse: collapse; margin-bottom: 15px; }
        th { background: #1B3A5C; color: white; padding: 8px 10px; text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; }
        td { padding: 8px 10px; border-bottom: 1px solid #eee; font-size: 11px; }
        tr:nth-child(even) { background: #fafafa; }
        .totals { display: flex; justify-content: flex-end; }
        .totals table { width: 250px; }
        .totals td { padding: 5px 10px; }
        .totals .grand-total { background: #2AABE2; color: white; font-weight: bold; font-size: 14px; }
        .footer { margin-top: 30px; padding-top: 15px; border-top: 1px solid #ddd; text-align: center; font-size: 9px; color: #999; }
        .payment-info { background: #f0f8ff; padding: 10px; border-radius: 6px; margin-bottom: 15px; display: flex; gap: 20px; font-size: 11px; }
        .btn-print { position: fixed; bottom: 20px; right: 20px; background: #2AABE2; color: white; border: none; padding: 12px 24px; border-radius: 8px; font-weight: bold; cursor: pointer; font-size: 14px; box-shadow: 0 4px 12px rgba(0,0,0,0.2); }
    </style>
</head>
<body>
    <button class="btn-print no-print" onclick="window.print()">🖨️ Imprimer / PDF</button>
    
    <div class="header">
        <div>
            <div class="logo"><span>A</span>SEL</div>
            <div class="logo-sub">MOBILE</div>
            <p style="font-size:10px;color:#888;margin-top:5px"><?=htmlspecialchars(str_replace(['ASEL Mobile — ','ASEL Mobile - '],'',$f['franchise_nom']))?></p>
            <p style="font-size:10px;color:#888"><?=$f['franchise_adresse']?></p>
            <p style="font-size:10px;color:#888">Tél: <?=$f['franchise_tel']?></p>
        </div>
        <div class="doc-type">
            <h2><?=strtoupper($f['type_facture'])?></h2>
            <div class="num">N° <?=$f['numero']?></div>
            <div style="font-size:11px;margin-top:5px">Date: <?=date('d/m/Y H:i', strtotime($f['date_facture']))?></div>
            <div style="font-size:11px">Vendeur: <?=$f['vendeur']?></div>
        </div>
    </div>
    
    <?php if ($f['client_nom']): ?>
    <div class="info-grid">
        <div class="info-box">
            <h4>Client</h4>
            <p>
                <strong><?=htmlspecialchars($f['client_nom'] . ' ' . ($f['client_prenom'] ?? ''))?></strong><br>
                <?php if($f['entreprise']): ?>Entreprise: <?=$f['entreprise']?><br><?php endif; ?>
                <?php if($f['client_tel']): ?>Tél: <?=$f['client_tel']?><br><?php endif; ?>
                <?php if($f['client_email']): ?>Email: <?=$f['client_email']?><br><?php endif; ?>
                <?php if($f['matricule_fiscal']): ?>MF: <?=$f['matricule_fiscal']?><br><?php endif; ?>
                Type: <?=$f['type_client']?>
            </p>
        </div>
        <div></div>
    </div>
    <?php endif; ?>
    
    <table>
        <thead>
            <tr><th>#</th><th>Désignation</th><th>Type</th><th style="text-align:center">Qté</th><th style="text-align:right">P.U.</th><th style="text-align:right">Remise</th><th style="text-align:right">Total</th></tr>
        </thead>
        <tbody>
            <?php foreach ($lignes as $i => $l): ?>
            <tr>
                <td><?=$i+1?></td>
                <td><strong><?=htmlspecialchars($l['designation'])?></strong></td>
                <td><span style="background:#eee;padding:2px 6px;border-radius:3px;font-size:9px"><?=$l['type_ligne']?></span></td>
                <td style="text-align:center"><?=$l['quantite']?></td>
                <td style="text-align:right"><?=number_format($l['prix_unitaire'],2)?> DT</td>
                <td style="text-align:right"><?=$l['remise'] > 0 ? number_format($l['remise'],2).' DT' : '—'?></td>
                <td style="text-align:right"><strong><?=number_format($l['total'],2)?> DT</strong></td>
            </tr>
            <?php endforeach; ?>
        </tbody>
    </table>
    
    <div class="totals">
        <table>
            <tr><td>Sous-total</td><td style="text-align:right"><?=number_format($f['sous_total'],2)?> DT</td></tr>
            <?php if ($f['remise_totale'] > 0): ?><tr><td>Remise</td><td style="text-align:right;color:#E63946">-<?=number_format($f['remise_totale'],2)?> DT</td></tr><?php endif; ?>
            <tr><td>Total HT</td><td style="text-align:right"><?=number_format($f['total_ht'],2)?> DT</td></tr>
            <?php if ($f['tva'] > 0): ?><tr><td>TVA (19%)</td><td style="text-align:right"><?=number_format($f['tva'],2)?> DT</td></tr><?php endif; ?>
            <tr class="grand-total"><td style="padding:8px 10px"><strong>TOTAL TTC</strong></td><td style="text-align:right;padding:8px 10px"><strong><?=number_format($f['total_ttc'],2)?> DT</strong></td></tr>
        </table>
    </div>
    
    <div class="payment-info">
        <?php 
        $mode_label = match($f['mode_paiement'] ?? ''){'especes'=>'Espèces','carte'=>'Carte bancaire','virement'=>'Virement','cheque'=>'Chèque','echeance'=>'Paiement par lot (échéances)',default=>ucfirst($f['mode_paiement'] ?: 'Non spécifié')};
        ?>
        <div><strong>Paiement:</strong> <?=$mode_label?></div>
        <?php if ($f['mode_paiement'] === 'especes'): ?>
        <div><strong>Reçu:</strong> <?=number_format($f['montant_recu'],2)?> DT</div>
        <?php if($f['monnaie']>0): ?><div><strong>Monnaie:</strong> <?=number_format($f['monnaie'],2)?> DT</div><?php endif; ?>
        <?php endif; ?>
        <?php 
        // Show avance + échéancier for ANY facture that has echeances (regardless of mode_paiement)
        $pdf_echeances = query("SELECT * FROM echeances WHERE facture_id=? ORDER BY date_echeance", [$id]);
        if ($pdf_echeances && count($pdf_echeances) > 0):
            $total_ech = array_sum(array_column($pdf_echeances, 'montant'));
            $avance_calc = max(0, round($f['total_ttc'] - $total_ech, 2));
        ?>
        <?php if($avance_calc > 0 || $f['montant_recu'] > 0): 
            $avance_display = max($avance_calc, floatval($f['montant_recu']));
        ?>
        <div><strong>💰 Avance versée:</strong> <?=number_format($avance_display,2)?> DT</div>
        <div><strong>Reste à payer:</strong> <?=number_format($total_ech,2)?> DT</div>
        <?php endif; ?>
        <div style="margin-top:5px;font-weight:bold;font-size:10px">ÉCHÉANCIER:</div>
        <table style="width:100%;font-size:9px;border-collapse:collapse;margin-top:3px">
            <tr style="background:#f0f0f0"><th style="padding:2px 5px;text-align:left">N°</th><th style="padding:2px 5px;text-align:left">Date</th><th style="padding:2px 5px;text-align:right">Montant</th><th style="padding:2px 5px;text-align:center">Statut</th></tr>
            <?php foreach($pdf_echeances as $i=>$ech): 
                $ech_color = match($ech['statut'] ?? ''){'payee'=>'#059669','en_retard'=>'#DC2626',default=>'#D97706'};
            ?>
            <tr><td style="padding:2px 5px">Lot <?=($i+1)?></td><td style="padding:2px 5px"><?=date('d/m/Y',strtotime($ech['date_echeance']))?></td><td style="padding:2px 5px;text-align:right;font-weight:bold"><?=number_format($ech['montant'],2)?> DT</td><td style="padding:2px 5px;text-align:center;color:<?=$ech_color?>"><?=ucfirst(str_replace('_',' ',$ech['statut'] ?? 'en attente'))?></td></tr>
            <?php endforeach; ?>
        </table>
        <?php endif; ?>
    </div>
    
    <div class="footer">
        <p><?=str_replace('ASEL Mobile — ','',$f['franchise_nom'])?> — <?=$f['franchise_adresse']?></p>
        <p>Merci de votre confiance! 📱</p>
    </div>
</body>
</html>
<?php
    exit;
}

// === RAPPORT JOURNALIER PDF ===
if ($type === 'rapport_jour') {
    $date = $_GET['date'] ?? date('Y-m-d');
    $fid = $_GET['fid'] ?? null;
    
    requirePermission('rapports');
    
    $franchise = $fid ? queryOne("SELECT * FROM franchises WHERE id=?", [$fid]) : null;
    $where_f = $fid ? "AND v.franchise_id=".intval($fid) : "";
    
    $ventes = query("SELECT v.*,p.nom as pnom,p.prix_achat,f.nom as fnom,u.nom_complet as vendeur,fa.mode_paiement 
                     FROM ventes v JOIN produits p ON v.produit_id=p.id 
                     JOIN franchises f ON v.franchise_id=f.id 
                     LEFT JOIN utilisateurs u ON v.utilisateur_id=u.id
                     LEFT JOIN factures fa ON v.facture_id=fa.id 
                     WHERE v.date_vente=? $where_f ORDER BY v.date_creation", [$date]);
    
    $total_ca = array_sum(array_column($ventes, 'prix_total'));
    $total_art = array_sum(array_column($ventes, 'quantite'));
    $total_cout = array_sum(array_map(fn($v) => $v['quantite'] * floatval($v['prix_achat']), $ventes));
    $total_profit = $total_ca - $total_cout;
    $total_ca_ht = round($total_ca / 1.19, 2);
    $total_tva = $total_ca - $total_ca_ht;
    
    // By mode paiement
    $by_mode_j = [];
    foreach($ventes as $v) {
        $m = $v['mode_paiement'] ?: 'especes';
        $by_mode_j[$m] = ($by_mode_j[$m] ?? 0) + $v['prix_total'];
    }
    // By employee
    $by_emp_j = [];
    foreach($ventes as $v) {
        $emp = $v['vendeur'] ?: 'Inconnu';
        if(!isset($by_emp_j[$emp])) $by_emp_j[$emp] = ['ca'=>0,'nb'=>0];
        $by_emp_j[$emp]['ca'] += $v['prix_total'];
        $by_emp_j[$emp]['nb']++;
    }
    arsort($by_mode_j);
    
    ?>
<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <title>Rapport journalier — <?=$date?></title>
    <style>
        @media print { body { margin: 0; } .no-print { display: none; } }
        * { font-family: 'Helvetica Neue', Arial, sans-serif; margin: 0; padding: 0; }
        body { padding: 20px; max-width: 800px; margin: auto; font-size: 12px; }
        .header { text-align: center; border-bottom: 3px solid #2AABE2; padding-bottom: 10px; margin-bottom: 20px; }
        .logo { font-size: 24px; font-weight: 900; color: #1B3A5C; }
        h1 { font-size: 18px; color: #2AABE2; margin: 10px 0; }
        .kpis { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 20px; }
        .kpi { background: #f8f9fa; padding: 12px; border-radius: 6px; text-align: center; border-left: 3px solid #2AABE2; }
        .kpi .val { font-size: 20px; font-weight: 800; color: #1B3A5C; }
        .kpi .lbl { font-size: 9px; color: #888; text-transform: uppercase; }
        table { width: 100%; border-collapse: collapse; margin-bottom: 15px; }
        th { background: #1B3A5C; color: white; padding: 6px 8px; text-align: left; font-size: 10px; text-transform: uppercase; }
        td { padding: 6px 8px; border-bottom: 1px solid #eee; font-size: 11px; }
        .footer { text-align: center; font-size: 9px; color: #999; margin-top: 20px; border-top: 1px solid #ddd; padding-top: 10px; }
        .btn-print { position: fixed; bottom: 20px; right: 20px; background: #2AABE2; color: white; border: none; padding: 12px 24px; border-radius: 8px; font-weight: bold; cursor: pointer; }
    </style>
</head>
<body>
    <button class="btn-print no-print" onclick="window.print()">🖨️ Imprimer / PDF</button>
    <div class="header">
        <div class="logo">ASEL MOBILE</div>
        <h1>RAPPORT JOURNALIER</h1>
        <p><?= $franchise ? htmlspecialchars($franchise['nom']) : 'Toutes les franchises' ?> — <?=date('d/m/Y', strtotime($date))?></p>
    </div>
    
    <div class="kpis">
        <div class="kpi"><div class="val"><?=number_format($total_ca,2)?> DT</div><div class="lbl">CA TTC</div></div>
        <div class="kpi"><div class="val"><?=number_format($total_ca_ht,2)?> DT</div><div class="lbl">CA HT</div></div>
        <div class="kpi"><div class="val"><?=number_format($total_tva,2)?> DT</div><div class="lbl">TVA 19%</div></div>
        <div class="kpi" style="border-color:<?=$total_profit>=0?'#28A745':'#E63946'?>"><div class="val" style="color:<?=$total_profit>=0?'#28A745':'#E63946'?>"><?=number_format($total_profit,2)?> DT</div><div class="lbl">Bénéfice net</div></div>
        <div class="kpi"><div class="val"><?=number_format($total_art)?></div><div class="lbl">Articles</div></div>
        <div class="kpi"><div class="val"><?=count($ventes)?></div><div class="lbl">Transactions</div></div>
    </div>
    
    <?php if(count($by_mode_j)>1 || (count($by_mode_j)==1 && !isset($by_mode_j['especes']))): ?>
    <h2 style="font-size:13px;color:#1B3A5C;margin-bottom:8px;">💳 Répartition par mode de paiement</h2>
    <table style="margin-bottom:15px"><thead><tr><th>Mode</th><th style="text-align:right">Montant</th><th style="text-align:right">%</th></tr></thead><tbody>
    <?php foreach($by_mode_j as $m=>$mt): $pct=$total_ca>0?round($mt/$total_ca*100):0; $icons=['especes'=>'💵','carte'=>'💳','virement'=>'🏦','cheque'=>'📋','echeance'=>'📅']; ?>
    <tr><td><?=($icons[$m]??'').' '.ucfirst($m)?></td><td style="text-align:right"><strong><?=number_format($mt,2)?> DT</strong></td><td style="text-align:right"><?=$pct?>%</td></tr>
    <?php endforeach; ?></tbody></table>
    <?php endif; ?>
    
    <?php if(count($by_emp_j)>1): ?>
    <h2 style="font-size:13px;color:#1B3A5C;margin-bottom:8px;">👥 Par vendeur</h2>
    <table style="margin-bottom:15px"><thead><tr><th>Vendeur</th><th style="text-align:center">Ventes</th><th style="text-align:right">CA</th></tr></thead><tbody>
    <?php foreach($by_emp_j as $emp=>$d): ?>
    <tr><td><?=htmlspecialchars($emp)?></td><td style="text-align:center"><?=$d['nb']?></td><td style="text-align:right"><strong><?=number_format($d['ca'],2)?> DT</strong></td></tr>
    <?php endforeach; ?></tbody></table>
    <?php endif; ?>
    
    <table>
        <thead><tr><th>Heure</th><th>Franchise</th><th>Produit</th><th>Qté</th><th>Prix</th><th>Total</th><th>Vendeur</th></tr></thead>
        <tbody>
        <?php foreach ($ventes as $v): ?>
            <tr><td><?=date('H:i',strtotime($v['date_creation']))?></td><td><?=str_replace('ASEL Mobile — ','',$v['fnom'])?></td><td><?=htmlspecialchars($v['pnom'])?></td><td><?=$v['quantite']?></td><td><?=number_format($v['prix_unitaire'],1)?></td><td><strong><?=number_format($v['prix_total'],1)?> DT</strong></td><td><?=$v['vendeur']?></td></tr>
        <?php endforeach; ?>
        </tbody>
        <tfoot><tr style="background:#1B3A5C;color:white"><td colspan="3"><strong>TOTAL</strong></td><td><strong><?=$total_art?></strong></td><td></td><td><strong><?=number_format($total_ca)?> DT</strong></td><td></td></tr></tfoot>
    </table>
    
    <div class="footer">
        <p>Rapport journalier du <?=date('d/m/Y', strtotime($date))?> — Généré le <?=date('d/m/Y à H:i')?></p>
        <p>CA HT: <?=number_format($total_ca_ht,2)?> DT · TVA: <?=number_format($total_tva,2)?> DT · Bénéfice: <?=number_format($total_profit,2)?> DT</p>
    </div>
</body>
</html>
<?php exit;
}

// === RAPPORT MENSUEL PDF ===
if ($type === 'rapport_mois') {
    $mois = $_GET['mois'] ?? date('Y-m');
    $fid = $_GET['fid'] ?? null;
    
    requirePermission('rapports');
    
    $franchise = $fid ? queryOne("SELECT * FROM franchises WHERE id=?", [$fid]) : null;
    $where_f = $fid ? "AND v.franchise_id=".intval($fid) : "";
    
    $par_jour = query("SELECT v.date_vente, SUM(v.prix_total) as ca, SUM(v.quantite) as articles, COUNT(*) as transactions
                       FROM ventes v WHERE DATE_FORMAT(v.date_vente,'%Y-%m')=? $where_f 
                       GROUP BY v.date_vente ORDER BY v.date_vente", [$mois]);
    
    $top_produits = query("SELECT p.nom, SUM(v.quantite) as qty, SUM(v.prix_total) as ca, SUM(v.quantite*p.prix_achat) as cout 
                          FROM ventes v JOIN produits p ON v.produit_id=p.id 
                          WHERE DATE_FORMAT(v.date_vente,'%Y-%m')=? $where_f 
                          GROUP BY p.id ORDER BY ca DESC LIMIT 15", [$mois]);
    
    // By mode paiement
    $by_mode = query("SELECT f.mode_paiement, SUM(f.total_ttc) as total, COUNT(*) as nb 
                      FROM factures f WHERE DATE_FORMAT(f.date_facture,'%Y-%m')=? AND f.statut!='annulee' ".($fid?"AND f.franchise_id=".intval($fid):"")."
                      GROUP BY f.mode_paiement ORDER BY total DESC", [$mois]);
    
    // By employee  
    $by_emp = query("SELECT u.nom_complet, SUM(v.prix_total) as ca, COUNT(*) as tx 
                     FROM ventes v LEFT JOIN utilisateurs u ON v.utilisateur_id=u.id 
                     WHERE DATE_FORMAT(v.date_vente,'%Y-%m')=? $where_f 
                     GROUP BY v.utilisateur_id ORDER BY ca DESC", [$mois]);
    
    $total_ca = array_sum(array_column($par_jour, 'ca'));
    $total_art = array_sum(array_column($par_jour, 'articles'));
    $total_tx = array_sum(array_column($par_jour, 'transactions'));
    $total_cout = array_sum(array_column($top_produits, 'cout'));
    $total_profit = $total_ca - $total_cout;
    $total_ca_ht = round($total_ca / 1.19, 2);
    $total_tva = $total_ca - $total_ca_ht;
    $nb_jours = count($par_jour);
    
    ?>
<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <title>Rapport mensuel — <?=$mois?></title>
    <style>
        @media print { body { margin: 0; } .no-print { display: none; } }
        * { font-family: 'Helvetica Neue', Arial, sans-serif; margin: 0; padding: 0; }
        body { padding: 20px; max-width: 800px; margin: auto; font-size: 12px; }
        .header { text-align: center; border-bottom: 3px solid #2AABE2; padding-bottom: 10px; margin-bottom: 20px; }
        .logo { font-size: 24px; font-weight: 900; color: #1B3A5C; }
        h1 { font-size: 18px; color: #2AABE2; margin: 10px 0; }
        h2 { font-size: 14px; color: #1B3A5C; margin: 15px 0 8px; }
        .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 20px; }
        .kpi { background: #f8f9fa; padding: 10px; border-radius: 6px; text-align: center; border-left: 3px solid #2AABE2; }
        .kpi .val { font-size: 18px; font-weight: 800; color: #1B3A5C; }
        .kpi .lbl { font-size: 9px; color: #888; text-transform: uppercase; }
        table { width: 100%; border-collapse: collapse; margin-bottom: 15px; }
        th { background: #1B3A5C; color: white; padding: 6px 8px; text-align: left; font-size: 10px; }
        td { padding: 5px 8px; border-bottom: 1px solid #eee; font-size: 11px; }
        .footer { text-align: center; font-size: 9px; color: #999; margin-top: 20px; border-top: 1px solid #ddd; padding-top: 10px; }
        .btn-print { position: fixed; bottom: 20px; right: 20px; background: #2AABE2; color: white; border: none; padding: 12px 24px; border-radius: 8px; font-weight: bold; cursor: pointer; }
    </style>
</head>
<body>
    <button class="btn-print no-print" onclick="window.print()">🖨️ Imprimer / PDF</button>
    <div class="header">
        <div class="logo">ASEL MOBILE</div>
        <h1>RAPPORT MENSUEL</h1>
        <p><?= $franchise ? htmlspecialchars($franchise['nom']) : 'Toutes les franchises' ?> — <?=date('F Y', strtotime($mois.'-01'))?></p>
    </div>
    
    <div class="kpis">
        <div class="kpi"><div class="val"><?=number_format($total_ca,2)?> DT</div><div class="lbl">CA TTC</div></div>
        <div class="kpi"><div class="val"><?=number_format($total_ca_ht,2)?> DT</div><div class="lbl">CA HT</div></div>
        <div class="kpi"><div class="val"><?=number_format($total_tva,2)?> DT</div><div class="lbl">TVA 19%</div></div>
        <div class="kpi"><div class="val" style="color:<?=$total_profit>=0?'#28A745':'#E63946'?>"><?=number_format($total_profit,2)?> DT</div><div class="lbl">Bénéfice net</div></div>
        <div class="kpi"><div class="val"><?=$total_art?></div><div class="lbl">Articles</div></div>
        <div class="kpi"><div class="val"><?=$total_tx?></div><div class="lbl">Transactions</div></div>
        <div class="kpi"><div class="val"><?=$nb_jours > 0 ? number_format($total_ca/$nb_jours) : 0?> DT</div><div class="lbl">CA/Jour moy.</div></div>
    </div>
    
    <h2>📊 Ventes par jour</h2>
    <table>
        <thead><tr><th>Date</th><th style="text-align:right">CA</th><th style="text-align:center">Articles</th><th style="text-align:center">Transactions</th></tr></thead>
        <tbody><?php foreach ($par_jour as $j): ?>
            <tr><td><?=date('d/m/Y',strtotime($j['date_vente']))?></td><td style="text-align:right"><strong><?=number_format($j['ca'])?> DT</strong></td><td style="text-align:center"><?=$j['articles']?></td><td style="text-align:center"><?=$j['transactions']?></td></tr>
        <?php endforeach; ?></tbody>
        <tfoot><tr style="background:#1B3A5C;color:white"><td><strong>TOTAL</strong></td><td style="text-align:right"><strong><?=number_format($total_ca)?> DT</strong></td><td style="text-align:center"><strong><?=$total_art?></strong></td><td style="text-align:center"><strong><?=$total_tx?></strong></td></tr></tfoot>
    </table>
    
    <h2>🏆 Top Produits</h2>
    <table>
        <thead><tr><th>#</th><th>Produit</th><th style="text-align:center">Qté</th><th style="text-align:right">CA TTC</th><th style="text-align:right">Bénéfice</th></tr></thead>
        <tbody><?php foreach ($top_produits as $i => $tp): $b=floatval($tp['ca'])-floatval($tp['cout']); ?>
            <tr><td><?=$i+1?></td><td><?=htmlspecialchars($tp['nom'])?></td><td style="text-align:center"><?=$tp['qty']?></td><td style="text-align:right"><strong><?=number_format($tp['ca'],2)?> DT</strong></td><td style="text-align:right;color:<?=$b>=0?'#28A745':'#E63946'?>"><?=number_format($b,2)?> DT</td></tr>
        <?php endforeach; ?></tbody>
    </table>
    
    <?php if($by_mode): ?>
    <h2>💳 Par mode de paiement</h2>
    <table>
        <thead><tr><th>Mode</th><th style="text-align:center">Nb factures</th><th style="text-align:right">Total</th></tr></thead>
        <tbody><?php foreach($by_mode as $m): ?><tr><td><?=ucfirst($m['mode_paiement'])?></td><td style="text-align:center"><?=$m['nb']?></td><td style="text-align:right"><strong><?=number_format($m['total'],2)?> DT</strong></td></tr><?php endforeach;?></tbody>
    </table>
    <?php endif; ?>
    
    <?php if($by_emp): ?>
    <h2>👥 Performance par vendeur</h2>
    <table>
        <thead><tr><th>Vendeur</th><th style="text-align:center">Ventes</th><th style="text-align:right">CA</th></tr></thead>
        <tbody><?php foreach($by_emp as $e): ?><tr><td><?=htmlspecialchars($e['nom_complet']??'Inconnu')?></td><td style="text-align:center"><?=$e['tx']?></td><td style="text-align:right"><strong><?=number_format($e['ca'],2)?> DT</strong></td></tr><?php endforeach;?></tbody>
    </table>
    <?php endif; ?>
    
    <div class="footer"><p>Rapport généré le <?=date('d/m/Y à H:i')?> — ASEL Mobile | CA HT: <?=number_format($total_ca_ht,2)?> DT | TVA: <?=number_format($total_tva,2)?> DT | Bénéfice: <?=number_format($total_profit,2)?> DT</p></div>
</body>
</html>
<?php exit;
}

// Default
echo "Type de PDF non reconnu. Types disponibles: facture, rapport_jour, rapport_mois, bon_reception";

// === BON DE RECEPTION PDF ===
if ($type === 'bon_reception' && $id) {
    $bon = queryOne("SELECT br.*,f.nom as fnom,fo.nom as fourn_nom,fo.adresse as fourn_adresse,fo.telephone as fourn_tel,u.nom_complet as unom FROM bons_reception br JOIN franchises f ON br.franchise_id=f.id LEFT JOIN fournisseurs fo ON br.fournisseur_id=fo.id LEFT JOIN utilisateurs u ON br.utilisateur_id=u.id WHERE br.id=?", [$id]);
    if (!$bon) { http_response_code(404); echo "Bon introuvable"; exit; }
    try { $lignes = query("SELECT bl.*,p.nom as pnom,p.reference as pref FROM bon_reception_lignes bl JOIN produits p ON bl.produit_id=p.id WHERE bl.bon_id=? ORDER BY bl.id", [$id]); } catch(Exception $e) { $lignes = []; }
    header('Content-Type: text/html; charset=utf-8');
    ?><!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><title>Bon réception <?=e($bon['numero'])?></title>
    <style>body{font-family:Arial,sans-serif;font-size:12px;margin:20px;color:#333;}.logo{font-size:20px;font-weight:900;color:#2AABE2;}.header{display:flex;justify-content:space-between;border-bottom:2px solid #2AABE2;padding-bottom:12px;margin-bottom:16px;}.meta{text-align:right;font-size:11px;color:#555;}.bon-num{font-size:16px;font-weight:bold;color:#2AABE2;}.info-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;}.info-box{background:#f8f9fa;padding:8px;border-radius:4px;font-size:11px;}label{font-size:9px;color:#999;text-transform:uppercase;display:block;}table{width:100%;border-collapse:collapse;margin:12px 0;}th{background:#1B3A5C;color:#fff;padding:7px;text-align:left;font-size:10px;}td{padding:6px 8px;border-bottom:1px solid #eee;font-size:11px;}.totals{float:right;width:220px;font-size:11px;}.tr{display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid #eee;}.tf{font-weight:bold;font-size:13px;color:#1B3A5C;border-top:2px solid #1B3A5C;padding-top:4px;margin-top:2px;}.footer{clear:both;margin-top:30px;font-size:9px;color:#aaa;text-align:center;border-top:1px solid #eee;padding-top:8px;}@media print{.no-print{display:none}}</style>
    </head><body>
    <button onclick="window.print()" class="no-print" style="position:fixed;top:10px;right:10px;background:#2AABE2;color:#fff;border:0;padding:7px 14px;border-radius:6px;cursor:pointer;font-weight:bold">🖨️ Imprimer</button>
    <div class="header"><div><div class="logo">ASEL Mobile</div><small><?=e(shortF($bon['fnom']))?></small></div><div class="meta"><div>BON DE RÉCEPTION</div><div class="bon-num"><?=e($bon['numero'])?></div><div><?=date('d/m/Y',strtotime($bon['date_reception']))?></div><div>Par: <?=e($bon['unom']??'—')?></div></div></div>
    <div class="info-grid"><div class="info-box"><label>Franchise</label><strong><?=e(shortF($bon['fnom']))?></strong></div><div class="info-box"><label>Fournisseur</label><strong><?=e($bon['fourn_nom']??'—')?></strong><?php if($bon['fourn_adresse']): ?><div><?=e($bon['fourn_adresse'])?></div><?php endif; ?></div></div>
    <?php if($bon['note']): ?><div style="background:#fff3cd;padding:6px 10px;border-radius:4px;margin-bottom:10px;font-size:11px"><strong>Note:</strong> <?=e($bon['note'])?></div><?php endif; ?>
    <table><thead><tr><th>Produit</th><th>Réf.</th><th>Qté</th><th>P.U. HT</th><th>TVA%</th><th>P.U. TTC</th><th>Total TTC</th></tr></thead><tbody>
    <?php foreach($lignes as $l): ?><tr><td><?=e($l['pnom'])?></td><td style="font-family:monospace;font-size:10px"><?=e($l['pref']??'')?></td><td style="text-align:center;font-weight:bold"><?=$l['quantite']?></td><td style="text-align:right"><?=number_format($l['prix_unitaire_ht'],2)?></td><td style="text-align:center"><?=number_format($l['tva_rate']??19,0)?>%</td><td style="text-align:right"><?=number_format($l['prix_unitaire_ttc'],2)?></td><td style="text-align:right;font-weight:bold"><?=number_format($l['total_ttc'],2)?></td></tr><?php endforeach; ?>
    </tbody></table>
    <div class="totals"><div class="tr"><span>Total HT</span><span><?=number_format($bon['total_ht'],2)?> DT</span></div><div class="tr"><span>TVA</span><span><?=number_format($bon['tva'],2)?> DT</span></div><div class="tr tf"><span>TOTAL TTC</span><span><?=number_format($bon['total_ttc'],2)?> DT</span></div></div>
    <div class="footer">ASEL Mobile — Bon de réception <?=e($bon['numero'])?> — Imprimé le <?=date('d/m/Y H:i')?></div>
    </body></html><?php exit;
}

// === ETIQUETTES PRODUITS (LABEL PRINT) ===
if ($type === 'etiquettes') {
    require_once 'config.php';
    requireLogin();
    
    $ids = array_map('intval', explode(',', $_GET['ids'] ?? ''));
    $qty_map = [];
    foreach(explode(',', $_GET['qty'] ?? '') as $i => $q) {
        if(isset($ids[$i])) $qty_map[$ids[$i]] = max(1, intval($q) ?: 1);
    }
    
    if(!$ids || !$ids[0]) { echo "Aucun produit sélectionné"; exit; }
    
    $products = query("SELECT p.*,c.nom as cat_nom FROM produits p JOIN categories c ON p.categorie_id=c.id WHERE p.id IN (".implode(',',array_fill(0,count($ids),'?')).")", $ids);
    
    header('Content-Type: text/html; charset=utf-8');
    ?><!DOCTYPE html><html lang="fr"><head><meta charset="utf-8">
    <title>Étiquettes produits</title>
    <style>
        @page{margin:5mm;size:A4}
        body{font-family:Arial,sans-serif;margin:0;padding:5mm;background:#fff}
        .grid{display:grid;grid-template-columns:repeat(4,1fr);gap:3mm}
        .label{border:1px solid #ddd;border-radius:3px;padding:4px 6px;text-align:center;page-break-inside:avoid;min-height:30mm;display:flex;flex-direction:column;justify-content:space-between}
        .brand{font-size:7px;color:#999;text-transform:uppercase;letter-spacing:1px}
        .name{font-size:9px;font-weight:bold;line-height:1.2;margin:2px 0;word-break:break-word}
        .ref{font-size:7px;color:#666;font-family:monospace}
        .barcode{margin:2px auto;display:block}
        .price{font-size:14px;font-weight:900;color:#2AABE2;margin:2px 0}
        .ht{font-size:7px;color:#999}
        @media print{body{padding:0;}.no-print{display:none}}
    </style></head><body>
    <button onclick="window.print()" class="no-print" style="position:fixed;top:10px;right:10px;background:#2AABE2;color:#fff;border:0;padding:8px 20px;border-radius:6px;cursor:pointer;font-weight:bold;z-index:999">🖨️ Imprimer</button>
    <div class="grid">
    <?php foreach($products as $p):
        $qty = $qty_map[$p['id']] ?? 1;
        for($i=0; $i<$qty; $i++):
            $code = $p['code_barre'] ?: $p['reference'] ?: "P{$p['id']}";
            $pv = floatval($p['prix_vente_ttc'] ?: $p['prix_vente']);
            $pv_ht = floatval($p['prix_vente_ht'] ?: round($pv/1.19,2));
    ?>
    <div class="label">
        <div class="brand"><?=e(shortF('ASEL Mobile'))?></div>
        <div class="name"><?=e(mb_substr($p['nom'],0,40))?></div>
        <div class="ref"><?=e($code)?></div>
        <?php if($code): ?>
        <img class="barcode" src="api.php?action=barcode_label&code=<?=urlencode($code)?>&name=&price=" height="30" alt="<?=e($code)?>">
        <?php endif; ?>
        <div class="price"><?=number_format($pv,2)?> DT</div>
        <div class="ht">HT: <?=number_format($pv_ht,2)?> DT <?php if($p['marque']): ?>· <?=e($p['marque'])?><?php endif; ?></div>
    </div>
    <?php endfor; endforeach; ?>
    </div>
    </body></html>
<?php
    exit;
}
