<?php
/**
 * ASEL Mobile — Zero Trust RBAC Middleware v3
 * Security-hardened: XSS, SQLi, CSRF, session fixation, rate limiting
 */

// === SECURITY HEADERS ===
header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: DENY');
header('X-XSS-Protection: 1; mode=block');
header('Referrer-Policy: strict-origin-when-cross-origin');

// === SESSION CONFIG ===
ini_set('session.cookie_httponly', 1);
ini_set('session.cookie_samesite', 'Lax');
ini_set('session.use_strict_mode', 1);
if (isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] === 'on') {
    ini_set('session.cookie_secure', 1);
}
session_start();
require_once __DIR__ . '/config.php';

// === ROLE PERMISSIONS MATRIX ===
define('PERMISSIONS', [
    'admin' => [
        // Pages
        'dashboard', 'pos', 'stock', 'entree', 'transferts', 'demandes',
        'retours', 'cloture', 'ventes', 'rapports', 'produits', 'users',
        'franchises_mgmt', 'franchise_locations', 'audit_log', 'settings',
        'clients', 'services', 'recharges', 'factures',
        'gestion_services', 'gestion_asel', 'echeances', 'inventaire',
        'notifications', 'mon_compte', 'stock_central',
        'pointage', 'pointage_admin', 'import_phones',
        // Actions
        'vente', 'entree_stock', 'entree_multi_stock', 'transfert', 'transfert_valider',
        'retour', 'cloture_submit', 'add_produit', 'add_produit_v2', 'edit_produit', 'add_product_fournisseur', 'remove_product_fournisseur',
        'demande_produit', 'traiter_demande', 'edit_user', 'add_user',
        'dispatch', 'export', 'add_client', 'edit_client', 'add_service',
        'edit_service', 'add_asel_product', 'edit_asel_product',
        'vente_recharge', 'create_facture', 'pay_echeance', 'pay_facture', 'create_echeance',
        'submit_inventaire', 'cancel_facture', 'validate_cloture',
        'validate_inventaire', 'add_category', 'toggle_produit',
        'update_franchise_location', 'create_echeances_lot',
        'dispatch_stock', 'manage_central',
        'add_franchise', 'edit_franchise', 'delete_franchise',
        'points_reseau', 'add_point', 'edit_point', 'delete_point',
        'add_pointage', 'validate_pointage',
        'fournisseurs', 'add_fournisseur', 'edit_fournisseur',
        'bons_reception', 'create_bon_reception', 'edit_bon_reception', 'valider_bon_reception', 'validate_bon_reception', 'delete_bon_reception',
        'tresorerie', 'add_tresorerie', 'cloture_mensuelle',
        'familles_categories', 'add_famille', 'add_sous_categorie',
        // Scope
        'view_all_franchises', 'manage_users', 'manage_products',
    ],
    'gestionnaire' => [
        'dashboard', 'stock', 'stock_central', 'entree', 'transferts', 'demandes',
        'ventes', 'rapports', 'produits', 'clients', 'services', 'recharges', 'factures',
        'echeances', 'inventaire', 'notifications', 'mon_compte',
        'points_reseau', 'fournisseurs', 'bons_reception', 'tresorerie',
        'familles_categories',
        // Actions
        'vente', 'entree_stock', 'entree_multi_stock', 'transfert', 'transfert_valider',
        'traiter_demande', 'dispatch', 'dispatch_stock', 'export',
        'add_client', 'edit_client', 'add_produit', 'edit_produit',
        'add_fournisseur', 'edit_fournisseur',
        'create_bon_reception', 'valider_bon_reception',
        'add_tresorerie',
        'vente_recharge', 'create_facture', 'pay_echeance', 'pay_facture', 'create_echeance',
        'submit_inventaire', 'cancel_facture', 'validate_cloture',
        'validate_inventaire', 'add_category', 'create_echeances_lot',
        'manage_products',
        // Scope
        'view_all_franchises',
        'pointage', 'pointage_admin', 'add_pointage',
    ],
    'franchise' => [
        'dashboard', 'pos', 'stock', 'entree', 'demandes',
        'retours', 'cloture', 'ventes', 'transferts',
        'clients', 'services', 'recharges', 'factures',
        'echeances', 'inventaire', 'notifications', 'mon_compte',
        // Actions — franchise can ONLY sell, enter stock, and manage their own data
        'vente', 'entree_stock', 'entree_multi_stock', 'transfert', 'retour',
        'cloture_submit', 'demande_produit', 'add_client', 'edit_client',
        'vente_recharge', 'create_facture', 'pay_echeance', 'pay_facture', 'create_echeance',
        'submit_inventaire', 'validate_cloture', 'validate_inventaire',
        'create_echeances_lot',
        'pointage', 'add_pointage',
        // NOTE: franchise CANNOT: add_produit, edit_produit, add_category, manage_products, 
        // fournisseurs, bons_reception, tresorerie, produits page, rapports, users
    ],
    'vendeur' => [
        // Pages — POS + caisse only
        'pos', 'cloture', 'ventes', 'factures', 'mon_compte', 'notifications',
        'clients',
        // Actions — sell + basic client management
        'vente', 'add_client', 'create_facture',
        'vente_recharge', 'cloture_submit', 'create_echeances_lot',
        'pay_echeance', 'pay_facture',
        'pointage', 'add_pointage',
    ],
    'viewer' => [
        'dashboard', 'stock', 'ventes', 'mon_compte', 'notifications', 'pointage',
    ],
]);

