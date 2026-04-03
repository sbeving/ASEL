"""
🏪 ASEL Mobile — Gestion de Stock
Application principale Streamlit
"""
import streamlit as st
import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
from datetime import datetime, timedelta, date
import database as db

# --- Init ---
db.init_db()

# --- Config page ---
st.set_page_config(
    page_title="ASEL Mobile — Gestion de Stock",
    page_icon="📱",
    layout="wide",
    initial_sidebar_state="expanded"
)

# --- Session State ---
if "user" not in st.session_state:
    st.session_state.user = None

# --- Authentification ---
def page_login():
    st.markdown("""
    <div style="text-align: center; padding: 2rem 0;">
        <h1>📱 ASEL Mobile</h1>
        <h3 style="color: #666;">Système de Gestion de Stock</h3>
    </div>
    """, unsafe_allow_html=True)
    
    col1, col2, col3 = st.columns([1, 2, 1])
    with col2:
        with st.form("login_form"):
            st.subheader("🔐 Connexion")
            username = st.text_input("Nom d'utilisateur")
            password = st.text_input("Mot de passe", type="password")
            submitted = st.form_submit_button("Se connecter", use_container_width=True)
            
            if submitted:
                user = db.verify_user(username, password)
                if user:
                    st.session_state.user = user
                    st.rerun()
                else:
                    st.error("❌ Identifiants incorrects")
        
        st.markdown("---")
        st.caption("**Comptes de démonstration:**")
        st.caption("Admin: `admin` / `admin2024`")
        st.caption("Franchise: `franchise1` / `franchise1`")

# --- Sidebar ---
def sidebar():
    user = st.session_state.user
    with st.sidebar:
        st.markdown(f"### 📱 ASEL Mobile")
        st.markdown(f"**{user['nom_complet']}**")
        role_badge = "🔴 Admin" if user['role'] == 'admin' else "🟢 Franchise"
        st.caption(role_badge)
        
        if user['role'] == 'franchise':
            franchises = db.get_franchises()
            franchise = next((f for f in franchises if f['id'] == user['franchise_id']), None)
            if franchise:
                st.caption(f"🏪 {franchise['nom']}")
        
        st.markdown("---")
        
        if user['role'] == 'admin':
            page = st.radio("Navigation", [
                "📊 Tableau de bord",
                "📦 Stock global",
                "💰 Ventes",
                "📥 Entrée de stock",
                "🏪 Franchises",
                "📋 Produits",
                "👥 Utilisateurs",
                "📈 Rapports",
            ], label_visibility="collapsed")
        else:
            page = st.radio("Navigation", [
                "📊 Tableau de bord",
                "📦 Mon stock",
                "💰 Enregistrer une vente",
                "📥 Entrée de stock",
                "📈 Mes rapports",
            ], label_visibility="collapsed")
        
        st.markdown("---")
        if st.button("🚪 Déconnexion", use_container_width=True):
            st.session_state.user = None
            st.rerun()
        
        return page

# --- Dashboard Admin ---
def page_dashboard_admin():
    st.title("📊 Tableau de bord — Administration")
    
    stats = db.get_stats_globales()
    
    # KPIs
    c1, c2, c3, c4 = st.columns(4)
    c1.metric("🏪 Franchises", stats['total_franchises'])
    c2.metric("📦 Stock total", f"{stats['stock_total']:,} unités")
    c3.metric("💰 Ventes aujourd'hui", f"{stats['ventes_aujourdhui']:,.0f} DT")
    c4.metric("⚠️ Alertes stock", stats['alertes_stock'])
    
    c5, c6 = st.columns(2)
    c5.metric("💎 Valeur du stock", f"{stats['valeur_stock']:,.0f} DT")
    c6.metric("📈 Ventes ce mois", f"{stats['ventes_ce_mois']:,.0f} DT")
    
    st.markdown("---")
    
    # Stock par franchise
    col1, col2 = st.columns(2)
    
    with col1:
        st.subheader("📦 Stock par franchise")
        stock_data = db.get_stock()
        if stock_data:
            df = pd.DataFrame(stock_data)
            stock_par_franchise = df.groupby('franchise_nom')['quantite'].sum().reset_index()
            fig = px.bar(stock_par_franchise, x='franchise_nom', y='quantite',
                        color='franchise_nom', title="Stock total par franchise",
                        labels={'franchise_nom': 'Franchise', 'quantite': 'Quantité'})
            fig.update_layout(showlegend=False)
            st.plotly_chart(fig, use_container_width=True)
    
    with col2:
        st.subheader("📊 Stock par catégorie")
        if stock_data:
            stock_par_cat = df.groupby('categorie_nom')['quantite'].sum().reset_index()
            fig2 = px.pie(stock_par_cat, values='quantite', names='categorie_nom',
                         title="Répartition du stock par catégorie")
            st.plotly_chart(fig2, use_container_width=True)
    
    # Alertes
    st.subheader("⚠️ Alertes de stock bas")
    alertes = db.get_alertes_stock(seuil=5)
    if alertes:
        df_alertes = pd.DataFrame(alertes)[['franchise_nom', 'produit_nom', 'reference', 'categorie_nom', 'quantite']]
        df_alertes.columns = ['Franchise', 'Produit', 'Réf.', 'Catégorie', 'Qté']
        st.dataframe(df_alertes, use_container_width=True, hide_index=True)
    else:
        st.success("✅ Aucune alerte — tous les stocks sont suffisants")

