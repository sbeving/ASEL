// ============================================================
// ASEL Mobile — Google Apps Script API
// Deploy as Web App: Execute as ME, Anyone can access
// ============================================================

// ---- CONFIG ----
const SHEET_ID = SpreadsheetApp.getActiveSpreadsheet().getId();

// ---- TABLES (sheet names) ----
const TABLES = [
  "franchises", "categories", "fournisseurs", "produits",
  "utilisateurs", "stock", "mouvements", "ventes",
  "transferts", "clotures", "retours", "dispatch",
  "historique_prix"
];

// ---- HEADERS ----
const HEADERS = {
  franchises: ["id","nom","adresse","telephone","responsable","actif","date_creation"],
  categories: ["id","nom","description"],
  fournisseurs: ["id","nom","telephone","email","adresse","actif"],
  produits: ["id","nom","categorie_id","prix_achat","prix_vente","reference","code_barre","description","fournisseur_id","seuil_alerte","actif","date_creation"],
  utilisateurs: ["id","nom_utilisateur","mot_de_passe","nom_complet","role","franchise_id","actif","date_creation"],
  stock: ["id","franchise_id","produit_id","quantite","derniere_maj"],
  mouvements: ["id","franchise_id","produit_id","type_mouvement","quantite","prix_unitaire","note","utilisateur_id","date_mouvement"],
  ventes: ["id","franchise_id","produit_id","quantite","prix_unitaire","prix_total","remise","date_vente","utilisateur_id","note","date_creation"],
  transferts: ["id","franchise_source","franchise_dest","produit_id","quantite","statut","demandeur_id","validateur_id","note","date_demande","date_validation"],
  clotures: ["id","franchise_id","date_cloture","total_ventes_declare","total_articles_declare","total_ventes_systeme","total_articles_systeme","commentaire","valide","utilisateur_id","validateur_id","date_creation"],
  retours: ["id","franchise_id","produit_id","quantite","type_retour","raison","note","utilisateur_id","date_retour"],
  dispatch: ["id","franchise_id","produit_id","quantite","utilisateur_id","note","date_dispatch"],
  historique_prix: ["id","produit_id","ancien_prix_achat","nouveau_prix_achat","ancien_prix_vente","nouveau_prix_vente","utilisateur_id","date_changement"]
};

// ============================================================
// WEB APP ENTRY POINTS
// ============================================================
function doGet(e) {
  const action = e.parameter.action || "ping";
  const table = e.parameter.table;
  const params = e.parameter;
  
  try {
    let result;
    
    // Check if this is a "POST" action sent via GET (redirect workaround)
    if (params.payload) {
      const body = JSON.parse(params.payload);
      return doPostInternal(body);
    }
    
    switch (action) {
      case "ping":
        result = { status: "ok", message: "ASEL API running" };
        break;
      case "init":
        result = initAllSheets();
        break;
      case "seed":
        result = seedData();
        break;
      case "read":
        result = readTable(table, params);
        break;
      case "stats":
        result = getStats(params.franchise_id || null);
        break;
      case "alertes":
        result = getAlertes(params.franchise_id || null);
        break;
      default:
        result = { error: "Unknown action: " + action };
    }
    return jsonResponse(result);
  } catch (err) {
    return jsonResponse({ error: err.message });
  }
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    return doPostInternal(body);
  } catch (err) {
    return jsonResponse({ error: err.message });
  }
}

function doPostInternal(body) {
  try {
    const action = body.action;
    let result;
    
    switch (action) {
      case "login":
        result = login(body.username, body.password);
        break;
      case "change_password":
        result = changePassword(body.user_id, body.new_password);
        break;
      case "add_row":
        result = addRow(body.table, body.data);
        break;
      case "update_row":
        result = updateRow(body.table, body.id, body.data);
        break;
      case "vente":
        result = enregistrerVente(body);
        break;
      case "vente_multiple":
        result = enregistrerVenteMultiple(body);
        break;
      case "entree_stock":
        result = entreeStock(body);
        break;
      case "batch_stock":
        result = batchStock(body);
        break;
      case "transfert_demande":
        result = demanderTransfert(body);
        break;
      case "transfert_valider":
        result = validerTransfert(body);
        break;
      case "dispatch":
        result = dispatchStock(body);
        break;
      case "cloture":
        result = soumettreCloture(body);
        break;
      case "cloture_valider":
        result = validerCloture(body);
        break;
      case "retour":
        result = enregistrerRetour(body);
        break;
      case "add_produit":
        result = addProduit(body);
        break;
      case "update_produit":
        result = updateProduit(body);
        break;
      case "add_franchise":
        result = addFranchise(body);
        break;
      case "add_user":
        result = addUser(body);
        break;
      default:
        result = { error: "Unknown action: " + action };
    }
    return jsonResponse(result);
  } catch (err) {
    return jsonResponse({ error: err.message });
  }
}

function jsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// ============================================================
// SHEET HELPERS
// ============================================================
function getOrCreateSheet(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let ws = ss.getSheetByName(name);
  if (!ws) {
    ws = ss.insertSheet(name);
    const headers = HEADERS[name];
    if (headers) ws.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
  return ws;
}

function readAll(name) {
  const ws = getOrCreateSheet(name);
  const data = ws.getDataRange().getValues();
  if (data.length <= 1) return [];
  const headers = data[0];
  return data.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => obj[h] = row[i]);
    return obj;
  });
}

function readTable(name, params) {
  let data = readAll(name);
  
  // Filter by params
  if (params.franchise_id) {
    data = data.filter(r => String(r.franchise_id) === String(params.franchise_id));
  }
  if (params.actif_only === "true") {
    data = data.filter(r => String(r.actif) === "1");
  }
  if (params.categorie_id) {
    data = data.filter(r => String(r.categorie_id) === String(params.categorie_id));
  }
  if (params.statut) {
    data = data.filter(r => r.statut === params.statut);
  }
  if (params.date_debut) {
    data = data.filter(r => (r.date_vente || r.date_creation || "") >= params.date_debut);
  }
  if (params.date_fin) {
    data = data.filter(r => (r.date_vente || r.date_creation || "") <= params.date_fin);
  }
  if (params.code_barre) {
    data = data.filter(r => r.code_barre === params.code_barre && String(r.actif) !== "0");
  }
  if (params.limit) {
    data = data.slice(0, parseInt(params.limit));
  }
  
  return data;
}

function nextId(name) {
  const data = readAll(name);
  if (!data.length) return 1;
  const ids = data.map(r => parseInt(r.id) || 0);
  return Math.max(...ids) + 1;
}

function appendRow(name, rowObj) {
  const ws = getOrCreateSheet(name);
  const headers = HEADERS[name];
  const row = headers.map(h => rowObj[h] !== undefined ? rowObj[h] : "");
  ws.appendRow(row);
}

function findAndUpdateRow(name, id, updates) {
  const ws = getOrCreateSheet(name);
  const data = ws.getDataRange().getValues();
  const headers = data[0];
  const idCol = headers.indexOf("id");
  
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][idCol]) === String(id)) {
      headers.forEach((h, j) => {
        if (updates[h] !== undefined) {
          ws.getRange(i + 1, j + 1).setValue(updates[h]);
        }
      });
      return true;
    }
  }
  return false;
}

function updateStockQty(franchiseId, produitId, delta) {
  const ws = getOrCreateSheet("stock");
  const data = ws.getDataRange().getValues();
  const headers = data[0];
  const fCol = headers.indexOf("franchise_id");
  const pCol = headers.indexOf("produit_id");
  const qCol = headers.indexOf("quantite");
  const dCol = headers.indexOf("derniere_maj");
  
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][fCol]) === String(franchiseId) && String(data[i][pCol]) === String(produitId)) {
      const newQty = Math.max(0, (parseInt(data[i][qCol]) || 0) + delta);
      ws.getRange(i + 1, qCol + 1).setValue(newQty);
      ws.getRange(i + 1, dCol + 1).setValue(new Date().toISOString());
      return;
    }
  }
  // Not found — create
  appendRow("stock", {
    id: nextId("stock"), franchise_id: franchiseId, produit_id: produitId,
    quantite: Math.max(0, delta), derniere_maj: new Date().toISOString()
  });
}

function now() { return new Date().toISOString().replace("T"," ").substring(0,19); }
function today() { return new Date().toISOString().substring(0,10); }

