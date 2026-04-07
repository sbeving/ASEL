<?php
/**
 * ASEL Mobile — Carte des points de vente
 * Employee-only page — requires authentication
 */
require_once 'helpers.php';
requireLogin();

// Only show retail franchises (not Stock Central)
try {
    $franchises = query("SELECT * FROM franchises WHERE actif=1 AND latitude IS NOT NULL AND (type_franchise='point_de_vente' OR type_franchise IS NULL)");
} catch(Exception $e) {
    $franchises = query("SELECT * FROM franchises WHERE actif=1 AND latitude IS NOT NULL");
}
$user = currentUser();
?>
<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>ASEL Mobile — Carte des franchises</title>
    <meta name="robots" content="noindex, nofollow">
    <meta name="theme-color" content="#2AABE2">
    <script src="https://cdn.tailwindcss.com"></script>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
    <link href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css" rel="stylesheet">
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
    <script>tailwind.config={theme:{extend:{colors:{asel:'#2AABE2','asel-dark':'#1B3A5C','asel-light':'#F0F8FF'},fontFamily:{sans:['Inter','sans-serif']}}}}</script>
    <style>
        #map { height: 450px; }
        @media (min-width: 768px) { #map { height: 500px; border-radius: 12px; } }
        .store-card:hover { transform: translateY(-2px); box-shadow: 0 8px 25px rgba(0,0,0,0.1); }
        .store-card { transition: transform 0.2s, box-shadow 0.2s; }
    </style>
</head>
<body class="bg-gray-50 font-sans">
    <!-- Header -->
    <header class="bg-gradient-to-r from-asel-dark to-asel text-white">
        <div class="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
            <div>
                <div class="text-2xl font-black tracking-wider">
                    <span class="bg-gradient-to-r from-red-400 via-yellow-300 via-green-400 to-blue-300 bg-clip-text text-transparent">A</span>SEL MOBILE
                </div>
                <p class="text-white/60 text-xs mt-0.5">Carte des points de vente</p>
            </div>
            <div class="flex items-center gap-3">
                <span class="text-white/60 text-xs hidden sm:inline"><?=htmlspecialchars($user['nom_complet'])?></span>
                <a href="index.php" class="bg-white/10 hover:bg-white/20 backdrop-blur rounded-lg px-3 py-1.5 text-sm transition-colors">
                    <i class="bi bi-arrow-left"></i> Retour
                </a>
            </div>
        </div>
    </header>
    
    <div class="max-w-6xl mx-auto px-4 py-6">
        <!-- Map -->
        <div class="bg-white rounded-2xl shadow-lg overflow-hidden mb-6">
            <div id="map"></div>
        </div>
        
        <!-- Store list -->
        <div class="grid sm:grid-cols-2 gap-4">
            <?php foreach ($franchises as $f): 
                $shortName = str_replace(['ASEL Mobile — ', 'ASEL Mobile - '], '', $f['nom']);
                $horaires = $f['horaires'] ?? 'Lun-Sam: 09:00-19:00';
            ?>
            <div class="store-card bg-white rounded-xl shadow-sm p-5 border-l-4 border-asel cursor-pointer"
                 onclick="map.setView([<?=$f['latitude']?>,<?=$f['longitude']?>], 16)">
                <div class="flex items-start justify-between">
                    <div>
                        <h3 class="font-bold text-asel-dark text-lg flex items-center gap-2">
                            <i class="bi bi-shop text-asel"></i> <?=$shortName?>
                        </h3>
                        <div class="space-y-1 mt-2 text-sm text-gray-500">
                            <p class="flex items-center gap-2"><i class="bi bi-geo-alt text-asel"></i> <?=$f['adresse']?></p>
                            <?php if ($f['telephone']): ?>
                            <p class="flex items-center gap-2"><i class="bi bi-telephone text-asel"></i> <a href="tel:<?=$f['telephone']?>" class="text-asel hover:underline"><?=$f['telephone']?></a></p>
                            <?php endif; ?>
                            <p class="flex items-center gap-2"><i class="bi bi-clock text-asel"></i> <?=$horaires?></p>
                            <p class="flex items-center gap-2"><i class="bi bi-person text-asel"></i> <?=$f['responsable']?></p>
                        </div>
                    </div>
                    <a href="https://www.google.com/maps/dir/?api=1&destination=<?=$f['latitude']?>,<?=$f['longitude']?>" 
                       target="_blank" 
                       class="inline-flex items-center gap-1 bg-asel hover:bg-asel-dark text-white text-xs font-bold px-3 py-2 rounded-lg transition-colors shrink-0"
                       onclick="event.stopPropagation()">
                        <i class="bi bi-sign-turn-right-fill"></i> Itinéraire
                    </a>
                </div>
            </div>
            <?php endforeach; ?>
        </div>
        
        <?php if (empty($franchises)): ?>
        <div class="bg-white rounded-xl shadow-sm p-12 text-center">
            <i class="bi bi-geo-alt text-6xl text-gray-200"></i>
            <h3 class="font-bold text-asel-dark mt-4 text-lg">Aucun point de vente géolocalisé</h3>
            <p class="text-gray-400 text-sm mt-1">Ajoutez les coordonnées dans <a href="index.php?page=franchise_locations" class="text-asel hover:underline">Coordonnées</a>.</p>
        </div>
        <?php endif; ?>
    </div>
    
    <script>
        const map = L.map('map').setView([36.79, 10.17], 12);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; OpenStreetMap'
        }).addTo(map);
        
        const aselIcon = L.divIcon({
            html: '<div style="background:linear-gradient(135deg,#2AABE2,#1B3A5C);color:white;width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:15px;box-shadow:0 3px 10px rgba(0,0,0,0.3);border:3px solid white">A</div>',
            className: '', iconSize: [36, 36], iconAnchor: [18, 18]
        });
        
        const bounds = [];
        <?php foreach ($franchises as $f): if ($f['latitude']): 
            $shortName = addslashes(str_replace(['ASEL Mobile — ', 'ASEL Mobile - '], '', $f['nom']));
        ?>
        bounds.push([<?=$f['latitude']?>, <?=$f['longitude']?>]);
        L.marker([<?=$f['latitude']?>, <?=$f['longitude']?>], {icon: aselIcon})
            .addTo(map)
            .bindPopup('<div style="font-family:Inter,sans-serif"><strong style="color:#1B3A5C"><?=$shortName?></strong><br><span style="color:#666;font-size:12px"><?=addslashes($f['adresse'])?></span><br><?php if($f['telephone']): ?><span style="font-size:12px"><?=$f['telephone']?></span><br><?php endif; ?><a href="https://www.google.com/maps/dir/?api=1&destination=<?=$f['latitude']?>,<?=$f['longitude']?>" target="_blank" style="color:#2AABE2;font-size:12px;font-weight:bold">Itinéraire →</a></div>');
        <?php endif; endforeach; ?>
        
        if (bounds.length > 0) map.fitBounds(bounds, {padding: [40, 40]});
    </script>
</body>
</html>
