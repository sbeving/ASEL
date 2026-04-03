"""
ASEL Mobile — Database Layer via Google Apps Script API
No GCP service account needed. Just the Apps Script Web App URL.
"""
import streamlit as st
import requests
import hashlib
from datetime import datetime, date, timedelta

# Apps Script Web App URL — set in Streamlit secrets
def get_api_url():
    return st.secrets["apps_script_url"]

def _get(params):
    r = requests.get(get_api_url(), params=params, timeout=30)
    return r.json()

def _post(data):
    """Send data via GET with JSON-encoded payload (Apps Script POST redirect issue workaround)"""
    import json as _json
    params = {"action": data.get("action", ""), "payload": _json.dumps(data)}
    r = requests.get(get_api_url(), params=params, timeout=30)
    return r.json()

# === INIT ===
def init_db():
    """No-op — Apps Script handles init via menu"""
    pass

# === AUTH ===
def hash_pw(p):
    return hashlib.sha256(p.encode()).hexdigest()

def verify_user(username, password):
    r = _post({"action": "login", "username": username, "password": password})
    if r.get("success"):
        return r["user"]
    return None

def change_password(user_id, new_pw):
    _post({"action": "change_password", "user_id": user_id, "new_password": new_pw})

# === READ FUNCTIONS ===
def get_franchises(actif_only=True):
    params = {"action": "read", "table": "franchises"}
    if actif_only:
        params["actif_only"] = "true"
    return _get(params)

def get_categories():
    return _get({"action": "read", "table": "categories"})

def get_fournisseurs():
    return _get({"action": "read", "table": "fournisseurs", "actif_only": "true"})

def get_produits(cat_id=None, actif_only=True):
    params = {"action": "read", "table": "produits"}
    if actif_only:
        params["actif_only"] = "true"
    if cat_id:
        params["categorie_id"] = str(cat_id)
    data = _get(params)
    cats = {str(c['id']): c['nom'] for c in get_categories()}
    for p in data:
        p['categorie_nom'] = cats.get(str(p.get('categorie_id', '')), '?')
    return data

def get_produit_by_barcode(code):
    data = _get({"action": "read", "table": "produits", "code_barre": code})
    if data:
        cats = {str(c['id']): c['nom'] for c in get_categories()}
        data[0]['categorie_nom'] = cats.get(str(data[0].get('categorie_id', '')), '?')
        return data[0]
    return None

def get_stock(franchise_id=None):
    params = {"action": "read", "table": "stock"}
    if franchise_id:
        params["franchise_id"] = str(franchise_id)
    raw = _get(params)
    
    produits = {str(p['id']): p for p in get_produits(actif_only=False)}
    cats = {str(c['id']): c['nom'] for c in get_categories()}
    franchises = {str(f['id']): f['nom'] for f in get_franchises(actif_only=False)}
    
    result = []
    for s in raw:
        pid = str(s.get('produit_id', ''))
        p = produits.get(pid, {})
        if str(p.get('actif', '1')) == '0':
            continue
        s['produit_nom'] = p.get('nom', '?')
        s['prix_vente'] = float(p.get('prix_vente', 0))
        s['prix_achat'] = float(p.get('prix_achat', 0))
        s['reference'] = p.get('reference', '')
        s['code_barre'] = p.get('code_barre', '')
        s['seuil_alerte'] = int(p.get('seuil_alerte', 5))
        s['categorie_nom'] = cats.get(str(p.get('categorie_id', '')), '?')
        s['franchise_nom'] = franchises.get(str(s.get('franchise_id', '')), '?')
        s['quantite'] = int(s.get('quantite', 0))
        result.append(s)
    return result

def get_ventes(fid=None, d1=None, d2=None):
    params = {"action": "read", "table": "ventes"}
    if fid:
        params["franchise_id"] = str(fid)
    if d1:
        params["date_debut"] = str(d1)
    if d2:
        params["date_fin"] = str(d2)
    data = _get(params)
    
    produits = {str(p['id']): p for p in get_produits(actif_only=False)}
    cats = {str(c['id']): c['nom'] for c in get_categories()}
    franchises = {str(f['id']): f['nom'] for f in get_franchises(actif_only=False)}
    users = {str(u['id']): u.get('nom_complet', '') for u in _get({"action": "read", "table": "utilisateurs"})}
    
    result = []
    for v in data:
        pid = str(v.get('produit_id', ''))
        p = produits.get(pid, {})
        v['produit_nom'] = p.get('nom', '?')
        v['reference'] = p.get('reference', '')
        v['categorie_nom'] = cats.get(str(p.get('categorie_id', '')), '?')
        v['franchise_nom'] = franchises.get(str(v.get('franchise_id', '')), '?')
        v['vendeur'] = users.get(str(v.get('utilisateur_id', '')), '')
        v['prix_total'] = float(v.get('prix_total', 0))
        v['quantite'] = int(v.get('quantite', 0))
        result.append(v)
    result.sort(key=lambda x: x.get('date_creation', ''), reverse=True)
    return result

