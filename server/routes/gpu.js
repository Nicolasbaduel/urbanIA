// ─────────────────────────────────────────
// Route : /api/gpu
// Connexion au Géoportail de l'Urbanisme (IGN)
// Doc : https://geoservices.ign.fr/services-web-experts-urbanisme
// ─────────────────────────────────────────
const express = require('express');
const fetch   = require('node-fetch');
const router  = express.Router();

const IGN_KEY = process.env.IGN_API_KEY;

// ── GET /api/gpu/zone?lat=48.85&lon=2.35 ──
// Identifie la zone PLU pour des coordonnées GPS
router.get('/zone', async (req, res) => {
  const { lat, lon } = req.query;

  if (!lat || !lon) {
    return res.status(400).json({ error: 'Paramètres lat et lon requis' });
  }

  // Tentative 1 : API Carto IGN (pas de clé requise pour certains endpoints)
  try {
    const apiCartoUrl =
      `https://apicarto.ign.fr/api/gpu/zone-urba?lon=${lon}&lat=${lat}`;

    const r = await fetch(apiCartoUrl, {
      headers: { 'Accept': 'application/json' }
    });

    if (r.ok) {
      const data = await r.json();

      if (data.features && data.features.length > 0) {
        const props = data.features[0].properties;
        return res.json({
          source:    'gpu-apicarto',
          zone:      props.libelle      || props.typezone || 'U',
          zoneFull:  props.libelong     || zoneFullName(props.typezone),
          commune:   props.nomcom       || '',
          codeInsee: props.insee        || '',
          partition: props.partition    || '',
          urlfic:    props.urlfic       || '',   // URL du règlement PDF officiel
          datappro:  props.datappro     || '',   // Date d'approbation du PLU
          raw:       props
        });
      }
    }
  } catch (e) {
    console.warn('[GPU] apicarto failed:', e.message);
  }

  // Tentative 2 : WFS IGN avec clé API
  if (IGN_KEY) {
    try {
      const delta = 0.001;
      const bbox  = `${parseFloat(lon)-delta},${parseFloat(lat)-delta},${parseFloat(lon)+delta},${parseFloat(lat)+delta}`;
      const wfsUrl =
        `https://wxs.ign.fr/${IGN_KEY}/geoportail/wfs?` +
        `SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature` +
        `&TYPENAMES=BDPU_V2:zone_urba` +
        `&BBOX=${bbox},EPSG:4326` +
        `&outputFormat=application/json&count=1`;

      const r = await fetch(wfsUrl);

      if (r.ok) {
        const data = await r.json();

        if (data.features && data.features.length > 0) {
          const props = data.features[0].properties;
          return res.json({
            source:    'gpu-wfs',
            zone:      props.libelle   || 'U',
            zoneFull:  props.libelong  || zoneFullName(props.typezone),
            commune:   props.nomcom    || '',
            codeInsee: props.insee     || '',
            urlfic:    props.urlfic    || '',
            datappro:  props.datappro  || '',
            raw:       props
          });
        }
      }
    } catch (e) {
      console.warn('[GPU] WFS failed:', e.message);
    }
  }

  // Fallback : on renvoie "non trouvé" mais pas d'erreur
  // Le front gérera l'analyse IA sans données GPU précises
  res.json({
    source:   'not-found',
    zone:     null,
    zoneFull: null,
    commune:  null,
    message:  'Zone PLU non trouvée pour ces coordonnées. ' +
              'La commune n\'a peut-être pas encore numérisé son PLU sur le GPU.'
  });
});

// ── GET /api/gpu/reglement?urlfic=https://... ──
// Récupère le PDF du règlement PLU officiel
// et renvoie l'URL pour que le front puisse l'afficher ou l'envoyer à l'IA
router.get('/reglement', async (req, res) => {
  const { urlfic } = req.query;

  if (!urlfic) {
    return res.status(400).json({ error: 'Paramètre urlfic requis' });
  }

  try {
    // On vérifie juste que le PDF est accessible
    const r = await fetch(urlfic, { method: 'HEAD' });

    res.json({
      accessible: r.ok,
      url:        urlfic,
      status:     r.status
    });
  } catch (e) {
    res.json({ accessible: false, url: urlfic, error: e.message });
  }
});

// ── GET /api/gpu/communes?q=Fontainebleau ──
// Recherche de communes pour l'autocomplétion
router.get('/communes', async (req, res) => {
  const { q } = req.query;
  if (!q) return res.status(400).json({ error: 'Paramètre q requis' });

  try {
    const url = `https://apicarto.ign.fr/api/gpu/municipality?nom=${encodeURIComponent(q)}`;
    const r   = await fetch(url);

    if (r.ok) {
      const data = await r.json();
      return res.json(data);
    }
  } catch(e) {}

  res.json({ features: [] });
});

// ── Utilitaire : nom complet d'une zone ──
function zoneFullName(code) {
  const map = {
    'U':  'Zone Urbaine',
    'UA': 'Zone Urbaine Centrale',
    'UB': 'Zone Urbaine Résidentielle',
    'UC': 'Zone Urbaine à Dominante Résidentielle',
    'UD': 'Zone Urbaine Diffuse',
    'UE': 'Zone Urbaine d\'Équipements',
    'UX': 'Zone Urbaine à Vocation Économique',
    'AU': 'Zone à Urbaniser',
    '1AU':'Zone à Urbaniser Immédiate',
    '2AU':'Zone à Urbaniser Différée',
    'A':  'Zone Agricole',
    'AP': 'Zone Agricole Protégée',
    'N':  'Zone Naturelle et Forestière',
    'NL': 'Zone Naturelle de Loisirs',
    'NP': 'Zone Naturelle Protégée',
  };
  return map[code] || `Zone ${code || 'Urbaine'}`;
}

module.exports = router;
