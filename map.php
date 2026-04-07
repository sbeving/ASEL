<?php
/**
 * ASEL Mobile — Carte du réseau
 * Employee-only — shows all network points (franchises, activation, recharge)
 */
require_once 'helpers.php';
requireLogin();

// Load from points_reseau if available, fallback to franchises
try {
    $points = query("SELECT * FROM points_reseau WHERE actif=1 AND latitude IS NOT NULL AND longitude IS NOT NULL ORDER BY type_point, nom");
    $has_points_reseau = true;
} catch (Exception $e) {
    $has_points_reseau = false;
    try {
        $points = query("SELECT *, 'franchise' as type_point, 'actif' as statut FROM franchises WHERE actif=1 AND latitude IS NOT NULL AND (type_franchise='point_de_vente' OR type_franchise IS NULL)");
    } catch (Exception $e2) {
        $points = query("SELECT *, 'franchise' as type_point, 'actif' as statut FROM franchises WHERE actif=1 AND latitude IS NOT NULL");
    }
}

$user = currentUser();
$type_labels = ['franchise'=>'Franchise','activation'=>'Point d\'activation','recharge'=>'Point de recharge','activation_recharge'=>'Activation & Recharge'];
$type_colors = ['franchise'=>'#2AABE2','activation'=>'#10B981','recharge'=>'#F59E0B','activation_recharge'=>'#8B5CF6'];
$type_letters = ['franchise'=>'F','activation'=>'A','recharge'=>'R','activation_recharge'=>'AR'];
$statut_labels = ['prospect'=>'Prospect','contact'=>'Contacté','contrat_non_signe'=>'Contrat non signé','contrat_signe'=>'Contrat signé','actif'=>'Actif','suspendu'=>'Suspendu','resilie'=>'Résilié'];
?>
<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>ASEL Mobile — Carte du réseau</title>
    <meta name="robots" content="noindex, nofollow">
    <meta name="theme-color" content="#2AABE2">
    <script src="https://cdn.tailwindcss.com"></script>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
    <link href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css" rel="stylesheet">
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
    <script>tailwind.config={theme:{extend:{colors:{asel:'#2AABE2','asel-dark':'#1B3A5C','asel-light':'#F0F8FF'},fontFamily:{sans:['Inter','sans-serif']}}}}</script>
    <style>
        #map { height: calc(100vh - 120px); min-height: 400px; }
        .leaflet-pane, .leaflet-control, .leaflet-top, .leaflet-bottom { z-index: 1 !important; }
        .leaflet-container { z-index: 0 !important; position: relative; }
    </style>
