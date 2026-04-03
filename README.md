# ASEL Mobile — Gestion de Stock

Application de gestion de stock multi-franchise pour ASEL Mobile (opérateur télécom tunisien).

## Fonctionnalités

- 🔐 **Authentification** — Admin & franchises avec rôles
- 📦 **Gestion de stock** — Entrée/sortie par franchise
- 💰 **Rapport de ventes** — Ventes journalières par franchise
- 📊 **Dashboard Admin** — Vue globale, tous les franchises
- 🏪 **Dashboard Franchise** — Vue locale, stock & ventes
- 📈 **Statistiques** — Stock restant, historique, alertes

## Stack

- **Frontend/Backend**: Streamlit
- **Base de données**: Google Sheets (via gspread) — gratuit, pas besoin de serveur
- **Hébergement**: Streamlit Cloud (gratuit)
- **Auth**: Streamlit native auth + secrets

## Déploiement

1. Fork ce repo
2. Connecter à Streamlit Cloud
3. Ajouter les secrets (Google Sheets credentials)
4. C'est parti! 🚀
