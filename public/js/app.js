/* ─────────────────────────────────────────
   UrbanIA — Frontend JS
   Tous les appels API passent par /api/* (notre serveur Node)
   Jamais directement vers IGN ou Anthropic
───────────────────────────────────────── */

// ── STATE ──
let currentZone    = null;
let currentCadastre = null;
let currentRisques  = null;
let currentCoords  = null;
let currentAddress = '';
let suggestTimer   = null;


// ════════════════════════════════════════
// STRIPE — ABONNEMENT PRO
// ════════════════════════════════════════
var DAILY_LIMIT = 5; // analyses gratuites par jour

function getDailyCount() {
  try {
    var data = JSON.parse(localStorage.getItem('urbaniaDaily') || '{}');
    var today = new Date().toDateString();
    if (data.date !== today) return 0;
    return data.count || 0;
  } catch(e) { return 0; }
}

function incrementDailyCount() {
  try {
    var today = new Date().toDateString();
    var count = getDailyCount() + 1;
    localStorage.setItem('urbaniaDaily', JSON.stringify({ date: today, count: count }));
  } catch(e) {}
}

function isPro() {
  // Pour l instant, verifier via localStorage (sera remplace par webhook Stripe)
  return localStorage.getItem('urbaniaIsPro') === 'true';
}

function checkDailyLimit() {
  if (isPro()) return true; // Pro = illimite
  var count = getDailyCount();
  if (count >= DAILY_LIMIT) {
    showUpgradeModal();
    return false;
  }
  return true;
}

function showUpgradeModal() {
  var old = document.getElementById('upgradeModal');
  if (old) old.remove();

  var modal = document.createElement('div');
  modal.id = 'upgradeModal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:2000;display:flex;align-items:center;justify-content:center;';

  var overlay = document.createElement('div');
  overlay.style.cssText = 'position:absolute;inset:0;background:rgba(0,0,0,0.6)';
  overlay.onclick = function() { modal.remove(); };
  modal.appendChild(overlay);

  var panel = document.createElement('div');
  panel.style.cssText = 'position:relative;background:white;width:90%;max-width:420px;z-index:2001;overflow:hidden;';
  panel.innerHTML =
    '<div style="background:#0f0f0f;padding:1.5rem;text-align:center">' +
      '<div style="font-size:1.2rem;font-weight:700;color:white;letter-spacing:-0.02em">URBAN<span style="color:#c0381a">IA</span> Pro</div>' +
      '<div style="font-size:0.75rem;color:rgba(255,255,255,0.5);margin-top:0.3rem">Analyses illimitees</div>' +
    '</div>' +
    '<div style="padding:2rem">' +
      '<div style="text-align:center;margin-bottom:1.5rem">' +
        '<div style="font-size:2.5rem;font-weight:700;letter-spacing:-0.03em">29<span style="font-size:1rem;font-weight:400;color:#666">€/mois</span></div>' +
        '<div style="font-size:0.75rem;color:#666;margin-top:0.2rem">Sans engagement</div>' +
      '</div>' +
      '<div style="background:#f5f4f1;padding:1rem;margin-bottom:1.5rem;font-size:0.8rem;color:#666;text-align:center">' +
        'Vous avez atteint la limite de <strong>' + DAILY_LIMIT + ' analyses gratuites</strong> aujourd hui.<br>' +
        'Passez Pro pour des analyses illimitees.' +
      '</div>' +
      '<ul style="list-style:none;margin-bottom:1.5rem">' +
        '<li style="padding:0.4rem 0;font-size:0.82rem;border-bottom:1px solid #e2e0db">✓ Analyses illimitees</li>' +
        '<li style="padding:0.4rem 0;font-size:0.82rem;border-bottom:1px solid #e2e0db">✓ Export PDF professionnel</li>' +
        '<li style="padding:0.4rem 0;font-size:0.82rem;border-bottom:1px solid #e2e0db">✓ Historique dans le cloud</li>' +
        '<li style="padding:0.4rem 0;font-size:0.82rem">✓ Comparaison de parcelles</li>' +
      '</ul>' +
      '<button onclick="redirectToCheckout()" style="width:100%;background:#c0381a;color:white;border:none;padding:0.9rem;font-size:0.9rem;font-weight:600;cursor:pointer;font-family:inherit">Passer Pro — 29€/mois →</button>' +
      '<button id="skipUpgradeBtn" style="width:100%;background:none;border:none;padding:0.6rem;font-size:0.78rem;color:#666;cursor:pointer;font-family:inherit;margin-top:0.5rem">Continuer avec la version gratuite</button>' +
    '</div>';

  modal.appendChild(panel);
  document.body.appendChild(modal);
  var skipBtn = document.getElementById('skipUpgradeBtn');
  if (skipBtn) skipBtn.onclick = function() { modal.remove(); };
}

async function redirectToCheckout() {
  var btn = document.querySelector('#upgradeModal button');
  if (btn) { btn.textContent = 'Redirection...'; btn.disabled = true; }
  try {
    var user = getUser();
    var r = await fetch('/api/create-checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: user ? user.email : '' })
    });
    var d = await r.json();
    if (d.url) window.location.href = d.url;
    else alert('Erreur de paiement. Reessayez.');
  } catch(e) {
    alert('Erreur reseau. Reessayez.');
  }
}

// Verifier si retour de Stripe avec succes
function checkStripeReturn() {
  var params = new URLSearchParams(window.location.search);
  if (params.get('upgrade') === 'success') {
    localStorage.setItem('urbaniaIsPro', 'true');
    var banner = document.createElement('div');
    banner.style.cssText = 'position:fixed;top:0;left:0;right:0;background:#22a855;color:white;text-align:center;padding:0.7rem;font-size:0.85rem;z-index:999;font-weight:500';
    banner.textContent = 'Bienvenue dans UrbanIA Pro ! Analyses illimitees activees.';
    document.body.appendChild(banner);
    setTimeout(function() { banner.remove(); }, 5000);
    window.history.replaceState({}, '', '/index.html');
  }
}


// ════════════════════════════════════════
// AUTHENTIFICATION SUPABASE
// ════════════════════════════════════════
var SUPA_URL = 'https://otyrdakukwocjdaczldf.supabase.co';
var SUPA_KEY = 'sb_publishable_XBn-rzpM44IDeJ_IsMfwXg_u2ye2jaR';

function getUser() {
  try { return JSON.parse(localStorage.getItem('urbaniaUser')); } catch(e) { return null; }
}

function getToken() {
  return localStorage.getItem('urbaniaToken') || null;
}

function logout() {
  localStorage.removeItem('urbaniaToken');
  localStorage.removeItem('urbaniaUser');
  updateAuthUI();
}

function updateAuthUI() {
  var user = getUser();
  var btn  = document.getElementById('authBtn');
  var hist = document.getElementById('historyBtn');
  if (!btn) return;
  if (user) {
    btn.textContent = user.email.split('@')[0] + ' · Deconnexion';
    btn.onclick = function() { if(confirm('Se deconnecter ?')) logout(); };
    if (hist) hist.style.display = 'inline-block';
  } else {
    btn.textContent = '👤 Connexion';
    btn.onclick = function() { window.location.href = '/auth.html'; };
    if (hist) hist.style.display = 'inline-block';
  }
}

// Sync history to Supabase when logged in
async function syncHistoryToCloud(entry) {
  var token = getToken();
  var user  = getUser();
  if (!token || !user) return;
  try {
    await fetch(SUPA_URL + '/rest/v1/analyses', {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'apikey':        SUPA_KEY,
        'Authorization': 'Bearer ' + token,
        'Prefer':        'return=minimal'
      },
      body: JSON.stringify({
        user_id:  user.id,
        address:  entry.address,
        question: entry.question,
        verdict:  entry.verdict,
        zone:     entry.zone,
        commune:  entry.commune
      })
    });
  } catch(e) {}
}

// ════════════════════════════════════════
// INIT — vérification serveur
// ════════════════════════════════════════
window.addEventListener('DOMContentLoaded', async () => {
  renderHistoryCount();
  updateAuthUI();
  checkStripeReturn();
  try {
    const r = await fetch('/api/health');
    const d = await r.json();
    const el = document.getElementById('serverStatus');
    if (d.status === 'ok') {
      el.innerHTML = `
        <div class="live-dot"></div>
        <span>Serveur actif · Anthropic ${d.anthropic ? '✅' : '❌'} · IGN ${d.ign ? '✅' : '❌'}</span>`;
    }
  } catch(e) {
    const el = document.getElementById('serverStatus');
    el.style.color = '#f4a080';
    el.innerHTML = `<span>⚠️ Serveur non démarré — lancez <code>npm start</code></span>`;
  }
});

