// api/geocode.js — Fonction serverless Vercel
// Géocodage via API Adresse officielle (pas de clé requise)

const https = require('https');

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(e); }
      });
    }).on('error', reject);
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const { q, limit = 5 } = req.query;

  if (!q || q.trim().length < 3) {
    return res.status(400).json({ error: 'Requête trop courte' });
  }

  try {
    const url = `https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(q)}&limit=${limit}`;
    const data = await fetchJSON(url);

    const results = (data.features || []).map(f => ({
      label:    f.properties.label,
      city:     f.properties.city,
      postcode: f.properties.postcode,
      citycode: f.properties.citycode || null,
      context:  f.properties.context,
      lat:      f.geometry.coordinates[1],
      lon:      f.geometry.coordinates[0]
    }));

    res.status(200).json({ results });

  } catch(err) {
    res.status(500).json({ error: 'Erreur géocodage', detail: err.message });
  }
};
