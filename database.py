"""
ASEL Mobile — Gestion de Stock & POS v2.0
Base de données SQLite complète
"""
import sqlite3, hashlib, os, csv, io
from datetime import datetime, date

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "asel_stock.db")

def get_db():
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn

def init_db():
    conn = get_db()
    c = conn.cursor()

    c.executescript("""
    CREATE TABLE IF NOT EXISTS franchises (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nom TEXT UNIQUE NOT NULL,
        adresse TEXT, telephone TEXT, responsable TEXT,
        actif INTEGER DEFAULT 1,
        date_creation TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nom TEXT UNIQUE NOT NULL, description TEXT
    );
    CREATE TABLE IF NOT EXISTS fournisseurs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nom TEXT NOT NULL, telephone TEXT, email TEXT, adresse TEXT,
        actif INTEGER DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS produits (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nom TEXT NOT NULL, categorie_id INTEGER NOT NULL,
        prix_achat REAL DEFAULT 0, prix_vente REAL DEFAULT 0,
        reference TEXT, code_barre TEXT, description TEXT,
        fournisseur_id INTEGER,
        seuil_alerte INTEGER DEFAULT 5,
        actif INTEGER DEFAULT 1,
        date_creation TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (categorie_id) REFERENCES categories(id),
        FOREIGN KEY (fournisseur_id) REFERENCES fournisseurs(id)
    );
    CREATE TABLE IF NOT EXISTS utilisateurs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nom_utilisateur TEXT UNIQUE NOT NULL,
        mot_de_passe TEXT NOT NULL,
        nom_complet TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('admin','franchise','viewer')),
        franchise_id INTEGER,
        actif INTEGER DEFAULT 1,
        date_creation TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (franchise_id) REFERENCES franchises(id)
    );
    CREATE TABLE IF NOT EXISTS stock (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        franchise_id INTEGER NOT NULL, produit_id INTEGER NOT NULL,
        quantite INTEGER DEFAULT 0,
        derniere_maj TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(franchise_id, produit_id),
        FOREIGN KEY (franchise_id) REFERENCES franchises(id),
        FOREIGN KEY (produit_id) REFERENCES produits(id)
    );
    CREATE TABLE IF NOT EXISTS mouvements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        franchise_id INTEGER NOT NULL, produit_id INTEGER NOT NULL,
        type_mouvement TEXT NOT NULL,
        quantite INTEGER NOT NULL,
        prix_unitaire REAL DEFAULT 0, note TEXT,
        utilisateur_id INTEGER,
        date_mouvement TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (franchise_id) REFERENCES franchises(id),
        FOREIGN KEY (produit_id) REFERENCES produits(id)
    );
    CREATE TABLE IF NOT EXISTS ventes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        franchise_id INTEGER NOT NULL, produit_id INTEGER NOT NULL,
        quantite INTEGER NOT NULL,
        prix_unitaire REAL NOT NULL, prix_total REAL NOT NULL,
        remise REAL DEFAULT 0,
        date_vente DATE DEFAULT (date('now')),
        utilisateur_id INTEGER, note TEXT,
        date_creation TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (franchise_id) REFERENCES franchises(id),
        FOREIGN KEY (produit_id) REFERENCES produits(id)
    );
    CREATE TABLE IF NOT EXISTS transferts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        franchise_source INTEGER NOT NULL,
        franchise_dest INTEGER NOT NULL,
        produit_id INTEGER NOT NULL,
        quantite INTEGER NOT NULL,
        statut TEXT DEFAULT 'en_attente' CHECK(statut IN ('en_attente','accepte','rejete')),
        demandeur_id INTEGER,
        validateur_id INTEGER,
        note TEXT,
        date_demande TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        date_validation TIMESTAMP,
        FOREIGN KEY (franchise_source) REFERENCES franchises(id),
        FOREIGN KEY (franchise_dest) REFERENCES franchises(id),
        FOREIGN KEY (produit_id) REFERENCES produits(id)
    );
    CREATE TABLE IF NOT EXISTS clotures (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        franchise_id INTEGER NOT NULL,
        date_cloture DATE NOT NULL,
        total_ventes_declare REAL DEFAULT 0,
        total_articles_declare INTEGER DEFAULT 0,
        total_ventes_systeme REAL DEFAULT 0,
        total_articles_systeme INTEGER DEFAULT 0,
        commentaire TEXT,
        valide INTEGER DEFAULT 0,
        utilisateur_id INTEGER,
        validateur_id INTEGER,
        date_creation TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(franchise_id, date_cloture),
        FOREIGN KEY (franchise_id) REFERENCES franchises(id)
    );
    CREATE TABLE IF NOT EXISTS retours (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        franchise_id INTEGER NOT NULL, produit_id INTEGER NOT NULL,
        quantite INTEGER NOT NULL,
        type_retour TEXT DEFAULT 'retour' CHECK(type_retour IN ('retour','echange')),
        raison TEXT, note TEXT,
        utilisateur_id INTEGER,
        date_retour TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (franchise_id) REFERENCES franchises(id),
        FOREIGN KEY (produit_id) REFERENCES produits(id)
    );
    CREATE TABLE IF NOT EXISTS historique_prix (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        produit_id INTEGER NOT NULL,
        ancien_prix_achat REAL, nouveau_prix_achat REAL,
        ancien_prix_vente REAL, nouveau_prix_vente REAL,
        utilisateur_id INTEGER,
        date_changement TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (produit_id) REFERENCES produits(id)
    );
    CREATE TABLE IF NOT EXISTS dispatch (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        franchise_id INTEGER NOT NULL, produit_id INTEGER NOT NULL,
        quantite INTEGER NOT NULL,
        utilisateur_id INTEGER, note TEXT,
        date_dispatch TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (franchise_id) REFERENCES franchises(id),
        FOREIGN KEY (produit_id) REFERENCES produits(id)
    );
    """)
    conn.commit()
    if c.execute("SELECT COUNT(*) FROM franchises").fetchone()[0] == 0:
        _seed(conn)
    conn.close()