// ════════════════════════════════════════
// AUTOCOMPLÉTION ADRESSE
// ════════════════════════════════════════
function onAddrInput() {
  clearTimeout(suggestTimer);
  const val = document.getElementById('addressInput').value.trim();
  if (val.length < 4) { hideSug(); return; }
  suggestTimer = setTimeout(() => fetchSuggestions(val), 280);
}

async function fetchSuggestions(q) {
  try {
    // Appel à notre serveur → qui appelle api-adresse.data.gouv.fr
    const r = await fetch(`/api/geocode?q=${encodeURIComponent(q)}&limit=5`);
    const d = await r.json();
    if (d.results?.length) showSug(d.results);
    else hideSug();
  } catch(e) { hideSug(); }
}

function showSug(results) {
  const box = document.getElementById('suggestions');
  box.innerHTML = results.map(item => `
    <div class="sug-item" onclick="pickAddr('${esc(item.label)}', ${item.lat}, ${item.lon}, '${esc(item.postcode)}', '${esc(item.city)}')">
      <span>📍</span>
      <div>
        <div class="sug-main">${esc(item.label)}</div>
        <div class="sug-sub">${esc(item.context)}</div>
      </div>
    </div>`).join('');
  box.classList.add('open');
}

function hideSug() {
  document.getElementById('suggestions').classList.remove('open');
}

function pickAddr(label, lat, lon, postcode, city) {
  document.getElementById('addressInput').value = label;
  currentAddress = label;
  currentCoords  = { lat, lon, postcode, city, label };
  hideSug();
}

document.addEventListener('click', e => {
  if (!e.target.closest('.search-container')) hideSug();
});

// ════════════════════════════════════════
// LANCEMENT DU FLOW PRINCIPAL
// ════════════════════════════════════════
async function launch() {
  if (!checkDailyLimit()) return;
  incrementDailyCount();
  const question = document.getElementById('questionInput').value.trim();
  const address  = document.getElementById('addressInput').value.trim();

  if (!question) { flash('questionInput'); return; }
  if (!address)  { flash('addressInput');  return; }

  currentAddress = address;

  // UI : désactiver bouton, cacher how-it-works
  document.getElementById('launchBtn').disabled = true;
  document.getElementById('howSection').classList.add('hidden');
  document.getElementById('zoneCard').classList.add('hidden');
  document.getElementById('qaSection').classList.add('hidden');
  document.getElementById('answers').innerHTML = '';

  // Afficher le pipeline
  showPipeline();
  pipeState(0, 'active');

  // ── ÉTAPE 1 : Géocodage ──
  currentCoords = await geocode(address);
  if (!currentCoords) {
    pipeState(0, 'error');
    alert('Adresse introuvable. Essayez avec une adresse plus précise.');
    document.getElementById('launchBtn').disabled = false;
    return;
  }
  pipeState(0, 'done'); pipeState(1, 'active');

  // ── ÉTAPE 2 : Zone PLU (GPU) ──
  const zoneData = await fetchZone(currentCoords.lat, currentCoords.lon);
  currentZone = zoneData;

  // Code INSEE depuis le geocodage initial
  const codeInsee = currentCoords.citycode || (currentZone && currentZone.codeInsee) || null;
  currentCadastre = await fetchCadastre(currentCoords.lat, currentCoords.lon, codeInsee);
  fetchRisques(codeInsee).then(d => { currentRisques = d; });
  pipeState(1, 'done'); pipeState(2, 'active');

  // ── ÉTAPE 3 : Afficher la zone ──
  await sleep(500);
  renderZoneCard(zoneData, currentCoords);
  renderCadastreCard(currentCadastre, currentCoords);
  renderQuickChips(zoneData);
  pipeState(2, 'done'); pipeState(3, 'active');

  // ── ÉTAPE 4 : Analyse IA ──
  document.getElementById('qaSection').classList.remove('hidden');
  await askQuestion(question);
  pipeState(3, 'done');

  document.getElementById('launchBtn').disabled = false;
}

// ════════════════════════════════════════
// APPELS API VIA NOTRE SERVEUR
// ════════════════════════════════════════

// Géocodage → /api/geocode
async function geocode(address) {
  try {
    const r = await fetch(`/api/geocode?q=${encodeURIComponent(address)}&limit=1`);
    const d = await r.json();
    return d.results?.[0] || null;
  } catch(e) { return null; }
}

// Zone PLU → /api/gpu/zone
async function fetchZone(lat, lon) {
  try {
    const r = await fetch(`/api/gpu/zone?lat=${lat}&lon=${lon}`);
    const d = await r.json();
    return d;
  } catch(e) {
    return { source: 'error', zone: null, zoneFull: null, commune: null };
  }
}


// Données cadastrales → /api/cadastre
async function fetchCadastre(lat, lon, codeInsee) {
  try {
    // Utiliser le code INSEE pour forcer la bonne commune (OBLIGATOIRE)
    let url = 'https://apicarto.ign.fr/api/cadastre/parcelle?lon=' + lon + '&lat=' + lat + '&_limit=1';
    if (codeInsee) url += '&code_insee=' + codeInsee;
    else return null; // Sans code INSEE on ne peut pas garantir la bonne commune
    const r = await fetch(url);
    const d = await r.json();
    if (!d.features || !d.features.length) return null;
    const feat  = d.features[0];
    const props = feat.properties;
    const surface = props.contenance || 0;
    return {
      parcelle: {
        found:    true,
        surface,
        commune:  props.nom_com   || '',
        section:  props.section   || '',
        numero:   props.numero    || '',
        codeInsee: props.code_insee || '',
        geometry: feat.geometry
      },
      calculs: surface > 0 ? {
        surfaceParcelle:      surface,
        empriseExistante:     0,
        tauxOccupationActuel: null,
        disponibleSi50pct:    Math.round(surface * 0.50),
        disponibleSi40pct:    Math.round(surface * 0.40),
        disponibleSi30pct:    Math.round(surface * 0.30),
        verandaSansPermis:    Math.min(19, Math.round(surface * 0.05))
      } : null
    };
  } catch(e) { return null; }
}

// Risques naturels -> /api/risques
async function fetchRisques(codeInsee) {
  if (!codeInsee) return null;
  try {
    const r = await fetch("/api/risques?code_insee=" + codeInsee);
    return await r.json();
  } catch(e) { return null; }
}

// Analyse IA -> /api/ai
async function callAI(payload) {
  const r = await fetch('/api/ai', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(payload)
  });
  if (!r.ok) {
    const err = await r.json();
    throw new Error(err.error || `Erreur serveur ${r.status}`);
  }
  return r.json();
}

// ════════════════════════════════════════
// QUESTIONS
// ════════════════════════════════════════
async function askFree() {
  const q = document.getElementById('freeQ').value.trim();
  if (!q) return;
  document.getElementById('freeQ').value = '';
  await askQuestion(q);
}

async function askQuestion(question) {
  document.getElementById('askBtn').disabled = true;

  // Afficher shimmer
  const shimmerId = 'sh_' + Date.now();
  document.getElementById('answers').insertAdjacentHTML('afterbegin', `
    <div class="shimmer" id="${shimmerId}">
      <div class="sh" style="height:13px;width:55%"></div>
      <div class="sh" style="height:10px;width:88%"></div>
      <div class="sh" style="height:10px;width:73%"></div>
      <div class="sh" style="height:10px;width:82%"></div>
      <div class="sh" style="height:10px;width:48%"></div>
    </div>`);

  try {
    const result = await callAI({
      question,
      zone:      currentZone?.zone,
      zoneFull:  currentZone?.zoneFull,
      commune:   currentZone?.commune  || currentCoords?.city,
      postcode:  currentZone?.codeInsee || currentCoords?.postcode,
      address:   currentAddress,
      urlfic:    currentZone?.urlfic,
      datappro:  currentZone?.datappro,
      cadastre:  currentCadastre
    });

    document.getElementById(shimmerId)?.remove();
    renderAnswer(question, result);

  } catch(err) {
    document.getElementById(shimmerId)?.remove();
    renderAnswerError(question, err.message);
  }

  document.getElementById('askBtn').disabled = false;
}

// Questions rapides prédéfinies selon la zone
function renderQuickChips(zone) {
  const z = (zone?.zone || 'U').toUpperCase();
  let chips = [
    { e: '🏗', q: 'Puis-je construire une extension de 30 m² ?' },
    { e: '🌿', q: 'Puis-je construire une véranda dans mon jardin ?' },
    { e: '📏', q: 'Quelle est la hauteur maximale autorisée ?' },
    { e: '🏊', q: 'Puis-je construire une piscine ?' },
    { e: '🚗', q: 'Puis-je construire un garage ou carport ?' },
    { e: '☀️', q: 'Puis-je installer des panneaux solaires ?' },
  ];
  if (z.startsWith('N') || z.startsWith('A')) {
    chips = [
      { e: '🏡', q: 'Puis-je construire une maison sur ce terrain ?' },
      { e: '🔄', q: 'Puis-je changer la destination du bâtiment existant ?' },
      { e: '🏗', q: 'Puis-je agrandir le bâtiment existant ?' },
      { e: '☀️', q: 'Puis-je installer des panneaux solaires ?' },
      { e: '💧', q: 'Y a-t-il des contraintes liées à une zone inondable ?' },
      { e: '🌾', q: 'Quelles constructions sont autorisées ici ?' },
    ];
  }
  document.getElementById('quickChips').innerHTML = chips.map(c =>
    `<div class="q-chip" onclick="quickAsk('${esc(c.q)}')">${c.e} ${c.q}</div>`
  ).join('');
}