# --- Dashboard Franchise ---
def page_dashboard_franchise():
    user = st.session_state.user
    franchise_id = user['franchise_id']
    franchises = db.get_franchises()
    franchise = next((f for f in franchises if f['id'] == franchise_id), {})
    
    st.title(f"📊 Tableau de bord — {franchise.get('nom', 'Ma franchise')}")
    
    # KPIs franchise
    stock = db.get_stock(franchise_id)
    ventes_jour = db.get_ventes(franchise_id, date_debut=date.today(), date_fin=date.today())
    alertes = db.get_alertes_stock(seuil=5, franchise_id=franchise_id)
    
    total_stock = sum(s['quantite'] for s in stock)
    valeur_stock = sum(s['quantite'] * s['prix_vente'] for s in stock)
    ca_jour = sum(v['prix_total'] for v in ventes_jour)
    
    c1, c2, c3, c4 = st.columns(4)
    c1.metric("📦 Stock total", f"{total_stock:,} unités")
    c2.metric("💎 Valeur", f"{valeur_stock:,.0f} DT")
    c3.metric("💰 Ventes aujourd'hui", f"{ca_jour:,.0f} DT")
    c4.metric("⚠️ Alertes", len(alertes))
    
    st.markdown("---")
    
    col1, col2 = st.columns(2)
    with col1:
        st.subheader("📦 Mon stock par catégorie")
        if stock:
            df = pd.DataFrame(stock)
            stock_cat = df.groupby('categorie_nom')['quantite'].sum().reset_index()
            fig = px.bar(stock_cat, x='categorie_nom', y='quantite', color='categorie_nom',
                        labels={'categorie_nom': 'Catégorie', 'quantite': 'Quantité'})
            fig.update_layout(showlegend=False)
            st.plotly_chart(fig, use_container_width=True)
    
    with col2:
        st.subheader("💰 Ventes récentes")
        ventes_recentes = db.get_ventes(franchise_id)[:10]
        if ventes_recentes:
            df_v = pd.DataFrame(ventes_recentes)[['date_vente', 'produit_nom', 'quantite', 'prix_total']]
            df_v.columns = ['Date', 'Produit', 'Qté', 'Total (DT)']
            st.dataframe(df_v, use_container_width=True, hide_index=True)
        else:
            st.info("Aucune vente enregistrée")
    
    if alertes:
        st.subheader("⚠️ Stock bas")
        df_a = pd.DataFrame(alertes)[['produit_nom', 'categorie_nom', 'quantite']]
        df_a.columns = ['Produit', 'Catégorie', 'Qté']
        st.dataframe(df_a, use_container_width=True, hide_index=True)

