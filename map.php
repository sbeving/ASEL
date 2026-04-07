<?php
/**
 * ASEL Mobile — Carte des points de vente
 * PUBLIC page — customer-facing store locator, no auth needed
 */
require_once 'config.php';

// Only show retail franchises (not Stock Central)
try {
    $franchises = db()->query("SELECT * FROM franchises WHERE actif=1 AND latitude IS NOT NULL AND (type_franchise='point_de_vente' OR type_franchise IS NULL)")->fetchAll(PDO::FETCH_ASSOC);
} catch(Exception $e) {
    $franchises = db()->query("SELECT * FROM franchises WHERE actif=1 AND latitude IS NOT NULL")->fetchAll(PDO::FETCH_ASSOC);
}
?>
<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>ASEL Mobile — Nos points de vente en Tunisie | Smartphones, accessoires & services</title>
    <meta name="description" content="Trouvez votre point de vente ASEL Mobile le plus proche en Tunisie. Smartphones, accessoires, réparations, recharges et forfaits internet. Mourouj, Soukra et plus.">
    <meta name="keywords" content="ASEL Mobile, téléphonie Tunisie, smartphones, accessoires téléphone, réparation téléphone, recharge mobile, franchise mobile Tunisie, Mourouj, Soukra, Ben Arous, Ariana">
    <meta property="og:title" content="ASEL Mobile — Nos points de vente en Tunisie">
    <meta property="og:description" content="Trouvez votre franchise ASEL Mobile la plus proche. Smartphones, accessoires, services techniques, recharges et forfaits.">
    <meta property="og:type" content="website">
    <meta name="theme-color" content="#2AABE2">
    <link rel="canonical" href="https://asel.rf.gd/map.php">
    <script src="https://cdn.tailwindcss.com"></script>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
    <link href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css" rel="stylesheet">
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
    <script>tailwind.config={theme:{extend:{colors:{asel:'#2AABE2','asel-dark':'#1B3A5C','asel-light':'#F0F8FF'},fontFamily:{sans:['Inter','sans-serif']}}}}</script>
    <style>
        #map { height: 450px; border-radius: 0; }
        @media (min-width: 768px) { #map { height: 500px; border-radius: 12px; } }
        .store-card:hover { transform: translateY(-2px); box-shadow: 0 8px 25px rgba(0,0,0,0.1); }
        .store-card { transition: transform 0.2s, box-shadow 0.2s; }
    </style>
</head>
<body class="bg-gray-50 font-sans">
    <!-- Header -->
    <header class="bg-gradient-to-r from-asel-dark to-asel text-white">
        <div class="max-w-6xl mx-auto px-4 py-6 sm:py-8">
            <div class="flex items-center justify-between">
                <div>
                    <div class="text-3xl sm:text-4xl font-black tracking-wider">
                        <span class="bg-gradient-to-r from-red-400 via-yellow-300 via-green-400 to-blue-300 bg-clip-text text-transparent">A</span>SEL MOBILE
                    </div>
                    <p class="text-white/70 text-sm mt-1">Votre partenaire téléphonie en Tunisie</p>
                </div>
                <a href="tel:+21652123456" class="hidden sm:flex items-center gap-2 bg-white/10 hover:bg-white/20 backdrop-blur rounded-xl px-4 py-2 text-sm transition-colors">
                    <i class="bi bi-telephone-fill"></i> Nous appeler
                </a>
            </div>
        </div>
    </header>
    
    <!-- Hero section -->
    <section class="bg-asel-dark text-white py-8 sm:py-12">
        <div class="max-w-6xl mx-auto px-4 text-center">
            <h1 class="text-2xl sm:text-3xl font-black mb-2"><i class="bi bi-geo-alt-fill"></i> Trouvez votre magasin</h1>
            <p class="text-white/60 max-w-xl mx-auto text-sm sm:text-base">
                <?=count($franchises)?> point<?=count($franchises)>1?'s':''?> de vente à votre service. 
                Smartphones, accessoires, réparations et recharges mobiles.
            </p>
        </div>
    </section>
    
    <div class="max-w-6xl mx-auto px-4 py-6">
        <!-- Map -->
        <div class="bg-white rounded-2xl shadow-lg overflow-hidden mb-8">
            <div id="map"></div>
        </div>
        
        <!-- Services offered -->
        <div class="mb-8">
            <h2 class="text-lg font-bold text-asel-dark mb-4 text-center"><i class="bi bi-stars text-asel"></i> Nos services</h2>
            <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div class="bg-white rounded-xl p-4 text-center shadow-sm border border-gray-100">
                    <div class="w-10 h-10 bg-asel-light rounded-full flex items-center justify-center mx-auto mb-2"><i class="bi bi-phone text-asel text-lg"></i></div>
                    <h3 class="font-bold text-xs text-asel-dark">Smartphones</h3>
                    <p class="text-[10px] text-gray-400 mt-1">Samsung, iPhone, Xiaomi, Huawei...</p>
                </div>
                <div class="bg-white rounded-xl p-4 text-center shadow-sm border border-gray-100">
                    <div class="w-10 h-10 bg-blue-50 rounded-full flex items-center justify-center mx-auto mb-2"><i class="bi bi-headphones text-blue-500 text-lg"></i></div>
                    <h3 class="font-bold text-xs text-asel-dark">Accessoires</h3>
                    <p class="text-[10px] text-gray-400 mt-1">Coques, chargeurs, écouteurs, cables...</p>
                </div>
                <div class="bg-white rounded-xl p-4 text-center shadow-sm border border-gray-100">
                    <div class="w-10 h-10 bg-orange-50 rounded-full flex items-center justify-center mx-auto mb-2"><i class="bi bi-tools text-orange-500 text-lg"></i></div>
                    <h3 class="font-bold text-xs text-asel-dark">Réparation</h3>
                    <p class="text-[10px] text-gray-400 mt-1">Écran, batterie, carte mère...</p>
                </div>
                <div class="bg-white rounded-xl p-4 text-center shadow-sm border border-gray-100">
                    <div class="w-10 h-10 bg-green-50 rounded-full flex items-center justify-center mx-auto mb-2"><i class="bi bi-sim text-green-500 text-lg"></i></div>
                    <h3 class="font-bold text-xs text-asel-dark">Recharges & SIM</h3>
                    <p class="text-[10px] text-gray-400 mt-1">Forfaits internet, recharges ASEL</p>
                </div>
            </div>
        </div>
        
        <!-- Store list -->
        <h2 class="text-lg font-bold text-asel-dark mb-4"><i class="bi bi-shop text-asel"></i> Nos points de vente</h2>
        <div class="grid sm:grid-cols-2 gap-4 mb-8">
            <?php foreach ($franchises as $f): 
                $shortName = str_replace(['ASEL Mobile — ', 'ASEL Mobile - '], '', $f['nom']);
                $horaires = $f['horaires'] ?? 'Lun-Sam: 09:00-19:00';
                $services_list = $f['services_offerts'] ?? 'Smartphones, Accessoires, Réparations, Recharges';
            ?>
            <div class="store-card bg-white rounded-xl shadow-sm p-5 border-l-4 border-asel cursor-pointer"
                 onclick="map.setView([<?=$f['latitude']?>,<?=$f['longitude']?>], 16)">
                <div class="flex items-start justify-between">
                    <div>
                        <h3 class="font-bold text-asel-dark text-lg flex items-center gap-2">
                            <i class="bi bi-shop text-asel"></i>
                            <?=$shortName?>
                        </h3>
                        <div class="space-y-1.5 mt-3 text-sm text-gray-500">
                            <p class="flex items-center gap-2"><i class="bi bi-geo-alt text-asel"></i> <?=$f['adresse']?></p>
                            <?php if ($f['telephone']): ?>
                            <p class="flex items-center gap-2"><i class="bi bi-telephone text-asel"></i> <a href="tel:<?=$f['telephone']?>" class="text-asel hover:underline"><?=$f['telephone']?></a></p>
                            <?php endif; ?>
                            <p class="flex items-center gap-2"><i class="bi bi-clock text-asel"></i> <?=$horaires?></p>
                            <p class="flex items-center gap-2"><i class="bi bi-person text-asel"></i> <?=$f['responsable']?></p>
                        </div>
                    </div>
                    <div class="shrink-0 ml-4">
                        <a href="https://www.google.com/maps/dir/?api=1&destination=<?=$f['latitude']?>,<?=$f['longitude']?>" 
                           target="_blank" 
                           class="inline-flex items-center gap-1.5 bg-asel hover:bg-asel-dark text-white text-xs font-bold px-4 py-2.5 rounded-lg transition-colors"
                           onclick="event.stopPropagation()">
                            <i class="bi bi-sign-turn-right-fill"></i> Itinéraire
                        </a>
                    </div>
                </div>
                <?php if ($services_list): ?>
                <div class="mt-3 pt-3 border-t border-gray-100">
                    <div class="flex flex-wrap gap-1">
                        <?php foreach (explode(',', $services_list) as $svc): $svc = trim($svc); if (!$svc) continue; ?>
                        <span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-asel-light text-asel"><?=$svc?></span>
                        <?php endforeach; ?>
                    </div>
                </div>
                <?php endif; ?>
            </div>
            <?php endforeach; ?>
        </div>
        
        <?php if (empty($franchises)): ?>
        <div class="bg-white rounded-xl shadow-sm p-12 text-center">
            <i class="bi bi-geo-alt text-6xl text-gray-200"></i>
            <h3 class="font-bold text-asel-dark mt-4 text-lg">Aucun point de vente trouvé</h3>
            <p class="text-gray-400 text-sm mt-1">Nos magasins seront bientôt référencés.</p>
        </div>
        <?php endif; ?>
        
        <!-- Find nearest CTA -->
        <div class="bg-gradient-to-r from-asel-dark to-asel text-white rounded-2xl p-6 sm:p-8 text-center mb-8">
            <h2 class="text-xl font-black mb-2">Besoin d'un conseil ?</h2>
            <p class="text-white/70 text-sm mb-4">Nos conseillers sont à votre écoute dans tous nos points de vente.</p>
            <div class="flex flex-wrap gap-3 justify-center">
                <button onclick="findNearest()" class="bg-white text-asel-dark font-bold px-6 py-3 rounded-xl text-sm hover:bg-gray-100 transition-colors">
                    <i class="bi bi-crosshair"></i> Trouver le plus proche
                </button>
                <?php if (!empty($franchises) && $franchises[0]['telephone']): ?>
                <a href="tel:<?=$franchises[0]['telephone']?>" class="bg-white/10 backdrop-blur text-white font-bold px-6 py-3 rounded-xl text-sm hover:bg-white/20 transition-colors">
                    <i class="bi bi-telephone-fill"></i> Appeler
                </a>
                <?php endif; ?>
            </div>
            <p id="nearestResult" class="mt-3 text-sm hidden"></p>
        </div>
    </div>
    
    <!-- Footer -->
    <footer class="bg-asel-dark text-white/50 py-6">
        <div class="max-w-6xl mx-auto px-4 text-center text-xs">
            <p>&copy; <?=date('Y')?> ASEL Mobile — Tous droits réservés</p>
            <p class="mt-1">Téléphonie mobile, accessoires et services en Tunisie</p>
            <div class="mt-3">
                <a href="login.php" class="text-white/30 hover:text-white/60 transition-colors"><i class="bi bi-lock"></i> Espace employés</a>
            </div>
        </div>
    </footer>
    
    <script>
        const map = L.map('map').setView([36.79, 10.17], 12);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; OpenStreetMap'
        }).addTo(map);
        
        const aselIcon = L.divIcon({
            html: '<div style="background:linear-gradient(135deg,#2AABE2,#1B3A5C);color:white;width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:15px;box-shadow:0 3px 10px rgba(0,0,0,0.3);border:3px solid white">A</div>',
            className: '',
            iconSize: [36, 36],
            iconAnchor: [18, 18]
        });
        
        const stores = [];
        <?php foreach ($franchises as $f): if ($f['latitude']): 
            $shortName = addslashes(str_replace(['ASEL Mobile — ', 'ASEL Mobile - '], '', $f['nom']));
        ?>
        stores.push({lat:<?=$f['latitude']?>, lng:<?=$f['longitude']?>, name:'<?=$shortName?>'});
        L.marker([<?=$f['latitude']?>, <?=$f['longitude']?>], {icon: aselIcon})
            .addTo(map)
            .bindPopup(`
                <div style="font-family:Inter,sans-serif;min-width:180px">
                    <strong style="color:#1B3A5C;font-size:14px"><?=$shortName?></strong><br>
                    <span style="color:#666;font-size:12px"><?=addslashes($f['adresse'])?></span><br>
                    <?php if($f['telephone']): ?><span style="font-size:12px">📞 <?=$f['telephone']?></span><br><?php endif; ?>
                    <a href="https://www.google.com/maps/dir/?api=1&destination=<?=$f['latitude']?>,<?=$f['longitude']?>" 
                       target="_blank" style="color:#2AABE2;font-size:12px;font-weight:bold;text-decoration:none">
                       ➔ Itinéraire
                    </a>
                </div>
            `);
        <?php endif; endforeach; ?>
        
        // Fit map to show all markers
        if (stores.length > 0) {
            const bounds = L.latLngBounds(stores.map(s => [s.lat, s.lng]));
            map.fitBounds(bounds.pad(0.3));
        }
        
        // Find nearest store
        function findNearest() {
            const result = document.getElementById('nearestResult');
            if (!navigator.geolocation) {
                result.textContent = 'Géolocalisation non supportée';
                result.classList.remove('hidden');
                return;
            }
            result.textContent = 'Recherche de votre position...';
            result.classList.remove('hidden');
            
            navigator.geolocation.getCurrentPosition(pos => {
                const userLat = pos.coords.latitude;
                const userLng = pos.coords.longitude;
                
                // Add user marker
                L.marker([userLat, userLng], {
                    icon: L.divIcon({
                        html: '<div style="background:#E63946;color:white;width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:14px;box-shadow:0 2px 6px rgba(0,0,0,0.3);border:2px solid white">📍</div>',
                        className: '', iconSize: [28, 28], iconAnchor: [14, 14]
                    })
                }).addTo(map).bindPopup('Vous êtes ici');
                
                // Find closest
                let closest = null;
                let minDist = Infinity;
                stores.forEach(s => {
                    const d = Math.sqrt(Math.pow(s.lat - userLat, 2) + Math.pow(s.lng - userLng, 2));
                    if (d < minDist) { minDist = d; closest = s; }
                });
                
                if (closest) {
                    const distKm = (minDist * 111).toFixed(1); // rough conversion
                    result.textContent = `Le plus proche: ${closest.name} (~${distKm} km)`;
                    map.setView([closest.lat, closest.lng], 14);
                }
            }, err => {
                result.textContent = 'Impossible de vous localiser. Autorisez la géolocalisation.';
            }, { enableHighAccuracy: true, timeout: 10000 });
        }
    </script>
</body>
</html>
