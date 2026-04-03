"""
ASEL Mobile — Gestion de Stock Multi-Franchise
Base de données SQLite + Streamlit
"""
import sqlite3
import hashlib
import os

DB_PATH = os.path.join(os.path.dirname(__file__), "asel_stock.db")

def get_db():
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn

def init_db():
    conn = get_db()
    c = conn.cursor()
    
    # Utilisateurs
    c.execute("""
        CREATE TABLE IF NOT EXISTS utilisateurs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nom_utilisateur TEXT UNIQUE NOT NULL,
            mot_de_passe TEXT NOT NULL,
            nom_complet TEXT NOT NULL,
            role TEXT NOT NULL CHECK(role IN ('admin', 'franchise')),
            franchise_id INTEGER,
            actif INTEGER DEFAULT 1,
            date_creation TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (franchise_id) REFERENCES franchises(id)
        )
    """)
    
    # Franchises
    c.execute("""
        CREATE TABLE IF NOT EXISTS franchises (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nom TEXT UNIQUE NOT NULL,
            adresse TEXT,
            telephone TEXT,
            responsable TEXT,
            actif INTEGER DEFAULT 1,
            date_creation TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    
    # Catégories de produits
    c.execute("""
        CREATE TABLE IF NOT EXISTS categories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nom TEXT UNIQUE NOT NULL,
            description TEXT
        )
    """)
    
    # Produits
    c.execute("""
        CREATE TABLE IF NOT EXISTS produits (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nom TEXT NOT NULL,
            categorie_id INTEGER NOT NULL,
            prix_achat REAL DEFAULT 0,
            prix_vente REAL DEFAULT 0,
            reference TEXT,
            description TEXT,
            actif INTEGER DEFAULT 1,
            date_creation TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (categorie_id) REFERENCES categories(id)
        )
    """)
    
    # Stock par franchise
    c.execute("""
        CREATE TABLE IF NOT EXISTS stock (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            franchise_id INTEGER NOT NULL,
            produit_id INTEGER NOT NULL,
            quantite INTEGER DEFAULT 0,
            derniere_maj TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (franchise_id) REFERENCES franchises(id),
            FOREIGN KEY (produit_id) REFERENCES produits(id),
            UNIQUE(franchise_id, produit_id)
        )
    """)
    
    # Mouvements de stock (entrées/sorties)
    c.execute("""
        CREATE TABLE IF NOT EXISTS mouvements (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            franchise_id INTEGER NOT NULL,
            produit_id INTEGER NOT NULL,
            type_mouvement TEXT NOT NULL CHECK(type_mouvement IN ('entree', 'sortie', 'vente', 'ajustement')),
            quantite INTEGER NOT NULL,
            prix_unitaire REAL DEFAULT 0,
            note TEXT,
            utilisateur_id INTEGER,
            date_mouvement TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (franchise_id) REFERENCES franchises(id),
            FOREIGN KEY (produit_id) REFERENCES produits(id),
            FOREIGN KEY (utilisateur_id) REFERENCES utilisateurs(id)
        )
    """)
    
    # Ventes journalières
    c.execute("""
        CREATE TABLE IF NOT EXISTS ventes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            franchise_id INTEGER NOT NULL,
            produit_id INTEGER NOT NULL,
            quantite INTEGER NOT NULL,
            prix_unitaire REAL NOT NULL,
            prix_total REAL NOT NULL,
            date_vente DATE DEFAULT (date('now')),
            utilisateur_id INTEGER,
            note TEXT,
            date_creation TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (franchise_id) REFERENCES franchises(id),
            FOREIGN KEY (produit_id) REFERENCES produits(id),
            FOREIGN KEY (utilisateur_id) REFERENCES utilisateurs(id)
        )
    """)
    
    conn.commit()
    
    # Seed data si vide
    if c.execute("SELECT COUNT(*) FROM franchises").fetchone()[0] == 0:
        _seed_data(conn)
    
    conn.close()

def _seed_data(conn):
    c = conn.cursor()
    
    # Franchises
    franchises = [
        ("ASEL Mobile — Tunis Centre", "Avenue Habib Bourguiba, Tunis", "+216 71 123 456", "Ahmed Ben Ali"),
        ("ASEL Mobile — Sfax", "Route de Tunis, Sfax", "+216 74 234 567", "Mohamed Trabelsi"),
        ("ASEL Mobile — Sousse", "Boulevard 14 Janvier, Sousse", "+216 73 345 678", "Fatma Bouazizi"),
        ("ASEL Mobile — Nabeul", "Avenue Habib Thameur, Nabeul", "+216 72 456 789", "Karim Jebali"),
        ("ASEL Mobile — Bizerte", "Rue de la République, Bizerte", "+216 72 567 890", "Sana Mansouri"),
    ]
    c.executemany("INSERT INTO franchises (nom, adresse, telephone, responsable) VALUES (?, ?, ?, ?)", franchises)
    
    # Catégories
    categories = [
        ("Téléphones", "Smartphones et téléphones portables"),
        ("Coques & Protections", "Coques, étuis et protections d'écran"),
        ("Écouteurs & Casques", "Écouteurs filaires, sans fil et casques"),
        ("Enceintes", "Enceintes Bluetooth et portables"),
        ("Chargeurs & Câbles", "Chargeurs, câbles et batteries externes"),
        ("Accessoires", "Autres accessoires (supports, cartes mémoire, etc.)"),
    ]
    c.executemany("INSERT INTO categories (nom, description) VALUES (?, ?)", categories)
    
    # Produits exemples
    produits = [
        ("Samsung Galaxy A15", 1, 450, 599, "SM-A155F"),
        ("Samsung Galaxy A25", 1, 650, 849, "SM-A256B"),
        ("iPhone 15", 1, 2800, 3499, "IPHONE15-128"),
        ("Xiaomi Redmi Note 13", 1, 500, 699, "RN13-128"),
        ("Coque Samsung A15", 2, 15, 35, "COQ-A15"),
        ("Coque iPhone 15", 2, 20, 45, "COQ-IP15"),
        ("Protection écran Samsung", 2, 8, 20, "PE-SAM"),
        ("Protection écran iPhone", 2, 10, 25, "PE-IP"),
        ("AirPods Pro 2", 3, 600, 849, "APP2"),
        ("Samsung Galaxy Buds FE", 3, 200, 299, "SGB-FE"),
        ("Écouteurs filaires USB-C", 3, 15, 35, "EC-USBC"),
        ("JBL Flip 6", 4, 250, 399, "JBL-F6"),
        ("JBL Go 3", 4, 80, 129, "JBL-G3"),
        ("Chargeur rapide 25W", 5, 25, 49, "CHR-25W"),
        ("Câble USB-C 1m", 5, 8, 20, "CAB-USBC"),
        ("Batterie externe 10000mAh", 5, 45, 79, "BAT-10K"),
        ("Support voiture", 6, 15, 35, "SUP-VOI"),
        ("Carte mémoire 64Go", 6, 20, 39, "CM-64"),
    ]
    c.executemany("INSERT INTO produits (nom, categorie_id, prix_achat, prix_vente, reference) VALUES (?, ?, ?, ?, ?)", produits)
    
    # Admin par défaut
    admin_pass = hashlib.sha256("admin2024".encode()).hexdigest()
    c.execute("INSERT INTO utilisateurs (nom_utilisateur, mot_de_passe, nom_complet, role) VALUES (?, ?, ?, ?)",
              ("admin", admin_pass, "Administrateur", "admin"))
    
    # Comptes franchise
    for i in range(1, 6):
        pwd = hashlib.sha256(f"franchise{i}".encode()).hexdigest()
        c.execute("INSERT INTO utilisateurs (nom_utilisateur, mot_de_passe, nom_complet, role, franchise_id) VALUES (?, ?, ?, ?, ?)",
                  (f"franchise{i}", pwd, f"Gérant Franchise {i}", "franchise", i))
    
    # Stock initial
    import random
    for franchise_id in range(1, 6):
        for produit_id in range(1, 19):
            qty = random.randint(5, 50)
            c.execute("INSERT INTO stock (franchise_id, produit_id, quantite) VALUES (?, ?, ?)",
                      (franchise_id, produit_id, qty))
    
    conn.commit()

# --- Fonctions utilitaires ---

def hash_password(password):
    return hashlib.sha256(password.encode()).hexdigest()

def verify_user(username, password):
    conn = get_db()
    user = conn.execute(
        "SELECT * FROM utilisateurs WHERE nom_utilisateur = ? AND mot_de_passe = ? AND actif = 1",
        (username, hash_password(password))
    ).fetchone()
    conn.close()
    return dict(user) if user else None

def get_franchises(actif_only=True):
    conn = get_db()
    q = "SELECT * FROM franchises" + (" WHERE actif = 1" if actif_only else "")
    rows = conn.execute(q).fetchall()
    conn.close()
    return [dict(r) for r in rows]

def get_categories():
    conn = get_db()
    rows = conn.execute("SELECT * FROM categories ORDER BY nom").fetchall()
    conn.close()
    return [dict(r) for r in rows]

def get_produits(categorie_id=None, actif_only=True):
    conn = get_db()
    q = "SELECT p.*, c.nom as categorie_nom FROM produits p JOIN categories c ON p.categorie_id = c.id"
    params = []
    conditions = []
    if actif_only:
        conditions.append("p.actif = 1")
    if categorie_id:
        conditions.append("p.categorie_id = ?")
        params.append(categorie_id)
    if conditions:
        q += " WHERE " + " AND ".join(conditions)
    q += " ORDER BY c.nom, p.nom"
    rows = conn.execute(q, params).fetchall()
    conn.close()
    return [dict(r) for r in rows]

def get_stock(franchise_id=None):
    conn = get_db()
    q = """
        SELECT s.*, p.nom as produit_nom, p.prix_vente, p.prix_achat, p.reference,
               c.nom as categorie_nom, f.nom as franchise_nom
        FROM stock s
        JOIN produits p ON s.produit_id = p.id
        JOIN categories c ON p.categorie_id = c.id
        JOIN franchises f ON s.franchise_id = f.id
        WHERE p.actif = 1
    """
    params = []
    if franchise_id:
        q += " AND s.franchise_id = ?"
        params.append(franchise_id)
    q += " ORDER BY f.nom, c.nom, p.nom"
    rows = conn.execute(q, params).fetchall()
    conn.close()
    return [dict(r) for r in rows]

def update_stock(franchise_id, produit_id, quantite, type_mouvement, prix_unitaire=0, note="", utilisateur_id=None):
    conn = get_db()
    c = conn.cursor()
    
    # Enregistrer le mouvement
    c.execute("""
        INSERT INTO mouvements (franchise_id, produit_id, type_mouvement, quantite, prix_unitaire, note, utilisateur_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    """, (franchise_id, produit_id, type_mouvement, quantite, prix_unitaire, note, utilisateur_id))
    
    # Mettre à jour le stock
    if type_mouvement in ('entree', 'ajustement'):
        c.execute("""
            INSERT INTO stock (franchise_id, produit_id, quantite, derniere_maj)
            VALUES (?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(franchise_id, produit_id)
            DO UPDATE SET quantite = quantite + ?, derniere_maj = CURRENT_TIMESTAMP
        """, (franchise_id, produit_id, quantite, quantite))
    elif type_mouvement in ('sortie', 'vente'):
        c.execute("""
            UPDATE stock SET quantite = quantite - ?, derniere_maj = CURRENT_TIMESTAMP
            WHERE franchise_id = ? AND produit_id = ?
        """, (quantite, franchise_id, produit_id))
    
    conn.commit()
    conn.close()

def enregistrer_vente(franchise_id, produit_id, quantite, prix_unitaire, utilisateur_id=None, note=""):
    conn = get_db()
    c = conn.cursor()
    
    prix_total = quantite * prix_unitaire
    
    # Enregistrer la vente
    c.execute("""
        INSERT INTO ventes (franchise_id, produit_id, quantite, prix_unitaire, prix_total, utilisateur_id, note)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    """, (franchise_id, produit_id, quantite, prix_unitaire, prix_total, utilisateur_id, note))
    
    # Mouvement de stock
    c.execute("""
        INSERT INTO mouvements (franchise_id, produit_id, type_mouvement, quantite, prix_unitaire, note, utilisateur_id)
        VALUES (?, ?, 'vente', ?, ?, ?, ?)
    """, (franchise_id, produit_id, quantite, prix_unitaire, note, utilisateur_id))
    
    # Décrémenter le stock
    c.execute("""
        UPDATE stock SET quantite = quantite - ?, derniere_maj = CURRENT_TIMESTAMP
        WHERE franchise_id = ? AND produit_id = ?
    """, (quantite, franchise_id, produit_id))
    
    conn.commit()
    conn.close()
    return prix_total

def get_ventes(franchise_id=None, date_debut=None, date_fin=None):
    conn = get_db()
    q = """
        SELECT v.*, p.nom as produit_nom, p.reference, c.nom as categorie_nom, 
               f.nom as franchise_nom, u.nom_complet as vendeur
        FROM ventes v
        JOIN produits p ON v.produit_id = p.id
        JOIN categories c ON p.categorie_id = c.id
        JOIN franchises f ON v.franchise_id = f.id
        LEFT JOIN utilisateurs u ON v.utilisateur_id = u.id
        WHERE 1=1
    """
    params = []
    if franchise_id:
        q += " AND v.franchise_id = ?"
        params.append(franchise_id)
    if date_debut:
        q += " AND v.date_vente >= ?"
        params.append(str(date_debut))
    if date_fin:
        q += " AND v.date_vente <= ?"
        params.append(str(date_fin))
    q += " ORDER BY v.date_creation DESC"
    rows = conn.execute(q, params).fetchall()
    conn.close()
    return [dict(r) for r in rows]

def get_mouvements(franchise_id=None, limit=50):
    conn = get_db()
    q = """
        SELECT m.*, p.nom as produit_nom, f.nom as franchise_nom, u.nom_complet as utilisateur_nom
        FROM mouvements m
        JOIN produits p ON m.produit_id = p.id
        JOIN franchises f ON m.franchise_id = f.id
        LEFT JOIN utilisateurs u ON m.utilisateur_id = u.id
        WHERE 1=1
    """
    params = []
    if franchise_id:
        q += " AND m.franchise_id = ?"
        params.append(franchise_id)
    q += " ORDER BY m.date_mouvement DESC LIMIT ?"
    params.append(limit)
    rows = conn.execute(q, params).fetchall()
    conn.close()
    return [dict(r) for r in rows]

def get_alertes_stock(seuil=5, franchise_id=None):
    conn = get_db()
    q = """
        SELECT s.*, p.nom as produit_nom, p.reference, c.nom as categorie_nom, f.nom as franchise_nom
        FROM stock s
        JOIN produits p ON s.produit_id = p.id
        JOIN categories c ON p.categorie_id = c.id
        JOIN franchises f ON s.franchise_id = f.id
        WHERE s.quantite <= ? AND p.actif = 1
    """
    params = [seuil]
    if franchise_id:
        q += " AND s.franchise_id = ?"
        params.append(franchise_id)
    q += " ORDER BY s.quantite ASC"
    rows = conn.execute(q, params).fetchall()
    conn.close()
    return [dict(r) for r in rows]

def get_stats_globales():
    conn = get_db()
    stats = {}
    
    stats['total_produits'] = conn.execute("SELECT COUNT(*) FROM produits WHERE actif=1").fetchone()[0]
    stats['total_franchises'] = conn.execute("SELECT COUNT(*) FROM franchises WHERE actif=1").fetchone()[0]
    stats['stock_total'] = conn.execute("SELECT COALESCE(SUM(quantite), 0) FROM stock").fetchone()[0]
    stats['valeur_stock'] = conn.execute("""
        SELECT COALESCE(SUM(s.quantite * p.prix_vente), 0) 
        FROM stock s JOIN produits p ON s.produit_id = p.id
    """).fetchone()[0]
    stats['ventes_aujourdhui'] = conn.execute("""
        SELECT COALESCE(SUM(prix_total), 0) FROM ventes WHERE date_vente = date('now')
    """).fetchone()[0]
    stats['ventes_ce_mois'] = conn.execute("""
        SELECT COALESCE(SUM(prix_total), 0) FROM ventes 
        WHERE strftime('%Y-%m', date_vente) = strftime('%Y-%m', 'now')
    """).fetchone()[0]
    stats['alertes_stock'] = conn.execute("""
        SELECT COUNT(*) FROM stock s JOIN produits p ON s.produit_id = p.id 
        WHERE s.quantite <= 5 AND p.actif = 1
    """).fetchone()[0]
    
    conn.close()
    return stats

# Gestion utilisateurs (admin)
def ajouter_utilisateur(nom_utilisateur, mot_de_passe, nom_complet, role, franchise_id=None):
    conn = get_db()
    try:
        conn.execute(
            "INSERT INTO utilisateurs (nom_utilisateur, mot_de_passe, nom_complet, role, franchise_id) VALUES (?, ?, ?, ?, ?)",
            (nom_utilisateur, hash_password(mot_de_passe), nom_complet, role, franchise_id)
        )
        conn.commit()
        conn.close()
        return True
    except sqlite3.IntegrityError:
        conn.close()
        return False

def ajouter_produit(nom, categorie_id, prix_achat, prix_vente, reference="", description=""):
    conn = get_db()
    c = conn.cursor()
    c.execute(
        "INSERT INTO produits (nom, categorie_id, prix_achat, prix_vente, reference, description) VALUES (?, ?, ?, ?, ?, ?)",
        (nom, categorie_id, prix_achat, prix_vente, reference, description)
    )
    produit_id = c.lastrowid
    # Initialiser le stock à 0 dans chaque franchise
    franchises = conn.execute("SELECT id FROM franchises WHERE actif=1").fetchall()
    for f in franchises:
        conn.execute("INSERT OR IGNORE INTO stock (franchise_id, produit_id, quantite) VALUES (?, ?, 0)", (f['id'], produit_id))
    conn.commit()
    conn.close()
    return produit_id

def ajouter_franchise(nom, adresse="", telephone="", responsable=""):
    conn = get_db()
    try:
        c = conn.cursor()
        c.execute(
            "INSERT INTO franchises (nom, adresse, telephone, responsable) VALUES (?, ?, ?, ?)",
            (nom, adresse, telephone, responsable)
        )
        franchise_id = c.lastrowid
        # Initialiser le stock à 0 pour tous les produits
        produits = conn.execute("SELECT id FROM produits WHERE actif=1").fetchall()
        for p in produits:
            conn.execute("INSERT OR IGNORE INTO stock (franchise_id, produit_id, quantite) VALUES (?, ?, 0)", (franchise_id, p['id']))
        conn.commit()
        conn.close()
        return franchise_id
    except sqlite3.IntegrityError:
        conn.close()
        return None
