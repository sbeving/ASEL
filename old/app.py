"""
🏪 ASEL Mobile — Gestion de Stock & POS v2.0
"""
import streamlit as st
import pandas as pd
import plotly.express as px
from datetime import datetime, timedelta, date
import old.database as db

db.init_db()
st.set_page_config(page_title="ASEL Mobile — Stock & POS", page_icon="📱", layout="wide", initial_sidebar_state="expanded")

if "user" not in st.session_state: st.session_state.user = None
if "cart" not in st.session_state: st.session_state.cart = []

# ============================================================
# LOGIN
# ============================================================
def page_login():
    st.markdown("<div style='text-align:center;padding:3rem 0'><h1>📱 ASEL Mobile</h1><h3 style='color:#666'>Gestion de Stock & Point de Vente</h3></div>", unsafe_allow_html=True)
    c1,c2,c3 = st.columns([1,2,1])
    with c2:
        with st.form("login"):
            st.subheader("🔐 Connexion")
            u = st.text_input("Nom d'utilisateur")
            p = st.text_input("Mot de passe", type="password")
            if st.form_submit_button("Se connecter", use_container_width=True):
                user = db.verify_user(u, p)
                if user: st.session_state.user = user; st.rerun()
                else: st.error("❌ Identifiants incorrects")
        st.caption("**Demo:** admin/admin2024 · franchise1/franchise1")

# ============================================================
# SIDEBAR
# ============================================================
def sidebar():
    user = st.session_state.user
    with st.sidebar:
        st.markdown(f"### 📱 ASEL Mobile")
        st.markdown(f"**{user['nom_complet']}**")
        st.caption("🔴 Admin" if user['role']=='admin' else "🟢 Franchise")
        if user['role']=='franchise':
            fs = db.get_franchises()
            fr = next((f for f in fs if f['id']==user['franchise_id']),None)
            if fr: st.caption(f"🏪 {fr['nom']}")
        st.markdown("---")
        if user['role']=='admin':
            page = st.radio("Nav", ["📊 Dashboard","💰 Point de vente","📦 Stock","📥 Entrée stock","📤 Dispatch","🔄 Transferts","📅 Clôtures","🔙 Retours","📈 Rapports","🏪 Franchises","📋 Produits","👥 Utilisateurs","⚙️ Paramètres"], label_visibility="collapsed")
        else:
            page = st.radio("Nav", ["📊 Dashboard","💰 Point de vente","📦 Mon stock","📥 Entrée stock","🔄 Transferts","📅 Clôture du jour","🔙 Retours","📈 Rapports","⚙️ Paramètres"], label_visibility="collapsed")
        st.markdown("---")
        cart_count = len(st.session_state.cart)
        if cart_count: st.markdown(f"🛒 **Panier: {cart_count} article(s)**")
        if st.button("🚪 Déconnexion", use_container_width=True): st.session_state.user=None; st.session_state.cart=[]; st.rerun()
        return page

# ============================================================
# DASHBOARD
# ============================================================
def page_dashboard():
    user = st.session_state.user
    fid = user.get('franchise_id') if user['role']!='admin' else None
    stats = db.get_stats(fid)
    title = "📊 Dashboard Admin" if not fid else "📊 Mon Dashboard"
    st.title(title)
    c1,c2,c3,c4 = st.columns(4)
    c1.metric("📦 Stock", f"{stats['stock_total']:,}")
    c2.metric("💰 Ventes jour", f"{stats['ventes_aujourdhui']:,.0f} DT")
    c3.metric("📈 Ventes mois", f"{stats['ventes_mois']:,.0f} DT")
    c4.metric("⚠️ Alertes", stats['alertes'])
    c5,c6,c7,c8 = st.columns(4)
    c5.metric("💎 Valeur stock", f"{stats['valeur_stock']:,.0f} DT")
    c6.metric("📆 Ventes semaine", f"{stats['ventes_semaine']:,.0f} DT")
    if not fid: c7.metric("🏪 Franchises", stats['total_franchises'])
    c8.metric("🔄 Transferts", stats['transferts_attente'])
    st.markdown("---")
    col1,col2 = st.columns(2)
    with col1:
        st.subheader("📦 Stock par catégorie")
        stock = db.get_stock(fid)
        if stock:
            df = pd.DataFrame(stock)
            fig = px.bar(df.groupby('categorie_nom')['quantite'].sum().reset_index(), x='categorie_nom', y='quantite', color='categorie_nom', labels={'categorie_nom':'Catégorie','quantite':'Qté'})
            fig.update_layout(showlegend=False, height=350)
            st.plotly_chart(fig, use_container_width=True)
    with col2:
        st.subheader("⚠️ Alertes stock bas")
        alertes = db.get_alertes(fid)
        if alertes:
            df_a = pd.DataFrame(alertes)[['franchise_nom','produit_nom','quantite','seuil_alerte']]
            df_a.columns = ['Franchise','Produit','Qté','Seuil']
            st.dataframe(df_a, use_container_width=True, hide_index=True)
        else: st.success("✅ Tous les stocks sont suffisants")
    # Ventes récentes
    st.subheader("💰 Dernières ventes")
    ventes = db.get_ventes(fid)[:10]
    if ventes:
        df_v = pd.DataFrame(ventes)[['date_vente','franchise_nom','produit_nom','quantite','prix_total']]
        df_v.columns = ['Date','Franchise','Produit','Qté','Total (DT)']
        st.dataframe(df_v, use_container_width=True, hide_index=True)

