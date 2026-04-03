"""
ASEL Mobile — Google Sheets Database Layer
Each sheet = one table. Uses gspread + service account.
"""
import gspread
from google.oauth2.service_account import Credentials
import streamlit as st
import json
import hashlib
from datetime import datetime, date
import time

# === CONNECTION ===
SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive"
]

@st.cache_resource(ttl=300)
def get_client():
    creds_dict = json.loads(st.secrets["gcp_service_account"])
    creds = Credentials.from_service_account_info(creds_dict, scopes=SCOPES)
    return gspread.authorize(creds)

def get_sheet():
    client = get_client()
    return client.open_by_key(st.secrets["spreadsheet_id"])

# === HELPERS ===
def _ws(name):
    """Get or create worksheet"""
    sh = get_sheet()
    try:
        return sh.worksheet(name)
    except gspread.WorksheetNotFound:
        return None

def _all(name):
    ws = _ws(name)
    if not ws: return []
    data = ws.get_all_records()
    return data

def _find_row(name, col, val):
    ws = _ws(name)
    if not ws: return None, None
    data = ws.get_all_records()
    for i, row in enumerate(data):
        if str(row.get(col, '')) == str(val):
            return i + 2, row  # +2 because row 1 = header, gspread is 1-indexed
    return None, None

def _next_id(name):
    data = _all(name)
    if not data: return 1
    ids = [int(r.get('id', 0)) for r in data if str(r.get('id', '')).isdigit()]
    return max(ids) + 1 if ids else 1

def _append(name, row_dict):
    ws = _ws(name)
    if not ws: return
    headers = ws.row_values(1)
    row = [row_dict.get(h, '') for h in headers]
    ws.append_row(row, value_input_option='USER_ENTERED')

def _update_row(name, row_num, row_dict):
    ws = _ws(name)
    if not ws: return
    headers = ws.row_values(1)
    row = [row_dict.get(h, '') for h in headers]
    ws.update(f'A{row_num}:{chr(64+len(headers))}{row_num}', [row])

def _retry(func, *args, retries=3, **kwargs):
    """Retry on API rate limit"""
    for i in range(retries):
        try:
            return func(*args, **kwargs)
        except gspread.exceptions.APIError as e:
            if 'RATE_LIMIT' in str(e) or '429' in str(e):
                time.sleep(2 ** i)
            else:
                raise
    return func(*args, **kwargs)

# === INIT SHEETS ===
def init_sheets():
    """Create all sheets with headers if they don't exist"""
    sh = get_sheet()
    existing = [ws.title for ws in sh.worksheets()]
    
    tables = {
        "franchises": ["id","nom","adresse","telephone","responsable","actif","date_creation"],
        "categories": ["id","nom","description"],
        "fournisseurs": ["id","nom","telephone","email","adresse","actif"],
        "produits": ["id","nom","categorie_id","prix_achat","prix_vente","reference","code_barre","description","fournisseur_id","seuil_alerte","actif","date_creation"],
        "utilisateurs": ["id","nom_utilisateur","mot_de_passe","nom_complet","role","franchise_id","actif","date_creation"],
        "stock": ["id","franchise_id","produit_id","quantite","derniere_maj"],
        "mouvements": ["id","franchise_id","produit_id","type_mouvement","quantite","prix_unitaire","note","utilisateur_id","date_mouvement"],
        "ventes": ["id","franchise_id","produit_id","quantite","prix_unitaire","prix_total","remise","date_vente","utilisateur_id","note","date_creation"],
        "transferts": ["id","franchise_source","franchise_dest","produit_id","quantite","statut","demandeur_id","validateur_id","note","date_demande","date_validation"],
        "clotures": ["id","franchise_id","date_cloture","total_ventes_declare","total_articles_declare","total_ventes_systeme","total_articles_systeme","commentaire","valide","utilisateur_id","validateur_id","date_creation"],
        "retours": ["id","franchise_id","produit_id","quantite","type_retour","raison","note","utilisateur_id","date_retour"],
        "dispatch": ["id","franchise_id","produit_id","quantite","utilisateur_id","note","date_dispatch"],
        "historique_prix": ["id","produit_id","ancien_prix_achat","nouveau_prix_achat","ancien_prix_vente","nouveau_prix_vente","utilisateur_id","date_changement"],
    }
    
    for name, headers in tables.items():
        if name not in existing:
            ws = sh.add_worksheet(title=name, rows=1000, cols=len(headers))
            ws.update('A1', [headers])
            time.sleep(1)  # Rate limit
    
    # Remove default Sheet1 if exists and empty
    if "Sheet1" in existing:
        try:
            ws1 = sh.worksheet("Sheet1")
            if not ws1.get_all_values()[1:]:
                sh.del_worksheet(ws1)
        except:
            pass
    
    # Seed if empty
    if not _all("franchises"):
        _seed()