function sha256(text) {
  const raw = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text);
  return raw.map(b => ('0' + ((b + 256) % 256).toString(16)).slice(-2)).join('');
}

// ============================================================
// AUTH
// ============================================================
function login(username, password) {
  const users = readAll("utilisateurs");
  const hashed = sha256(password);
  const user = users.find(u => u.nom_utilisateur === username && u.mot_de_passe === hashed && String(u.actif) !== "0");
  if (user) {
    delete user.mot_de_passe;
    return { success: true, user: user };
  }
  return { success: false, error: "Identifiants incorrects" };
}

function changePassword(userId, newPw) {
  return findAndUpdateRow("utilisateurs", userId, { mot_de_passe: sha256(newPw) })
    ? { success: true } : { error: "Utilisateur non trouvé" };
}

// ============================================================
// VENTES
// ============================================================
function enregistrerVente(body) {
  const { franchise_id, produit_id, quantite, prix_unitaire, remise, utilisateur_id, note } = body;
  const total = quantite * prix_unitaire * (1 - (remise || 0) / 100);
  
  appendRow("ventes", {
    id: nextId("ventes"), franchise_id, produit_id, quantite,
    prix_unitaire, prix_total: Math.round(total * 100) / 100,
    remise: remise || 0, date_vente: today(),
    utilisateur_id: utilisateur_id || "", note: note || "",
    date_creation: now()
  });
  
  appendRow("mouvements", {
    id: nextId("mouvements"), franchise_id, produit_id,
    type_mouvement: "vente", quantite, prix_unitaire,
    note: note || "", utilisateur_id: utilisateur_id || "",
    date_mouvement: now()
  });
  
  updateStockQty(franchise_id, produit_id, -quantite);
  return { success: true, total: Math.round(total * 100) / 100 };
}

function enregistrerVenteMultiple(body) {
  const { franchise_id, items, utilisateur_id } = body;
  let totalGlobal = 0;
  
  items.forEach(item => {
    const r = enregistrerVente({
      franchise_id, produit_id: item.produit_id,
      quantite: item.quantite, prix_unitaire: item.prix_unitaire,
      remise: item.remise || 0, utilisateur_id, note: item.note || ""
    });
    totalGlobal += r.total;
  });
  
  return { success: true, total: Math.round(totalGlobal * 100) / 100 };
}

// ============================================================
// STOCK
// ============================================================
function entreeStock(body) {
  const { franchise_id, produit_id, quantite, note, utilisateur_id } = body;
  
  appendRow("mouvements", {
    id: nextId("mouvements"), franchise_id, produit_id,
    type_mouvement: "entree", quantite, prix_unitaire: 0,
    note: note || "", utilisateur_id: utilisateur_id || "",
    date_mouvement: now()
  });
  
  updateStockQty(franchise_id, produit_id, quantite);
  return { success: true };
}

function batchStock(body) {
  const { franchise_id, items, utilisateur_id } = body;
  items.forEach(item => {
    entreeStock({
      franchise_id, produit_id: item.produit_id,
      quantite: item.quantite, note: item.note || "Lot",
      utilisateur_id
    });
  });
  return { success: true, count: items.length };
}

// ============================================================
// TRANSFERTS
// ============================================================
function demanderTransfert(body) {
  appendRow("transferts", {
    id: nextId("transferts"),
    franchise_source: body.franchise_source, franchise_dest: body.franchise_dest,
    produit_id: body.produit_id, quantite: body.quantite,
    statut: "en_attente", demandeur_id: body.utilisateur_id || "",
    validateur_id: "", note: body.note || "",
    date_demande: now(), date_validation: ""
  });
  return { success: true };
}

