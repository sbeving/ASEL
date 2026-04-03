<?php
/**
 * ASEL Mobile — Ticket de caisse (format thermique 80mm)
 */
require_once 'helpers.php';
requireLogin();

$id = intval($_GET['id'] ?? 0);
$f = queryOne("SELECT f.*,fr.nom as franchise_nom,fr.adresse as franchise_adresse,fr.telephone as franchise_tel,
               c.nom as client_nom,c.prenom as client_prenom,c.telephone as client_tel,
               u.nom_complet as vendeur
               FROM factures f JOIN franchises fr ON f.franchise_id=fr.id
               LEFT JOIN clients c ON f.client_id=c.id LEFT JOIN utilisateurs u ON f.utilisateur_id=u.id
               WHERE f.id=?", [$id]);
if (!$f) die('Facture non trouvée');

$lignes = query("SELECT * FROM facture_lignes WHERE facture_id=?", [$id]);
?>
<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Ticket <?=$f['numero']?></title>
    <style>
        @media print { body{margin:0;padding:0} .no-print{display:none} @page{margin:2mm;size:80mm auto} }
        * { font-family: 'Courier New', monospace; margin:0; padding:0; }
        body { width:80mm; margin:auto; padding:3mm; font-size:11px; }
        .center { text-align:center; }
        .bold { font-weight:bold; }
        .line { border-top:1px dashed #000; margin:4px 0; }
        .row { display:flex; justify-content:space-between; }
        .big { font-size:16px; font-weight:bold; }
        table { width:100%; }
        td { padding:1px 0; vertical-align:top; }
        .right { text-align:right; }
        .btn-print { position:fixed; bottom:20px; right:20px; background:#2AABE2; color:white; border:none; padding:15px 30px; border-radius:10px; font-weight:bold; cursor:pointer; font-size:16px; box-shadow:0 4px 12px rgba(0,0,0,0.3); z-index:100; }
    </style>
</head>
<body>
    <button class="btn-print no-print" onclick="window.print()">🖨️ Imprimer</button>
    
    <div class="center bold" style="font-size:14px">ASEL MOBILE</div>
    <div class="center" style="font-size:9px"><?=str_replace('ASEL Mobile — ','',$f['franchise_nom'])?></div>
    <div class="center" style="font-size:9px"><?=$f['franchise_adresse']?></div>
    <div class="center" style="font-size:9px">Tél: <?=$f['franchise_tel']?></div>
    
    <div class="line"></div>
    
    <div class="row"><span><?=strtoupper($f['type_facture'])?></span><span><?=$f['numero']?></span></div>
    <div class="row"><span><?=date('d/m/Y',strtotime($f['date_facture']))?></span><span><?=date('H:i',strtotime($f['date_facture']))?></span></div>
    <div>Vendeur: <?=$f['vendeur']?></div>
    <?php if($f['client_nom']): ?>
    <div>Client: <?=htmlspecialchars($f['client_nom'].' '.($f['client_prenom']??''))?></div>
    <?php endif; ?>
    
    <div class="line"></div>
    
    <table>
        <tr class="bold"><td>Article</td><td class="right">Qté</td><td class="right">P.U.</td><td class="right">Total</td></tr>
        <?php foreach($lignes as $l): ?>
        <tr>
            <td colspan="4" style="font-size:10px"><?=htmlspecialchars($l['designation'])?></td>
        </tr>
        <tr>
            <td></td>
            <td class="right"><?=$l['quantite']?></td>
            <td class="right"><?=number_format($l['prix_unitaire'],2)?></td>
            <td class="right bold"><?=number_format($l['total'],2)?></td>
        </tr>
        <?php if($l['remise']>0): ?>
        <tr><td colspan="3" style="font-size:9px">  Remise:</td><td class="right" style="font-size:9px">-<?=number_format($l['remise'],2)?></td></tr>
        <?php endif; ?>
        <?php endforeach; ?>
    </table>
    
    <div class="line"></div>
    
    <?php if($f['remise_totale']>0): ?>
    <div class="row"><span>Sous-total:</span><span><?=number_format($f['sous_total'],2)?> DT</span></div>
    <div class="row"><span>Remise:</span><span>-<?=number_format($f['remise_totale'],2)?> DT</span></div>
    <?php endif; ?>
    
    <div class="row big" style="margin:4px 0"><span>TOTAL</span><span><?=number_format($f['total_ttc'],2)?> DT</span></div>
    
    <div class="line"></div>
    
    <div class="row"><span>Paiement:</span><span><?=$f['mode_paiement']?></span></div>
    <?php if($f['mode_paiement']==='especes' && $f['montant_recu']>0): ?>
    <div class="row"><span>Reçu:</span><span><?=number_format($f['montant_recu'],2)?> DT</span></div>
    <div class="row bold"><span>Monnaie:</span><span><?=number_format($f['monnaie'],2)?> DT</span></div>
    <?php endif; ?>
    
    <div class="line"></div>
    
    <div class="center" style="font-size:9px;margin-top:4px">Merci de votre visite!</div>
    <div class="center" style="font-size:8px;color:#666">ASEL Mobile - Votre partenaire télécom</div>
    <div class="center" style="font-size:8px;color:#999;margin-top:4px"><?=date('d/m/Y H:i:s')?></div>
</body>
</html>