async function quickAsk(q) {
  document.getElementById('freeQ').value = q;
  await askQuestion(q);
  document.getElementById('freeQ').value = '';
}

// ════════════════════════════════════════
// RENDU : ZONE CARD
// ════════════════════════════════════════
function renderZoneCard(zone, coords) {
  document.getElementById('zoneBadge').textContent  = zone.zone || '?';
  document.getElementById('zoneName').textContent   = zone.zoneFull || 'Zone non identifiée';
  document.getElementById('zoneCommune').textContent =
    (zone.commune || coords?.city || '') +
    (coords?.postcode ? ` (${coords.postcode})` : '');

  // Tags source
  const isOfficial = zone.source === 'gpu-apicarto' || zone.source === 'gpu-wfs';
  let tags = isOfficial
    ? ['<span class="ztag">✅ GPU officiel</span>']
    : ['<span class="ztag">⚠️ Données indicatives</span>'];
  if (zone.datappro) tags.push(`<span class="ztag">PLU ${zone.datappro.slice(0,4)}</span>`);
  document.getElementById('zoneTags').innerHTML = tags.join('');

  // Date d'approbation
  document.getElementById('zoneDate').textContent =
    zone.datappro ? ` · PLU approuvé le ${zone.datappro}` : '';

  // Lien GPU
  const gpuUrl = `https://www.geoportail-urbanisme.gouv.fr/map/#tile=1&lon=${coords.lon}&lat=${coords.lat}&zoom=17`;
  document.getElementById('gpuLink').href = gpuUrl;
  document.getElementById('gpuBtn').href  = gpuUrl;

  // Règles indicatives de la zone
  const rules = zoneRules(zone.zone);
  document.getElementById('zoneRules').innerHTML = rules.map(r => `
    <div class="rule-cell" ${r.detail ? 'title="' + r.detail + '" onclick="toggleRuleDetail(this)"' : ''}>
      <div class="rule-val">${r.val}</div>
      <div class="rule-key">${r.key}</div>
      <div class="rule-note">${r.note}</div>
      ${r.detail ? '<div class="rule-detail">' + (r.svg ? '<div class="rule-svg">' + r.svg + '</div>' : '') + '<div class="rule-detail-text">' + r.detail + '</div></div>' : ''}
    </div>`).join('');

  document.getElementById('zoneCard').classList.remove('hidden');
  

}

function renderCadastreCard(cad, coords) {
  // Supprimer ancien bloc
  const old = document.getElementById('cadastreBlock');
  if (old) old.remove();

  const c = cad && cad.calculs;
  const p = cad && cad.parcelle;

  // Bande de données cadastrales
  let stripHtml = '';
  if (c && c.surfaceParcelle > 0) {
    const items = [
      { label: 'Parcelle', val: c.surfaceParcelle + ' m²', green: false },
      { label: 'Constructible est.', val: c.disponibleSi50pct + ' m²', green: true },
      ...(p && p.section ? [{ label: 'Réf. cadastre', val: 'Sec. ' + p.section + ' n°' + p.numero, green: false }] : [])
    ];
    stripHtml = '<div class="cadastre-strip">' +
      items.map(i => '<span class="cad-item' + (i.green ? ' cad-green' : '') + '">' +
        '<span class="cad-label">' + i.label + '</span>' +
        '<strong>' + i.val + '</strong></span>').join('') +
      '</div>';
  }

  // Carte Leaflet
  const mapHtml = '<div id="cadastreMap" style="height:280px;width:100%;border-top:1px solid var(--border)"></div>';

  // Bloc complet
  const block = document.createElement('div');
  block.id = 'cadastreBlock';
  block.innerHTML = stripHtml + mapHtml;
  document.getElementById('zoneRules').insertAdjacentElement('afterend', block);

  // Initialiser la carte immédiatement
  if (typeof L === 'undefined') return;
  if (window._leafletMap) { window._leafletMap.remove(); window._leafletMap = null; }

  const m = L.map('cadastreMap', { zoomControl: true });
  window._leafletMap = m;

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap', maxZoom: 20
  }).addTo(m);

  m.setView([coords.lat, coords.lon], 18);

  // Si la géométrie est disponible depuis notre API, l'afficher
  if (p && p.geometry && p.geometry.coordinates) {
    const layer = L.geoJSON(p.geometry, {
      style: { color: '#c0381a', weight: 2.5, fillColor: '#c0381a', fillOpacity: 0.15 }
    }).addTo(m);
    try {
      m.fitBounds(layer.getBounds(), { padding: [20, 20] });
      // Label surface sur la carte
      if (cad && cad.parcelle && cad.parcelle.surface > 0) {
        const center = layer.getBounds().getCenter();
        L.tooltip({ permanent: true, direction: 'center', className: 'parcel-label' })
          .setContent(cad.parcelle.surface + ' m²')
          .setLatLng(center)
          .addTo(m);
      }
    } catch(e) {}
  } else {
    // Fallback : récupérer la géométrie directement depuis APICarto (public, pas de CORS)
    fetch('https://apicarto.ign.fr/api/cadastre/parcelle?lon=' + coords.lon + '&lat=' + coords.lat + '&_limit=1')
      .then(r => r.json())
      .then(data => {
        if (data.features && data.features.length > 0) {
          const feat = data.features[0];
          const props = feat.properties;
          // Mettre à jour la bande avec les vraies données
          const surface = props.contenance || 0;
          if (surface > 0) {
            const strip = document.querySelector('.cadastre-strip');
            if (strip) {
              const constructible = Math.round(surface * 0.5);
              strip.innerHTML =
                '<span class="cad-item"><span class="cad-label">Parcelle</span><strong>' + surface + ' m²</strong></span>' +
                '<span class="cad-item cad-green"><span class="cad-label">Constructible est.</span><strong>' + constructible + ' m²</strong></span>' +
                (props.section ? '<span class="cad-item"><span class="cad-label">Réf. cadastre</span><strong>Sec. ' + props.section + ' n°' + props.numero + '</strong></span>' : '');
            }
          }
          // Afficher le polygone
          if (feat.geometry) {
            const layer = L.geoJSON(feat.geometry, {
              style: { color: '#c0381a', weight: 2.5, fillColor: '#c0381a', fillOpacity: 0.15 }
            }).addTo(m);
            try {
              m.fitBounds(layer.getBounds(), { padding: [20, 20] });
              if (surface > 0) {
                const center = layer.getBounds().getCenter();
                L.tooltip({ permanent: true, direction: 'center', className: 'parcel-label' })
                  .setContent(surface + ' m²')
                  .setLatLng(center)
                  .addTo(m);
              }
            } catch(e) {}
          }
        }
      })
      .catch(() => {
        // Simple marqueur si tout échoue
        L.circleMarker([coords.lat, coords.lon], {
          radius: 10, color: '#c0381a', fillColor: '#c0381a', fillOpacity: 0.5
        }).addTo(m);
      });
  }
}


function toggleRuleDetail(el) {
  el.classList.toggle('rule-open');
}