# ============================================================
# POINT DE VENTE (POS)
# ============================================================
def page_pos():
    user = st.session_state.user
    st.title("💰 Point de vente")
    franchises = db.get_franchises()
    if user['role']=='admin':
        fn = st.selectbox("Franchise", [f['nom'] for f in franchises], key="pos_franchise")
        fid = next(f['id'] for f in franchises if f['nom']==fn)
    else: fid = user['franchise_id']
    
    stock = [s for s in db.get_stock(fid) if s['quantite']>0]
    
    tab1, tab2 = st.tabs(["🔍 Recherche produit", "📷 Code-barres"])
    
    with tab1:
        search = st.text_input("🔍 Rechercher un produit", placeholder="Nom, référence...")
        if search:
            filtered = [s for s in stock if search.lower() in s['produit_nom'].lower() or search.lower() in (s.get('reference','') or '').lower()]
        else: filtered = stock
        
        for s in filtered[:20]:
            col1,col2,col3,col4 = st.columns([3,1,1,1])
            col1.markdown(f"**{s['produit_nom']}** — {s['categorie_nom']}")
            col2.caption(f"Stock: {s['quantite']}")
            col3.caption(f"{s['prix_vente']} DT")
            if col4.button("➕", key=f"add_{s['produit_id']}"):
                existing = next((c for c in st.session_state.cart if c['produit_id']==s['produit_id']), None)
                if existing:
                    if existing['quantite'] < s['quantite']: existing['quantite'] += 1
                else:
                    st.session_state.cart.append({'produit_id':s['produit_id'],'nom':s['produit_nom'],'prix':s['prix_vente'],'quantite':1,'max_qty':s['quantite'],'remise':0})
                st.rerun()
    
    with tab2:
        barcode = st.text_input("📷 Scanner ou saisir le code-barres", placeholder="EAN-13, UPC...")
        if barcode:
            prod = db.get_produit_by_barcode(barcode)
            if prod:
                st.success(f"✅ {prod['nom']} — {prod['prix_vente']} DT")
                stock_item = next((s for s in stock if s['produit_id']==prod['id']), None)
                if stock_item and stock_item['quantite']>0:
                    if st.button(f"➕ Ajouter au panier", key="barcode_add"):
                        existing = next((c for c in st.session_state.cart if c['produit_id']==prod['id']), None)
                        if existing:
                            if existing['quantite']<stock_item['quantite']: existing['quantite']+=1
                        else:
                            st.session_state.cart.append({'produit_id':prod['id'],'nom':prod['nom'],'prix':prod['prix_vente'],'quantite':1,'max_qty':stock_item['quantite'],'remise':0})
                        st.rerun()
                else: st.warning("⚠️ Produit en rupture de stock")
            else: st.error("❌ Code-barres non trouvé")
    
    # PANIER
    st.markdown("---")
    st.subheader(f"🛒 Panier ({len(st.session_state.cart)} article(s))")
    if not st.session_state.cart:
        st.info("Le panier est vide")
        return
    
    total = 0
    items_to_remove = []
    for i, item in enumerate(st.session_state.cart):
        col1,col2,col3,col4,col5 = st.columns([3,1,1,1,1])
        col1.markdown(f"**{item['nom']}**")
        new_qty = col2.number_input("Qté", min_value=1, max_value=item['max_qty'], value=item['quantite'], key=f"qty_{i}")
        item['quantite'] = new_qty
        new_remise = col3.number_input("Remise %", min_value=0, max_value=100, value=item['remise'], key=f"rem_{i}")
        item['remise'] = new_remise
        line_total = item['quantite'] * item['prix'] * (1 - item['remise']/100)
        total += line_total
        col4.markdown(f"**{line_total:,.0f} DT**")
        if col5.button("🗑️", key=f"del_{i}"): items_to_remove.append(i)
    
    for i in sorted(items_to_remove, reverse=True): st.session_state.cart.pop(i)
    if items_to_remove: st.rerun()
    
    st.markdown(f"### 💰 Total: **{total:,.0f} DT**")
    
    col1, col2 = st.columns(2)
    if col1.button("✅ Valider la vente", use_container_width=True, type="primary"):
        items = [(c['produit_id'],c['quantite'],c['prix'],c['remise'],"") for c in st.session_state.cart]
        total_final = db.enregistrer_vente_multiple(fid, items, user['id'])
        st.success(f"✅ Vente enregistrée: **{total_final:,.0f} DT**")
        st.session_state.cart = []
        st.balloons()
        st.rerun()
    if col2.button("🗑️ Vider le panier", use_container_width=True):
        st.session_state.cart = []; st.rerun()