def _seed():
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    
    # Franchises
    franchises = [
        {"id":1,"nom":"ASEL Mobile — Tunis Centre","adresse":"Av. Habib Bourguiba, Tunis","telephone":"+216 71 123 456","responsable":"Ahmed Ben Ali","actif":1,"date_creation":now},
        {"id":2,"nom":"ASEL Mobile — Sfax","adresse":"Route de Tunis, Sfax","telephone":"+216 74 234 567","responsable":"Mohamed Trabelsi","actif":1,"date_creation":now},
        {"id":3,"nom":"ASEL Mobile — Sousse","adresse":"Bd 14 Janvier, Sousse","telephone":"+216 73 345 678","responsable":"Fatma Bouazizi","actif":1,"date_creation":now},
        {"id":4,"nom":"ASEL Mobile — Nabeul","adresse":"Av. Habib Thameur, Nabeul","telephone":"+216 72 456 789","responsable":"Karim Jebali","actif":1,"date_creation":now},
        {"id":5,"nom":"ASEL Mobile — Bizerte","adresse":"Rue de la République, Bizerte","telephone":"+216 72 567 890","responsable":"Sana Mansouri","actif":1,"date_creation":now},
    ]
    ws = _ws("franchises")
    for f in franchises:
        _append("franchises", f)
        time.sleep(0.5)
    
    # Categories
    cats = [
        {"id":1,"nom":"Téléphones","description":"Smartphones et téléphones"},
        {"id":2,"nom":"Coques & Protections","description":"Coques, étuis, films"},
        {"id":3,"nom":"Écouteurs & Casques","description":"Filaires et Bluetooth"},
        {"id":4,"nom":"Enceintes","description":"Bluetooth et portables"},
        {"id":5,"nom":"Chargeurs & Câbles","description":"Chargeurs, câbles, batteries"},
        {"id":6,"nom":"Accessoires","description":"Supports, cartes mémoire, etc."},
    ]
    for c in cats:
        _append("categories", c)
        time.sleep(0.3)
    
    # Fournisseurs
    _append("fournisseurs", {"id":1,"nom":"Fournisseur Général","telephone":"+216 70 000 000","email":"contact@fournisseur.tn","adresse":"Tunis","actif":1})
    
    # Produits
    produits = [
        (1,"Samsung Galaxy A15",1,450,599,"SM-A155F","8806095426280",1,5),
        (2,"Samsung Galaxy A25",1,650,849,"SM-A256B","8806095468123",1,5),
        (3,"iPhone 15",1,2800,3499,"IPHONE15-128","0194253396055",1,3),
        (4,"Xiaomi Redmi Note 13",1,500,699,"RN13-128","6941812756423",1,5),
        (5,"OPPO A18",1,380,499,"OPPO-A18","6932169086547",1,5),
        (6,"Coque Samsung A15",2,15,35,"COQ-A15","COQ-SAM-A15",1,10),
        (7,"Coque iPhone 15",2,20,45,"COQ-IP15","COQ-IP-15",1,10),
        (8,"Protection écran Samsung",2,8,20,"PE-SAM","PE-SAM-UNIV",1,10),
        (9,"Protection écran iPhone",2,10,25,"PE-IP","PE-IP-15",1,10),
        (10,"Coque Xiaomi RN13",2,12,30,"COQ-XRN13","COQ-XI-RN13",1,10),
        (11,"AirPods Pro 2",3,600,849,"APP2","0194253404026",1,3),
        (12,"Samsung Galaxy Buds FE",3,200,299,"SGB-FE","8806095170862",1,5),
        (13,"Écouteurs filaires USB-C",3,15,35,"EC-USBC","EC-USBC-GEN",1,15),
        (14,"JBL Tune 520BT",3,120,179,"JBL-T520","6925281978944",1,5),
        (15,"JBL Flip 6",4,250,399,"JBL-F6","6925281993152",1,3),
        (16,"JBL Go 3",4,80,129,"JBL-G3","6925281979415",1,5),
        (17,"Chargeur rapide 25W",5,25,49,"CHR-25W","CHR-25W-SAM",1,10),
        (18,"Chargeur rapide 65W",5,45,79,"CHR-65W","CHR-65W-GAN",1,5),
        (19,"Câble USB-C 1m",5,8,20,"CAB-USBC","CAB-USBC-1M",1,15),
        (20,"Câble Lightning 1m",5,12,25,"CAB-LTN","CAB-LTN-1M",1,10),
        (21,"Batterie externe 10000mAh",5,45,79,"BAT-10K","BAT-10K-ANK",1,5),
        (22,"Support voiture magnétique",6,15,35,"SUP-VOI","SUP-MAG-VOI",1,10),
        (23,"Carte mémoire 64Go",6,20,39,"CM-64","CM-SD-64",1,10),
        (24,"Carte mémoire 128Go",6,35,59,"CM-128","CM-SD-128",1,5),
    ]
    for p in produits:
        _append("produits", {"id":p[0],"nom":p[1],"categorie_id":p[2],"prix_achat":p[3],"prix_vente":p[4],"reference":p[5],"code_barre":p[6],"fournisseur_id":p[7],"seuil_alerte":p[8],"actif":1,"date_creation":now,"description":""})
        time.sleep(0.3)
    
    # Admin + franchise users
    _append("utilisateurs", {"id":1,"nom_utilisateur":"admin","mot_de_passe":hash_pw("admin2024"),"nom_complet":"Administrateur","role":"admin","franchise_id":"","actif":1,"date_creation":now})
    time.sleep(0.3)
    for i in range(1,6):
        _append("utilisateurs", {"id":i+1,"nom_utilisateur":f"franchise{i}","mot_de_passe":hash_pw(f"franchise{i}"),"nom_complet":f"Gérant Franchise {i}","role":"franchise","franchise_id":i,"actif":1,"date_creation":now})
        time.sleep(0.3)
    
    # Initial stock
    import random
    sid = 1
    for fid in range(1,6):
        for pid in range(1,25):
            _append("stock", {"id":sid,"franchise_id":fid,"produit_id":pid,"quantite":random.randint(5,40),"derniere_maj":now})
            sid += 1
            time.sleep(0.2)