function validerTransfert(body) {
  const { transfert_id, accepter, utilisateur_id } = body;
  const transferts = readAll("transferts");
  const t = transferts.find(x => String(x.id) === String(transfert_id));
  if (!t) return { error: "Transfert non trouvé" };
  
  const statut = accepter ? "accepte" : "rejete";
  findAndUpdateRow("transferts", transfert_id, {
    statut, validateur_id: utilisateur_id || "", date_validation: now()
  });
  
  if (accepter) {
    updateStockQty(t.franchise_source, t.produit_id, -parseInt(t.quantite));
    updateStockQty(t.franchise_dest, t.produit_id, parseInt(t.quantite));
    
    appendRow("mouvements", {
      id: nextId("mouvements"), franchise_id: t.franchise_source, produit_id: t.produit_id,
      type_mouvement: "dispatch_out", quantite: t.quantite, prix_unitaire: 0,
      note: "Transfert→" + t.franchise_dest, utilisateur_id: utilisateur_id || "",
      date_mouvement: now()
    });
    appendRow("mouvements", {
      id: nextId("mouvements"), franchise_id: t.franchise_dest, produit_id: t.produit_id,
      type_mouvement: "dispatch_in", quantite: t.quantite, prix_unitaire: 0,
      note: "Transfert←" + t.franchise_source, utilisateur_id: utilisateur_id || "",
      date_mouvement: now()
    });
  }
  return { success: true };
}

// ============================================================
// DISPATCH
// ============================================================
function dispatchStock(body) {
  const { items, utilisateur_id } = body;
  items.forEach(item => {
    appendRow("dispatch", {
      id: nextId("dispatch"), franchise_id: item.franchise_id,
      produit_id: item.produit_id, quantite: item.quantite,
      utilisateur_id: utilisateur_id || "", note: item.note || "Dispatch",
      date_dispatch: now()
    });
    updateStockQty(item.franchise_id, item.produit_id, parseInt(item.quantite));
    appendRow("mouvements", {
      id: nextId("mouvements"), franchise_id: item.franchise_id,
      produit_id: item.produit_id, type_mouvement: "dispatch_in",
      quantite: item.quantite, prix_unitaire: 0,
      note: item.note || "Dispatch admin", utilisateur_id: utilisateur_id || "",
      date_mouvement: now()
    });
  });
  return { success: true, count: items.length };
}

// ============================================================
// CLOTURES
// ============================================================
function soumettreCloture(body) {
  const { franchise_id, date_cloture, total_declare, articles_declare, commentaire, utilisateur_id } = body;
  
  // Check duplicate
  const existing = readAll("clotures");
  if (existing.find(c => String(c.franchise_id) === String(franchise_id) && c.date_cloture === date_cloture)) {
    return { error: "Clôture déjà soumise pour cette date" };
  }
  
  // System totals
  const ventes = readAll("ventes").filter(v =>
    String(v.franchise_id) === String(franchise_id) && v.date_vente === date_cloture
  );
  const sysTotal = ventes.reduce((s, v) => s + (parseFloat(v.prix_total) || 0), 0);
  const sysArticles = ventes.reduce((s, v) => s + (parseInt(v.quantite) || 0), 0);
  
  appendRow("clotures", {
    id: nextId("clotures"), franchise_id, date_cloture,
    total_ventes_declare: total_declare, total_articles_declare: articles_declare,
    total_ventes_systeme: Math.round(sysTotal * 100) / 100,
    total_articles_systeme: sysArticles,
    commentaire: commentaire || "", valide: 0,
    utilisateur_id: utilisateur_id || "", validateur_id: "",
    date_creation: now()
  });
  return { success: true };
}

function validerCloture(body) {
  return findAndUpdateRow("clotures", body.cloture_id, {
    valide: 1, validateur_id: body.utilisateur_id || ""
  }) ? { success: true } : { error: "Clôture non trouvée" };
}

// ============================================================
// RETOURS
// ============================================================
function enregistrerRetour(body) {
  const { franchise_id, produit_id, quantite, type_retour, raison, note, utilisateur_id } = body;
  
  appendRow("retours", {
    id: nextId("retours"), franchise_id, produit_id, quantite,
    type_retour: type_retour || "retour", raison: raison || "",
    note: note || "", utilisateur_id: utilisateur_id || "",
    date_retour: now()
  });
  
  if (type_retour === "retour") {
    updateStockQty(franchise_id, produit_id, parseInt(quantite));
    appendRow("mouvements", {
      id: nextId("mouvements"), franchise_id, produit_id,
      type_mouvement: "retour", quantite, prix_unitaire: 0,
      note: raison || "", utilisateur_id: utilisateur_id || "",
      date_mouvement: now()
    });
  }
  return { success: true };
}