def get_transferts(fid=None, statut=None):
    params = {"action": "read", "table": "transferts"}
    if fid:
        params["franchise_id"] = str(fid)
    if statut:
        params["statut"] = statut
    data = _get(params)
    produits = {str(p['id']): p.get('nom', '?') for p in get_produits(actif_only=False)}
    franchises = {str(f['id']): f['nom'] for f in get_franchises(actif_only=False)}
    for t in data:
        t['produit_nom'] = produits.get(str(t.get('produit_id', '')), '?')
        t['source_nom'] = franchises.get(str(t.get('franchise_source', '')), '?')
        t['dest_nom'] = franchises.get(str(t.get('franchise_dest', '')), '?')
    return sorted(data, key=lambda x: x.get('date_demande', ''), reverse=True)

def get_clotures(fid=None):
    params = {"action": "read", "table": "clotures"}
    if fid:
        params["franchise_id"] = str(fid)
    data = _get(params)
    franchises = {str(f['id']): f['nom'] for f in get_franchises(actif_only=False)}
    for cl in data:
        cl['franchise_nom'] = franchises.get(str(cl.get('franchise_id', '')), '?')
        cl['total_ventes_declare'] = float(cl.get('total_ventes_declare', 0))
        cl['total_articles_declare'] = int(cl.get('total_articles_declare', 0))
        cl['total_ventes_systeme'] = float(cl.get('total_ventes_systeme', 0))
        cl['total_articles_systeme'] = int(cl.get('total_articles_systeme', 0))
    return sorted(data, key=lambda x: x.get('date_cloture', ''), reverse=True)

def get_retours(fid=None):
    params = {"action": "read", "table": "retours"}
    if fid:
        params["franchise_id"] = str(fid)
    data = _get(params)
    produits = {str(p['id']): p.get('nom', '?') for p in get_produits(actif_only=False)}
    franchises = {str(f['id']): f['nom'] for f in get_franchises(actif_only=False)}
    for r in data:
        r['produit_nom'] = produits.get(str(r.get('produit_id', '')), '?')
        r['franchise_nom'] = franchises.get(str(r.get('franchise_id', '')), '?')
    return sorted(data, key=lambda x: x.get('date_retour', ''), reverse=True)

def get_mouvements(fid=None, limit=100):
    params = {"action": "read", "table": "mouvements", "limit": str(limit)}
    if fid:
        params["franchise_id"] = str(fid)
    data = _get(params)
    produits = {str(p['id']): p.get('nom', '?') for p in get_produits(actif_only=False)}
    franchises = {str(f['id']): f['nom'] for f in get_franchises(actif_only=False)}
    users = {str(u['id']): u.get('nom_complet', '') for u in _get({"action": "read", "table": "utilisateurs"})}
    for m in data:
        m['produit_nom'] = produits.get(str(m.get('produit_id', '')), '?')
        m['franchise_nom'] = franchises.get(str(m.get('franchise_id', '')), '?')
        m['utilisateur_nom'] = users.get(str(m.get('utilisateur_id', '')), '')
    return sorted(data, key=lambda x: x.get('date_mouvement', ''), reverse=True)[:limit]

def get_alertes(fid=None):
    return _get({"action": "alertes", "franchise_id": str(fid) if fid else ""})

def get_stats(fid=None):
    return _get({"action": "stats", "franchise_id": str(fid) if fid else ""})

# === WRITE FUNCTIONS ===
def enregistrer_vente(fid, pid, qty, prix, remise=0, uid=None, note=""):
    r = _post({"action": "vente", "franchise_id": fid, "produit_id": pid, "quantite": qty, "prix_unitaire": prix, "remise": remise, "utilisateur_id": uid, "note": note})
    return r.get("total", 0)

def enregistrer_vente_multiple(fid, items, uid=None):
    api_items = [{"produit_id": i[0], "quantite": i[1], "prix_unitaire": i[2], "remise": i[3], "note": i[4]} for i in items]
    r = _post({"action": "vente_multiple", "franchise_id": fid, "items": api_items, "utilisateur_id": uid})
    return r.get("total", 0)