# ============================================================
# STOCK
# ============================================================
def page_stock():
    user = st.session_state.user
    fid = user.get('franchise_id') if user['role']!='admin' else None
    st.title("📦 Stock" if not fid else "📦 Mon stock")
    
    franchises = db.get_franchises()
    if not fid:
        fn = st.selectbox("Franchise", ["Toutes"] + [f['nom'] for f in franchises])
        if fn != "Toutes": fid = next(f['id'] for f in franchises if f['nom']==fn)
    
    stock = db.get_stock(fid)
    if stock:
        df = pd.DataFrame(stock)
        cats = sorted(df['categorie_nom'].unique())
        filtre = st.selectbox("Catégorie", ["Toutes"] + list(cats))
        if filtre != "Toutes": df = df[df['categorie_nom']==filtre]
        
        display = df[['franchise_nom','categorie_nom','produit_nom','reference','code_barre','quantite','prix_vente']].copy()
        display.columns = ['Franchise','Catégorie','Produit','Réf.','Code-barres','Qté','Prix (DT)']
        display['Valeur'] = display['Qté'] * display['Prix (DT)']
        st.dataframe(display, use_container_width=True, hide_index=True)
        st.markdown(f"**{display['Qté'].sum():,} unités — {display['Valeur'].sum():,.0f} DT**")
        
        # Export CSV
        csv = display.to_csv(index=False)
        st.download_button("📥 Exporter CSV", csv, "stock_asel.csv", "text/csv")

# ============================================================
# ENTREE STOCK
# ============================================================
def page_entree_stock():
    user = st.session_state.user
    st.title("📥 Entrée de stock")
    franchises = db.get_franchises()
    produits = db.get_produits()
    
    tab1, tab2 = st.tabs(["📦 Entrée simple", "📦📦 Entrée par lot"])
    
    with tab1:
        with st.form("entree_simple"):
            if user['role']=='admin':
                fn = st.selectbox("Franchise", [f['nom'] for f in franchises])
                fid = next(f['id'] for f in franchises if f['nom']==fn)
            else: fid = user['franchise_id']
            pn = st.selectbox("Produit", [f"{p['nom']} ({p['categorie_nom']})" for p in produits])
            pidx = [f"{p['nom']} ({p['categorie_nom']})" for p in produits].index(pn)
            prod = produits[pidx]
            qty = st.number_input("Quantité", min_value=1, value=1)
            note = st.text_input("Note")
            if st.form_submit_button("✅ Enregistrer", use_container_width=True):
                db.update_stock(fid, prod['id'], qty, 'entree', prod['prix_achat'], note, user['id'])
                st.success(f"✅ +{qty}x {prod['nom']} ajouté(s)!")
                st.rerun()
    
    with tab2:
        st.markdown("**Ajoutez plusieurs produits d'un coup:**")
        if user['role']=='admin':
            fn2 = st.selectbox("Franchise (lot)", [f['nom'] for f in franchises], key="batch_f")
            fid2 = next(f['id'] for f in franchises if f['nom']==fn2)
        else: fid2 = user['franchise_id']
        
        if 'batch_items' not in st.session_state: st.session_state.batch_items = []
        
        col1,col2,col3 = st.columns([3,1,1])
        with col1: bp = st.selectbox("Produit (lot)", [f"{p['nom']}" for p in produits], key="batch_p")
        with col2: bq = st.number_input("Qté", min_value=1, value=1, key="batch_q")
        with col3:
            st.write(""); st.write("")
            if st.button("➕ Ajouter au lot"):
                pidx = [p['nom'] for p in produits].index(bp)
                st.session_state.batch_items.append((produits[pidx]['id'], bq, produits[pidx]['nom']))
                st.rerun()
        
        if st.session_state.batch_items:
            for i,(pid,q,nom) in enumerate(st.session_state.batch_items):
                st.markdown(f"  • **{nom}** × {q}")
            col1,col2 = st.columns(2)
            if col1.button("✅ Valider le lot", use_container_width=True):
                items = [(pid,q,"Lot") for pid,q,_ in st.session_state.batch_items]
                db.batch_stock_entry(fid2, items, user['id'])
                st.success(f"✅ {len(items)} produits ajoutés au stock!")
                st.session_state.batch_items = []; st.rerun()
            if col2.button("🗑️ Vider le lot", use_container_width=True):
                st.session_state.batch_items = []; st.rerun()

