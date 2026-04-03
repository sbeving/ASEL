<?php
/**
 * ASEL Mobile — Carte des points de vente
 * Public page — no auth needed
 */
require_once 'config.php';
$franchises = db()->query("SELECT * FROM franchises WHERE actif=1 AND latitude IS NOT NULL")->fetchAll(PDO::FETCH_ASSOC);
?>
<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>ASEL Mobile — Nos points de vente en Tunisie | Franchises téléphonie</title>
    <meta name="description" content="Trouvez votre point de vente ASEL Mobile le plus proche en Tunisie. Smartphones, accessoires, réparations, recharges et forfaits internet.">
    <meta name="keywords" content="ASEL Mobile, téléphonie Tunisie, smartphones, accessoires téléphone, réparation téléphone, recharge mobile, franchise mobile Tunisie, Mourouj, Soukra">
    <meta property="og:title" content="ASEL Mobile — Nos points de vente">
    <meta property="og:description" content="Trouvez votre franchise ASEL Mobile la plus proche. Smartphones, accessoires, services techniques.">
    <meta property="og:type" content="website">
    <meta name="theme-color" content="#2AABE2">
    <link rel="canonical" href="https://asel.rf.gd/map.php">
    <script src="https://cdn.tailwindcss.com"></script>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800;900&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
    <script>tailwind.config={theme:{extend:{colors:{asel:'#2AABE2','asel-dark':'#1B3A5C'},fontFamily:{sans:['Inter']}}}}</script>
    <style>
        #map { height: 500px; border-radius: 12px; }
        @media (max-width: 768px) { #map { height: 350px; } }
    </style>
</head>
<body class="bg-gray-50 font-sans">
    <!-- Header -->
    <div class="bg-asel text-white py-4 px-6 text-center">
        <div class="text-3xl font-black tracking-wider"><span class="bg-gradient-to-r from-red-400 via-yellow-300 via-green-400 to-blue-300 bg-clip-text text-transparent">A</span>SEL MOBILE</div>
        <p class="text-white/80 text-sm mt-1">Trouvez votre point de vente le plus proche</p>
    </div>
    
    <div class="max-w-5xl mx-auto p-4">
        <!-- Map -->
        <div class="bg-white rounded-2xl shadow-lg overflow-hidden mb-6">
            <div id="map"></div>
        </div>
        
        <!-- Store list -->
        <div class="grid sm:grid-cols-2 gap-4">
            <?php foreach ($franchises as $f): ?>
            <div class="bg-white rounded-xl shadow-sm p-5 border-l-4 border-asel hover:shadow-md transition-shadow cursor-pointer"
                 onclick="map.setView([<?=$f['latitude']?>,<?=$f['longitude']?>], 16)">
                <h3 class="font-bold text-asel-dark flex items-center gap-2">
                    <svg class="w-5 h-5 text-asel" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z"/></svg>
                    <?= str_replace('ASEL Mobile — ', '', $f['nom']) ?>
                </h3>
                <p class="text-sm text-gray-500 mt-1">📍 <?=$f['adresse']?></p>
                <p class="text-sm text-gray-500">📞 <?=$f['telephone']?></p>
                <p class="text-sm text-gray-500">👤 <?=$f['responsable']?></p>
                <a href="https://www.google.com/maps/dir/?api=1&destination=<?=$f['latitude']?>,<?=$f['longitude']?>" target="_blank" class="inline-flex items-center gap-1 mt-2 text-asel text-sm font-semibold hover:underline">
                    🧭 Itinéraire
                </a>
            </div>
            <?php endforeach; ?>
        </div>
        
        <div class="text-center mt-6">
            <a href="login.php" class="text-asel hover:underline text-sm">🔐 Accès employés</a>
        </div>
    </div>
    
    <script>
        const map = L.map('map').setView([36.79, 10.17], 12);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap'
        }).addTo(map);
        
        const aselIcon = L.divIcon({
            html: '<div style="background:#2AABE2;color:white;width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:14px;box-shadow:0 2px 8px rgba(0,0,0,0.3);border:2px solid white">A</div>',
            className: '',
            iconSize: [32, 32],
            iconAnchor: [16, 16]
        });
        
        <?php foreach ($franchises as $f): if ($f['latitude']): ?>
        L.marker([<?=$f['latitude']?>, <?=$f['longitude']?>], {icon: aselIcon})
            .addTo(map)
            .bindPopup('<strong><?=addslashes(str_replace("ASEL Mobile — ","",$f["nom"]))?></strong><br><?=addslashes($f["adresse"])?><br>📞 <?=$f["telephone"]?><br><a href="https://www.google.com/maps/dir/?api=1&destination=<?=$f["latitude"]?>,<?=$f["longitude"]?>" target="_blank">🧭 Itinéraire</a>');
        <?php endif; endforeach; ?>
    </script>
</body>
</html>