def _seed(conn):
    c = conn.cursor()
    franchises = [
        ("ASEL Mobile — Tunis Centre","Av. Habib Bourguiba, Tunis","+216 71 123 456","Ahmed Ben Ali"),
        ("ASEL Mobile — Sfax","Route de Tunis, Sfax","+216 74 234 567","Mohamed Trabelsi"),
        ("ASEL Mobile — Sousse","Bd 14 Janvier, Sousse","+216 73 345 678","Fatma Bouazizi"),
        ("ASEL Mobile — Nabeul","Av. Habib Thameur, Nabeul","+216 72 456 789","Karim Jebali"),
        ("ASEL Mobile — Bizerte","Rue de la République, Bizerte","+216 72 567 890","Sana Mansouri"),
    ]
    c.executemany("INSERT INTO franchises (nom,adresse,telephone,responsable) VALUES (?,?,?,?)", franchises)
    cats = [("Téléphones","Smartphones et téléphones"),("Coques & Protections","Coques, étuis, films"),
            ("Écouteurs & Casques","Filaires et Bluetooth"),("Enceintes","Bluetooth et portables"),
            ("Chargeurs & Câbles","Chargeurs, câbles, batteries"),("Accessoires","Supports, cartes mémoire, etc.")]
    c.executemany("INSERT INTO categories (nom,description) VALUES (?,?)", cats)
    c.execute("INSERT INTO fournisseurs (nom,telephone,email) VALUES (?,?,?)",("Fournisseur Général","+216 70 000 000","contact@fournisseur.tn"))
    produits = [
        ("Samsung Galaxy A15",1,450,599,"SM-A155F","8806095426280",1),
        ("Samsung Galaxy A25",1,650,849,"SM-A256B","8806095468123",1),
        ("iPhone 15",1,2800,3499,"IPHONE15-128","0194253396055",1),
        ("Xiaomi Redmi Note 13",1,500,699,"RN13-128","6941812756423",1),
        ("OPPO A18",1,380,499,"OPPO-A18","6932169086547",1),
        ("Coque Samsung A15",2,15,35,"COQ-A15","COQ-SAM-A15",1),
        ("Coque iPhone 15",2,20,45,"COQ-IP15","COQ-IP-15",1),
        ("Protection écran Samsung",2,8,20,"PE-SAM","PE-SAM-UNIV",1),
        ("Protection écran iPhone",2,10,25,"PE-IP","PE-IP-15",1),
        ("Coque Xiaomi RN13",2,12,30,"COQ-XRN13","COQ-XI-RN13",1),
        ("AirPods Pro 2",3,600,849,"APP2","0194253404026",1),
        ("Samsung Galaxy Buds FE",3,200,299,"SGB-FE","8806095170862",1),
        ("Écouteurs filaires USB-C",3,15,35,"EC-USBC","EC-USBC-GEN",1),
        ("JBL Tune 520BT",3,120,179,"JBL-T520","6925281978944",1),
        ("JBL Flip 6",4,250,399,"JBL-F6","6925281993152",1),
        ("JBL Go 3",4,80,129,"JBL-G3","6925281979415",1),
        ("Anker Soundcore Mini",4,60,99,"ANK-MINI","ANK-SC-MINI",1),
        ("Chargeur rapide 25W",5,25,49,"CHR-25W","CHR-25W-SAM",1),
        ("Chargeur rapide 65W",5,45,79,"CHR-65W","CHR-65W-GAN",1),
        ("Câble USB-C 1m",5,8,20,"CAB-USBC","CAB-USBC-1M",1),
        ("Câble Lightning 1m",5,12,25,"CAB-LTN","CAB-LTN-1M",1),
        ("Batterie externe 10000mAh",5,45,79,"BAT-10K","BAT-10K-ANK",1),
        ("Batterie externe 20000mAh",5,65,109,"BAT-20K","BAT-20K-ANK",1),
        ("Support voiture magnétique",6,15,35,"SUP-VOI","SUP-MAG-VOI",1),
        ("Carte mémoire 64Go",6,20,39,"CM-64","CM-SD-64",1),
        ("Carte mémoire 128Go",6,35,59,"CM-128","CM-SD-128",1),
    ]
    c.executemany("INSERT INTO produits (nom,categorie_id,prix_achat,prix_vente,reference,code_barre,fournisseur_id) VALUES (?,?,?,?,?,?,?)", produits)
    pwd = hashlib.sha256("admin2024".encode()).hexdigest()
    c.execute("INSERT INTO utilisateurs (nom_utilisateur,mot_de_passe,nom_complet,role) VALUES (?,?,?,?)",("admin",pwd,"Administrateur","admin"))
    for i in range(1,6):
        p = hashlib.sha256(f"franchise{i}".encode()).hexdigest()
        c.execute("INSERT INTO utilisateurs (nom_utilisateur,mot_de_passe,nom_complet,role,franchise_id) VALUES (?,?,?,?,?)",(f"franchise{i}",p,f"Gérant Franchise {i}","franchise",i))
    import random
    for fid in range(1,6):
        for pid in range(1,27):
            c.execute("INSERT INTO stock (franchise_id,produit_id,quantite) VALUES (?,?,?)",(fid,pid,random.randint(3,50)))
    conn.commit()

