// api/cadastre.js — Données cadastrales officielles
// Sources :
//   - apicarto.ign.fr/api/cadastre  → parcelle (superficie)
//   - apicarto.ign.fr/api/gpu       → bâti existant (emprise au sol)
//   - api-adresse.data.gouv.fr      → géocodage adresse

const https = require('https');
const http  = require('http');

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    const opts = {
      headers: { 'Accept': 'application/json', 'User-Agent': 'UrbanIA/1.0' },
      timeout: 12000
    };
    protocol.get(url, opts, (res) => {
      let data = '';
      if ([301,302,307].includes(res.statusCode) && res.headers.location) {
        return fetchJSON(res.headers.location).then(resolve).catch(reject);
      }
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch(e) { resolve({ status: res.statusCode, body: null }); }
      });
    }).on('error', reject).on('timeout', () => reject(new Error('Timeout')));
  });
}

// Calcule la surface d'un polygone GeoJSON (formule Shoelace, coordonnées GPS → m²)
function calcSurface(coordinates) {
  try {
    const coords = coordinates[0]; // anneau extérieur
    if (!coords || coords.length < 3) return 0;

    // Formule de Gauss (Shoelace) avec correction sphérique approximative
    const R = 6371000; // rayon Terre en mètres
    const toRad = d => d * Math.PI / 180;

    let area = 0;
    const n = coords.length;

    for (let i = 0; i < n - 1; i++) {
      const [lon1, lat1] = coords[i];
      const [lon2, lat2] = coords[i + 1];
      area += toRad(lon2 - lon1) * (2 + Math.sin(toRad(lat1)) + Math.sin(toRad(lat2)));
    }

    area = Math.abs(area) * R * R / 2;
    return Math.round(area);
  } catch(e) {
    return 0;
  }
}

// Récupère la parcelle cadastrale depuis l'API Carto IGN
async function fetchParcelle(lat, lon) {
  const url = `https://apicarto.ign.fr/api/cadastre/parcelle?lon=${lon}&lat=${lat}&_limit=1`;
  const r   = await fetchJSON(url);

  if (r.status === 200 && r.body?.features?.length > 0) {
    const feat  = r.body.features[0];
    const props = feat.properties;

    // Surface officielle ou calculée
    let surface = 0;
    if (props.contenance && props.contenance > 0) {
      surface = props.contenance; // surface cadastrale en m²
    } else if (feat.geometry?.coordinates) {
      surface = calcSurface(feat.geometry.coordinates);
    }

    return {
      found:      true,
      surface,                                    // m² de la parcelle
      commune:    props.nom_com   || '',
      codeInsee:  props.code_insee || props.commune || '',
      section:    props.section   || '',
      numero:     props.numero    || '',
      parcellId:  props.id        || '',
      geometry:   feat.geometry
    };
  }
  return { found: false };
}

// Récupère le bâti existant (bâtiments sur la parcelle)
async function fetchBati(lat, lon) {
  const url = `https://apicarto.ign.fr/api/gpu/acte-de-servitude?lon=${lon}&lat=${lat}`;

  // Tentative via BDTopo bâtiments
  const batiUrl = `https://apicarto.ign.fr/api/cadastre/batiment?lon=${lon}&lat=${lat}&_limit=10`;
  const r = await fetchJSON(batiUrl);

  if (r.status === 200 && r.body?.features?.length > 0) {
    let totalEmprise = 0;
    const batiments = [];

    for (const feat of r.body.features) {
      if (feat.geometry?.coordinates) {
        const surf = calcSurface(feat.geometry.coordinates);
        totalEmprise += surf;
        batiments.push({
          surface: surf,
          usage:   feat.properties?.usage1 || 'Bâtiment'
        });
      }
    }

    return {
      found:        true,
      totalEmprise,
      batiments,
      count:        batiments.length
    };
  }

  return { found: false, totalEmprise: 0, batiments: [], count: 0 };
}

// ── Route principale ──
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const { lat, lon } = req.query;
  if (!lat || !lon) return res.status(400).json({ error: 'lat et lon requis' });

  const results = {
    parcelle: null,
    bati:     null,
    calculs:  null,
    errors:   []
  };

  // ── 1. Parcelle cadastrale ──
  try {
    results.parcelle = await fetchParcelle(lat, lon);
  } catch(e) {
    results.errors.push('Parcelle: ' + e.message);
    results.parcelle = { found: false };
  }

  // ── 2. Bâti existant ──
  try {
    results.bati = await fetchBati(lat, lon);
  } catch(e) {
    results.errors.push('Bâti: ' + e.message);
    results.bati = { found: false, totalEmprise: 0 };
  }

  // ── 3. Calculs urbanistiques ──
  if (results.parcelle?.found && results.parcelle.surface > 0) {
    const surfParcelle = results.parcelle.surface;
    const empriseExist = results.bati?.totalEmprise || 0;
    const tauxActuel   = empriseExist > 0 ? Math.round((empriseExist / surfParcelle) * 100) : null;

    // Marges constructibles selon coefficients typiques
    // Ces valeurs seront affinées avec le PLU réel
    const emprise50 = Math.round(surfParcelle * 0.50 - empriseExist); // si CES = 50%
    const emprise40 = Math.round(surfParcelle * 0.40 - empriseExist); // si CES = 40%
    const emprise30 = Math.round(surfParcelle * 0.30 - empriseExist); // si CES = 30%

    // Surface plancher disponible (SHON/SDP)
    const cos05  = Math.round(surfParcelle * 0.5);
    const cos10  = Math.round(surfParcelle * 1.0);

    results.calculs = {
      surfaceParcelle:  surfParcelle,
      empriseExistante: empriseExist,
      tauxOccupationActuel: tauxActuel,

      // Disponible selon différents CES
      disponibleSi50pct: Math.max(0, emprise50),
      disponibleSi40pct: Math.max(0, emprise40),
      disponibleSi30pct: Math.max(0, emprise30),

      // SDP disponible
      sdpSi05: cos05,
      sdpSi10: cos10,

      // Recommandation véranda (< 20m² = DP, pas PC)
      verandaSansPermis: empriseExist > 0
        ? Math.min(19, Math.max(0, emprise50))
        : Math.min(19, Math.round(surfParcelle * 0.15)),

      // Statuts
      peutConstruire:    emprise50 > 0,
      superficiePetite:  surfParcelle < 150
    };
  }

  res.status(200).json(results);
};