# ============================================================
# DISPATCH (Admin)
# ============================================================
def page_dispatch():
    st.title("📤 Dispatch vers franchises")
    franchises = db.get_franchises()
    produits = db.get_produits()
    
    if 'dispatch_items' not in st.session_state: st.session_state.dispatch_items = []
    
    col1,col2,col3,col4 = st.columns([2,2,1,1])
    with col1: df_ = st.selectbox("Franchise dest.", [f['nom'] for f in franchises], key="disp_f")
    with col2: dp = st.selectbox("Produit", [p['nom'] for p in produits], key="disp_p")
    with col3: dq = st.number_input("Qté", min_value=1, value=1, key="disp_q")
    with col4:
        st.write(""); st.write("")
        if st.button("➕", key="disp_add"):
            fid = next(f['id'] for f in franchises if f['nom']==df_)
            pid = next(p['id'] for p in produits if p['nom']==dp)
            st.session_state.dispatch_items.append((fid, pid, dq, df_, dp))
            st.rerun()
    
    if st.session_state.dispatch_items:
        st.markdown("### 📋 Dispatch en cours")
        for i,(fid,pid,q,fn,pn) in enumerate(st.session_state.dispatch_items):
            st.markdown(f"  • **{pn}** × {q} → {fn}")
        
        col1,col2 = st.columns(2)
        if col1.button("✅ Exécuter le dispatch", use_container_width=True, type="primary"):
            items = [(fid,pid,q,"Dispatch admin") for fid,pid,q,_,_ in st.session_state.dispatch_items]
            db.dispatch_stock(items, st.session_state.user['id'])
            st.success(f"✅ {len(items)} dispatch(s) effectué(s)!")
            st.session_state.dispatch_items = []; st.rerun()
        if col2.button("🗑️ Annuler", use_container_width=True):
            st.session_state.dispatch_items = []; st.rerun()