# === AUTH ===
def hash_pw(p): return hashlib.sha256(p.encode()).hexdigest()
def verify_user(u,p):
    conn=get_db(); r=conn.execute("SELECT * FROM utilisateurs WHERE nom_utilisateur=? AND mot_de_passe=? AND actif=1",(u,hash_pw(p))).fetchone(); conn.close()
    return dict(r) if r else None
def change_password(user_id, new_pw):
    conn=get_db(); conn.execute("UPDATE utilisateurs SET mot_de_passe=? WHERE id=?",(hash_pw(new_pw),user_id)); conn.commit(); conn.close()

# === FRANCHISES ===
def get_franchises(actif_only=True):
    conn=get_db(); q="SELECT * FROM franchises"+(" WHERE actif=1" if actif_only else ""); r=[dict(x) for x in conn.execute(q).fetchall()]; conn.close(); return r
def add_franchise(nom,adresse="",telephone="",responsable=""):
    conn=get_db()
    try:
        c=conn.cursor(); c.execute("INSERT INTO franchises (nom,adresse,telephone,responsable) VALUES (?,?,?,?)",(nom,adresse,telephone,responsable))
        fid=c.lastrowid
        for p in conn.execute("SELECT id FROM produits WHERE actif=1").fetchall():
            conn.execute("INSERT OR IGNORE INTO stock (franchise_id,produit_id,quantite) VALUES (?,?,0)",(fid,p['id']))
        conn.commit(); conn.close(); return fid
    except: conn.close(); return None
def update_franchise(fid,nom,adresse,telephone,responsable,actif):
    conn=get_db(); conn.execute("UPDATE franchises SET nom=?,adresse=?,telephone=?,responsable=?,actif=? WHERE id=?",(nom,adresse,telephone,responsable,actif,fid)); conn.commit(); conn.close()

# === CATEGORIES ===
def get_categories():
    conn=get_db(); r=[dict(x) for x in conn.execute("SELECT * FROM categories ORDER BY nom").fetchall()]; conn.close(); return r