# --- Stock global (admin) ---
def page_stock_global():
    st.title("📦 Stock global — Toutes les franchises")
    
    franchises = db.get_franchises()
    filtre_franchise = st.selectbox("Filtrer par franchise", ["Toutes"] + [f['nom'] for f in franchises])
    
    franchise_id = None
    if filtre_franchise != "Toutes":
        franchise_id = next(f['id'] for f in franchises if f['nom'] == filtre_franchise)
    
    stock = db.get_stock(franchise_id)
    if stock:
        df = pd.DataFrame(stock)
        display_df = df[['franchise_nom', 'categorie_nom', 'produit_nom', 'reference', 'quantite', 'prix_vente']].copy()
        display_df.columns = ['Franchise', 'Catégorie', 'Produit', 'Réf.', 'Quantité', 'Prix (DT)']
        display_df['Valeur (DT)'] = display_df['Quantité'] * display_df['Prix (DT)']
        
        st.dataframe(display_df, use_container_width=True, hide_index=True)
        
        st.markdown(f"**Total:** {display_df['Quantité'].sum():,} unités — **Valeur:** {display_df['Valeur (DT)'].sum():,.0f} DT")

# --- Mon stock (franchise) ---
def page_mon_stock():
    user = st.session_state.user
    franchise_id = user['franchise_id']
    
    st.title("📦 Mon stock")
    
    stock = db.get_stock(franchise_id)
    if stock:
        df = pd.DataFrame(stock)
        display_df = df[['categorie_nom', 'produit_nom', 'reference', 'quantite', 'prix_vente']].copy()
        display_df.columns = ['Catégorie', 'Produit', 'Réf.', 'Quantité', 'Prix (DT)']
        display_df['Valeur (DT)'] = display_df['Quantité'] * display_df['Prix (DT)']
        
        # Filtre par catégorie
        categories = sorted(display_df['Catégorie'].unique())
        filtre_cat = st.selectbox("Filtrer par catégorie", ["Toutes"] + list(categories))
        if filtre_cat != "Toutes":
            display_df = display_df[display_df['Catégorie'] == filtre_cat]
        
        st.dataframe(display_df, use_container_width=True, hide_index=True)
        st.markdown(f"**Total:** {display_df['Quantité'].sum():,} unités — **Valeur:** {display_df['Valeur (DT)'].sum():,.0f} DT")

# --- Entrée de stock ---
def page_entree_stock():
    user = st.session_state.user
    st.title("📥 Entrée de stock")
    
    franchises = db.get_franchises()
    produits = db.get_produits()
    
    with st.form("entree_stock_form"):
        if user['role'] == 'admin':
            franchise_nom = st.selectbox("Franchise", [f['nom'] for f in franchises])
            franchise_id = next(f['id'] for f in franchises if f['nom'] == franchise_nom)
        else:
            franchise_id = user['franchise_id']
            franchise = next(f for f in franchises if f['id'] == franchise_id)
            st.info(f"🏪 {franchise['nom']}")
        
        produit_nom = st.selectbox("Produit", [f"{p['nom']} ({p['categorie_nom']}) — {p['prix_vente']} DT" for p in produits])
        produit_idx = [f"{p['nom']} ({p['categorie_nom']}) — {p['prix_vente']} DT" for p in produits].index(produit_nom)
        produit = produits[produit_idx]
        
        quantite = st.number_input("Quantité", min_value=1, value=1)
        note = st.text_input("Note (optionnel)")
        
        submitted = st.form_submit_button("✅ Enregistrer l'entrée", use_container_width=True)
        
        if submitted:
            db.update_stock(franchise_id, produit['id'], quantite, 'entree', produit['prix_achat'], note, user['id'])
            st.success(f"✅ +{quantite}x {produit['nom']} ajouté(s) au stock!")
            st.rerun()