# === AUTH ===
def hash_pw(p):
    return hashlib.sha256(p.encode()).hexdigest()

def verify_user(username, password):
    users = _all("utilisateurs")
    hashed = hash_pw(password)
    for u in users:
        if u.get('nom_utilisateur') == username and u.get('mot_de_passe') == hashed and str(u.get('actif','1')) == '1':
            return u
    return None

def change_password(user_id, new_pw):
    row_num, row = _find_row("utilisateurs", "id", user_id)
    if row_num:
        row['mot_de_passe'] = hash_pw(new_pw)
        _update_row("utilisateurs", row_num, row)

# === FRANCHISES ===
def get_franchises(actif_only=True):
    data = _all("franchises")
    if actif_only:
        return [f for f in data if str(f.get('actif','1')) == '1']
    return data

def add_franchise(nom, adresse="", telephone="", responsable=""):
    nid = _next_id("franchises")
    _append("franchises", {"id":nid,"nom":nom,"adresse":adresse,"telephone":telephone,"responsable":responsable,"actif":1,"date_creation":datetime.now().strftime("%Y-%m-%d %H:%M:%S")})
    # Init stock for all products
    produits = get_produits()
    sid = _next_id("stock")
    for p in produits:
        _append("stock", {"id":sid,"franchise_id":nid,"produit_id":p['id'],"quantite":0,"derniere_maj":datetime.now().strftime("%Y-%m-%d %H:%M:%S")})
        sid += 1
        time.sleep(0.2)
    return nid

def update_franchise(fid, nom, adresse, telephone, responsable, actif):
    row_num, _ = _find_row("franchises", "id", fid)
    if row_num:
        _update_row("franchises", row_num, {"id":fid,"nom":nom,"adresse":adresse,"telephone":telephone,"responsable":responsable,"actif":actif,"date_creation":""})

# === CATEGORIES ===
def get_categories():
    return _all("categories")

def add_category(nom, desc=""):
    nid = _next_id("categories")
    _append("categories", {"id":nid,"nom":nom,"description":desc})
    return True

# === FOURNISSEURS ===
def get_fournisseurs():
    return [f for f in _all("fournisseurs") if str(f.get('actif','1')) == '1']