def add_category(nom,desc=""):
    conn=get_db()
    try: conn.execute("INSERT INTO categories (nom,description) VALUES (?,?)",(nom,desc)); conn.commit(); conn.close(); return True
    except: conn.close(); return False

# === FOURNISSEURS ===
def get_fournisseurs():
    conn=get_db(); r=[dict(x) for x in conn.execute("SELECT * FROM fournisseurs WHERE actif=1").fetchall()]; conn.close(); return r
def add_fournisseur(nom,tel="",email="",adresse=""):
    conn=get_db(); conn.execute("INSERT INTO fournisseurs (nom,telephone,email,adresse) VALUES (?,?,?,?)",(nom,tel,email,adresse)); conn.commit(); conn.close()

# === PRODUITS ===
def get_produits(cat_id=None,actif_only=True):
    conn=get_db()
    q="SELECT p.*,c.nom as categorie_nom,f.nom as fournisseur_nom FROM produits p JOIN categories c ON p.categorie_id=c.id LEFT JOIN fournisseurs f ON p.fournisseur_id=f.id"
    conds,params=[],[]
    if actif_only: conds.append("p.actif=1")
    if cat_id: conds.append("p.categorie_id=?"); params.append(cat_id)
    if conds: q+=" WHERE "+" AND ".join(conds)
    q+=" ORDER BY c.nom,p.nom"
    r=[dict(x) for x in conn.execute(q,params).fetchall()]; conn.close(); return r

def get_produit_by_barcode(code):
    conn=get_db(); r=conn.execute("SELECT p.*,c.nom as categorie_nom FROM produits p JOIN categories c ON p.categorie_id=c.id WHERE p.code_barre=? AND p.actif=1",(code,)).fetchone(); conn.close()
    return dict(r) if r else None

def add_produit(nom,cat_id,prix_achat,prix_vente,ref="",code_barre="",desc="",fournisseur_id=None,seuil=5):
    conn=get_db(); c=conn.cursor()
    c.execute("INSERT INTO produits (nom,categorie_id,prix_achat,prix_vente,reference,code_barre,description,fournisseur_id,seuil_alerte) VALUES (?,?,?,?,?,?,?,?,?)",
              (nom,cat_id,prix_achat,prix_vente,ref,code_barre,desc,fournisseur_id,seuil))
    pid=c.lastrowid
    for f in conn.execute("SELECT id FROM franchises WHERE actif=1").fetchall():
        conn.execute("INSERT OR IGNORE INTO stock (franchise_id,produit_id,quantite) VALUES (?,?,0)",(f['id'],pid))
    conn.commit(); conn.close(); return pid

def update_produit(pid,nom,cat_id,prix_achat,prix_vente,ref,code_barre,desc,fournisseur_id,seuil,actif,user_id=None):
    conn=get_db()
    old=conn.execute("SELECT prix_achat,prix_vente FROM produits WHERE id=?",(pid,)).fetchone()
    if old and (old['prix_achat']!=prix_achat or old['prix_vente']!=prix_vente):
        conn.execute("INSERT INTO historique_prix (produit_id,ancien_prix_achat,nouveau_prix_achat,ancien_prix_vente,nouveau_prix_vente,utilisateur_id) VALUES (?,?,?,?,?,?)",
                     (pid,old['prix_achat'],prix_achat,old['prix_vente'],prix_vente,user_id))
    conn.execute("UPDATE produits SET nom=?,categorie_id=?,prix_achat=?,prix_vente=?,reference=?,code_barre=?,description=?,fournisseur_id=?,seuil_alerte=?,actif=? WHERE id=?",
                 (nom,cat_id,prix_achat,prix_vente,ref,code_barre,desc,fournisseur_id,seuil,actif,pid))
    conn.commit(); conn.close()

def import_produits_csv(csv_text):
    """Import CSV: nom,categorie,prix_achat,prix_vente,reference,code_barre"""
    conn=get_db(); reader=csv.DictReader(io.StringIO(csv_text)); count=0
    cats={c['nom']:c['id'] for c in [dict(x) for x in conn.execute("SELECT * FROM categories").fetchall()]}
    for row in reader:
        cat_id=cats.get(row.get('categorie',''))
        if not cat_id: continue
        try:
            conn.execute("INSERT INTO produits (nom,categorie_id,prix_achat,prix_vente,reference,code_barre) VALUES (?,?,?,?,?,?)",
                         (row['nom'],cat_id,float(row.get('prix_achat',0)),float(row.get('prix_vente',0)),row.get('reference',''),row.get('code_barre','')))
            count+=1
        except: pass
    conn.commit(); conn.close(); return count

