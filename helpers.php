<?php
/**
 * ASEL Mobile — Zero Trust RBAC Middleware v2
 * Enhanced audit logging + Stock Central support
 */
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
        // Actions
        'vente', 'entree_stock', 'transfert', 'transfert_valider',
        'retour', 'cloture_submit', 'add_produit', 'edit_produit',
        'demande_produit', 'traiter_demande', 'edit_user', 'add_user',
        'dispatch', 'export', 'add_client', 'edit_client', 'add_service',
        'edit_service', 'add_asel_product', 'edit_asel_product',
        'vente_recharge', 'create_facture', 'pay_echeance', 'create_echeance',
        'submit_inventaire', 'cancel_facture', 'validate_cloture',
        'validate_inventaire', 'add_category', 'toggle_produit',
        'update_franchise_location', 'create_echeances_lot',
        'dispatch_stock', 'manage_central',
        // Scope
        'view_all_franchises', 'manage_users', 'manage_products',
    ],
    'gestionnaire' => [
        'dashboard', 'stock', 'stock_central', 'entree', 'transferts', 'demandes',
        'ventes', 'rapports', 'clients', 'services', 'recharges', 'factures',
        'echeances', 'inventaire', 'notifications', 'mon_compte',
        // Actions
        'entree_stock', 'transfert', 'transfert_valider',
        'traiter_demande', 'dispatch', 'dispatch_stock', 'export',
        'add_client', 'edit_client',
        'vente_recharge', 'create_facture', 'pay_echeance', 'create_echeance',
        'submit_inventaire', 'cancel_facture', 'validate_cloture',
        'validate_inventaire', 'add_category', 'create_echeances_lot',
        // Scope
        'view_all_franchises',
    ],
    'franchise' => [
        'dashboard', 'pos', 'stock', 'entree', 'demandes',
        'retours', 'cloture', 'ventes', 'transferts',
        'clients', 'services', 'recharges', 'factures',
        'echeances', 'inventaire', 'notifications', 'mon_compte',
        // Actions
        'vente', 'entree_stock', 'transfert', 'retour',
        'cloture_submit', 'demande_produit', 'add_client', 'edit_client',
        'vente_recharge', 'create_facture', 'pay_echeance', 'create_echeance',
        'submit_inventaire', 'validate_cloture', 'validate_inventaire',
        'add_category', 'create_echeances_lot',
    ],
    'viewer' => [
        'dashboard', 'stock', 'ventes', 'mon_compte', 'notifications',
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
        return $_GET['fid'] ?? null; // Admin/gestionnaire can filter
    }
    return currentFranchise(); // Franchise users locked to their own
}

// Get Stock Central franchise ID
function getCentralId() {
    static $id = null;
    if ($id === null) {
        $row = queryOne("SELECT id FROM franchises WHERE type_franchise='central' LIMIT 1");
        $id = $row ? $row['id'] : 0;
    }
    return $id;
}

// Get only point-de-vente franchises (exclude central)
function getRetailFranchises() {
    return query("SELECT * FROM franchises WHERE actif=1 AND (type_franchise='point_de_vente' OR type_franchise IS NULL) ORDER BY nom");
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