function zoneRules(z) {
  z = (z || "").toUpperCase();
  if (z.startsWith("UA") || z === "UC" || z === "U") return [
    { val: "10-15m", key: "Hauteur max",  note: "Egout du toit R3/R4", detail: "Mesuree du sol jusqu a l egout. Faitage peut depasser de 1,5m." },
    { val: "0m",     key: "Recul voirie", note: "Alignement",          detail: "Facade a l alignement de la voie sauf indication du PLU." },
    { val: "20%",    key: "Pleine terre", note: "Jardin min 20%",      detail: "20% de la parcelle minimum en pleine terre." },
    { val: "0.8-1.5",key: "COS",         note: "Coeff occupation",    detail: "Surface constructible = COS x parcelle." }
  ];
  if (z.startsWith("UB") || z.startsWith("UD")) return [
    { val: "7-9m",   key: "Hauteur max",  note: "Egout du toit R1/R2", detail: "Mesuree du sol jusqu a l egout. Maison plus 1 ou 2 etages." },
    { val: "5m",     key: "Recul voirie", note: "Distance min 5m",     detail: "Facade principale a minimum 5m de la voie." },
    { val: "30%",    key: "Pleine terre", note: "Jardin min 30%",      detail: "30% minimum de la parcelle non impermeabilisee." },
    { val: "0.3-0.6",key: "COS",         note: "Coeff occupation",    detail: "Surface constructible = COS x parcelle." }
  ];
  if (z.startsWith("AU") || z.startsWith("1AU")) return [
    { val: "7-10m",  key: "Hauteur max",  note: "Egout variable",      detail: "Zone a urbaniser. Hauteur definie par l OAP." },
    { val: "5m",     key: "Recul voirie", note: "Distance min 5m",     detail: "Recul minimum 5m sauf prescriptions OAP." },
    { val: "25%",    key: "Pleine terre", note: "Jardin min 25%",      detail: "25% minimum de la parcelle en pleine terre." },
    { val: "OAP",    key: "Orientation",  note: "Voir document OAP",   detail: "Zone soumise a une Orientation d Amenagement." }
  ];
  if (z.startsWith("N")) return [
    { val: "---",    key: "Construction", note: "Tres limitee",        detail: "Zone naturelle protegee. Construction quasi interdite." },
    { val: "10m",    key: "Recul voirie", note: "Distance min 10m",    detail: "Recul minimum 10m depuis la voie publique." },
    { val: "90%",    key: "Pleine terre", note: "Zone naturelle",      detail: "90% minimum en pleine terre." },
    { val: "~0",     key: "COS",          note: "Quasi nul",           detail: "COS proche de zero. Construction quasi interdite." }
  ];
  if (z.startsWith("A")) return [
    { val: "---",    key: "Construction", note: "Usage agricole",      detail: "Zone agricole. Constructions agricoles uniquement." },
    { val: "15m",    key: "Recul voirie", note: "Distance min 15m",    detail: "Recul minimum 15m pour batiment agricole." },
    { val: "85%",    key: "Pleine terre", note: "Zone agricole",       detail: "85% minimum de la parcelle en pleine terre." },
    { val: "0.05",   key: "COS",          note: "Tres limite",         detail: "Reserve aux batiments agricoles indispensables." }
  ];
  return [
    { val: "9-12m",  key: "Hauteur max",  note: "Egout variable",      detail: "Mesuree du sol jusqu a l egout. Faitage peut depasser de 1,5m.", svg: '<svg viewBox=\'0 0 120 100\' xmlns=\'http://www.w3.org/2000/svg\' style=\'width:100%;max-width:180px\'>  <rect x=\'10\' y=\'60\' width=\'100\' height=\'35\' fill=\'#e8e4dc\' stroke=\'#999\' stroke-width=\'1\'/>  <rect x=\'25\' y=\'30\' width=\'70\' height=\'30\' fill=\'#d4c9b0\' stroke=\'#999\' stroke-width=\'1\'/>  <polygon points=\'20,30 60,8 100,30\' fill=\'#c0381a\' opacity=\'0.7\'/>  <line x1=\'5\' y1=\'30\' x2=\'115\' y2=\'30\' stroke=\'#c0381a\' stroke-width=\'1\' stroke-dasharray=\'3,2\'/>  <line x1=\'5\' y1=\'95\' x2=\'115\' y2=\'95\' stroke=\'#666\' stroke-width=\'1\'/>  <line x1=\'108\' y1=\'30\' x2=\'108\' y2=\'95\' stroke=\'#c0381a\' stroke-width=\'1.5\' marker-end=\'url(#arr)\'/>  <text x=\'82\' y=\'65\' font-size=\'7\' fill=\'#c0381a\' font-family=\'sans-serif\'>egout</text>  <text x=\'82\' y=\'73\' font-size=\'7\' fill=\'#c0381a\' font-family=\'sans-serif\'>9-12m</text>  <text x=\'30\' y=\'98\' font-size=\'6\' fill=\'#666\' font-family=\'sans-serif\'>sol naturel</text></svg>' },
    { val: "5m",     key: "Recul voirie", note: "Distance variable",   detail: "Distance minimale entre la facade et la voie.", svg: '<svg viewBox=\'0 0 120 90\' xmlns=\'http://www.w3.org/2000/svg\' style=\'width:100%;max-width:180px\'>  <rect x=\'0\' y=\'70\' width=\'120\' height=\'20\' fill=\'#d4c9b0\'/>  <text x=\'45\' y=\'83\' font-size=\'7\' fill=\'#666\' font-family=\'sans-serif\'>voie publique</text>  <rect x=\'40\' y=\'20\' width=\'55\' height=\'45\' fill=\'#d4c9b0\' stroke=\'#999\' stroke-width=\'1\'/>  <text x=\'52\' y=\'47\' font-size=\'8\' fill=\'#666\' font-family=\'sans-serif\'>batiment</text>  <line x1=\'10\' y1=\'70\' x2=\'10\' y2=\'10\' stroke=\'#999\' stroke-width=\'1\' stroke-dasharray=\'3,2\'/>  <line x1=\'40\' y1=\'50\' x2=\'40\' y2=\'50\'/>  <line x1=\'10\' y1=\'42\' x2=\'40\' y2=\'42\' stroke=\'#c0381a\' stroke-width=\'1.5\'/>  <text x=\'14\' y=\'39\' font-size=\'7\' fill=\'#c0381a\' font-family=\'sans-serif\'>recul</text>  <text x=\'14\' y=\'47\' font-size=\'7\' fill=\'#c0381a\' font-family=\'sans-serif\'>5m min</text>  <line x1=\'10\' y1=\'10\' x2=\'120\' y2=\'10\' stroke=\'#999\' stroke-width=\'0.5\' stroke-dasharray=\'2,2\'/>  <text x=\'12\' y=\'8\' font-size=\'6\' fill=\'#999\' font-family=\'sans-serif\'>limite parcelle</text></svg>' },
    { val: "25%",    key: "Pleine terre", note: "Surface jardin min",  detail: "Pourcentage minimum de la parcelle en pleine terre.", svg: '<svg viewBox=\'0 0 120 90\' xmlns=\'http://www.w3.org/2000/svg\' style=\'width:100%;max-width:180px\'>  <rect x=\'5\' y=\'5\' width=\'110\' height=\'80\' fill=\'#e8f5e9\' stroke=\'#999\' stroke-width=\'1\'/>  <rect x=\'5\' y=\'5\' width=\'65\' height=\'80\' fill=\'#d4c9b0\' stroke=\'#999\' stroke-width=\'1\'/>  <rect x=\'15\' y=\'15\' width=\'45\' height=\'55\' fill=\'#c5b99a\' stroke=\'#999\' stroke-width=\'1\'/>  <text x=\'25\' y=\'47\' font-size=\'7\' fill=\'#666\' font-family=\'sans-serif\'>bati+</text>  <text x=\'20\' y=\'56\' font-size=\'7\' fill=\'#666\' font-family=\'sans-serif\'>mineraux</text>  <text x=\'75\' y=\'40\' font-size=\'7\' fill=\'#2e7d32\' font-family=\'sans-serif\'>pleine</text>  <text x=\'75\' y=\'50\' font-size=\'7\' fill=\'#2e7d32\' font-family=\'sans-serif\'>terre</text>  <text x=\'75\' y=\'60\' font-size=\'8\' fill=\'#2e7d32\' font-weight=\'bold\' font-family=\'sans-serif\'>25%</text>  <text x=\'8\' y=\'98\' font-size=\'6\' fill=\'#c0381a\' font-family=\'sans-serif\'>impermeabilise 75%</text></svg>' },
    { val: "Var.",   key: "COS",          note: "Voir PLU",            detail: "Le COS determine la surface max constructible.", svg: '<svg viewBox=\'0 0 120 90\' xmlns=\'http://www.w3.org/2000/svg\' style=\'width:100%;max-width:180px\'>  <rect x=\'5\' y=\'60\' width=\'110\' height=\'25\' fill=\'#e8e4dc\' stroke=\'#999\' stroke-width=\'1\'/>  <text x=\'45\' y=\'76\' font-size=\'7\' fill=\'#666\' font-family=\'sans-serif\'>parcelle</text>  <rect x=\'15\' y=\'40\' width=\'35\' height=\'20\' fill=\'#d4c9b0\' stroke=\'#999\' stroke-width=\'1\'/>  <text x=\'18\' y=\'53\' font-size=\'6\' fill=\'#666\' font-family=\'sans-serif\'>RDC</text>  <rect x=\'20\' y=\'22\' width=\'25\' height=\'18\' fill=\'#c5b99a\' stroke=\'#999\' stroke-width=\'1\'/>  <text x=\'23\' y=\'34\' font-size=\'6\' fill=\'#666\' font-family=\'sans-serif\'>R+1</text>  <rect x=\'23\' y=\'8\' width=\'19\' height=\'14\' fill=\'#b5a98a\' stroke=\'#999\' stroke-width=\'1\'/>  <text x=\'25\' y=\'18\' font-size=\'6\' fill=\'#666\' font-family=\'sans-serif\'>R+2</text>  <text x=\'65\' y=\'30\' font-size=\'7\' fill=\'#c0381a\' font-family=\'sans-serif\'>surface</text>  <text x=\'65\' y=\'40\' font-size=\'7\' fill=\'#c0381a\' font-family=\'sans-serif\'>plancher</text>  <text x=\'65\' y=\'50\' font-size=\'7\' fill=\'#c0381a\' font-family=\'sans-serif\'>= COS x</text>  <text x=\'65\' y=\'60\' font-size=\'7\' fill=\'#c0381a\' font-family=\'sans-serif\'>parcelle</text></svg>' }
  ];
}