# === STOCK ===
def get_stock(franchise_id=None):
    conn=get_db()
    q="""SELECT s.*,p.nom as produit_nom,p.prix_vente,p.prix_achat,p.reference,p.code_barre,p.seuil_alerte,
         c.nom as categorie_nom,f.nom as franchise_nom
         FROM stock s JOIN produits p ON s.produit_id=p.id JOIN categories c ON p.categorie_id=c.id JOIN franchises f ON s.franchise_id=f.id WHERE p.actif=1"""
    params=[]
    if franchise_id: q+=" AND s.franchise_id=?"; params.append(franchise_id)
    q+=" ORDER BY f.nom,c.nom,p.nom"
    r=[dict(x) for x in conn.execute(q,params).fetchall()]; conn.close(); return r

def update_stock(fid,pid,qty,type_mv,prix=0,note="",uid=None):
    conn=get_db(); c=conn.cursor()
    c.execute("INSERT INTO mouvements (franchise_id,produit_id,type_mouvement,quantite,prix_unitaire,note,utilisateur_id) VALUES (?,?,?,?,?,?,?)",(fid,pid,type_mv,qty,prix,note,uid))
    if type_mv in ('entree','ajustement','dispatch_in','retour'):
        c.execute("INSERT INTO stock (franchise_id,produit_id,quantite) VALUES (?,?,?) ON CONFLICT(franchise_id,produit_id) DO UPDATE SET quantite=quantite+?,derniere_maj=CURRENT_TIMESTAMP",(fid,pid,qty,qty))
    elif type_mv in ('sortie','vente','dispatch_out'):
        c.execute("UPDATE stock SET quantite=MAX(0,quantite-?),derniere_maj=CURRENT_TIMESTAMP WHERE franchise_id=? AND produit_id=?",(qty,fid,pid))
    conn.commit(); conn.close()

def batch_stock_entry(fid,items,uid=None):
    """items = [(produit_id, quantite, note), ...]"""
    conn=get_db(); c=conn.cursor()
    for pid,qty,note in items:
        c.execute("INSERT INTO mouvements (franchise_id,produit_id,type_mouvement,quantite,note,utilisateur_id) VALUES (?,?,'entree',?,?,?)",(fid,pid,qty,note,uid))
        c.execute("INSERT INTO stock (franchise_id,produit_id,quantite) VALUES (?,?,?) ON CONFLICT(franchise_id,produit_id) DO UPDATE SET quantite=quantite+?,derniere_maj=CURRENT_TIMESTAMP",(fid,pid,qty,qty))
    conn.commit(); conn.close()

def get_stock_value(franchise_id=None):
    conn=get_db()
    q="SELECT COALESCE(SUM(s.quantite*p.prix_vente),0) as valeur, COALESCE(SUM(s.quantite*p.prix_achat),0) as cout, COALESCE(SUM(s.quantite),0) as total FROM stock s JOIN produits p ON s.produit_id=p.id"
    if franchise_id: q+=" WHERE s.franchise_id=?"; r=conn.execute(q,(franchise_id,)).fetchone()
    else: r=conn.execute(q).fetchone()
    conn.close(); return dict(r)

# === VENTES ===
def enregistrer_vente(fid,pid,qty,prix,remise=0,uid=None,note=""):
    total=qty*prix*(1-remise/100)
    conn=get_db(); c=conn.cursor()
    c.execute("INSERT INTO ventes (franchise_id,produit_id,quantite,prix_unitaire,prix_total,remise,utilisateur_id,note) VALUES (?,?,?,?,?,?,?,?)",(fid,pid,qty,prix,total,remise,uid,note))
    c.execute("INSERT INTO mouvements (franchise_id,produit_id,type_mouvement,quantite,prix_unitaire,note,utilisateur_id) VALUES (?,?,'vente',?,?,?,?)",(fid,pid,qty,prix,note,uid))
    c.execute("UPDATE stock SET quantite=MAX(0,quantite-?),derniere_maj=CURRENT_TIMESTAMP WHERE franchise_id=? AND produit_id=?",(qty,fid,pid))
    conn.commit(); conn.close(); return total