def add_fournisseur(nom, tel="", email="", adresse=""):
    nid = _next_id("fournisseurs")
    _append("fournisseurs", {"id":nid,"nom":nom,"telephone":tel,"email":email,"adresse":adresse,"actif":1})

# === PRODUITS ===
def get_produits(cat_id=None, actif_only=True):
    data = _all("produits")
    cats = {str(c['id']): c['nom'] for c in get_categories()}
    result = []
    for p in data:
        if actif_only and str(p.get('actif','1')) != '1':
            continue
        if cat_id and str(p.get('categorie_id','')) != str(cat_id):
            continue
        p['categorie_nom'] = cats.get(str(p.get('categorie_id','')), '?')
        result.append(p)
    return result

def get_produit_by_barcode(code):
    produits = _all("produits")
    for p in produits:
        if p.get('code_barre') == code and str(p.get('actif','1')) == '1':
            cats = {str(c['id']): c['nom'] for c in get_categories()}
            p['categorie_nom'] = cats.get(str(p.get('categorie_id','')), '?')
            return p
    return None

def add_produit(nom, cat_id, prix_achat, prix_vente, ref="", code_barre="", desc="", fournisseur_id=None, seuil=5):
    nid = _next_id("produits")
    _append("produits", {"id":nid,"nom":nom,"categorie_id":cat_id,"prix_achat":prix_achat,"prix_vente":prix_vente,"reference":ref,"code_barre":code_barre,"description":desc,"fournisseur_id":fournisseur_id or "","seuil_alerte":seuil,"actif":1,"date_creation":datetime.now().strftime("%Y-%m-%d %H:%M:%S")})
    # Init stock
    sid = _next_id("stock")
    for f in get_franchises():
        _append("stock", {"id":sid,"franchise_id":f['id'],"produit_id":nid,"quantite":0,"derniere_maj":datetime.now().strftime("%Y-%m-%d %H:%M:%S")})
        sid += 1
        time.sleep(0.2)
    return nid

def update_produit(pid, nom, cat_id, prix_achat, prix_vente, ref, code_barre, desc, fournisseur_id, seuil, actif, user_id=None):
    row_num, old = _find_row("produits", "id", pid)
    if row_num:
        # Track price history
        if old and (float(old.get('prix_achat',0)) != float(prix_achat) or float(old.get('prix_vente',0)) != float(prix_vente)):
            hid = _next_id("historique_prix")
            _append("historique_prix", {"id":hid,"produit_id":pid,"ancien_prix_achat":old.get('prix_achat',0),"nouveau_prix_achat":prix_achat,"ancien_prix_vente":old.get('prix_vente',0),"nouveau_prix_vente":prix_vente,"utilisateur_id":user_id or "","date_changement":datetime.now().strftime("%Y-%m-%d %H:%M:%S")})
        _update_row("produits", row_num, {"id":pid,"nom":nom,"categorie_id":cat_id,"prix_achat":prix_achat,"prix_vente":prix_vente,"reference":ref,"code_barre":code_barre,"description":desc,"fournisseur_id":fournisseur_id or "","seuil_alerte":seuil,"actif":actif,"date_creation":old.get('date_creation','')})

# === STOCK ===
def get_stock(franchise_id=None):
    stock_data = _all("stock")
    produits = {str(p['id']): p for p in get_produits(actif_only=False)}
    cats = {str(c['id']): c['nom'] for c in get_categories()}
    franchises = {str(f['id']): f['nom'] for f in get_franchises(actif_only=False)}
    
    result = []
    for s in stock_data:
        if franchise_id and str(s.get('franchise_id','')) != str(franchise_id):
            continue
        pid = str(s.get('produit_id',''))
        p = produits.get(pid, {})
        if str(p.get('actif','1')) != '1':
            continue
        s['produit_nom'] = p.get('nom', '?')
        s['prix_vente'] = float(p.get('prix_vente', 0))
        s['prix_achat'] = float(p.get('prix_achat', 0))
        s['reference'] = p.get('reference', '')
        s['code_barre'] = p.get('code_barre', '')
        s['seuil_alerte'] = int(p.get('seuil_alerte', 5))
        s['categorie_nom'] = cats.get(str(p.get('categorie_id','')), '?')
        s['franchise_nom'] = franchises.get(str(s.get('franchise_id','')), '?')
        s['quantite'] = int(s.get('quantite', 0))
        result.append(s)
    return result

