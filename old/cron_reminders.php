<?php
/**
 * ASEL Mobile — Cron: Check echeances & send reminders
 * Call daily via cron or manually: /cron_reminders.php?key=asel2024
 */
require_once 'config.php';

if (($_GET['key'] ?? '') !== 'asel2024') die('Unauthorized');

$pdo = db();
$today = date('Y-m-d');
$in7 = date('Y-m-d', strtotime('+7 days'));
$in3 = date('Y-m-d', strtotime('+3 days'));

// Mark overdue
$pdo->exec("UPDATE echeances SET statut='en_retard' WHERE statut='en_attente' AND date_echeance < '$today'");

// 7-day reminder
$echeances_7j = $pdo->query("SELECT e.*,c.nom as client_nom,c.telephone as client_tel,f.nom as franchise_nom 
    FROM echeances e JOIN clients c ON e.client_id=c.id JOIN franchises f ON e.franchise_id=f.id 
    WHERE e.statut='en_attente' AND e.date_echeance = '$in7' AND e.rappel_7j_envoye=0")->fetchAll(PDO::FETCH_ASSOC);

foreach ($echeances_7j as $e) {
    // Create notification for franchise
    $pdo->prepare("INSERT INTO notifications (franchise_id,titre,message,type_notif,lien) VALUES (?,?,?,?,?)")
        ->execute([$e['franchise_id'], 
            "⏰ Échéance dans 7 jours",
            "Client {$e['client_nom']} — {$e['montant']} DT — Échéance: {$e['date_echeance']}. Contactez-le!",
            'warning',
            "index.php?page=echeances"
        ]);
    $pdo->exec("UPDATE echeances SET rappel_7j_envoye=1 WHERE id={$e['id']}");
}

// 3-day reminder  
$echeances_3j = $pdo->query("SELECT e.*,c.nom as client_nom,c.telephone as client_tel,f.nom as franchise_nom 
    FROM echeances e JOIN clients c ON e.client_id=c.id JOIN franchises f ON e.franchise_id=f.id 
    WHERE e.statut='en_attente' AND e.date_echeance = '$in3' AND e.rappel_3j_envoye=0")->fetchAll(PDO::FETCH_ASSOC);

foreach ($echeances_3j as $e) {
    $pdo->prepare("INSERT INTO notifications (franchise_id,titre,message,type_notif,lien) VALUES (?,?,?,?,?)")
        ->execute([$e['franchise_id'],
            "🚨 Échéance dans 3 jours!",
            "URGENT: Client {$e['client_nom']} — {$e['montant']} DT — Échéance: {$e['date_echeance']}. Appelez le {$e['client_tel']}!",
            'danger',
            "index.php?page=echeances"
        ]);
    $pdo->exec("UPDATE echeances SET rappel_3j_envoye=1 WHERE id={$e['id']}");
}

// Overdue notifications
$overdue = $pdo->query("SELECT e.*,c.nom as client_nom FROM echeances e JOIN clients c ON e.client_id=c.id 
    WHERE e.statut='en_retard'")->fetchAll(PDO::FETCH_ASSOC);

// Monthly inventory reminder (1st of month)
if (date('d') === '01') {
    $prev_month = date('Y-m', strtotime('-1 month'));
    $franchises = $pdo->query("SELECT * FROM franchises WHERE actif=1")->fetchAll(PDO::FETCH_ASSOC);
    foreach ($franchises as $f) {
        $existing = $pdo->prepare("SELECT COUNT(*) FROM inventaires WHERE franchise_id=? AND mois=?");
        $existing->execute([$f['id'], $prev_month]);
        if ($existing->fetchColumn() == 0) {
            $pdo->prepare("INSERT INTO notifications (franchise_id,titre,message,type_notif,lien) VALUES (?,?,?,?,?)")
                ->execute([$f['id'],
                    "📋 Inventaire mensuel requis",
                    "Veuillez effectuer l'inventaire du mois de $prev_month.",
                    'warning',
                    "index.php?page=inventaire"
                ]);
        }
    }
}

echo json_encode([
    'reminders_7j' => count($echeances_7j),
    'reminders_3j' => count($echeances_3j),
    'overdue' => count($overdue),
]);