def enregistrer_vente_multiple(fid,items,uid=None):
    """items = [(produit_id, quantite, prix_unitaire, remise, note), ...]"""
    conn=get_db(); c=conn.cursor(); total_global=0
    for pid,qty,prix,remise,note in items:
        total=qty*prix*(1-remise/100); total_global+=total
        c.execute("INSERT INTO ventes (franchise_id,produit_id,quantite,prix_unitaire,prix_total,remise,utilisateur_id,note) VALUES (?,?,?,?,?,?,?,?)",(fid,pid,qty,prix,total,remise,uid,note))
        c.execute("INSERT INTO mouvements (franchise_id,produit_id,type_mouvement,quantite,prix_unitaire,note,utilisateur_id) VALUES (?,?,'vente',?,?,?,?)",(fid,pid,qty,prix,note,uid))
        c.execute("UPDATE stock SET quantite=MAX(0,quantite-?),derniere_maj=CURRENT_TIMESTAMP WHERE franchise_id=? AND produit_id=?",(qty,fid,pid))
    conn.commit(); conn.close(); return total_global

def get_ventes(fid=None,d1=None,d2=None):
    conn=get_db()
    q="""SELECT v.*,p.nom as produit_nom,p.reference,c.nom as categorie_nom,f.nom as franchise_nom,u.nom_complet as vendeur
         FROM ventes v JOIN produits p ON v.produit_id=p.id JOIN categories c ON p.categorie_id=c.id JOIN franchises f ON v.franchise_id=f.id LEFT JOIN utilisateurs u ON v.utilisateur_id=u.id WHERE 1=1"""
    params=[]
    if fid: q+=" AND v.franchise_id=?"; params.append(fid)
    if d1: q+=" AND v.date_vente>=?"; params.append(str(d1))
    if d2: q+=" AND v.date_vente<=?"; params.append(str(d2))
    q+=" ORDER BY v.date_creation DESC"
    r=[dict(x) for x in conn.execute(q,params).fetchall()]; conn.close(); return r

# === TRANSFERTS ===
def demander_transfert(src,dest,pid,qty,uid=None,note=""):
    conn=get_db(); conn.execute("INSERT INTO transferts (franchise_source,franchise_dest,produit_id,quantite,demandeur_id,note) VALUES (?,?,?,?,?,?)",(src,dest,pid,qty,uid,note)); conn.commit(); conn.close()

def get_transferts(fid=None,statut=None):
    conn=get_db()
    q="""SELECT t.*,p.nom as produit_nom,fs.nom as source_nom,fd.nom as dest_nom,u.nom_complet as demandeur_nom
         FROM transferts t JOIN produits p ON t.produit_id=p.id JOIN franchises fs ON t.franchise_source=fs.id JOIN franchises fd ON t.franchise_dest=fd.id LEFT JOIN utilisateurs u ON t.demandeur_id=u.id WHERE 1=1"""
    params=[]
    if fid: q+=" AND (t.franchise_source=? OR t.franchise_dest=?)"; params.extend([fid,fid])
    if statut: q+=" AND t.statut=?"; params.append(statut)
    q+=" ORDER BY t.date_demande DESC"
    r=[dict(x) for x in conn.execute(q,params).fetchall()]; conn.close(); return r

def valider_transfert(tid,accepter,uid=None):
    conn=get_db(); t=dict(conn.execute("SELECT * FROM transferts WHERE id=?",(tid,)).fetchone())
    statut='accepte' if accepter else 'rejete'
    conn.execute("UPDATE transferts SET statut=?,validateur_id=?,date_validation=CURRENT_TIMESTAMP WHERE id=?",(statut,uid,tid))
    if accepter:
        conn.execute("UPDATE stock SET quantite=MAX(0,quantite-?) WHERE franchise_id=? AND produit_id=?",(t['quantite'],t['franchise_source'],t['produit_id']))
        conn.execute("INSERT INTO stock (franchise_id,produit_id,quantite) VALUES (?,?,?) ON CONFLICT(franchise_id,produit_id) DO UPDATE SET quantite=quantite+?",(t['franchise_dest'],t['produit_id'],t['quantite'],t['quantite']))
        conn.execute("INSERT INTO mouvements (franchise_id,produit_id,type_mouvement,quantite,note,utilisateur_id) VALUES (?,?,'dispatch_out',?,?,?)",(t['franchise_source'],t['produit_id'],t['quantite'],f"Transfert→{t['franchise_dest']}",uid))
        conn.execute("INSERT INTO mouvements (franchise_id,produit_id,type_mouvement,quantite,note,utilisateur_id) VALUES (?,?,'dispatch_in',?,?,?)",(t['franchise_dest'],t['produit_id'],t['quantite'],f"Transfert←{t['franchise_source']}",uid))
    conn.commit(); conn.close()