def _update_stock_qty(franchise_id, produit_id, delta):
    """Update stock quantity by delta (+ or -)"""
    stock_data = _all("stock")
    ws = _ws("stock")
    for i, s in enumerate(stock_data):
        if str(s.get('franchise_id','')) == str(franchise_id) and str(s.get('produit_id','')) == str(produit_id):
            new_qty = max(0, int(s.get('quantite', 0)) + delta)
            s['quantite'] = new_qty
            s['derniere_maj'] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            _update_row("stock", i + 2, s)
            return
    # If not found, create it
    sid = _next_id("stock")
    _append("stock", {"id":sid,"franchise_id":franchise_id,"produit_id":produit_id,"quantite":max(0, delta),"derniere_maj":datetime.now().strftime("%Y-%m-%d %H:%M:%S")})

def update_stock(fid, pid, qty, type_mv, prix=0, note="", uid=None):
    mid = _next_id("mouvements")
    _append("mouvements", {"id":mid,"franchise_id":fid,"produit_id":pid,"type_mouvement":type_mv,"quantite":qty,"prix_unitaire":prix,"note":note,"utilisateur_id":uid or "","date_mouvement":datetime.now().strftime("%Y-%m-%d %H:%M:%S")})
    if type_mv in ('entree','ajustement','dispatch_in','retour'):
        _update_stock_qty(fid, pid, qty)
    elif type_mv in ('sortie','vente','dispatch_out'):
        _update_stock_qty(fid, pid, -qty)

def batch_stock_entry(fid, items, uid=None):
    for pid, qty, note in items:
        update_stock(fid, pid, qty, 'entree', 0, note, uid)
        time.sleep(0.3)

# === VENTES ===
def enregistrer_vente(fid, pid, qty, prix, remise=0, uid=None, note=""):
    total = qty * prix * (1 - remise / 100)
    vid = _next_id("ventes")
    now = datetime.now()
    _append("ventes", {"id":vid,"franchise_id":fid,"produit_id":pid,"quantite":qty,"prix_unitaire":prix,"prix_total":round(total,2),"remise":remise,"date_vente":now.strftime("%Y-%m-%d"),"utilisateur_id":uid or "","note":note,"date_creation":now.strftime("%Y-%m-%d %H:%M:%S")})
    update_stock(fid, pid, qty, 'vente', prix, note, uid)
    return total

def enregistrer_vente_multiple(fid, items, uid=None):
    total_global = 0
    for pid, qty, prix, remise, note in items:
        total_global += enregistrer_vente(fid, pid, qty, prix, remise, uid, note)
        time.sleep(0.3)
    return total_global

def get_ventes(fid=None, d1=None, d2=None):
    data = _all("ventes")
    produits = {str(p['id']): p for p in get_produits(actif_only=False)}
    cats = {str(c['id']): c['nom'] for c in get_categories()}
    franchises = {str(f['id']): f['nom'] for f in get_franchises(actif_only=False)}
    users = {str(u['id']): u.get('nom_complet','') for u in _all("utilisateurs")}
    
    result = []
    for v in data:
        if fid and str(v.get('franchise_id','')) != str(fid):
            continue
        dv = v.get('date_vente', '')
        if d1 and dv < str(d1):
            continue
        if d2 and dv > str(d2):
            continue
        pid = str(v.get('produit_id',''))
        p = produits.get(pid, {})
        v['produit_nom'] = p.get('nom', '?')
        v['reference'] = p.get('reference', '')
        v['categorie_nom'] = cats.get(str(p.get('categorie_id','')), '?')
        v['franchise_nom'] = franchises.get(str(v.get('franchise_id','')), '?')
        v['vendeur'] = users.get(str(v.get('utilisateur_id','')), '')
        v['prix_total'] = float(v.get('prix_total', 0))
        v['quantite'] = int(v.get('quantite', 0))
        result.append(v)
    result.sort(key=lambda x: x.get('date_creation', ''), reverse=True)
    return result

# === TRANSFERTS ===
def demander_transfert(src, dest, pid, qty, uid=None, note=""):
    tid = _next_id("transferts")
    _append("transferts", {"id":tid,"franchise_source":src,"franchise_dest":dest,"produit_id":pid,"quantite":qty,"statut":"en_attente","demandeur_id":uid or "","validateur_id":"","note":note,"date_demande":datetime.now().strftime("%Y-%m-%d %H:%M:%S"),"date_validation":""})