// ════════════════════════════════════════
// RENDU : ANSWER CARD
// ════════════════════════════════════════
function renderAnswer(question, data) {
  const verdictClass = {
    'OUI':            'v-oui',
    'NON':            'v-non',
    'SOUS_CONDITIONS':'v-cond',
    'INFO':           'v-info'
  }[data.verdict] || 'v-info';

  const verdictLabel = {
    'OUI':            '✅ OUI',
    'NON':            '❌ NON',
    'SOUS_CONDITIONS':'⚠️ Sous conditions',
    'INFO':           'ℹ️ Info'
  }[data.verdict] || 'ℹ️ Info';

  // Conditions
  const condHtml = (data.conditions || []).map(c => {
    const cls  = { ok:'cond-ok', alert:'cond-alert', info:'cond-info', warn:'cond-warn' }[c.type] || 'cond-info';
    const icon = { ok:'✅', alert:'⛔', info:'ℹ️', warn:'⚠️' }[c.type] || 'ℹ️';
    return `<div class="cond-line ${cls}"><span class="cond-icon">${icon}</span><span>${c.text}</span></div>`;
  }).join('');

  // Règles
  const reglesHtml = (data.regles || []).length ? `
    <div class="regles-title">Règles applicables</div>
    ${data.regles.map(r => `
      <div class="regle-row">
        <span class="regle-label">${r.label}</span>
        <span class="regle-val">${r.valeur}</span>
        ${r.article ? `<span class="regle-art">${r.article}</span>` : ''}
      </div>`).join('')}` : '';

  // Coûts
  const coutsHtml = (data.couts?.present) ? `
    <div class="couts-title">Estimation budgétaire</div>
    <div class="couts-box">
      <div class="couts-amount">💰 ${data.couts.fourchette || ''}</div>
      ${data.couts.detail ? `<div class="couts-detail">${data.couts.detail}</div>` : ''}
    </div>` : '';

  // Prix du marché
  const marcheHtml = data.marche ? `
    <div class="couts-title">Prix du marché immobilier</div>
    <div class="marche-grid">
      ${data.marche.prix_maison ? `<div class="marche-item"><span class="marche-label">🏠 Maison</span><span class="marche-val">${data.marche.prix_maison}</span></div>` : ''}
      ${data.marche.prix_appart ? `<div class="marche-item"><span class="marche-label">🏢 Appartement</span><span class="marche-val">${data.marche.prix_appart}</span></div>` : ''}
      ${data.marche.source ? `<div class="marche-source">Source : ${data.marche.source}</div>` : ''}
    </div>` : '';

  // Constructibilité
  const constructHtml = data.constructibilite ? `
    <div class="couts-title">Potentiel constructible</div>
    <div class="construct-box">
      ${data.constructibilite.shon_max ? `<div class="construct-shon">📐 Surface max : <strong>${data.constructibilite.shon_max}</strong></div>` : ''}
      ${data.constructibilite.detail ? `<div class="construct-detail">${data.constructibilite.detail}</div>` : ''}
    </div>` : '';

  // Délais
  const delaisHtml = data.delais ? `
    <div class="couts-title">Délais estimés</div>
    <div class="delais-box">
      ${data.delais.instruction ? `<div class="delai-item">⏱ Instruction : <strong>${data.delais.instruction}</strong></div>` : ''}
      ${data.delais.recours_tiers ? `<div class="delai-item">⚖️ Recours tiers : ${data.delais.recours_tiers}</div>` : ''}
      ${data.delais.total_estime ? `<div class="delai-total">Total estimé : <strong>${data.delais.total_estime}</strong></div>` : ''}
    </div>` : '';

  // Taxe d'aménagement
  const taxeHtml = data.taxe_amenagement ? `
    <div class="couts-title">Taxe d'aménagement</div>
    <div class="taxe-box">
      ${data.taxe_amenagement.montant_estime ? `<div class="taxe-montant">🏛 Montant estimé : <strong>${data.taxe_amenagement.montant_estime}</strong></div>` : ''}
      ${data.taxe_amenagement.detail ? `<div class="taxe-detail">${data.taxe_amenagement.detail}</div>` : ''}
    </div>` : '';

  // Étapes
  const etapesHtml = (data.etapes || []).length ? `
    <div class="etapes-title">Prochaines étapes</div>
    ${data.etapes.map((e, i) => `
      <div class="etape-row">
        <span class="etape-num">${i+1}.</span>
        <span class="etape-text">${e}</span>
      </div>`).join('')}` : '';

  // Risques
  const risquesHtml = (data.risques || []).length ? `
    ${data.risques.map(r => `<div class="cond-line cond-warn"><span class="cond-icon">⚠️</span><span>${r}</span></div>`).join('')}` : '';

  const zone    = currentZone?.zone    || '';
  const commune = currentZone?.commune || currentCoords?.city || '';
  const isOfficial = currentZone?.source === 'gpu-apicarto' || currentZone?.source === 'gpu-wfs';

  // Affichage source PLU — PDF officiel ou règles générales
  let sourceHtml;
  if (data.plu_available) {
    sourceHtml = `<span style="color:var(--green);font-weight:500">📄 PLU officiel lu</span> · <a href="${currentZone?.urlfic||'https://www.geoportail-urbanisme.gouv.fr'}" target="_blank">Voir le règlement</a>`;
  } else if (isOfficial) {
    sourceHtml = `<a href="https://www.geoportail-urbanisme.gouv.fr" target="_blank">GPU officiel</a> · PDF non disponible`;
  } else {
    sourceHtml = `Règles indicatives · <a href="https://www.geoportail-urbanisme.gouv.fr" target="_blank">Vérifier sur GPU</a>`;
  }

  const html = `
    <div class="answer-card">
      <div class="answer-top">
        <div class="verdict ${verdictClass}">${verdictLabel}</div>
        <div>
          <div class="answer-q-text">${question}</div>
          <div class="answer-q-meta">${zone ? `Zone ${zone} · ` : ''}${commune}</div>
        </div>
      </div>
      <div class="answer-body">
        <div class="answer-resume">${data.resume || ''}</div>
        ${condHtml}
        ${reglesHtml}
        ${coutsHtml}
        ${marcheHtml}
        ${constructHtml}
        ${delaisHtml}
        ${taxeHtml}
        ${etapesHtml}
        ${risquesHtml}
        ${data.disclaimer ? `<div class="answer-disclaimer">📌 ${data.disclaimer}</div>` : ''}
      </div>
      <div class="answer-footer">
        <div class="answer-source">📡 ${sourceHtml}</div>
        <div class="answer-btns">
          <button class="ans-btn" onclick="copyCard(this)">📋 Copier</button>
          <button class="ans-btn" onclick="exportCard(this, '${esc(question)}')">📄 Exporter</button>
          <button class="ans-btn ans-btn-compare" onclick="startCompare(this)">⚖️ Comparer</button>
        </div>
      </div>
    </div>`;

  document.getElementById('answers').insertAdjacentHTML('afterbegin', html);
  saveToHistory(currentAddress, question, data.verdict || '', currentZone && currentZone.zone ? currentZone.zone : '');

  // Pub contextuelle immobiliere (version gratuite)
  renderContextualAd(currentZone && currentZone.commune ? currentZone.commune : (currentCoords ? currentCoords.city : ''), currentCoords);
}

