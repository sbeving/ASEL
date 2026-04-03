<?php
/**
 * ASEL Mobile — Zero Trust RBAC Middleware
 * Every request goes through permission checks
 */
session_start();
require_once __DIR__ . '/config.php';

// === ROLE PERMISSIONS MATRIX ===
define('PERMISSIONS', [
    'admin' => [
        'dashboard', 'pos', 'stock', 'entree', 'transferts', 'demandes',
        'retours', 'cloture', 'ventes', 'rapports', 'produits', 'users',
        'franchises_mgmt', 'settings', 'clients', 'services', 'recharges', 'factures',
        'gestion_services', 'gestion_asel', 'echeances', 'inventaire', 'notifications', 'mon_compte',
        // Actions
        'vente', 'entree_stock', 'transfert', 'transfert_valider',
        'retour', 'cloture_submit', 'add_produit', 'edit_produit',
        'demande_produit', 'traiter_demande', 'edit_user', 'add_user',
        'dispatch', 'export', 'add_client', 'edit_client', 'add_service',
        'edit_service', 'add_asel_product', 'edit_asel_product',
        'vente_recharge', 'create_facture', 'pay_echeance', 'create_echeance', 'submit_inventaire', 'edit_client', 'cancel_facture', 'validate_cloture', 'validate_inventaire', 'add_category',
        // Scope
        'view_all_franchises', 'manage_users', 'manage_products',
    ],
    'gestionnaire' => [
        'dashboard', 'stock', 'entree', 'transferts', 'demandes',
        'ventes', 'rapports', 'dispatch', 'clients', 'services', 'recharges', 'factures',
        'echeances', 'inventaire', 'notifications', 'mon_compte',
        // Actions
        'entree_stock', 'transfert', 'transfert_valider',
        'traiter_demande', 'dispatch', 'export', 'add_client',
        'vente_recharge', 'create_facture', 'pay_echeance', 'create_echeance', 'submit_inventaire', 'edit_client', 'cancel_facture', 'validate_cloture', 'validate_inventaire', 'add_category',
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
        'cloture_submit', 'demande_produit', 'add_client',
        'vente_recharge', 'create_facture', 'pay_echeance', 'create_echeance', 'submit_inventaire', 'edit_client', 'cancel_facture', 'validate_cloture', 'validate_inventaire', 'add_category',
    ],
    'viewer' => [
        'dashboard', 'stock', 'ventes',
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
        die('<div style="text-align:center;padding:60px;font-family:Inter,sans-serif"><h1>🔒 Accès refusé</h1><p>Vous n\'avez pas la permission d\'accéder à cette page.</p><a href="index.php">← Retour</a></div>');
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