// ============================================================
// PRODUITS
// ============================================================
function addProduit(body) {
  const pid = nextId("produits");
  appendRow("produits", {
    id: pid, nom: body.nom, categorie_id: body.categorie_id,
    prix_achat: body.prix_achat || 0, prix_vente: body.prix_vente || 0,
    reference: body.reference || "", code_barre: body.code_barre || "",
    description: body.description || "", fournisseur_id: body.fournisseur_id || "",
    seuil_alerte: body.seuil_alerte || 5, actif: 1, date_creation: now()
  });
  
  // Init stock in all franchises
  const franchises = readAll("franchises").filter(f => String(f.actif) !== "0");
  franchises.forEach(f => {
    appendRow("stock", {
      id: nextId("stock"), franchise_id: f.id, produit_id: pid,
      quantite: 0, derniere_maj: now()
    });
  });
  return { success: true, id: pid };
}

function updateProduit(body) {
  const old = readAll("produits").find(p => String(p.id) === String(body.id));
  if (old && (parseFloat(old.prix_achat) !== parseFloat(body.prix_achat) || parseFloat(old.prix_vente) !== parseFloat(body.prix_vente))) {
    appendRow("historique_prix", {
      id: nextId("historique_prix"), produit_id: body.id,
      ancien_prix_achat: old.prix_achat, nouveau_prix_achat: body.prix_achat,
      ancien_prix_vente: old.prix_vente, nouveau_prix_vente: body.prix_vente,
      utilisateur_id: body.utilisateur_id || "", date_changement: now()
    });
  }
  
  findAndUpdateRow("produits", body.id, {
    nom: body.nom, categorie_id: body.categorie_id,
    prix_achat: body.prix_achat, prix_vente: body.prix_vente,
    reference: body.reference || "", code_barre: body.code_barre || "",
    description: body.description || "", fournisseur_id: body.fournisseur_id || "",
    seuil_alerte: body.seuil_alerte || 5, actif: body.actif !== undefined ? body.actif : 1
  });
  return { success: true };
}

// ============================================================
// FRANCHISES
// ============================================================
function addFranchise(body) {
  const fid = nextId("franchises");
  appendRow("franchises", {
    id: fid, nom: body.nom, adresse: body.adresse || "",
    telephone: body.telephone || "", responsable: body.responsable || "",
    actif: 1, date_creation: now()
  });
  // Init stock
  const produits = readAll("produits").filter(p => String(p.actif) !== "0");
  produits.forEach(p => {
    appendRow("stock", {
      id: nextId("stock"), franchise_id: fid, produit_id: p.id,
      quantite: 0, derniere_maj: now()
    });
  });
  return { success: true, id: fid };
}

// ============================================================
// USERS
// ============================================================
function addUser(body) {
  const existing = readAll("utilisateurs");
  if (existing.find(u => u.nom_utilisateur === body.username)) {
    return { error: "Nom d'utilisateur déjà pris" };
  }
  appendRow("utilisateurs", {
    id: nextId("utilisateurs"), nom_utilisateur: body.username,
    mot_de_passe: sha256(body.password), nom_complet: body.nom_complet,
    role: body.role, franchise_id: body.franchise_id || "",
    actif: 1, date_creation: now()
  });
  return { success: true };
}