function renderContextualAd(ville, coords) {
  var old = document.getElementById('contextualAd');
  if (old) old.remove();

  var villeEncode = encodeURIComponent(ville || '');
  var selogerUrl  = 'https://www.seloger.com/annonces/achat/ville-' + villeEncode.toLowerCase().replace(/%20/g,'-') + '.htm';
  var lbcUrl      = 'https://www.leboncoin.fr/recherche?category=9&locations=' + villeEncode;
  var gpuUrl      = coords ? 'https://www.geoportail-urbanisme.gouv.fr/map/#tile=1&lon=' + coords.lon + '&lat=' + coords.lat + '&zoom=17' : '#';

  var ad = document.createElement('div');
  ad.id = 'contextualAd';
  ad.className = 'contextual-ad';
  ad.innerHTML =
    '<div class="ad-label">Liens utiles</div>' +
    '<div class="ad-links">' +
      '<a href="' + selogerUrl + '" target="_blank" rel="noopener" class="ad-link">' +
        '<span class="ad-link-icon">🏠</span>' +
        '<span class="ad-link-body">' +
          '<span class="ad-link-title">Biens a vendre</span>' +
          '<span class="ad-link-sub">' + (ville || 'dans cette ville') + ' · SeLoger</span>' +
        '</span>' +
        '<span class="ad-link-arrow">→</span>' +
      '</a>' +
      '<a href="' + lbcUrl + '" target="_blank" rel="noopener" class="ad-link">' +
        '<span class="ad-link-icon">🔍</span>' +
        '<span class="ad-link-body">' +
          '<span class="ad-link-title">Annonces immobilieres</span>' +
          '<span class="ad-link-sub">' + (ville || 'dans cette ville') + ' · Leboncoin</span>' +
        '</span>' +
        '<span class="ad-link-arrow">→</span>' +
      '</a>' +
      '<a href="' + gpuUrl + '" target="_blank" rel="noopener" class="ad-link">' +
        '<span class="ad-link-icon">🗺</span>' +
        '<span class="ad-link-body">' +
          '<span class="ad-link-title">Voir le PLU complet</span>' +
          '<span class="ad-link-sub">Geoportail de l Urbanisme officiel</span>' +
        '</span>' +
        '<span class="ad-link-arrow">→</span>' +
      '</a>' +
    '</div>' +
    '<div class="ad-footer">Liens partenaires · Version gratuite</div>';

  document.getElementById('answers').insertAdjacentElement('afterend', ad);
}

function renderAnswerError(question, msg) {
  document.getElementById('answers').insertAdjacentHTML('afterbegin', `
    <div class="answer-card">
      <div class="answer-top">
        <div class="verdict v-info">⚠️ Erreur</div>
        <div class="answer-q-text">${question}</div>
      </div>
      <div class="answer-body" style="color:var(--red)">
        ${msg}<br>
        <span style="font-size:.78rem;color:var(--muted)">Vérifiez que le serveur est démarré (<code>npm start</code>) et que les clés API sont configurées.</span>
      </div>
    </div>`);
}

// ════════════════════════════════════════
// PIPELINE UI
// ════════════════════════════════════════
function showPipeline() {
  const el = document.getElementById('pipeline');
  el.classList.add('show');
  // Reset tous les steps
  [0,1,2,3].forEach(i => {
    const s = document.getElementById(`ps${i}`);
    s.classList.remove('active','done');
    s.querySelector('.pipe-icon').textContent = ['📍','🗺','📄','🧠'][i];
  });
}

function pipeState(i, state) {
  const el = document.getElementById(`ps${i}`);
  el.classList.remove('active', 'done');
  if (state === 'active') el.classList.add('active');
  if (state === 'done')   { el.classList.add('done'); el.querySelector('.pipe-icon').textContent = '✓'; }
}

// ════════════════════════════════════════
// EXPORT / COPY
// ════════════════════════════════════════
function copyCard(btn) {
  const card = btn.closest('.answer-card');
  const text = card.querySelector('.answer-body').innerText;
  navigator.clipboard.writeText(text).then(() => {
    btn.textContent = '✓ Copié !';
    setTimeout(() => btn.textContent = '📋 Copier', 2000);
  });
}

// ════════════════════════════════════════
// RISQUES NATURELS
// ════════════════════════════════════════
function renderRisquesCard(data) {
  var old = document.getElementById("risquesBlock");
  if (old) old.remove();
  if (!data || !data.found || !data.risques || !data.risques.length) return;

  var icons = {
    inondation:  "inondation",
    seisme:      "sismicite",
    mouvement:   "mouvement terrain",
    tassement:   "tassement",
    feu:         "feu de foret",
    cavite:      "cavites / carrieres",
    industriel:  "risque industriel",
    radon:       "radon",
    avalanche:   "avalanche",
    volcan:      "volcan",
    autre:       "risque"
  };

  var levelColors = { alert: "#c0381a", warn: "#e68c1e", info: "#2563eb" };

  var items = data.risques.map(function(r) {
    var color = levelColors[r.level] || levelColors.info;
    return "<div class=\"risque-item\">" +
      "<span class=\"risque-dot\" style=\"background:" + color + "\"></span>" +
      "<span class=\"risque-label\">" + r.label + "</span>" +
      "</div>";
  }).join("");

  var block = document.createElement("div");
  block.id = "risquesBlock";
  block.className = "risques-block";
  block.innerHTML =
    "<div class=\"risques-header\">Risques identifies sur la commune</div>" +
    "<div class=\"risques-grid\">" + items + "</div>" +
    "<div class=\"risques-source\">Source : Georisques.gouv.fr - GASPAR</div>";

  var cadastreBlock = document.getElementById("cadastreBlock");
  if (cadastreBlock) {
    cadastreBlock.insertAdjacentElement("afterend", block);
  } else {
    document.getElementById("zoneRules").insertAdjacentElement("afterend", block);
  }
}


// ════════════════════════════════════════
// HISTORIQUE DES ANALYSES
// ════════════════════════════════════════
function saveToHistory(address, question, verdict, zone) {
  try {
    var history = JSON.parse(localStorage.getItem('urbaniaHistory') || '[]');
    history.unshift({
      id:       Date.now(),
      date:     new Date().toLocaleDateString('fr-FR'),
      address:  address,
      question: question,
      verdict:  verdict,
      zone:     zone,
      commune:  currentZone && currentZone.commune ? currentZone.commune : ''
    });
    // Garder max 20 analyses
    history = history.slice(0, 20);
    localStorage.setItem('urbaniaHistory', JSON.stringify(history));
    renderHistoryCount();
    syncHistoryToCloud(history[0]);
  } catch(e) {}
}

function renderHistoryCount() {
  try {
    var history = JSON.parse(localStorage.getItem('urbaniaHistory') || '[]');
    var btn = document.getElementById('historyBtn');
    if (btn && history.length > 0) {
      btn.textContent = '📋 Historique (' + history.length + ')';
    }
  } catch(e) {}
}

function showHistory() {
  try {
    var history = JSON.parse(localStorage.getItem('urbaniaHistory') || '[]');
    var old = document.getElementById('historyModal');
    if (old) old.remove();

    if (history.length === 0) {
      alert('Aucune analyse enregistree.');
      return;
    }

    var rows = history.map(function(h) {
      var vc = h.verdict && h.verdict.includes('OUI') ? 'color:#22a855' :
               h.verdict && h.verdict.includes('NON') ? 'color:#c0381a' : 'color:#e68c1e';
      return '<tr onclick="loadFromHistory(' + h.id + ')" style="cursor:pointer">' +
        '<td style="padding:0.6rem 1rem;font-size:0.75rem;color:#666">' + h.date + '</td>' +
        '<td style="padding:0.6rem 1rem;font-size:0.8rem;font-weight:500">' + (h.address||'') + '</td>' +
        '<td style="padding:0.6rem 1rem;font-size:0.75rem;color:#666">' + (h.question||'') + '</td>' +
        '<td style="padding:0.6rem 1rem;font-size:0.72rem;font-weight:600;' + vc + '">' + (h.verdict||'') + '</td>' +
        '</tr>';
    }).join('');

    var modal = document.createElement('div');
    modal.id = 'historyModal';
    modal.style.cssText = 'position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;';

    var inner = document.createElement('div');
    inner.style.cssText = 'position:absolute;inset:0;background:rgba(0,0,0,0.5)';
    inner.onclick = function() { modal.remove(); };
    modal.appendChild(inner);

    var panel = document.createElement('div');
    panel.style.cssText = 'position:relative;background:white;width:90%;max-width:700px;max-height:80vh;overflow:auto;z-index:1001';
    panel.innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:center;padding:1rem 1.5rem;border-bottom:1px solid #e2e0db">' +
        '<span style="font-weight:600;font-size:0.9rem">Historique des analyses</span>' +
        '<button id="closeHistBtn" style="background:none;border:none;cursor:pointer;font-size:1rem;color:#666">X</button>' +
      '</div>' +
      '<table style="width:100%;border-collapse:collapse">' +
        '<thead><tr style="background:#f5f4f1">' +
          '<th style="padding:0.5rem 1rem;font-size:0.65rem;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#666;text-align:left">Date</th>' +
          '<th style="padding:0.5rem 1rem;font-size:0.65rem;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#666;text-align:left">Adresse</th>' +
          '<th style="padding:0.5rem 1rem;font-size:0.65rem;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#666;text-align:left">Question</th>' +
          '<th style="padding:0.5rem 1rem;font-size:0.65rem;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#666;text-align:left">Verdict</th>' +
        '</tr></thead>' +
        '<tbody>' + rows + '</tbody>' +
      '</table>' +
      '<div style="padding:0.8rem 1.5rem;border-top:1px solid #e2e0db;display:flex;justify-content:space-between;align-items:center">' +
        '<span style="font-size:0.72rem;color:#666">' + history.length + ' analyse(s)</span>' +
        '<button id="clearHistBtn" style="font-size:0.72rem;color:#c0381a;background:none;border:none;cursor:pointer">Effacer tout</button>' +
      '</div>';

    modal.appendChild(panel);
    document.body.appendChild(modal);

    document.getElementById('closeHistBtn').onclick = function() { modal.remove(); };
    document.getElementById('clearHistBtn').onclick = function() { clearHistory(); };

  } catch(e) { console.error(e); }
}

