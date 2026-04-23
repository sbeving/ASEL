"""
ASEL Mobile — Seed Real Data
Run this ONCE to populate the Google Sheet with real ASEL data.
Replaces the default seed data.

Usage: 
  Set your Apps Script URL below, then run:
  python3 seed_real_data.py
"""
import requests
import json
import time

# === CONFIG ===
API_URL = "https://script.google.com/macros/s/AKfycbz4klgmapT3Hz80yhhY5X5UlIfOk-ZV6kPl3zWZW-mw2OtRl5WcOz2d_vrZvQTT90GomQ/exec"

def call_api(payload):
    """Call Apps Script via GET with payload (POST redirect workaround)"""
    r = requests.get(API_URL, params={"action": payload["action"], "payload": json.dumps(payload)}, timeout=60)
    return r.json()

def read(table):
    r = requests.get(API_URL, params={"action": "read", "table": table}, timeout=30)
    return r.json()

# Load clean data
data = json.load(open("clean_data.json"))

print("🏪 ASEL Mobile — Import des données réelles")
print(f"   {len(data['products'])} produits, {len(data['categories'])} catégories")
print()

# Check if already seeded
existing = read("franchises")
if len(existing) > 0:
    print(f"⚠️  La base contient déjà {len(existing)} franchise(s).")
    print("   Pour réinitialiser, supprimez manuellement les données des onglets Google Sheets.")
    print("   Ou continuez pour ajouter les données manquantes.")
    resp = input("   Continuer? (o/n): ")
    if resp.lower() != 'o':
        exit()

print("\n📋 Étape 1/6 — Franchises...")
franchises = [
    {"nom": "ASEL Mobile — Mourouj", "adresse": "Mourouj, Ben Arous", "telephone": "216 52 123 456", "responsable": "Gérant Mourouj"},
    {"nom": "ASEL Mobile — Dar Fadhal", "adresse": "Dar Fadhal, Manouba", "telephone": "216 52 234 567", "responsable": "Gérant Dar Fadhal"},
]

existing_franchises = {f['nom'] for f in read("franchises")}
for f in franchises:
    if f['nom'] not in existing_franchises:
        r = call_api({"action": "add_franchise", **f})
        print(f"   ✅ {f['nom']}")
        time.sleep(1)
    else:
        print(f"   ⏭️  {f['nom']} (existe déjà)")

print("\n📁 Étape 2/6 — Catégories...")
existing_cats = {c['nom'] for c in read("categories")}
for cat in data['categories']:
    if cat not in existing_cats:
        call_api({"action": "add_row", "table": "categories", "data": {"nom": cat, "description": ""}})
        print(f"   ✅ {cat}")
        time.sleep(0.5)
    else:
        print(f"   ⏭️  {cat}")

print("\n🏭 Étape 3/6 — Fournisseurs...")
existing_fours = {f['nom'] for f in read("fournisseurs")}
for four in data['fournisseurs']:
    if four not in existing_fours:
        call_api({"action": "add_row", "table": "fournisseurs", "data": {"nom": four, "telephone": "", "email": "", "adresse": "Tunisie", "actif": 1}})
        print(f"   ✅ {four}")
        time.sleep(0.5)
    else:
        print(f"   ⏭️  {four}")

# Reload IDs
cats = {c['nom']: c['id'] for c in read("categories")}
fours = {f['nom']: f['id'] for f in read("fournisseurs")}
franchises_db = read("franchises")
franchise_ids = {f['nom']: f['id'] for f in franchises_db}

mourouj_id = None
dar_fadhal_id = None
for f in franchises_db:
    if 'Mourouj' in f['nom']: mourouj_id = f['id']
    if 'Dar Fadhal' in f['nom'] or 'Fadhal' in f['nom']: dar_fadhal_id = f['id']

print(f"\n   Franchise IDs: Mourouj={mourouj_id}, Dar Fadhal={dar_fadhal_id}")

print(f"\n📦 Étape 4/6 — Produits ({len(data['products'])})...")
for i, p in enumerate(data['products']):
    cat_id = cats.get(p['categorie'], 1)
    four_id = fours.get(p['fournisseur'], '') if p['fournisseur'] else ''
    
    r = call_api({
        "action": "add_produit",
        "nom": p['nom'][:60],
        "categorie_id": cat_id,
        "prix_achat": p['prix_achat'],
        "prix_vente": p['prix_vente'],
        "reference": p['reference'],
        "code_barre": "",
        "description": f"{p['marque']} - {p['reference']}",
        "fournisseur_id": four_id,
        "seuil_alerte": 3
    })
    
    pid = r.get('id', '?')
    print(f"   [{i+1}/{len(data['products'])}] ✅ {p['nom'][:40]} (id={pid})")
    time.sleep(0.8)  # Rate limit

print("\n📊 Étape 5/6 — Stock initial...")
# Reload products to get IDs
produits_db = read("produits")
# Match by name
prod_ids = {}
for p in produits_db:
    prod_ids[p['nom']] = p['id']

stock_items = []
for p in data['products']:
    pid = prod_ids.get(p['nom'][:60])
    if not pid:
        continue
    
    if mourouj_id and p['stock_mourouj'] > 0:
        stock_items.append((mourouj_id, pid, p['stock_mourouj']))
    if dar_fadhal_id and p['stock_dar_fadhal'] > 0:
        stock_items.append((dar_fadhal_id, pid, p['stock_dar_fadhal']))

print(f"   {len(stock_items)} entrées de stock à créer...")
for i, (fid, pid, qty) in enumerate(stock_items):
    call_api({
        "action": "entree_stock",
        "franchise_id": fid,
        "produit_id": pid,
        "quantite": qty,
        "note": "Stock initial import",
        "utilisateur_id": 1
    })
    if (i+1) % 10 == 0:
        print(f"   [{i+1}/{len(stock_items)}] ...")
    time.sleep(0.5)

print(f"   ✅ {len(stock_items)} entrées de stock importées")

print("\n👥 Étape 6/6 — Utilisateurs...")
users = [
    {"username": "admin", "password": "admin2024", "nom_complet": "Administrateur", "role": "admin", "franchise_id": ""},
    {"username": "mourouj", "password": "mourouj2024", "nom_complet": "Gérant Mourouj", "role": "franchise", "franchise_id": mourouj_id},
    {"username": "darfadhal", "password": "darfadhal2024", "nom_complet": "Gérant Dar Fadhal", "role": "franchise", "franchise_id": dar_fadhal_id},
]

existing_users = {u['nom_utilisateur'] for u in read("utilisateurs")}
for u in users:
    if u['username'] not in existing_users:
        call_api({"action": "add_user", **u})
        print(f"   ✅ {u['username']} ({u['role']})")
        time.sleep(0.5)
    else:
        print(f"   ⏭️  {u['username']}")

print("\n✅ IMPORT TERMINÉ!")
print(f"   🏪 Franchises: Mourouj, Dar Fadhal")
print(f"   📦 Produits: {len(data['products'])}")
print(f"   📊 Stock: {len(stock_items)} entrées")
print(f"\n   Comptes:")
print(f"   - admin / admin2024")
print(f"   - mourouj / mourouj2024")
print(f"   - darfadhal / darfadhal2024")