# --- Enregistrer une vente ---
def page_vente():
    user = st.session_state.user
    st.title("💰 Enregistrer une vente")
    
    franchises = db.get_franchises()
    
    if user['role'] == 'admin':
        franchise_nom = st.selectbox("Franchise", [f['nom'] for f in franchises])
        franchise_id = next(f['id'] for f in franchises if f['nom'] == franchise_nom)
    else:
        franchise_id = user['franchise_id']
    
    # Afficher le stock disponible
    stock = db.get_stock(franchise_id)
    stock_dispo = [s for s in stock if s['quantite'] > 0]
    
    if not stock_dispo:
        st.warning("⚠️ Aucun produit en stock")
        return
    
    with st.form("vente_form"):
        options = [f"{s['produit_nom']} — {s['quantite']} en stock — {s['prix_vente']} DT" for s in stock_dispo]
        choix = st.selectbox("Produit", options)
        idx = options.index(choix)
        item = stock_dispo[idx]
        
        quantite = st.number_input("Quantité vendue", min_value=1, max_value=item['quantite'], value=1)
        prix = st.number_input("Prix de vente (DT)", min_value=0.0, value=float(item['prix_vente']), step=0.5)
        note = st.text_input("Note (optionnel)")
        
        submitted = st.form_submit_button("💰 Enregistrer la vente", use_container_width=True)
        
        if submitted:
            total = db.enregistrer_vente(franchise_id, item['produit_id'], quantite, prix, user['id'], note)
            st.success(f"✅ Vente enregistrée: {quantite}x {item['produit_nom']} = **{total:,.0f} DT**")
            st.balloons()
            st.rerun()

# --- Ventes (admin) ---
def page_ventes_admin():
    st.title("💰 Historique des ventes")
    
    franchises = db.get_franchises()
    
    col1, col2, col3 = st.columns(3)
    with col1:
        filtre_franchise = st.selectbox("Franchise", ["Toutes"] + [f['nom'] for f in franchises])
    with col2:
        date_debut = st.date_input("Date début", value=date.today() - timedelta(days=30))
    with col3:
        date_fin = st.date_input("Date fin", value=date.today())
    
    franchise_id = None
    if filtre_franchise != "Toutes":
        franchise_id = next(f['id'] for f in franchises if f['nom'] == filtre_franchise)
    
    ventes = db.get_ventes(franchise_id, date_debut, date_fin)
    
    if ventes:
        df = pd.DataFrame(ventes)
        
        # Résumé
        total_ca = df['prix_total'].sum()
        total_articles = df['quantite'].sum()
        st.markdown(f"### 💰 CA: **{total_ca:,.0f} DT** — 📦 Articles vendus: **{total_articles:,}**")
        
        # Graphique ventes par jour
        df['date_vente'] = pd.to_datetime(df['date_vente'])
        ventes_jour = df.groupby('date_vente')['prix_total'].sum().reset_index()
        fig = px.line(ventes_jour, x='date_vente', y='prix_total', title="Chiffre d'affaires par jour",
                     labels={'date_vente': 'Date', 'prix_total': 'CA (DT)'})
        st.plotly_chart(fig, use_container_width=True)
        
        # Tableau détaillé
        display_df = df[['date_vente', 'franchise_nom', 'produit_nom', 'quantite', 'prix_unitaire', 'prix_total', 'vendeur']].copy()
        display_df.columns = ['Date', 'Franchise', 'Produit', 'Qté', 'Prix unit.', 'Total', 'Vendeur']
        st.dataframe(display_df, use_container_width=True, hide_index=True)
    else:
        st.info("Aucune vente sur cette période")

# --- Gestion franchises ---
def page_franchises():
    st.title("🏪 Gestion des franchises")
    
    franchises = db.get_franchises(actif_only=False)
    
    # Ajouter franchise
    with st.expander("➕ Ajouter une franchise"):
        with st.form("add_franchise"):
            nom = st.text_input("Nom de la franchise")
            adresse = st.text_input("Adresse")
            telephone = st.text_input("Téléphone")
            responsable = st.text_input("Responsable")
            
            if st.form_submit_button("Ajouter", use_container_width=True):
                if nom:
                    result = db.ajouter_franchise(nom, adresse, telephone, responsable)
                    if result:
                        st.success(f"✅ Franchise '{nom}' ajoutée!")
                        st.rerun()
                    else:
                        st.error("❌ Ce nom de franchise existe déjà")
    
    # Liste des franchises
    for f in franchises:
        with st.container():
            cols = st.columns([3, 2, 2, 1])
            cols[0].markdown(f"**{f['nom']}**")
            cols[1].caption(f"📞 {f['telephone'] or '-'}")
            cols[2].caption(f"👤 {f['responsable'] or '-'}")
            status = "🟢 Actif" if f['actif'] else "🔴 Inactif"
            cols[3].caption(status)