function clearHistory() {
  if (confirm('Effacer tout l historique ?')) {
    localStorage.removeItem('urbaniaHistory');
    document.getElementById('historyModal').remove();
    renderHistoryCount();
  }
}

function loadFromHistory(id) {
  try {
    var history = JSON.parse(localStorage.getItem('urbaniaHistory') || '[]');
    var item = history.find(function(h) { return h.id == id; });
    if (!item) return;
    document.getElementById('historyModal').remove();
    document.getElementById('questionInput').value = item.question;
    document.getElementById('addressInput').value  = item.address;
    document.getElementById('addressInput').focus();
  } catch(e) {}
}


// ════════════════════════════════════════
// COMPARAISON DE PARCELLES
// ════════════════════════════════════════
var compareData = null;

function startCompare(btn) {
  var card = btn.closest(".answer-card");

  // Sauvegarder les donnees de la premiere parcelle
  compareData = {
    address:      currentAddress,
    zone:         currentZone,
    coords:       currentCoords,
    cadastre:     currentCadastre,
    verdict:      card.querySelector(".verdict") ? card.querySelector(".verdict").textContent : "",
    resume:       card.querySelector(".answer-resume") ? card.querySelector(".answer-resume").textContent : "",
    budget:       card.querySelector(".budget-amount, .fourchette") ? card.querySelector(".budget-amount, .fourchette").textContent : "",
    question:     card.querySelector(".answer-q-text") ? card.querySelector(".answer-q-text").textContent : ""
  };

  // Afficher le modal de comparaison
  var modal = document.getElementById("compareModal");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "compareModal";
    modal.innerHTML = [
      "<div class=\"compare-overlay\" onclick=\"closeCompare()\"></div>",
      "<div class=\"compare-panel\">",
      "  <div class=\"compare-header\">",
      "    <span>Comparer avec une autre parcelle</span>",
      "    <button onclick=\"closeCompare()\">✕</button>",
      "  </div>",
      "  <div class=\"compare-body\">",
      "    <p class=\"compare-hint\">Entrez la deuxieme adresse a comparer :</p>",
      "    <input id=\"compareAddr\" type=\"text\" placeholder=\"Ex : 13 rue de la Paix 75001 Paris\" class=\"compare-input\"/>",
      "    <input id=\"compareQ\" type=\"text\" placeholder=\"Meme question ou autre ?\" class=\"compare-input\" value=\"" + (compareData.question || "") + "\"/>",
      "    <button class=\"compare-launch-btn\" onclick=\"launchCompare()\">Analyser et comparer →</button>",
      "  </div>",
      "</div>"
    ].join("");
    document.body.appendChild(modal);
  }
  modal.style.display = "flex";
  setTimeout(function() { document.getElementById("compareAddr").focus(); }, 100);
}

function closeCompare() {
  var modal = document.getElementById("compareModal");
  if (modal) modal.style.display = "none";
}

async function launchCompare() {
  var addr2 = document.getElementById("compareAddr").value.trim();
  var q2    = document.getElementById("compareQ").value.trim();
  if (!addr2) { document.getElementById("compareAddr").style.outline = "2px solid red"; return; }

  var btn = document.querySelector(".compare-launch-btn");
  btn.textContent = "Analyse en cours...";
  btn.disabled = true;

  try {
    // Geocoder la 2eme adresse
    var r = await fetch("/api/geocode?q=" + encodeURIComponent(addr2) + "&limit=1");
    var d = await r.json();
    var coords2 = d.results && d.results[0] ? d.results[0] : null;
    if (!coords2) { btn.textContent = "Adresse introuvable"; btn.disabled = false; return; }

    // Zone PLU
    var zr = await fetch("/api/gpu/zone?lat=" + coords2.lat + "&lon=" + coords2.lon);
    var zone2 = await zr.json();

    // Cadastre
    var codeInsee2 = null;
    try {
      var banR = await fetch("https://api-adresse.data.gouv.fr/search/?q=" + encodeURIComponent(addr2) + "&limit=1");
      var banD = await banR.json();
      if (banD.features && banD.features[0]) codeInsee2 = banD.features[0].properties.citycode;
    } catch(e) {}
    var cad2 = await fetchCadastre(coords2.lat, coords2.lon, codeInsee2);

    closeCompare();
    renderCompare(addr2, zone2, coords2, cad2, q2);

  } catch(e) {
    btn.textContent = "Erreur - reessayez";
    btn.disabled = false;
  }
}

function renderCompare(addr2, zone2, coords2, cad2, question) {
  // Supprimer ancien bloc comparaison
  var old = document.getElementById("compareBlock");
  if (old) old.remove();

  var d1 = compareData;
  var c1 = d1.cadastre && d1.cadastre.calculs ? d1.cadastre.calculs : null;
  var p1 = d1.cadastre && d1.cadastre.parcelle ? d1.cadastre.parcelle : null;
  var c2 = cad2 && cad2.calculs ? cad2.calculs : null;
  var p2 = cad2 && cad2.parcelle ? cad2.parcelle : null;
  var z1 = d1.zone;
  var z2 = zone2;

  function row(label, v1, v2, highlight) {
    var cls1 = highlight && v1 > v2 ? " cmp-winner" : "";
    var cls2 = highlight && v2 > v1 ? " cmp-winner" : "";
    return "<tr><td class=\"cmp-label\">" + label + "</td>" +
      "<td class=\"cmp-val" + cls1 + "\">" + (v1 || "—") + "</td>" +
      "<td class=\"cmp-val" + cls2 + "\">" + (v2 || "—") + "</td></tr>";
  }

  var html = [
    "<div id=\"compareBlock\" class=\"compare-result\">",
    "  <div class=\"cmp-title\">Comparaison de parcelles</div>",
    "  <table class=\"cmp-table\">",
    "    <thead>",
    "      <tr>",
    "        <th></th>",
    "        <th class=\"cmp-head\">" + (d1.address || "Parcelle 1") + "</th>",
    "        <th class=\"cmp-head\">" + addr2 + "</th>",
    "      </tr>",
    "    </thead>",
    "    <tbody>",
    row("Zone PLU", z1 ? z1.zone || "—" : "—", z2 ? z2.zone || "—" : "—", false),
    row("Commune", z1 ? z1.commune || "—" : "—", z2 ? z2.commune || "—" : "—", false),
    row("Surface parcelle", c1 ? c1.surfaceParcelle + " m2" : "—", c2 ? c2.surfaceParcelle + " m2" : "—", false),
    row("Constructible est.", c1 ? c1.disponibleSi50pct + " m2" : "—", c2 ? c2.disponibleSi50pct + " m2" : "—", false),
    row("Ref. cadastrale", p1 && p1.section ? "Sec. " + p1.section + " n" + p1.numero : "—", p2 && p2.section ? "Sec. " + p2.section + " n" + p2.numero : "—", false),
    row("Hauteur max", z1 ? "9-12m" : "—", z2 ? "9-12m" : "—", false),
    row("Verdict IA", d1.verdict || "—", "Non analyse", false),
    row("Budget est.", d1.budget || "—", "—", false),
    "    </tbody>",
    "  </table>",
    "  <div class=\"cmp-footer\">",
    "    <button class=\"ans-btn\" onclick=\"document.getElementById('compareBlock').remove()\">Fermer</button>",
    "  </div>",
    "</div>"
  ].join("");

  document.getElementById("answers").insertAdjacentHTML("afterbegin", html);
  document.getElementById("compareBlock").scrollIntoView({ behavior: "smooth" });
}