# ============================================================
# TRANSFERTS
# ============================================================
def page_transferts():
    user = st.session_state.user
    st.title("🔄 Transferts inter-franchises")
    franchises = db.get_franchises()
    fid = user.get('franchise_id') if user['role']!='admin' else None
    
    tab1, tab2 = st.tabs(["📤 Demander", "📋 Historique"])
    
    with tab1:
        with st.form("transfert"):
            if user['role']=='admin':
                src_n = st.selectbox("De (source)", [f['nom'] for f in franchises])
                src = next(f['id'] for f in franchises if f['nom']==src_n)
                dest_n = st.selectbox("Vers (destination)", [f['nom'] for f in franchises if f['nom']!=src_n])
            else:
                src = fid
                dest_n = st.selectbox("Demander à", [f['nom'] for f in franchises if f['id']!=fid])
                src_n = dest_n
                # Swap: franchise requests FROM another franchise
                src = next(f['id'] for f in franchises if f['nom']==dest_n)
            dest = next(f['id'] for f in franchises if f['nom']==dest_n) if user['role']=='admin' else fid
            
            produits = db.get_produits()
            pn = st.selectbox("Produit", [p['nom'] for p in produits])
            pid = next(p['id'] for p in produits if p['nom']==pn)
            qty = st.number_input("Quantité", min_value=1, value=1)
            note = st.text_input("Note")
            if st.form_submit_button("📤 Demander le transfert", use_container_width=True):
                db.demander_transfert(src, dest, pid, qty, user['id'], note)
                st.success("✅ Demande de transfert envoyée!")
                st.rerun()
    
    with tab2:
        transferts = db.get_transferts(fid)
        if transferts:
            for t in transferts:
                with st.container():
                    col1,col2,col3,col4 = st.columns([3,1,1,2])
                    col1.markdown(f"**{t['produit_nom']}** × {t['quantite']}")
                    col1.caption(f"{t['source_nom']} → {t['dest_nom']}")
                    badge = {"en_attente":"🟡 En attente","accepte":"🟢 Accepté","rejete":"🔴 Rejeté"}
                    col2.markdown(badge.get(t['statut'], t['statut']))
                    col3.caption(t['date_demande'][:10] if t['date_demande'] else "")
                    if t['statut']=='en_attente' and user['role']=='admin':
                        if col4.button("✅ Accepter", key=f"acc_{t['id']}"):
                            db.valider_transfert(t['id'], True, user['id']); st.rerun()
                        if col4.button("❌ Rejeter", key=f"rej_{t['id']}"):
                            db.valider_transfert(t['id'], False, user['id']); st.rerun()
        else: st.info("Aucun transfert")

# ============================================================
# CLOTURES
# ============================================================
def page_clotures():
    user = st.session_state.user
    fid = user.get('franchise_id') if user['role']!='admin' else None
    st.title("📅 Clôture journalière" if fid else "📅 Clôtures")
    
    if fid or user['role']=='admin':
        tab1, tab2 = st.tabs(["📝 Soumettre", "📋 Historique"])
        with tab1:
            with st.form("cloture"):
                if user['role']=='admin':
                    fn = st.selectbox("Franchise", [f['nom'] for f in db.get_franchises()])
                    fid_cl = next(f['id'] for f in db.get_franchises() if f['nom']==fn)
                else: fid_cl = fid
                date_cl = st.date_input("Date", value=date.today())
                total_d = st.number_input("Total ventes déclaré (DT)", min_value=0.0, step=1.0)
                articles_d = st.number_input("Nombre d'articles déclaré", min_value=0, step=1)
                comm = st.text_area("Commentaire")
                if st.form_submit_button("📅 Soumettre la clôture", use_container_width=True):
                    if db.soumettre_cloture(fid_cl, date_cl, total_d, articles_d, comm, user['id']):
                        st.success("✅ Clôture soumise!")
                    else: st.error("❌ Clôture déjà soumise pour cette date")
        with tab2:
            clotures = db.get_clotures(fid)
            if clotures:
                for cl in clotures:
                    with st.container():
                        col1,col2,col3,col4 = st.columns([2,2,2,1])
                        col1.markdown(f"**{cl['date_cloture']}** — {cl['franchise_nom']}")
                        col2.markdown(f"Déclaré: **{cl['total_ventes_declare']:,.0f} DT** ({cl['total_articles_declare']} art.)")
                        col3.markdown(f"Système: **{cl['total_ventes_systeme']:,.0f} DT** ({cl['total_articles_systeme']} art.)")
                        diff = cl['total_ventes_declare'] - cl['total_ventes_systeme']
                        badge = "✅ Validé" if cl['valide'] else ("🟡 En attente" if abs(diff)<1 else f"⚠️ Écart: {diff:+,.0f} DT")
                        col4.markdown(badge)
                        if not cl['valide'] and user['role']=='admin':
                            if col4.button("✅ Valider", key=f"val_cl_{cl['id']}"):
                                db.valider_cloture(cl['id'], user['id']); st.rerun()