# --- Gestion produits ---
def page_produits():
    st.title("📋 Gestion des produits")
    
    categories = db.get_categories()
    
    with st.expander("➕ Ajouter un produit"):
        with st.form("add_produit"):
            nom = st.text_input("Nom du produit")
            categorie = st.selectbox("Catégorie", [c['nom'] for c in categories])
            cat_id = next(c['id'] for c in categories if c['nom'] == categorie)
            
            col1, col2 = st.columns(2)
            prix_achat = col1.number_input("Prix d'achat (DT)", min_value=0.0, step=1.0)
            prix_vente = col2.number_input("Prix de vente (DT)", min_value=0.0, step=1.0)
            reference = st.text_input("Référence")
            
            if st.form_submit_button("Ajouter", use_container_width=True):
                if nom and prix_vente > 0:
                    db.ajouter_produit(nom, cat_id, prix_achat, prix_vente, reference)
                    st.success(f"✅ Produit '{nom}' ajouté!")
                    st.rerun()
    
    # Liste des produits par catégorie
    filtre_cat = st.selectbox("Filtrer par catégorie", ["Toutes"] + [c['nom'] for c in categories])
    cat_id = None
    if filtre_cat != "Toutes":
        cat_id = next(c['id'] for c in categories if c['nom'] == filtre_cat)
    
    produits = db.get_produits(cat_id)
    if produits:
        df = pd.DataFrame(produits)[['nom', 'categorie_nom', 'reference', 'prix_achat', 'prix_vente']]
        df.columns = ['Produit', 'Catégorie', 'Réf.', 'Prix achat (DT)', 'Prix vente (DT)']
        df['Marge (DT)'] = df['Prix vente (DT)'] - df['Prix achat (DT)']
        st.dataframe(df, use_container_width=True, hide_index=True)

# --- Gestion utilisateurs ---
def page_utilisateurs():
    st.title("👥 Gestion des utilisateurs")
    
    franchises = db.get_franchises()
    
    with st.expander("➕ Ajouter un utilisateur"):
        with st.form("add_user"):
            nom_utilisateur = st.text_input("Nom d'utilisateur")
            mot_de_passe = st.text_input("Mot de passe", type="password")
            nom_complet = st.text_input("Nom complet")
            role = st.selectbox("Rôle", ["franchise", "admin"])
            
            franchise_id = None
            if role == "franchise":
                franchise_nom = st.selectbox("Franchise", [f['nom'] for f in franchises])
                franchise_id = next(f['id'] for f in franchises if f['nom'] == franchise_nom)
            
            if st.form_submit_button("Ajouter", use_container_width=True):
                if nom_utilisateur and mot_de_passe and nom_complet:
                    success = db.ajouter_utilisateur(nom_utilisateur, mot_de_passe, nom_complet, role, franchise_id)
                    if success:
                        st.success(f"✅ Utilisateur '{nom_utilisateur}' créé!")
                        st.rerun()
                    else:
                        st.error("❌ Ce nom d'utilisateur existe déjà")
    
    # Liste
    conn = db.get_db()
    users = conn.execute("""
        SELECT u.*, f.nom as franchise_nom 
        FROM utilisateurs u LEFT JOIN franchises f ON u.franchise_id = f.id
        ORDER BY u.role, u.nom_complet
    """).fetchall()
    conn.close()
    
    for u in users:
        u = dict(u)
        cols = st.columns([2, 2, 1, 2])
        cols[0].markdown(f"**{u['nom_complet']}**")
        cols[1].caption(f"👤 {u['nom_utilisateur']}")
        badge = "🔴 Admin" if u['role'] == 'admin' else "🟢 Franchise"
        cols[2].caption(badge)
        cols[3].caption(f"🏪 {u.get('franchise_nom', '-') or '-'}")