function requireLogin() {
    if (!isset($_SESSION['user']) || !$_SESSION['user']['actif']) {
        header('Location: login.php');
        exit;
    }
}

function can($permission) {
    $role = $_SESSION['user']['role'] ?? '';
    return in_array($permission, PERMISSIONS[$role] ?? []);
}

function requirePermission($permission) {
    if (!can($permission)) {
        http_response_code(403);
        die('<div style="text-align:center;padding:60px;font-family:Inter,sans-serif"><h1 style="color:#E63946">🔒 Accès refusé</h1><p style="color:#666">Vous n\'avez pas la permission d\'accéder à cette ressource.</p><a href="index.php" style="color:#2AABE2">← Retour au tableau de bord</a></div>');
    }
}

function isAdmin() { return ($_SESSION['user']['role'] ?? '') === 'admin'; }
function isGestionnaire() { return ($_SESSION['user']['role'] ?? '') === 'gestionnaire'; }
function isAdminOrGest() { return isAdmin() || isGestionnaire(); }
function currentFranchise() { return $_SESSION['user']['franchise_id'] ?? null; }
function currentUser() { return $_SESSION['user'] ?? null; }
function userRole() { return $_SESSION['user']['role'] ?? ''; }

// Franchise scope: franchise users can ONLY see their own data
function scopedFranchiseId() {
    if (can('view_all_franchises')) {
        // If fid is passed in URL, save to session for persistence
        if (isset($_GET['fid'])) {
            $fid = $_GET['fid'];
            if ($fid === '' || $fid === '0' || $fid === 'all') {
                unset($_SESSION['admin_fid']); // Clear filter = show all
                return null;
            }
            $_SESSION['admin_fid'] = intval($fid);
            return intval($fid);
        }
        // Use session-stored franchise if available
        return $_SESSION['admin_fid'] ?? null;
    }
    return currentFranchise(); // Franchise users locked to their own
}

// Get Stock Central franchise ID
function getCentralId() {
    static $id = null;
    if ($id === null) {
        try {
            $row = queryOne("SELECT id FROM franchises WHERE type_franchise='central' LIMIT 1");
            $id = $row ? $row['id'] : 0;
        } catch (Exception $e) {
            // type_franchise column may not exist yet (pre-migration)
            $row = queryOne("SELECT id FROM franchises WHERE nom='Stock Central' LIMIT 1");
            $id = $row ? $row['id'] : 0;
        }
    }
    return $id;
}

// Get only point-de-vente franchises (exclude central)
function getRetailFranchises() {
    try {
        return query("SELECT * FROM franchises WHERE actif=1 AND (type_franchise='point_de_vente' OR type_franchise IS NULL) ORDER BY nom");
    } catch (Exception $e) {
        // type_franchise column may not exist yet (pre-migration)
        return query("SELECT * FROM franchises WHERE actif=1 AND nom!='Stock Central' ORDER BY nom");
    }
}

