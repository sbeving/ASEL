<?php
// === SECURITY HEADERS ===
header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: DENY');
header('X-XSS-Protection: 1; mode=block');
header('Referrer-Policy: strict-origin-when-cross-origin');

ini_set('session.cookie_httponly', 1);
ini_set('session.cookie_samesite', 'Lax');
ini_set('session.use_strict_mode', 1);
session_start();
require_once 'config.php';
if (isset($_SESSION['user'])) { header('Location: index.php'); exit; }

// Rate limiting helper (inline since helpers.php requires login)
function loginRateCheck($ip, $max = 5, $window = 300) {
    $file = sys_get_temp_dir() . '/asel_login_' . md5($ip) . '.json';
    $now = time();
    $data = [];
    if (file_exists($file)) {
        $data = json_decode(@file_get_contents($file), true) ?: [];
        $data = array_filter($data, fn($t) => ($now - $t) < $window);
    }
    if (count($data) >= $max) return false;
    $data[] = $now;
    @file_put_contents($file, json_encode(array_values($data)));
    return true;
}
function loginRateClear($ip) {
    @unlink(sys_get_temp_dir() . '/asel_login_' . md5($ip) . '.json');
}

$error = '';
$rate_limited = false;

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $ip = $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0';
    
    // Rate limit: 5 attempts per 5 minutes per IP
    if (!loginRateCheck($ip)) {
        $error = "Trop de tentatives. Réessayez dans 5 minutes.";
        $rate_limited = true;
    } else {
        $u = trim($_POST['username'] ?? '');
        $p = $_POST['password'] ?? '';
        if ($u && $p) {
            $stmt = db()->prepare("SELECT * FROM utilisateurs WHERE nom_utilisateur = ? AND actif = 1");
            $stmt->execute([$u]);
            $user = $stmt->fetch(PDO::FETCH_ASSOC);
            if ($user && password_verify($p, $user['mot_de_passe'])) {
                // Session fixation protection
                session_regenerate_id(true);
                
                unset($user['mot_de_passe']);
                $_SESSION['user'] = $user;
                $_SESSION['csrf'] = bin2hex(random_bytes(32));
                $_SESSION['login_time'] = time();
                $_SESSION['ip'] = $ip;
                
                // Clear rate limit on success
                loginRateClear($ip);
                
                // Audit log
                try {
                    db()->prepare("INSERT INTO audit_logs (utilisateur_id, utilisateur_nom, action, details, ip_address, user_agent, franchise_id) VALUES (?,?,?,?,?,?,?)")->execute([
                        $user['id'], $user['nom_complet'], 'login', 'Connexion réussie',
                        $ip, substr($_SERVER['HTTP_USER_AGENT'] ?? '', 0, 255),
                        $user['franchise_id']
                    ]);
                } catch (Exception $e) {}
                header('Location: index.php');
                exit;
            }
        }
        $error = "Identifiants incorrects";
    }
}
?>
<!DOCTYPE html>
<html lang="fr" class="h-full">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>ASEL Mobile — Connexion | Gestion de Stock</title>
    <meta name="description" content="ASEL Mobile - Connexion au système de gestion de stock et point de vente">
    <meta name="theme-color" content="#2AABE2">
    <link rel="apple-touch-icon" sizes="180x180" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>📱</text></svg>">
    <script src="https://cdn.tailwindcss.com"></script>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
    <script>tailwind.config={theme:{extend:{colors:{asel:'#2AABE2','asel-dark':'#1B3A5C','asel-light':'#F0F8FF'},fontFamily:{sans:['Inter','sans-serif']}}}}</script>
</head>
<body class="h-full bg-gradient-to-br from-asel to-asel-dark flex items-center justify-center p-4 font-sans">
    <div class="w-full max-w-sm">
        <div class="bg-white rounded-2xl shadow-2xl overflow-hidden">
            <!-- Logo -->
            <div class="bg-asel px-6 py-8 text-center">
                <div class="text-4xl font-black text-white tracking-wider">
                    <span class="bg-gradient-to-r from-red-500 via-yellow-400 via-green-500 to-blue-400 bg-clip-text text-transparent">A</span>SEL
                </div>
                <div class="text-white/90 text-sm font-semibold tracking-[0.3em] mt-1">MOBILE</div>
            </div>
            
            <!-- Form -->
            <div class="p-6">
                <h2 class="text-center text-gray-500 text-sm font-medium mb-6">Gestion de Stock & Ventes</h2>
                
                <?php if ($error): ?>
                <div class="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm mb-4 flex items-center gap-2">
                    <svg class="w-5 h-5 shrink-0" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"/></svg>
                    <?= $error ?>
                </div>
                <?php endif; ?>
                
                <form method="POST" class="space-y-4">
                    <div>
                        <div class="relative">
                            <span class="absolute inset-y-0 left-0 pl-3 flex items-center text-gray-400">
                                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/></svg>
                            </span>
                            <input type="text" name="username" required autofocus
                                class="w-full pl-10 pr-4 py-3 border-2 border-gray-200 rounded-xl focus:border-asel focus:ring-2 focus:ring-asel/20 transition-all outline-none text-sm"
                                placeholder="Nom d'utilisateur">
                        </div>
                    </div>
                    <div>
                        <div class="relative">
                            <span class="absolute inset-y-0 left-0 pl-3 flex items-center text-gray-400">
                                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/></svg>
                            </span>
                            <input type="password" name="password" required
                                class="w-full pl-10 pr-4 py-3 border-2 border-gray-200 rounded-xl focus:border-asel focus:ring-2 focus:ring-asel/20 transition-all outline-none text-sm"
                                placeholder="Mot de passe">
                        </div>
                    </div>
                    <button type="submit" class="w-full bg-asel hover:bg-asel-dark text-white font-bold py-3 rounded-xl transition-all duration-200 transform hover:scale-[1.02] active:scale-[0.98] text-sm tracking-wide">
                        CONNEXION
                    </button>
                </form>
            </div>
        </div>
        <p class="text-center text-white/50 text-xs mt-4">© 2026 ASEL Mobile — Tous droits réservés</p>
    </div>
</body>
</html>