# --- Rapports ---
def page_rapports(franchise_id=None):
    st.title("📈 Rapports")
    
    is_admin = st.session_state.user['role'] == 'admin'
    franchises = db.get_franchises()
    
    if is_admin:
        filtre = st.selectbox("Franchise", ["Toutes"] + [f['nom'] for f in franchises])
        if filtre != "Toutes":
            franchise_id = next(f['id'] for f in franchises if f['nom'] == filtre)
    
    col1, col2 = st.columns(2)
    date_debut = col1.date_input("Du", value=date.today() - timedelta(days=30))
    date_fin = col2.date_input("Au", value=date.today())
    
    ventes = db.get_ventes(franchise_id, date_debut, date_fin)
    
    if not ventes:
        st.info("Aucune donnée sur cette période")
        return
    
    df = pd.DataFrame(ventes)
    
    # Résumé
    st.subheader("📊 Résumé")
    c1, c2, c3 = st.columns(3)
    c1.metric("💰 Chiffre d'affaires", f"{df['prix_total'].sum():,.0f} DT")
    c2.metric("📦 Articles vendus", f"{df['quantite'].sum():,}")
    c3.metric("🧾 Transactions", f"{len(df):,}")
    
    st.markdown("---")
    
    # Top produits
    col1, col2 = st.columns(2)
    with col1:
        st.subheader("🏆 Top produits (CA)")
        top = df.groupby('produit_nom')['prix_total'].sum().sort_values(ascending=False).head(10).reset_index()
        fig = px.bar(top, x='prix_total', y='produit_nom', orientation='h',
                    labels={'prix_total': 'CA (DT)', 'produit_nom': 'Produit'})
        fig.update_layout(yaxis={'categoryorder': 'total ascending'})
        st.plotly_chart(fig, use_container_width=True)
    
    with col2:
        st.subheader("📊 Ventes par catégorie")
        cat_ventes = df.groupby('categorie_nom')['prix_total'].sum().reset_index()
        fig2 = px.pie(cat_ventes, values='prix_total', names='categorie_nom')
        st.plotly_chart(fig2, use_container_width=True)
    
    # Ventes par jour
    st.subheader("📈 Évolution des ventes")
    df['date_vente'] = pd.to_datetime(df['date_vente'])
    jour = df.groupby('date_vente')['prix_total'].sum().reset_index()
    fig3 = px.area(jour, x='date_vente', y='prix_total',
                  labels={'date_vente': 'Date', 'prix_total': 'CA (DT)'})
    st.plotly_chart(fig3, use_container_width=True)
    
    # Si admin, ventes par franchise
    if is_admin:
        st.subheader("🏪 CA par franchise")
        fran_ventes = df.groupby('franchise_nom')['prix_total'].sum().reset_index()
        fig4 = px.bar(fran_ventes, x='franchise_nom', y='prix_total', color='franchise_nom',
                     labels={'franchise_nom': 'Franchise', 'prix_total': 'CA (DT)'})
        fig4.update_layout(showlegend=False)
        st.plotly_chart(fig4, use_container_width=True)
    
    # Historique mouvements
    with st.expander("📋 Historique des mouvements"):
        mouvements = db.get_mouvements(franchise_id, limit=100)
        if mouvements:
            df_m = pd.DataFrame(mouvements)[['date_mouvement', 'franchise_nom', 'produit_nom', 'type_mouvement', 'quantite', 'utilisateur_nom']]
            df_m.columns = ['Date', 'Franchise', 'Produit', 'Type', 'Qté', 'Utilisateur']
            st.dataframe(df_m, use_container_width=True, hide_index=True)

# --- Routeur principal ---
def main():
    if st.session_state.user is None:
        page_login()
        return
    
    page = sidebar()
    user = st.session_state.user
    
    if user['role'] == 'admin':
        if page == "📊 Tableau de bord":
            page_dashboard_admin()
        elif page == "📦 Stock global":
            page_stock_global()
        elif page == "💰 Ventes":
            page_ventes_admin()
        elif page == "📥 Entrée de stock":
            page_entree_stock()
        elif page == "🏪 Franchises":
            page_franchises()
        elif page == "📋 Produits":
            page_produits()
        elif page == "👥 Utilisateurs":
            page_utilisateurs()
        elif page == "📈 Rapports":
            page_rapports()
    else:
        franchise_id = user['franchise_id']
        if page == "📊 Tableau de bord":
            page_dashboard_franchise()
        elif page == "📦 Mon stock":
            page_mon_stock()
        elif page == "💰 Enregistrer une vente":
            page_vente()
        elif page == "📥 Entrée de stock":
            page_entree_stock()
        elif page == "📈 Mes rapports":
            page_rapports(franchise_id)

if __name__ == "__main__":
    main()