// ============================================================
// STATS
// ============================================================
function getStats(franchiseId) {
  const stock = readAll("stock");
  const produits = readAll("produits");
  const ventes = readAll("ventes");
  const transferts = readAll("transferts");
  const prodMap = {};
  produits.forEach(p => prodMap[String(p.id)] = p);
  
  const todayStr = today();
  const weekAgo = new Date(Date.now() - 7*86400000).toISOString().substring(0,10);
  const monthStr = todayStr.substring(0,7);
  
  let filtStock = stock;
  let filtVentes = ventes;
  if (franchiseId) {
    filtStock = stock.filter(s => String(s.franchise_id) === String(franchiseId));
    filtVentes = ventes.filter(v => String(v.franchise_id) === String(franchiseId));
  }
  
  let stockTotal = 0, valeurStock = 0;
  filtStock.forEach(s => {
    const q = parseInt(s.quantite) || 0;
    const p = prodMap[String(s.produit_id)];
    stockTotal += q;
    valeurStock += q * (parseFloat(p?.prix_vente) || 0);
  });
  
  const ventesJour = filtVentes.filter(v => v.date_vente === todayStr).reduce((s,v) => s + (parseFloat(v.prix_total)||0), 0);
  const ventesSemaine = filtVentes.filter(v => (v.date_vente||"") >= weekAgo).reduce((s,v) => s + (parseFloat(v.prix_total)||0), 0);
  const ventesMois = filtVentes.filter(v => (v.date_vente||"").substring(0,7) === monthStr).reduce((s,v) => s + (parseFloat(v.prix_total)||0), 0);
  
  // Alertes
  let alertes = 0;
  filtStock.forEach(s => {
    const p = prodMap[String(s.produit_id)];
    if (p && String(p.actif) !== "0" && (parseInt(s.quantite)||0) <= (parseInt(p.seuil_alerte)||5)) {
      alertes++;
    }
  });
  
  return {
    total_produits: produits.filter(p => String(p.actif) !== "0").length,
    total_franchises: readAll("franchises").filter(f => String(f.actif) !== "0").length,
    stock_total: stockTotal,
    valeur_stock: Math.round(valeurStock),
    ventes_aujourdhui: Math.round(ventesJour),
    ventes_semaine: Math.round(ventesSemaine),
    ventes_mois: Math.round(ventesMois),
    alertes: alertes,
    transferts_attente: transferts.filter(t => t.statut === "en_attente").length
  };
}

function getAlertes(franchiseId) {
  const stock = readAll("stock");
  const produits = readAll("produits");
  const cats = readAll("categories");
  const franchises = readAll("franchises");
  
  const prodMap = {}, catMap = {}, franMap = {};
  produits.forEach(p => prodMap[String(p.id)] = p);
  cats.forEach(c => catMap[String(c.id)] = c.nom);
  franchises.forEach(f => franMap[String(f.id)] = f.nom);
  
  const result = [];
  stock.forEach(s => {
    if (franchiseId && String(s.franchise_id) !== String(franchiseId)) return;
    const p = prodMap[String(s.produit_id)];
    if (!p || String(p.actif) === "0") return;
    const qty = parseInt(s.quantite) || 0;
    const seuil = parseInt(p.seuil_alerte) || 5;
    if (qty <= seuil) {
      result.push({
        franchise_nom: franMap[String(s.franchise_id)] || "?",
        produit_nom: p.nom, reference: p.reference,
        categorie_nom: catMap[String(p.categorie_id)] || "?",
        quantite: qty, seuil_alerte: seuil
      });
    }
  });
  return result;
}

// ============================================================
// INIT & SEED (run once from menu)
// ============================================================
function initAllSheets() {
  Object.keys(HEADERS).forEach(name => getOrCreateSheet(name));
  return { success: true, message: "All sheets created" };
}