# ============================================================
# RETOURS
# ============================================================
def page_retours():
    user = st.session_state.user
    fid = user.get('franchise_id') if user['role']!='admin' else None
    st.title("🔙 Retours & échanges")
    
    tab1, tab2 = st.tabs(["📝 Nouveau retour", "📋 Historique"])
    with tab1:
        with st.form("retour"):
            franchises = db.get_franchises()
            if user['role']=='admin':
                fn = st.selectbox("Franchise", [f['nom'] for f in franchises])
                fid_r = next(f['id'] for f in franchises if f['nom']==fn)
            else: fid_r = fid
            produits = db.get_produits()
            pn = st.selectbox("Produit", [p['nom'] for p in produits])
            pid = next(p['id'] for p in produits if p['nom']==pn)
            qty = st.number_input("Quantité", min_value=1, value=1)
            type_r = st.selectbox("Type", ["retour", "echange"])
            raison = st.text_input("Raison")
            note = st.text_area("Note")
            if st.form_submit_button("🔙 Enregistrer le retour", use_container_width=True):
                db.enregistrer_retour(fid_r, pid, qty, type_r, raison, note, user['id'])
                st.success("✅ Retour enregistré! Stock mis à jour." if type_r=='retour' else "✅ Échange enregistré!")
                st.rerun()
    with tab2:
        retours = db.get_retours(fid)
        if retours:
            df = pd.DataFrame(retours)[['date_retour','franchise_nom','produit_nom','quantite','type_retour','raison']]
            df.columns = ['Date','Franchise','Produit','Qté','Type','Raison']
            st.dataframe(df, use_container_width=True, hide_index=True)

# ============================================================
# RAPPORTS
# ============================================================
def page_rapports():
    user = st.session_state.user
    fid = user.get('franchise_id') if user['role']!='admin' else None
    st.title("📈 Rapports")
    
    franchises = db.get_franchises()
    if not fid:
        fn = st.selectbox("Franchise", ["Toutes"] + [f['nom'] for f in franchises])
        if fn != "Toutes": fid = next(f['id'] for f in franchises if f['nom']==fn)
    
    c1,c2 = st.columns(2)
    d1 = c1.date_input("Du", value=date.today()-timedelta(days=30))
    d2 = c2.date_input("Au", value=date.today())
    
    ventes = db.get_ventes(fid, d1, d2)
    if not ventes: st.info("Aucune donnée"); return
    
    df = pd.DataFrame(ventes)
    st.subheader("📊 Résumé")
    c1,c2,c3,c4 = st.columns(4)
    c1.metric("💰 CA", f"{df['prix_total'].sum():,.0f} DT")
    c2.metric("📦 Articles", f"{df['quantite'].sum():,}")
    c3.metric("🧾 Transactions", f"{len(df):,}")
    c4.metric("💵 Panier moyen", f"{df['prix_total'].mean():,.0f} DT")
    
    st.markdown("---")
    col1,col2 = st.columns(2)
    with col1:
        st.subheader("🏆 Top produits")
        top = df.groupby('produit_nom')['prix_total'].sum().sort_values(ascending=False).head(10).reset_index()
        fig = px.bar(top, x='prix_total', y='produit_nom', orientation='h', labels={'prix_total':'CA (DT)','produit_nom':''})
        fig.update_layout(yaxis={'categoryorder':'total ascending'}, height=400)
        st.plotly_chart(fig, use_container_width=True)
    with col2:
        st.subheader("📊 Par catégorie")
        fig2 = px.pie(df.groupby('categorie_nom')['prix_total'].sum().reset_index(), values='prix_total', names='categorie_nom')
        fig2.update_layout(height=400)
        st.plotly_chart(fig2, use_container_width=True)
    
    st.subheader("📈 Évolution")
    df['date_vente'] = pd.to_datetime(df['date_vente'])
    jour = df.groupby('date_vente')['prix_total'].sum().reset_index()
    fig3 = px.area(jour, x='date_vente', y='prix_total', labels={'date_vente':'Date','prix_total':'CA (DT)'})
    st.plotly_chart(fig3, use_container_width=True)
    
    if user['role']=='admin':
        st.subheader("🏪 CA par franchise")
        fig4 = px.bar(df.groupby('franchise_nom')['prix_total'].sum().reset_index(), x='franchise_nom', y='prix_total', color='franchise_nom', labels={'franchise_nom':'','prix_total':'CA (DT)'})
        fig4.update_layout(showlegend=False)
        st.plotly_chart(fig4, use_container_width=True)
    
    # Export
    export = df[['date_vente','franchise_nom','produit_nom','quantite','prix_unitaire','remise','prix_total','vendeur']].copy()
    export.columns = ['Date','Franchise','Produit','Qté','Prix unit.','Remise %','Total','Vendeur']
    st.download_button("📥 Exporter CSV", export.to_csv(index=False), "ventes_asel.csv", "text/csv")