def get_transferts(fid=None, statut=None):
    data = _all("transferts")
    produits = {str(p['id']): p.get('nom','?') for p in get_produits(actif_only=False)}
    franchises = {str(f['id']): f['nom'] for f in get_franchises(actif_only=False)}
    
    result = []
    for t in data:
        if fid and str(t.get('franchise_source','')) != str(fid) and str(t.get('franchise_dest','')) != str(fid):
            continue
        if statut and t.get('statut','') != statut:
            continue
        t['produit_nom'] = produits.get(str(t.get('produit_id','')), '?')
        t['source_nom'] = franchises.get(str(t.get('franchise_source','')), '?')
        t['dest_nom'] = franchises.get(str(t.get('franchise_dest','')), '?')
        result.append(t)
    result.sort(key=lambda x: x.get('date_demande', ''), reverse=True)
    return result

def valider_transfert(tid, accepter, uid=None):
    row_num, t = _find_row("transferts", "id", tid)
    if not row_num: return
    t['statut'] = 'accepte' if accepter else 'rejete'
    t['validateur_id'] = uid or ''
    t['date_validation'] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    _update_row("transferts", row_num, t)
    if accepter:
        qty = int(t.get('quantite', 0))
        pid = t.get('produit_id')
        update_stock(t['franchise_source'], pid, qty, 'dispatch_out', 0, f"Transfert→{t['franchise_dest']}", uid)
        time.sleep(0.3)
        update_stock(t['franchise_dest'], pid, qty, 'dispatch_in', 0, f"Transfert←{t['franchise_source']}", uid)

# === DISPATCH ===
def dispatch_stock(items, uid=None):
    for fid, pid, qty, note in items:
        did = _next_id("dispatch")
        _append("dispatch", {"id":did,"franchise_id":fid,"produit_id":pid,"quantite":qty,"utilisateur_id":uid or "","note":note or "Dispatch admin","date_dispatch":datetime.now().strftime("%Y-%m-%d %H:%M:%S")})
        update_stock(fid, pid, qty, 'dispatch_in', 0, note or "Dispatch admin", uid)
        time.sleep(0.3)

# === CLOTURES ===
def soumettre_cloture(fid, date_cl, total_declare, articles_declare, commentaire="", uid=None):
    # Check if already exists
    data = _all("clotures")
    for cl in data:
        if str(cl.get('franchise_id','')) == str(fid) and cl.get('date_cloture','') == str(date_cl):
            return False
    
    # Get system totals
    ventes = get_ventes(fid, date_cl, date_cl)
    sys_total = sum(float(v.get('prix_total', 0)) for v in ventes)
    sys_articles = sum(int(v.get('quantite', 0)) for v in ventes)
    
    cid = _next_id("clotures")
    _append("clotures", {"id":cid,"franchise_id":fid,"date_cloture":str(date_cl),"total_ventes_declare":total_declare,"total_articles_declare":articles_declare,"total_ventes_systeme":round(sys_total,2),"total_articles_systeme":sys_articles,"commentaire":commentaire,"valide":0,"utilisateur_id":uid or "","validateur_id":"","date_creation":datetime.now().strftime("%Y-%m-%d %H:%M:%S")})
    return True

def get_clotures(fid=None):
    data = _all("clotures")
    franchises = {str(f['id']): f['nom'] for f in get_franchises(actif_only=False)}
    result = []
    for cl in data:
        if fid and str(cl.get('franchise_id','')) != str(fid):
            continue
        cl['franchise_nom'] = franchises.get(str(cl.get('franchise_id','')), '?')
        cl['total_ventes_declare'] = float(cl.get('total_ventes_declare', 0))
        cl['total_articles_declare'] = int(cl.get('total_articles_declare', 0))
        cl['total_ventes_systeme'] = float(cl.get('total_ventes_systeme', 0))
        cl['total_articles_systeme'] = int(cl.get('total_articles_systeme', 0))
        result.append(cl)
    result.sort(key=lambda x: x.get('date_cloture', ''), reverse=True)
    return result

def valider_cloture(cid, uid):
    row_num, cl = _find_row("clotures", "id", cid)
    if row_num:
        cl['valide'] = 1
        cl['validateur_id'] = uid
        _update_row("clotures", row_num, cl)

