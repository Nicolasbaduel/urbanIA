const https = require('https');
const http  = require('http');

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    const opts = {
      headers: { 'Accept': 'application/json', 'User-Agent': 'UrbanIA/1.0' },
      timeout: 8000
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

function calcSurface(coordinates) {
  try {
    // Gère MultiPolygon et Polygon
    const ring = coordinates[0][0] || coordinates[0];
    if (!ring || ring.length < 3) return 0;
    const R = 6371000;
    const toRad = d => d * Math.PI / 180;
    let area = 0;
    for (let i = 0; i < ring.length - 1; i++) {
      const [lon1, lat1] = ring[i];
      const [lon2, lat2] = ring[i + 1];
      area += toRad(lon2 - lon1) * (2 + Math.sin(toRad(lat1)) + Math.sin(toRad(lat2)));
    }
    return Math.round(Math.abs(area) * R * R / 2);
  } catch(e) { return 0; }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const { lat, lon } = req.query;
  if (!lat || !lon) return res.status(400).json({ error: 'lat et lon requis' });

  const results = { parcelle: { found: false }, bati: { found: false, totalEmprise: 0 }, calculs: null, errors: [] };

  // Parcelle cadastrale
  try {
    const url = `https://apicarto.ign.fr/api/cadastre/parcelle?lon=${lon}&lat=${lat}&_limit=1`;
    const r = await fetchJSON(url);
    if (r.status === 200 && r.body?.features?.length > 0) {
      const feat  = r.body.features[0];
      const props = feat.properties;
      let surface = props.contenance || 0;
      if (!surface && feat.geometry?.coordinates) {
        surface = calcSurface(feat.geometry.coordinates);
      }
      results.parcelle = {
        found:     true,
        surface,
        commune:   props.nom_com    || '',
        codeInsee: props.code_insee || props.commune || '',
        section:   props.section    || '',
        numero:    props.numero     || '',
        geometry:  feat.geometry
      };
    }
  } catch(e) {
    results.errors.push('Parcelle: ' + e.message);
  }

  // Calculs si parcelle trouvée
  if (results.parcelle.found && results.parcelle.surface > 0) {
    const s = results.parcelle.surface;
    results.calculs = {
      surfaceParcelle:      s,
      empriseExistante:     0,
      tauxOccupationActuel: null,
      disponibleSi50pct:    Math.round(s * 0.50),
      disponibleSi40pct:    Math.round(s * 0.40),
      disponibleSi30pct:    Math.round(s * 0.30),
      verandaSansPermis:    Math.min(19, Math.round(s * 0.05)),
      peutConstruire:       true
    };
  }

  res.status(200).json(results);
};