# ============================================================
# FRANCHISES (Admin)
# ============================================================
def page_franchises():
    st.title("🏪 Gestion des franchises")
    with st.expander("➕ Ajouter une franchise"):
        with st.form("add_f"):
            nom = st.text_input("Nom"); adr = st.text_input("Adresse"); tel = st.text_input("Téléphone"); resp = st.text_input("Responsable")
            if st.form_submit_button("Ajouter", use_container_width=True):
                if nom:
                    r = db.add_franchise(nom, adr, tel, resp)
                    if r: st.success(f"✅ Franchise ajoutée!"); st.rerun()
                    else: st.error("❌ Nom déjà existant")
    
    franchises = db.get_franchises(actif_only=False)
    for f in franchises:
        with st.expander(f"{'🟢' if f['actif'] else '🔴'} {f['nom']}"):
            with st.form(f"edit_f_{f['id']}"):
                nom = st.text_input("Nom", value=f['nom'], key=f"fn_{f['id']}")
                adr = st.text_input("Adresse", value=f.get('adresse','') or '', key=f"fa_{f['id']}")
                tel = st.text_input("Téléphone", value=f.get('telephone','') or '', key=f"ft_{f['id']}")
                resp = st.text_input("Responsable", value=f.get('responsable','') or '', key=f"fr_{f['id']}")
                actif = st.checkbox("Actif", value=bool(f['actif']), key=f"fac_{f['id']}")
                if st.form_submit_button("💾 Sauvegarder", use_container_width=True):
                    db.update_franchise(f['id'], nom, adr, tel, resp, int(actif)); st.success("✅ Mis à jour!"); st.rerun()

# ============================================================
# PRODUITS (Admin)
# ============================================================
def page_produits():
    st.title("📋 Gestion des produits")
    categories = db.get_categories()
    fournisseurs = db.get_fournisseurs()
    
    tab1, tab2, tab3 = st.tabs(["📋 Liste", "➕ Ajouter", "📤 Import CSV"])
    
    with tab1:
        filtre = st.selectbox("Catégorie", ["Toutes"] + [c['nom'] for c in categories])
        cat_id = next((c['id'] for c in categories if c['nom']==filtre), None) if filtre!="Toutes" else None
        produits = db.get_produits(cat_id, actif_only=False)
        if produits:
            df = pd.DataFrame(produits)[['nom','categorie_nom','reference','code_barre','prix_achat','prix_vente','actif']]
            df.columns = ['Produit','Catégorie','Réf.','Code-barres','Achat','Vente','Actif']
            df['Marge'] = df['Vente'] - df['Achat']
            df['Actif'] = df['Actif'].map({1:'✅',0:'❌'})
            st.dataframe(df, use_container_width=True, hide_index=True)
    
    with tab2:
        with st.form("add_p"):
            nom = st.text_input("Nom du produit")
            cat = st.selectbox("Catégorie", [c['nom'] for c in categories])
            cat_id = next(c['id'] for c in categories if c['nom']==cat)
            c1,c2 = st.columns(2)
            pa = c1.number_input("Prix achat (DT)", min_value=0.0, step=1.0)
            pv = c2.number_input("Prix vente (DT)", min_value=0.0, step=1.0)
            ref = st.text_input("Référence")
            cb = st.text_input("Code-barres")
            four = st.selectbox("Fournisseur", ["—"] + [f['nom'] for f in fournisseurs])
            four_id = next((f['id'] for f in fournisseurs if f['nom']==four), None) if four!="—" else None
            seuil = st.number_input("Seuil d'alerte", min_value=0, value=5)
            if st.form_submit_button("➕ Ajouter", use_container_width=True):
                if nom and pv > 0:
                    db.add_produit(nom, cat_id, pa, pv, ref, cb, "", four_id, seuil)
                    st.success(f"✅ {nom} ajouté!"); st.rerun()
    
    with tab3:
        st.markdown("**Format CSV:** `nom,categorie,prix_achat,prix_vente,reference,code_barre`")
        uploaded = st.file_uploader("📤 Charger un fichier CSV", type="csv")
        if uploaded:
            content = uploaded.read().decode("utf-8")
            st.code(content[:500])
            if st.button("📥 Importer"):
                count = db.import_produits_csv(content)
                st.success(f"✅ {count} produits importés!"); st.rerun()