def update_stock(fid, pid, qty, type_mv, prix=0, note="", uid=None):
    _post({"action": "entree_stock", "franchise_id": fid, "produit_id": pid, "quantite": qty, "note": note, "utilisateur_id": uid})

def batch_stock_entry(fid, items, uid=None):
    api_items = [{"produit_id": i[0], "quantite": i[1], "note": i[2] if len(i) > 2 else ""} for i in items]
    _post({"action": "batch_stock", "franchise_id": fid, "items": api_items, "utilisateur_id": uid})

def demander_transfert(src, dest, pid, qty, uid=None, note=""):
    _post({"action": "transfert_demande", "franchise_source": src, "franchise_dest": dest, "produit_id": pid, "quantite": qty, "utilisateur_id": uid, "note": note})

def valider_transfert(tid, accepter, uid=None):
    _post({"action": "transfert_valider", "transfert_id": tid, "accepter": accepter, "utilisateur_id": uid})

def dispatch_stock(items, uid=None):
    api_items = [{"franchise_id": i[0], "produit_id": i[1], "quantite": i[2], "note": i[3] if len(i) > 3 else ""} for i in items]
    _post({"action": "dispatch", "items": api_items, "utilisateur_id": uid})

def soumettre_cloture(fid, date_cl, total_d, articles_d, comm="", uid=None):
    r = _post({"action": "cloture", "franchise_id": fid, "date_cloture": str(date_cl), "total_declare": total_d, "articles_declare": articles_d, "commentaire": comm, "utilisateur_id": uid})
    return not r.get("error")

def valider_cloture(cid, uid):
    _post({"action": "cloture_valider", "cloture_id": cid, "utilisateur_id": uid})

def enregistrer_retour(fid, pid, qty, type_r, raison="", note="", uid=None):
    _post({"action": "retour", "franchise_id": fid, "produit_id": pid, "quantite": qty, "type_retour": type_r, "raison": raison, "note": note, "utilisateur_id": uid})

def add_produit(nom, cat_id, prix_achat, prix_vente, ref="", code_barre="", desc="", fournisseur_id=None, seuil=5):
    r = _post({"action": "add_produit", "nom": nom, "categorie_id": cat_id, "prix_achat": prix_achat, "prix_vente": prix_vente, "reference": ref, "code_barre": code_barre, "description": desc, "fournisseur_id": fournisseur_id, "seuil_alerte": seuil})
    return r.get("id")

def update_produit(pid, nom, cat_id, prix_achat, prix_vente, ref, code_barre, desc, fournisseur_id, seuil, actif, user_id=None):
    _post({"action": "update_produit", "id": pid, "nom": nom, "categorie_id": cat_id, "prix_achat": prix_achat, "prix_vente": prix_vente, "reference": ref, "code_barre": code_barre, "description": desc, "fournisseur_id": fournisseur_id, "seuil_alerte": seuil, "actif": actif, "utilisateur_id": user_id})

def add_franchise(nom, adresse="", telephone="", responsable=""):
    r = _post({"action": "add_franchise", "nom": nom, "adresse": adresse, "telephone": telephone, "responsable": responsable})
    return r.get("id")

def update_franchise(fid, nom, adresse, telephone, responsable, actif):
    _post({"action": "update_row", "table": "franchises", "id": fid, "data": {"nom": nom, "adresse": adresse, "telephone": telephone, "responsable": responsable, "actif": actif}})

def get_utilisateurs():
    data = _get({"action": "read", "table": "utilisateurs"})
    franchises = {str(f['id']): f['nom'] for f in get_franchises(actif_only=False)}
    for u in data:
        u['franchise_nom'] = franchises.get(str(u.get('franchise_id', '')), '')
    return data

def add_user(username, pwd, nom, role, fid=None):
    r = _post({"action": "add_user", "username": username, "password": pwd, "nom_complet": nom, "role": role, "franchise_id": fid})
    return not r.get("error")

def reset_user_password(uid, new_pw):
    _post({"action": "change_password", "user_id": uid, "new_password": new_pw})

def add_category(nom, desc=""):
    _post({"action": "add_row", "table": "categories", "data": {"nom": nom, "description": desc}})
    return True

def add_fournisseur(nom, tel="", email="", adresse=""):
    _post({"action": "add_row", "table": "fournisseurs", "data": {"nom": nom, "telephone": tel, "email": email, "adresse": adresse, "actif": 1}})