# === DISPATCH ===
def dispatch_stock(items,uid=None):
    """items = [(franchise_id, produit_id, quantite, note), ...]"""
    conn=get_db(); c=conn.cursor()
    for fid,pid,qty,note in items:
        c.execute("INSERT INTO dispatch (franchise_id,produit_id,quantite,utilisateur_id,note) VALUES (?,?,?,?,?)",(fid,pid,qty,uid,note))
        c.execute("INSERT INTO stock (franchise_id,produit_id,quantite) VALUES (?,?,?) ON CONFLICT(franchise_id,produit_id) DO UPDATE SET quantite=quantite+?,derniere_maj=CURRENT_TIMESTAMP",(fid,pid,qty,qty))
        c.execute("INSERT INTO mouvements (franchise_id,produit_id,type_mouvement,quantite,note,utilisateur_id) VALUES (?,?,'dispatch_in',?,?,?)",(fid,pid,qty,note or "Dispatch admin",uid))
    conn.commit(); conn.close()

# === CLOTURES ===
def soumettre_cloture(fid,date_cl,total_declare,articles_declare,commentaire="",uid=None):
    conn=get_db()
    sys_data=conn.execute("SELECT COALESCE(SUM(prix_total),0) as t,COALESCE(SUM(quantite),0) as a FROM ventes WHERE franchise_id=? AND date_vente=?",(fid,str(date_cl))).fetchone()
    try:
        conn.execute("INSERT INTO clotures (franchise_id,date_cloture,total_ventes_declare,total_articles_declare,total_ventes_systeme,total_articles_systeme,commentaire,utilisateur_id) VALUES (?,?,?,?,?,?,?,?)",
                     (fid,str(date_cl),total_declare,articles_declare,sys_data['t'],sys_data['a'],commentaire,uid))
        conn.commit(); conn.close(); return True
    except: conn.close(); return False

def get_clotures(fid=None):
    conn=get_db()
    q="SELECT cl.*,f.nom as franchise_nom,u.nom_complet as soumis_par FROM clotures cl JOIN franchises f ON cl.franchise_id=f.id LEFT JOIN utilisateurs u ON cl.utilisateur_id=u.id WHERE 1=1"
    params=[]
    if fid: q+=" AND cl.franchise_id=?"; params.append(fid)
    q+=" ORDER BY cl.date_cloture DESC"
    r=[dict(x) for x in conn.execute(q,params).fetchall()]; conn.close(); return r

def valider_cloture(cid,uid):
    conn=get_db(); conn.execute("UPDATE clotures SET valide=1,validateur_id=? WHERE id=?",(uid,cid)); conn.commit(); conn.close()

# === RETOURS ===
def enregistrer_retour(fid,pid,qty,type_r,raison="",note="",uid=None):
    conn=get_db()
    conn.execute("INSERT INTO retours (franchise_id,produit_id,quantite,type_retour,raison,note,utilisateur_id) VALUES (?,?,?,?,?,?,?)",(fid,pid,qty,type_r,raison,note,uid))
    if type_r=='retour':
        conn.execute("INSERT INTO stock (franchise_id,produit_id,quantite) VALUES (?,?,?) ON CONFLICT(franchise_id,produit_id) DO UPDATE SET quantite=quantite+?",(fid,pid,qty,qty))
        conn.execute("INSERT INTO mouvements (franchise_id,produit_id,type_mouvement,quantite,note,utilisateur_id) VALUES (?,?,'retour',?,?,?)",(fid,pid,qty,raison,uid))
    conn.commit(); conn.close()

def get_retours(fid=None):
    conn=get_db()
    q="SELECT r.*,p.nom as produit_nom,f.nom as franchise_nom FROM retours r JOIN produits p ON r.produit_id=p.id JOIN franchises f ON r.franchise_id=f.id WHERE 1=1"
    params=[]
    if fid: q+=" AND r.franchise_id=?"; params.append(fid)
    q+=" ORDER BY r.date_retour DESC"
    r=[dict(x) for x in conn.execute(q,params).fetchall()]; conn.close(); return r