# ============================================================
# UTILISATEURS (Admin)
# ============================================================
def page_utilisateurs():
    st.title("👥 Gestion des utilisateurs")
    franchises = db.get_franchises()
    
    with st.expander("➕ Ajouter un utilisateur"):
        with st.form("add_u"):
            un = st.text_input("Nom d'utilisateur"); pw = st.text_input("Mot de passe", type="password")
            nc = st.text_input("Nom complet"); role = st.selectbox("Rôle", ["franchise","admin","viewer"])
            fid = None
            if role == "franchise":
                fn = st.selectbox("Franchise", [f['nom'] for f in franchises])
                fid = next(f['id'] for f in franchises if f['nom']==fn)
            if st.form_submit_button("Ajouter", use_container_width=True):
                if un and pw and nc:
                    if db.add_user(un, pw, nc, role, fid): st.success("✅ Créé!"); st.rerun()
                    else: st.error("❌ Nom d'utilisateur déjà pris")
    
    users = db.get_utilisateurs()
    for u in users:
        with st.expander(f"{'🔴' if u['role']=='admin' else '🟢'} {u['nom_complet']} ({u['nom_utilisateur']})"):
            col1,col2 = st.columns(2)
            col1.caption(f"Rôle: {u['role']}")
            col1.caption(f"Franchise: {u.get('franchise_nom','—') or '—'}")
            col2.caption(f"Actif: {'✅' if u['actif'] else '❌'}")
            new_pw = col2.text_input("Nouveau mdp", type="password", key=f"pw_{u['id']}")
            if new_pw:
                if col2.button("🔑 Reset", key=f"rst_{u['id']}"):
                    db.reset_user_password(u['id'], new_pw); st.success("✅ Mot de passe changé!")

# ============================================================
# PARAMETRES
# ============================================================
def page_parametres():
    user = st.session_state.user
    st.title("⚙️ Paramètres")
    with st.form("change_pw"):
        st.subheader("🔑 Changer mon mot de passe")
        new_pw = st.text_input("Nouveau mot de passe", type="password")
        confirm = st.text_input("Confirmer", type="password")
        if st.form_submit_button("Changer", use_container_width=True):
            if new_pw and new_pw == confirm:
                db.change_password(user['id'], new_pw)
                st.success("✅ Mot de passe changé!")
            elif new_pw != confirm: st.error("❌ Les mots de passe ne correspondent pas")
    
    if user['role'] == 'admin':
        st.markdown("---")
        st.subheader("📂 Catégories")
        with st.form("add_cat"):
            cn = st.text_input("Nouvelle catégorie")
            cd = st.text_input("Description")
            if st.form_submit_button("Ajouter"):
                if cn:
                    if db.add_category(cn, cd): st.success("✅ Catégorie ajoutée!"); st.rerun()
                    else: st.error("❌ Existe déjà")
        
        st.subheader("🏭 Fournisseurs")
        with st.form("add_four"):
            fn = st.text_input("Nom fournisseur"); ft = st.text_input("Téléphone"); fe = st.text_input("Email")
            if st.form_submit_button("Ajouter"):
                if fn: db.add_fournisseur(fn, ft, fe); st.success("✅ Fournisseur ajouté!"); st.rerun()
        
        fournisseurs = db.get_fournisseurs()
        for f in fournisseurs:
            st.caption(f"🏭 {f['nom']} — 📞 {f.get('telephone','') or '—'} — ✉️ {f.get('email','') or '—'}")

# ============================================================
# ROUTEUR
# ============================================================
def main():
    if not st.session_state.user: page_login(); return
    page = sidebar()
    user = st.session_state.user
    
    routes = {
        "📊 Dashboard": page_dashboard,
        "💰 Point de vente": page_pos,
        "📦 Stock": page_stock, "📦 Mon stock": page_stock,
        "📥 Entrée stock": page_entree_stock,
        "📤 Dispatch": page_dispatch,
        "🔄 Transferts": page_transferts,
        "📅 Clôtures": page_clotures, "📅 Clôture du jour": page_clotures,
        "🔙 Retours": page_retours,
        "📈 Rapports": page_rapports, "📈 Mes rapports": page_rapports,
        "🏪 Franchises": page_franchises,
        "📋 Produits": page_produits,
        "👥 Utilisateurs": page_utilisateurs,
        "⚙️ Paramètres": page_parametres,
    }
    
    handler = routes.get(page)
    if handler: handler()

if __name__ == "__main__": main()
