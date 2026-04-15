<?php
// Minimal test - simulate what the main page provides
require_once __DIR__ . '/config.php';
require_once __DIR__ . '/helpers.php';
session_start();
if (!isset($_SESSION['user'])) {
    $_SESSION['user'] = ['id'=>1,'nom_utilisateur'=>'admin','nom_complet'=>'Admin','role'=>'admin','franchise_id'=>null,'actif'=>1];
}
$user = $_SESSION['user'];
$csrf = bin2hex(random_bytes(16));
$allFranchises = [];
try { $allFranchises = query("SELECT * FROM franchises WHERE actif=1 ORDER BY nom"); } catch(Exception $e) { $allFranchises = []; }
?>
<!DOCTYPE html>
<html><head><title>Client JS Test</title></head>
<body>
<button onclick="openQuickAddClient()">TEST ADD CLIENT</button>
<button onclick="alert('edit works')">TEST EDIT</button>

<div id="modal" class="hidden"></div>
<div id="modalContent"></div>

<script>
function openModal(html) { document.getElementById('modalContent').innerHTML = html; document.getElementById('modal').style.display='block'; }
function closeModal() { document.getElementById('modal').style.display='none'; }
function modalHeader(i,t,s) { return '<h2>'+t+'</h2>'; }
function modalForm(a,c,f,s) { return '<form>'+f+'<button type="submit">'+(s||'Save')+'</button></form>'; }
function modalField(l,n,t,v,p,o) { 
    if(t==='select' && o) return '<select name="'+n+'">'+o.map(x=>'<option value="'+x.value+'">'+x.label+'</option>').join('')+'</select>';
    return '<input name="'+n+'" value="'+(v||'')+'" placeholder="'+(p||'')+'">';
}
function modalRow(c) { return c.join(''); }
</script>

<script>
// THIS IS THE CLIENT SCRIPT
function openQuickAddClient() {
    const csrf = '<?=$csrf?>';
    const isAdmin = <?=can('view_all_franchises')?'true':'false'?>;
    const franchises = <?=json_encode(array_map(fn($f)=>['value'=>$f['id'],'label'=>shortF($f['nom'])], $allFranchises ?? []))?>;
    
    alert('openQuickAddClient called! isAdmin=' + isAdmin + ' franchises=' + JSON.stringify(franchises));
    
    let franchiseField = '';
    if (isAdmin) {
        franchiseField = modalField('Franchise', 'franchise_id', 'select', '', '', franchises);
    }
    
    openModal(
        modalHeader('bi-person-plus', 'Nouveau client', '') +
        modalForm('add_client', csrf,
            franchiseField +
            modalField('Nom', 'nom', 'text', '', 'Nom'),
            'Ajouter'
        )
    );
}
</script>

<p>If the button works, the JS is fine. Check browser console for errors.</p>
</body></html>
