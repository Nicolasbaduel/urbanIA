// ─────────────────────────────────────────
// Route : /api/geocode
// Géocodage via l'API Adresse officielle (api-adresse.data.gouv.fr)
// Pas de clé API nécessaire — API publique française
// ─────────────────────────────────────────
const express = require('express');
const fetch   = require('node-fetch');
const router  = express.Router();

// GET /api/geocode/search?q=12+rue+de+la+Paix+Paris
router.get('/search', async (req, res) => {
  const { q, limit = 5 } = req.query;

  if (!q || q.trim().length < 3) {
    return res.status(400).json({ error: 'Requête trop courte (min 3 caractères)' });
  }

  try {
    const url = `https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(q)}&limit=${limit}`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`API Adresse erreur : ${response.status}`);
    }

    const data = await response.json();

    // On formate la réponse pour le front
    const results = (data.features || []).map(f => ({
      label:    f.properties.label,
      city:     f.properties.city,
      postcode: f.properties.postcode,
      context:  f.properties.context,
      lat:      f.geometry.coordinates[1],
      lon:      f.geometry.coordinates[0],
      score:    f.properties.score
    }));

    res.json({ results });

  } catch (err) {
    console.error('[GEOCODE]', err.message);
    res.status(500).json({ error: 'Impossible de géocoder cette adresse', detail: err.message });
  }
});

module.exports = router;