function exportCard(btn, question) {
  const card    = btn.closest('.answer-card');
  const verdict = card.querySelector('.verdict') ? card.querySelector('.verdict').textContent : '';
  const zone    = document.getElementById('zoneName').textContent;
  const commune = document.getElementById('zoneCommune').textContent;
  const date    = new Date().toLocaleDateString('fr-FR');

  const rules = [];
  document.querySelectorAll('.rule-cell').forEach(function(r) {
    var val  = r.querySelector('.rule-val')  ? r.querySelector('.rule-val').textContent  : '';
    var key  = r.querySelector('.rule-key')  ? r.querySelector('.rule-key').textContent  : '';
    var note = r.querySelector('.rule-note') ? r.querySelector('.rule-note').textContent : '';
    if (val && key) rules.push({ val: val, key: key, note: note });
  });

  var conditions = [];
  card.querySelectorAll('.cond-item').forEach(function(c) { conditions.push(c.textContent.trim()); });

  var resume = '';
  var resumeEl = card.querySelector('.answer-resume') || card.querySelector('.answer-body p');
  if (resumeEl) resume = resumeEl.textContent;

  var budget = '';
  var budgetEl = card.querySelector('.budget-amount') || card.querySelector('.fourchette');
  if (budgetEl) budget = budgetEl.textContent;

  var parcelle      = currentCadastre && currentCadastre.calculs ? currentCadastre.calculs.surfaceParcelle + ' m2'       : 'N/A';
  var constructible = currentCadastre && currentCadastre.calculs ? currentCadastre.calculs.disponibleSi50pct + ' m2'     : 'N/A';
  var refCadastre   = currentCadastre && currentCadastre.parcelle && currentCadastre.parcelle.section ?
    'Sec. ' + currentCadastre.parcelle.section + ' n' + currentCadastre.parcelle.numero : 'N/A';

  if (typeof window.jspdf === 'undefined') {
    var script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
    script.onload = function() { generatePDF(); };
    document.head.appendChild(script);
  } else {
    generatePDF();
  }

  function generatePDF() {
    var jsPDF = window.jspdf.jsPDF;
    var doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    var W = 210; var H = 297;
    var y = 0;

    // Header noir
    doc.setFillColor(20, 20, 20);
    doc.rect(0, 0, W, 28, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(20);
    doc.text('URBAN', 14, 13);
    doc.setTextColor(192, 56, 26);
    doc.text('IA', 14 + doc.getTextWidth('URBAN'), 13);
    doc.setTextColor(180, 180, 180);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text('Analyse PLU - Rapport', 14, 21);
    doc.setTextColor(120, 120, 120);
    doc.text('Genere le ' + date, W - 14, 21, { align: 'right' });
    y = 38;

    // Adresse
    doc.setFillColor(248, 247, 245);
    doc.rect(14, y - 5, W - 28, 20, 'F');
    doc.setTextColor(120, 120, 120);
    doc.setFontSize(7);
    doc.setFont('helvetica', 'bold');
    doc.text('ADRESSE ANALYSEE', 18, y + 1);
    doc.setTextColor(20, 20, 20);
    doc.setFontSize(11);
    doc.text(currentAddress || 'Non precisee', 18, y + 8);
    doc.setTextColor(120, 120, 120);
    doc.setFontSize(8);
    doc.text(commune, 18, y + 13);
    y += 28;

    // Cadastre 3 colonnes
    doc.setTextColor(120, 120, 120);
    doc.setFontSize(7);
    doc.setFont('helvetica', 'bold');
    doc.text('DONNEES CADASTRALES', 14, y);
    y += 5;
    var cols = [
      { label: 'SURFACE PARCELLE', val: parcelle, green: false },
      { label: 'CONSTRUCTIBLE EST.', val: constructible, green: true },
      { label: 'REF. CADASTRALE', val: refCadastre, green: false }
    ];
    var cw = (W - 28) / 3;
    cols.forEach(function(col, i) {
      var x = 14 + i * cw;
      doc.setFillColor(255, 255, 255);
      doc.setDrawColor(220, 220, 220);
      doc.rect(x, y, cw - 2, 16, 'FD');
      doc.setTextColor(120, 120, 120);
      doc.setFontSize(6);
      doc.setFont('helvetica', 'bold');
      doc.text(col.label, x + (cw - 2) / 2, y + 5, { align: 'center' });
      if (col.green) { doc.setTextColor(34, 139, 82); } else { doc.setTextColor(20, 20, 20); }
      doc.setFontSize(10);
      doc.setFont('helvetica', 'bold');
      doc.text(col.val, x + (cw - 2) / 2, y + 12, { align: 'center' });
    });
    y += 22;

    // Zone PLU
    doc.setTextColor(120, 120, 120);
    doc.setFontSize(7);
    doc.setFont('helvetica', 'bold');
    doc.text('ZONE PLU', 14, y);
    y += 5;
    doc.setFillColor(248, 247, 245);
    doc.rect(14, y, W - 28, 8, 'F');
    doc.setFillColor(20, 20, 20);
    doc.rect(14, y, 14, 8, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.text(zone, 21, y + 5.5, { align: 'center' });
    doc.setTextColor(20, 20, 20);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.text(commune, 32, y + 5.5);
    y += 12;

    // Regles grille
    if (rules.length > 0) {
      var rw = (W - 28) / rules.length;
      rules.forEach(function(r, i) {
        var x = 14 + i * rw;
        doc.setFillColor(255, 255, 255);
        doc.setDrawColor(220, 220, 220);
        doc.rect(x, y, rw - 1, 18, 'FD');
        doc.setTextColor(20, 20, 20);
        doc.setFontSize(11);
        doc.setFont('helvetica', 'bold');
        doc.text(r.val, x + (rw - 1) / 2, y + 8, { align: 'center' });
        doc.setTextColor(120, 120, 120);
        doc.setFontSize(6);
        doc.setFont('helvetica', 'bold');
        doc.text(r.key.toUpperCase(), x + (rw - 1) / 2, y + 13, { align: 'center' });
        doc.setFontSize(5.5);
        doc.setFont('helvetica', 'normal');
        doc.text(r.note, x + (rw - 1) / 2, y + 17, { align: 'center' });
      });
      y += 24;
    }

    // Verdict
    doc.setTextColor(120, 120, 120);
    doc.setFontSize(7);
    doc.setFont('helvetica', 'bold');
    doc.text('ANALYSE IA', 14, y);
    y += 5;
    var vc = verdict.includes('OUI') ? [34, 139, 82] : verdict.includes('NON') ? [180, 30, 30] : [230, 140, 30];
    doc.setFillColor(vc[0], vc[1], vc[2]);
    doc.rect(14, y, W - 28, 10, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    var vtext = verdict + '  |  ' + question;
    doc.text(doc.splitTextToSize(vtext, W - 32)[0], W / 2, y + 6.5, { align: 'center' });
    y += 14;

    // Resume
    if (resume) {
      doc.setTextColor(20, 20, 20);
      doc.setFontSize(8);
      doc.setFont('helvetica', 'normal');
      var rlines = doc.splitTextToSize(resume, W - 28);
      doc.text(rlines.slice(0, 4), 14, y);
      y += rlines.slice(0, 4).length * 5 + 4;
    }

    // Budget
    if (budget) {
      doc.setFillColor(248, 247, 245);
      doc.rect(14, y, W - 28, 12, 'F');
      doc.setTextColor(120, 120, 120);
      doc.setFontSize(6);
      doc.setFont('helvetica', 'bold');
      doc.text('ESTIMATION BUDGETAIRE', 18, y + 4);
      doc.setTextColor(34, 139, 82);
      doc.setFontSize(10);
      doc.text(budget, 18, y + 10);
      y += 16;
    }

    // Footer
    doc.setFillColor(20, 20, 20);
    doc.rect(0, H - 18, W, 18, 'F');
    doc.setTextColor(120, 120, 120);
    doc.setFontSize(6);
    doc.setFont('helvetica', 'normal');
    doc.text('Source : Geoportail de l Urbanisme (GPU) - api-adresse.data.gouv.fr', 14, H - 10);
    doc.text('Ces informations sont indicatives. Verifiez aupres du service d urbanisme avant tout depot.', 14, H - 5);
    doc.setTextColor(192, 56, 26);
    doc.setFontSize(7);
    doc.setFont('helvetica', 'bold');
    doc.text('URBANIA', W - 14, H - 8, { align: 'right' });
    doc.setTextColor(120, 120, 120);
    doc.setFontSize(6);
    doc.setFont('helvetica', 'normal');
    doc.text('urban-ia-two.vercel.app', W - 14, H - 4, { align: 'right' });

    var filename = 'urbania-' + (currentAddress || 'analyse').replace(/[^a-z0-9]/gi, '-').toLowerCase().slice(0, 25) + '.pdf';
    doc.save(filename);
    btn.textContent = 'PDF telecharge !';
    setTimeout(function() { btn.textContent = 'Exporter PDF'; }, 3000);
  }
}

// ════════════════════════════════════════
// UTILS
// ════════════════════════════════════════
function flash(id) {
  const el = document.getElementById(id);
  el.style.outline = '2px solid var(--accent)';
  el.focus();
  setTimeout(() => el.style.outline = '', 2000);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function esc(s) {
  return String(s || '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