function seedData() {
  // Check if already seeded
  if (readAll("franchises").length > 0) return { message: "Already seeded" };
  
  const n = now();
  
  // Franchises
  [
    [1,"ASEL Mobile — Tunis Centre","Av. Habib Bourguiba, Tunis","'216 71 123 456","Ahmed Ben Ali"],
    [2,"ASEL Mobile — Sfax","Route de Tunis, Sfax","'216 74 234 567","Mohamed Trabelsi"],
    [3,"ASEL Mobile — Sousse","Bd 14 Janvier, Sousse","'216 73 345 678","Fatma Bouazizi"],
    [4,"ASEL Mobile — Nabeul","Av. Habib Thameur, Nabeul","'216 72 456 789","Karim Jebali"],
    [5,"ASEL Mobile — Bizerte","Rue de la République, Bizerte","'216 72 567 890","Sana Mansouri"]
  ].forEach(f => appendRow("franchises",{id:f[0],nom:f[1],adresse:f[2],telephone:f[3],responsable:f[4],actif:1,date_creation:n}));
  
  // Categories
  [[1,"Téléphones"],[2,"Coques & Protections"],[3,"Écouteurs & Casques"],[4,"Enceintes"],[5,"Chargeurs & Câbles"],[6,"Accessoires"]]
    .forEach(c => appendRow("categories",{id:c[0],nom:c[1],description:""}));
  
  // Fournisseur
  appendRow("fournisseurs",{id:1,nom:"Fournisseur Général",telephone:"+216 70 000 000",email:"contact@fournisseur.tn",adresse:"Tunis",actif:1});
  
  // Produits (24 items)
  const prods = [
    [1,"Samsung Galaxy A15",1,450,599,"SM-A155F","8806095426280"],
    [2,"Samsung Galaxy A25",1,650,849,"SM-A256B","8806095468123"],
    [3,"iPhone 15",1,2800,3499,"IPHONE15-128","0194253396055"],
    [4,"Xiaomi Redmi Note 13",1,500,699,"RN13-128","6941812756423"],
    [5,"OPPO A18",1,380,499,"OPPO-A18","6932169086547"],
    [6,"Coque Samsung A15",2,15,35,"COQ-A15","COQ-SAM-A15"],
    [7,"Coque iPhone 15",2,20,45,"COQ-IP15","COQ-IP-15"],
    [8,"Protection écran Samsung",2,8,20,"PE-SAM","PE-SAM-UNIV"],
    [9,"Protection écran iPhone",2,10,25,"PE-IP","PE-IP-15"],
    [10,"Coque Xiaomi RN13",2,12,30,"COQ-XRN13","COQ-XI-RN13"],
    [11,"AirPods Pro 2",3,600,849,"APP2","0194253404026"],
    [12,"Samsung Galaxy Buds FE",3,200,299,"SGB-FE","8806095170862"],
    [13,"Écouteurs filaires USB-C",3,15,35,"EC-USBC","EC-USBC-GEN"],
    [14,"JBL Tune 520BT",3,120,179,"JBL-T520","6925281978944"],
    [15,"JBL Flip 6",4,250,399,"JBL-F6","6925281993152"],
    [16,"JBL Go 3",4,80,129,"JBL-G3","6925281979415"],
    [17,"Chargeur rapide 25W",5,25,49,"CHR-25W","CHR-25W-SAM"],
    [18,"Chargeur rapide 65W",5,45,79,"CHR-65W","CHR-65W-GAN"],
    [19,"Câble USB-C 1m",5,8,20,"CAB-USBC","CAB-USBC-1M"],
    [20,"Câble Lightning 1m",5,12,25,"CAB-LTN","CAB-LTN-1M"],
    [21,"Batterie externe 10000mAh",5,45,79,"BAT-10K","BAT-10K-ANK"],
    [22,"Support voiture magnétique",6,15,35,"SUP-VOI","SUP-MAG-VOI"],
    [23,"Carte mémoire 64Go",6,20,39,"CM-64","CM-SD-64"],
    [24,"Carte mémoire 128Go",6,35,59,"CM-128","CM-SD-128"]
  ];
  prods.forEach(p => appendRow("produits",{id:p[0],nom:p[1],categorie_id:p[2],prix_achat:p[3],prix_vente:p[4],reference:p[5],code_barre:p[6],description:"",fournisseur_id:1,seuil_alerte:5,actif:1,date_creation:n}));
  
  // Users
  appendRow("utilisateurs",{id:1,nom_utilisateur:"admin",mot_de_passe:sha256("admin2024"),nom_complet:"Administrateur",role:"admin",franchise_id:"",actif:1,date_creation:n});
  for (let i = 1; i <= 5; i++) {
    appendRow("utilisateurs",{id:i+1,nom_utilisateur:"franchise"+i,mot_de_passe:sha256("franchise"+i),nom_complet:"Gérant Franchise "+i,role:"franchise",franchise_id:i,actif:1,date_creation:n});
  }
  
  // Stock initial
  let sid = 1;
  for (let fid = 1; fid <= 5; fid++) {
    for (let pid = 1; pid <= 24; pid++) {
      appendRow("stock",{id:sid++,franchise_id:fid,produit_id:pid,quantite:Math.floor(Math.random()*36)+5,derniere_maj:n});
    }
  }
  
  return { success: true, message: "Seed complete" };
}

// ============================================================
// MENU FUNCTIONS (run manually from Apps Script editor)
// ============================================================
function onOpen() {
  SpreadsheetApp.getUi().createMenu("ASEL")
    .addItem("Initialiser les feuilles", "initAllSheets")
    .addItem("Charger les données initiales", "seedData")
    .addToUi();
}