# === RETOURS ===
def enregistrer_retour(fid, pid, qty, type_r, raison="", note="", uid=None):
    rid = _next_id("retours")
    _append("retours", {"id":rid,"franchise_id":fid,"produit_id":pid,"quantite":qty,"type_retour":type_r,"raison":raison,"note":note,"utilisateur_id":uid or "","date_retour":datetime.now().strftime("%Y-%m-%d %H:%M:%S")})
    if type_r == 'retour':
        update_stock(fid, pid, qty, 'retour', 0, raison, uid)

def get_retours(fid=None):
    data = _all("retours")
    produits = {str(p['id']): p.get('nom','?') for p in get_produits(actif_only=False)}
    franchises = {str(f['id']): f['nom'] for f in get_franchises(actif_only=False)}
    result = []
    for r in data:
        if fid and str(r.get('franchise_id','')) != str(fid):
            continue
        r['produit_nom'] = produits.get(str(r.get('produit_id','')), '?')
        r['franchise_nom'] = franchises.get(str(r.get('franchise_id','')), '?')
        result.append(r)
    result.sort(key=lambda x: x.get('date_retour', ''), reverse=True)
    return result

# === MOUVEMENTS ===
def get_mouvements(fid=None, limit=100):
    data = _all("mouvements")
    produits = {str(p['id']): p.get('nom','?') for p in get_produits(actif_only=False)}
    franchises = {str(f['id']): f['nom'] for f in get_franchises(actif_only=False)}
    users = {str(u['id']): u.get('nom_complet','') for u in _all("utilisateurs")}
    result = []
    for m in data:
        if fid and str(m.get('franchise_id','')) != str(fid):
            continue
        m['produit_nom'] = produits.get(str(m.get('produit_id','')), '?')
        m['franchise_nom'] = franchises.get(str(m.get('franchise_id','')), '?')
        m['utilisateur_nom'] = users.get(str(m.get('utilisateur_id','')), '')
        result.append(m)
    result.sort(key=lambda x: x.get('date_mouvement', ''), reverse=True)
    return result[:limit]

# === ALERTES ===
def get_alertes(fid=None):
    stock = get_stock(fid)
    return [s for s in stock if s['quantite'] <= s['seuil_alerte']]

# === STATS ===
def get_stats(fid=None):
    stock = get_stock(fid)
    ventes_all = get_ventes(fid)
    today = date.today().strftime("%Y-%m-%d")
    week_ago = (date.today() - __import__('datetime').timedelta(days=7)).strftime("%Y-%m-%d")
    month = date.today().strftime("%Y-%m")
    
    s = {}
    s['total_produits'] = len(get_produits())
    s['total_franchises'] = len(get_franchises())
    s['stock_total'] = sum(int(x.get('quantite',0)) for x in stock)
    s['valeur_stock'] = sum(int(x.get('quantite',0)) * float(x.get('prix_vente',0)) for x in stock)
    s['ventes_aujourdhui'] = sum(float(v.get('prix_total',0)) for v in ventes_all if v.get('date_vente','') == today)
    s['ventes_semaine'] = sum(float(v.get('prix_total',0)) for v in ventes_all if v.get('date_vente','') >= week_ago)
    s['ventes_mois'] = sum(float(v.get('prix_total',0)) for v in ventes_all if v.get('date_vente','')[:7] == month)
    s['alertes'] = len(get_alertes(fid))
    s['transferts_attente'] = len([t for t in _all("transferts") if t.get('statut')=='en_attente'])
    return s

# === USERS ===
def get_utilisateurs():
    data = _all("utilisateurs")
    franchises = {str(f['id']): f['nom'] for f in get_franchises(actif_only=False)}
    for u in data:
        u['franchise_nom'] = franchises.get(str(u.get('franchise_id','')), '')
    return data

def add_user(username, pwd, nom, role, fid=None):
    users = _all("utilisateurs")
    if any(u.get('nom_utilisateur') == username for u in users):
        return False
    uid = _next_id("utilisateurs")
    _append("utilisateurs", {"id":uid,"nom_utilisateur":username,"mot_de_passe":hash_pw(pwd),"nom_complet":nom,"role":role,"franchise_id":fid or "","actif":1,"date_creation":datetime.now().strftime("%Y-%m-%d %H:%M:%S")})
    return True

def reset_user_password(uid, new_pw):
    row_num, row = _find_row("utilisateurs", "id", uid)
    if row_num:
        row['mot_de_passe'] = hash_pw(new_pw)
        _update_row("utilisateurs", row_num, row)