function query($sql, $params = []) {
    $stmt = db()->prepare($sql);
    $stmt->execute($params);
    return $stmt->fetchAll();
}
function queryOne($sql, $params = []) {
    $stmt = db()->prepare($sql);
    $stmt->execute($params);
    return $stmt->fetch();
}
function execute($sql, $params = []) {
    $stmt = db()->prepare($sql);
    return $stmt->execute($params);
}

// CSRF token
function csrfToken() {
    if (empty($_SESSION['csrf'])) $_SESSION['csrf'] = bin2hex(random_bytes(32));
    return $_SESSION['csrf'];
}
function verifyCsrf() {
    if (($_POST['_csrf'] ?? '') !== ($_SESSION['csrf'] ?? '')) {
        die('CSRF token invalid');
    }
}

// Role badge
function roleBadge($role) {
    return match($role) {
        'admin' => '<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800">Admin</span>',
        'gestionnaire' => '<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-yellow-100 text-yellow-800">Stock Central</span>',
        'franchise' => '<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">Franchise</span>',
        'vendeur' => '<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">Vendeur</span>',
        'viewer' => '<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-800">Viewer</span>',
        default => '<span class="badge bg-secondary">'.$role.'</span>',
    };
}

// Short franchise name
function shortF($name) { return str_replace(['ASEL Mobile — ', 'ASEL Mobile - '], '', $name); }

// === AUDIT LOGGING (Enhanced) ===
function auditLog($action, $cible = null, $cible_id = null, $details = null) {
    $user = currentUser();
    if (!$user) return;
    try {
        execute("INSERT INTO audit_logs (utilisateur_id, utilisateur_nom, action, cible, cible_id, details, ip_address, user_agent, franchise_id) VALUES (?,?,?,?,?,?,?,?,?)", [
            $user['id'],
            $user['nom_complet'],
            $action,
            $cible,
            $cible_id,
            is_array($details) ? json_encode($details, JSON_UNESCAPED_UNICODE) : $details,
            $_SERVER['REMOTE_ADDR'] ?? null,
            substr($_SERVER['HTTP_USER_AGENT'] ?? '', 0, 255),
            currentFranchise()
        ]);
    } catch (Exception $e) {
        // Silent fail — don't break the app for logging
    }
}

// === SECURITY UTILITIES ===

/**
 * Escape for HTML attribute context (data-*, title, value, etc.)
 */
function e($str) {
    return htmlspecialchars($str ?? '', ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

/**
 * Escape for JavaScript string context (inside single quotes)
 */
function ejs($str) {
    return str_replace(
        ["\\", "'", '"', "\n", "\r", "\t", "</"],
        ["\\\\", "\\'", '\\"', "\\n", "\\r", "\\t", "<\\/"],
        $str ?? ''
    );
}

/**
 * Sanitize integer input
 */
function intParam($key, $source = 'GET') {
    $val = $source === 'POST' ? ($_POST[$key] ?? 0) : ($_GET[$key] ?? 0);
    return intval($val);
}

/**
 * Sanitize string input (trim + limit length)
 */
function strParam($key, $maxLen = 255, $source = 'POST') {
    $val = $source === 'POST' ? ($_POST[$key] ?? '') : ($_GET[$key] ?? '');
    return mb_substr(trim($val), 0, $maxLen);
}

/**
 * Rate limit check (simple file-based for free hosting)
 */
function checkRateLimit($key, $maxAttempts = 5, $windowSeconds = 300) {
    $file = sys_get_temp_dir() . '/asel_rate_' . md5($key) . '.json';
    $now = time();
    $data = [];
    
    if (file_exists($file)) {
        $data = json_decode(file_get_contents($file), true) ?: [];
        // Clean old entries
        $data = array_filter($data, fn($t) => ($now - $t) < $windowSeconds);
    }
    
    if (count($data) >= $maxAttempts) {
        return false; // Rate limited
    }
    
    $data[] = $now;
    @file_put_contents($file, json_encode($data));
    return true;
}

/**
 * Clear rate limit (on successful action)
 */
function clearRateLimit($key) {
    $file = sys_get_temp_dir() . '/asel_rate_' . md5($key) . '.json';
    @unlink($file);
}