# === MOUVEMENTS ===
def get_mouvements(fid=None,limit=100):
    conn=get_db()
    q="SELECT m.*,p.nom as produit_nom,f.nom as franchise_nom,u.nom_complet as utilisateur_nom FROM mouvements m JOIN produits p ON m.produit_id=p.id JOIN franchises f ON m.franchise_id=f.id LEFT JOIN utilisateurs u ON m.utilisateur_id=u.id WHERE 1=1"
    params=[]
    if fid: q+=" AND m.franchise_id=?"; params.append(fid)
    q+=" ORDER BY m.date_mouvement DESC LIMIT ?"; params.append(limit)
    r=[dict(x) for x in conn.execute(q,params).fetchall()]; conn.close(); return r

# === ALERTES ===
def get_alertes(fid=None):
    conn=get_db()
    q="SELECT s.*,p.nom as produit_nom,p.reference,p.seuil_alerte,c.nom as categorie_nom,f.nom as franchise_nom FROM stock s JOIN produits p ON s.produit_id=p.id JOIN categories c ON p.categorie_id=c.id JOIN franchises f ON s.franchise_id=f.id WHERE s.quantite<=p.seuil_alerte AND p.actif=1"
    params=[]
    if fid: q+=" AND s.franchise_id=?"; params.append(fid)
    q+=" ORDER BY s.quantite ASC"
    r=[dict(x) for x in conn.execute(q,params).fetchall()]; conn.close(); return r

# === STATS ===
def get_stats(fid=None):
    conn=get_db(); s={}
    filt=" WHERE franchise_id=?" if fid else ""; p=(fid,) if fid else ()
    filt_v=" AND franchise_id=?" if fid else ""; p_v=(fid,) if fid else ()
    s['total_produits']=conn.execute("SELECT COUNT(*) FROM produits WHERE actif=1").fetchone()[0]
    s['total_franchises']=conn.execute("SELECT COUNT(*) FROM franchises WHERE actif=1").fetchone()[0]
    sv=conn.execute(f"SELECT COALESCE(SUM(quantite),0),COALESCE(SUM(quantite*(SELECT prix_vente FROM produits WHERE id=stock.produit_id)),0) FROM stock{filt}",p).fetchone()
    s['stock_total']=sv[0]; s['valeur_stock']=sv[1]
    s['ventes_aujourdhui']=conn.execute(f"SELECT COALESCE(SUM(prix_total),0) FROM ventes WHERE date_vente=date('now'){filt_v}",p_v).fetchone()[0]
    s['ventes_semaine']=conn.execute(f"SELECT COALESCE(SUM(prix_total),0) FROM ventes WHERE date_vente>=date('now','-7 days'){filt_v}",p_v).fetchone()[0]
    s['ventes_mois']=conn.execute(f"SELECT COALESCE(SUM(prix_total),0) FROM ventes WHERE strftime('%Y-%m',date_vente)=strftime('%Y-%m','now'){filt_v}",p_v).fetchone()[0]
    s['alertes']=len(get_alertes(fid))
    s['transferts_attente']=conn.execute("SELECT COUNT(*) FROM transferts WHERE statut='en_attente'").fetchone()[0]
    conn.close(); return s

# === USERS ===
def get_utilisateurs():
    conn=get_db(); r=[dict(x) for x in conn.execute("SELECT u.*,f.nom as franchise_nom FROM utilisateurs u LEFT JOIN franchises f ON u.franchise_id=f.id ORDER BY u.role,u.nom_complet").fetchall()]; conn.close(); return r
def add_user(username,pwd,nom,role,fid=None):
    conn=get_db()
    try: conn.execute("INSERT INTO utilisateurs (nom_utilisateur,mot_de_passe,nom_complet,role,franchise_id) VALUES (?,?,?,?,?)",(username,hash_pw(pwd),nom,role,fid)); conn.commit(); conn.close(); return True
    except: conn.close(); return False
def update_user(uid,nom_complet,role,fid,actif):
    conn=get_db(); conn.execute("UPDATE utilisateurs SET nom_complet=?,role=?,franchise_id=?,actif=? WHERE id=?",(nom_complet,role,fid,actif,uid)); conn.commit(); conn.close()
def reset_user_password(uid,new_pw):
    conn=get_db(); conn.execute("UPDATE utilisateurs SET mot_de_passe=? WHERE id=?",(hash_pw(new_pw),uid)); conn.commit(); conn.close()
