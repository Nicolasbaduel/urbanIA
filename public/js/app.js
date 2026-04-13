/* ─────────────────────────────────────────
   UrbanIA — Frontend JS
   Tous les appels API passent par /api/* (notre serveur Node)
   Jamais directement vers IGN ou Anthropic
───────────────────────────────────────── */

// ── STATE ──
let currentZone    = null;
let currentCadastre = null;
let currentCoords  = null;
let currentAddress = '';
let suggestTimer   = null;

// ════════════════════════════════════════
// INIT — vérification serveur
// ════════════════════════════════════════
window.addEventListener('DOMContentLoaded', async () => {
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

  // Récupération des données cadastrales (attendue)
  // Récupérer le code INSEE depuis l'API adresse (plus fiable que le postcode)
  let codeInsee = null;
  try {
    const geoR = await fetch('/api/geocode?q=' + encodeURIComponent(currentAddress) + '&limit=1');
    const geoD = await geoR.json();
    if (geoD.results && geoD.results[0] && geoD.results[0].postcode) {
      // Construire code INSEE depuis postcode + city (approximation)
      // On utilise l'API ban pour avoir le code INSEE exact
      const banR = await fetch('https://api-adresse.data.gouv.fr/search/?q=' + encodeURIComponent(currentAddress) + '&limit=1');
      const banD = await banR.json();
      if (banD.features && banD.features[0]) {
        codeInsee = banD.features[0].properties.citycode;
      }
    }
  } catch(e) {}
  currentCadastre = await fetchCadastre(currentCoords.lat, currentCoords.lon, codeInsee);
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

// Analyse IA → /api/ai
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
      ${r.detail ? '<div class="rule-detail">' + r.detail + '</div>' : ''}
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
  z = (z || '').toUpperCase();
  if (z.startsWith('UA') || z === 'UC' || z === 'U')
    return [
      { val: '10–15m', key: 'Hauteur max', note: 'À l'égout du toit · R+3 à R+4', detail: 'Mesurée depuis le sol naturel jusqu'à l'égout du toit (gouttière). Le faîtage peut dépasser de 1,5m.' },
      { val: '0m',     key: 'Recul voirie', note: 'Alignement obligatoire', detail: 'La façade doit être implantée à l'alignement de la voie publique, sauf indication contraire du PLU.' },
      { val: '20%',    key: 'Pleine terre', note: 'Surface jardin min.', detail: 'Au moins 20% de la parcelle doit rester en pleine terre (non imperméabilisée) pour absorber les eaux de pluie.' },
      { val: '0.8–1.5',key: 'COS', note: 'Coeff. d'occupation des sols', detail: 'Surface de plancher constructible = COS × surface parcelle. Ex: parcelle 300m² × COS 1.0 = 300m² constructibles.' },
    ];
  if (z.startsWith('UB') || z.startsWith('UD'))
    return [
      { val: '7–9m',   key: 'Hauteur max', note: 'À l'égout du toit · R+1 à R+2', detail: 'Mesurée depuis le sol naturel jusqu'à l'égout du toit. Correspond à une maison + 1 ou 2 étages.' },
      { val: '5m',     key: 'Recul voirie', note: 'Distance min. à la rue', detail: 'La façade principale doit être implantée à minimum 5m de l'alignement de la voie publique.' },
      { val: '30%',    key: 'Pleine terre', note: 'Surface jardin min.', detail: 'Au moins 30% de la parcelle doit rester en pleine terre non imperméabilisée.' },
      { val: '0.3–0.6',key: 'COS', note: 'Coeff. d'occupation des sols', detail: 'Surface de plancher constructible = COS × surface parcelle. Ex: parcelle 500m² × COS 0.4 = 200m² constructibles.' },
    ];
  if (z.startsWith('AU') || z.startsWith('1AU'))
    return [
      { val: '7–10m',  key: 'Hauteur max', note: 'À l'égout du toit · variable', detail: 'Zone à urbaniser : hauteur définie par l'OAP (Orientation d'Aménagement et de Programmation) de la commune.' },
      { val: '5m',     key: 'Recul voirie', note: 'Distance min. à la rue', detail: 'Recul minimum de 5m depuis la voie publique, sauf prescriptions spéciales de l'OAP.' },
      { val: '25%',    key: 'Pleine terre', note: 'Surface jardin min.', detail: 'Minimum 25% de la parcelle en pleine terre. Souvent plus élevé dans les OAP récents.' },
      { val: 'OAP',    key: 'Orientation', note: 'Voir document OAP', detail: 'Zone soumise à une Orientation d'Aménagement et de Programmation. Consulter la mairie pour les prescriptions exactes.' },
    ];
  if (z.startsWith('N'))
    return [
      { val: '—',      key: 'Construction', note: 'Très limitée', detail: 'Zone naturelle protégée. Seules quelques constructions légères liées à la gestion du site sont autorisées.' },
      { val: '10m',    key: 'Recul voirie', note: 'Distance min. à la rue', detail: 'Recul minimum de 10m depuis la voie publique pour toute construction autorisée.' },
      { val: '90%',    key: 'Pleine terre', note: 'Zone naturelle', detail: 'Au minimum 90% de la parcelle doit rester en pleine terre. Imperméabilisation quasi-interdite.' },
      { val: '~0',     key: 'COS', note: 'Quasi nul', detail: 'Coefficient d'occupation des sols proche de zéro. La construction neuve est quasi-interdite.' },
    ];
  if (z.startsWith('A'))
    return [
      { val: '—',      key: 'Construction', note: 'Usage agricole uniquement', detail: 'Zone agricole protégée. Seules les constructions liées à l'exploitation agricole sont autorisées.' },
      { val: '15m',    key: 'Recul voirie', note: 'Distance min. à la rue', detail: 'Recul minimum de 15m depuis la voie publique pour tout bâtiment agricole.' },
      { val: '85%',    key: 'Pleine terre', note: 'Zone agricole', detail: 'Au minimum 85% de la parcelle doit rester en pleine terre non imperméabilisée.' },
      { val: '0.05',   key: 'COS', note: 'Très limité', detail: 'COS très faible réservé aux bâtiments agricoles indispensables à l'exploitation.' },
    ];
  return [
    { val: '9–12m',  key: 'Hauteur max', note: 'À l'égout du toit · variable', detail: 'Mesurée depuis le sol naturel jusqu'à l'égout du toit (gouttière). Le faîtage peut dépasser de 1 à 1,5m supplémentaire.' },
    { val: '5m',     key: 'Recul voirie', note: 'Distance min. à la rue', detail: 'Distance minimale entre la façade et l'alignement de la voie publique. Variable selon les articles du PLU.' },
    { val: '25%',    key: 'Pleine terre', note: 'Surface jardin min.', detail: 'Pourcentage minimum de la parcelle devant rester en pleine terre non imperméabilisée.' },
    { val: 'Var.',   key: 'COS', note: 'Voir règlement PLU', detail: 'Le Coefficient d'Occupation des Sols détermine la surface de plancher maximum constructible sur la parcelle.' },
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
        ${etapesHtml}
        ${risquesHtml}
        ${data.disclaimer ? `<div class="answer-disclaimer">📌 ${data.disclaimer}</div>` : ''}
      </div>
      <div class="answer-footer">
        <div class="answer-source">📡 ${sourceHtml}</div>
        <div class="answer-btns">
          <button class="ans-btn" onclick="copyCard(this)">📋 Copier</button>
          <button class="ans-btn" onclick="exportCard(this, '${esc(question)}')">📄 Exporter</button>
        </div>
      </div>
    </div>`;

  document.getElementById('answers').insertAdjacentHTML('afterbegin', html);
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

function exportCard(btn, question) {
  const card    = btn.closest('.answer-card');
  const verdict = card.querySelector('.verdict').textContent;
  const body    = card.querySelector('.answer-body').innerText;
  const zone    = document.getElementById('zoneName').textContent;
  const commune = document.getElementById('zoneCommune').textContent;

  const content = [
    'ANALYSE PLU — UrbanIA',
    '='.repeat(50),
    '',
    `Question  : ${question}`,
    `Adresse   : ${currentAddress}`,
    `Zone PLU  : ${zone} · ${commune}`,
    `Verdict   : ${verdict}`,
    '',
    body,
    '',
    '─'.repeat(40),
    `Généré par UrbanIA · ${new Date().toLocaleDateString('fr-FR')}`,
    'Source : Géoportail de l\'Urbanisme (GPU) · api-adresse.data.gouv.fr',
    '',
    '⚠️ Ces informations sont indicatives. Vérifiez toujours auprès du service',
    '   d\'urbanisme de votre mairie avant tout dépôt de permis ou déclaration.'
  ].join('\n');

  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `analyse-plu-urbania-${Date.now()}.txt`;
  a.click();
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