</head>
<body class="bg-gray-50 font-sans h-screen">
    <!-- Header -->
    <header class="bg-gradient-to-r from-asel-dark to-asel text-white">
        <div class="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
            <div class="flex items-center gap-4">
                <div class="text-xl font-black tracking-wider">
                    <span class="bg-gradient-to-r from-red-400 via-yellow-300 via-green-400 to-blue-300 bg-clip-text text-transparent">A</span>SEL
                </div>
                <span class="text-white/50 text-sm hidden sm:inline">Carte du réseau</span>
            </div>
            <div class="flex items-center gap-2">
                <!-- Type filters -->
                <div class="hidden sm:flex gap-1">
                    <button onclick="toggleType('all')" class="px-2 py-1 rounded text-[10px] font-bold bg-white/20 text-white" id="btn_all">Tous</button>
                    <?php foreach ($type_labels as $tk => $tl): ?>
                    <button onclick="toggleType('<?=$tk?>')" class="px-2 py-1 rounded text-[10px] font-bold bg-white/10 text-white/60 hover:bg-white/20" id="btn_<?=$tk?>"><?=$tl?></button>
                    <?php endforeach; ?>
                </div>
                <span class="text-white/40 text-xs"><?=count($points)?> pts</span>
                <a href="index.php?page=points_reseau" class="bg-white/10 hover:bg-white/20 rounded-lg px-3 py-1.5 text-xs transition-colors"><i class="bi bi-list"></i> Liste</a>
                <a href="index.php" class="bg-white/10 hover:bg-white/20 rounded-lg px-3 py-1.5 text-xs transition-colors"><i class="bi bi-arrow-left"></i></a>
            </div>
        </div>
    </header>
    
    <!-- Full-width map -->
    <div id="map"></div>
    
    <!-- Legend bar -->
    <div class="bg-white border-t px-4 py-2 flex flex-wrap items-center justify-center gap-4 text-xs">
        <?php foreach ($type_labels as $tk => $tl): 
            $count = count(array_filter($points, fn($p) => $p['type_point'] === $tk));
            if ($count === 0) continue;
        ?>
        <div class="flex items-center gap-1.5">
            <span class="w-3 h-3 rounded-full inline-block" style="background:<?=$type_colors[$tk]?>"></span>
            <span class="font-medium"><?=$tl?></span>
            <span class="text-gray-400">(<?=$count?>)</span>
        </div>
        <?php endforeach; ?>
    </div>
    
    <script>
        const map = L.map('map').setView([36.4, 9.8], 7);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OSM' }).addTo(map);
        
        const typeColors = <?=json_encode($type_colors)?>;
        const typeLetters = <?=json_encode($type_letters)?>;
        const typeLabels = <?=json_encode($type_labels)?>;
        const statutLabels = <?=json_encode($statut_labels)?>;
        const markers = {};
        const allMarkers = [];
        const bounds = [];
        
        <?php foreach ($points as $pt): if (!$pt['latitude'] || !$pt['longitude']) continue; ?>
        (function(){
            const type = '<?=$pt['type_point']?>';
            const color = typeColors[type] || '#666';
            const letter = typeLetters[type] || '?';
            const icon = L.divIcon({
                html: '<div style="background:'+color+';color:white;width:30px;height:30px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:10px;box-shadow:0 2px 8px rgba(0,0,0,0.3);border:2px solid white;letter-spacing:-0.5px">'+letter+'</div>',
                className: '', iconSize: [30, 30], iconAnchor: [15, 15]
            });
            
            const m = L.marker([<?=$pt['latitude']?>, <?=$pt['longitude']?>], {icon})
                .addTo(map)
                .bindPopup(`<div style="font-family:Inter,sans-serif;min-width:200px">
                    <strong style="color:#1B3A5C;font-size:13px"><?=ejs($pt['nom'])?></strong>
                    <br><span style="font-size:11px;color:${color};font-weight:600">${typeLabels[type]||type}</span>
                    <span style="font-size:10px;background:#f3f4f6;padding:1px 6px;border-radius:4px;margin-left:4px">${statutLabels['<?=$pt['statut']?>']||'<?=$pt['statut']?>'}</span>
                    <?php if($pt['adresse']): ?><br><span style="font-size:11px;color:#666"><i class="bi bi-geo-alt"></i> <?=ejs($pt['adresse'])?></span><?php endif; ?>
                    <?php if($pt['telephone']): ?><br><span style="font-size:11px"><i class="bi bi-telephone"></i> <?=ejs($pt['telephone'])?></span><?php endif; ?>
                    <?php if($pt['responsable']): ?><br><span style="font-size:11px"><i class="bi bi-person"></i> <?=ejs($pt['responsable'])?></span><?php endif; ?>
                    <?php if($pt['notes_internes']): ?><br><span style="font-size:10px;color:#999;font-style:italic"><?=ejs(substr($pt['notes_internes'],0,80))?></span><?php endif; ?>
                    <br><a href="https://www.google.com/maps/dir/?api=1&destination=<?=$pt['latitude']?>,<?=$pt['longitude']?>" target="_blank" style="color:#2AABE2;font-size:11px;font-weight:600;text-decoration:none">Itinéraire →</a>
                </div>`);
            
            if (!markers[type]) markers[type] = [];
            markers[type].push(m);
            allMarkers.push(m);
            bounds.push([<?=$pt['latitude']?>, <?=$pt['longitude']?>]);
        })();
        <?php endforeach; ?>
        
        if (bounds.length > 0) map.fitBounds(bounds, {padding: [30, 30]});
        
        let activeFilter = 'all';
        function toggleType(type) {
            activeFilter = type;
            // Update button styles
            document.querySelectorAll('[id^="btn_"]').forEach(b => { b.className = 'px-2 py-1 rounded text-[10px] font-bold bg-white/10 text-white/60 hover:bg-white/20'; });
            document.getElementById('btn_' + type).className = 'px-2 py-1 rounded text-[10px] font-bold bg-white/20 text-white';
            
            // Show/hide markers
            if (type === 'all') {
                allMarkers.forEach(m => map.addLayer(m));
            } else {
                allMarkers.forEach(m => map.removeLayer(m));
                (markers[type] || []).forEach(m => map.addLayer(m));
            }
        }
    </script>
</body>
</html>
