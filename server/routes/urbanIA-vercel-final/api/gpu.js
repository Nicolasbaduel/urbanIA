// api/gpu.js — Fonction serverless Vercel
// Zone PLU via Géoportail de l'Urbanisme (IGN)

const https = require('https');

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    const options = { headers: { 'Accept': 'application/json', 'User-Agent': 'UrbanIA/1.0' } };
    https.get(url, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch(e) { resolve({ status: res.statusCode, body: null }); }
      });
    }).on('error', reject);
  });
}

const ZONE_NAMES = {
  'U':   'Zone Urbaine',
  'UA':  'Zone Urbaine Centrale',
  'UB':  'Zone Urbaine Résidentielle',
  'UC':  'Zone Urbaine à Dom. Résidentielle',
  'UD':  'Zone Urbaine Diffuse',
  'UE':  'Zone Urbaine d\'Équipements',
  'UX':  'Zone Urbaine Économique',
  'AU':  'Zone à Urbaniser',
  '1AU': 'Zone à Urbaniser Immédiate',
  '2AU': 'Zone à Urbaniser Différée',
  'A':   'Zone Agricole',
  'AP':  'Zone Agricole Protégée',
  'N':   'Zone Naturelle et Forestière',
  'NL':  'Zone Naturelle de Loisirs',
  'NP':  'Zone Naturelle Protégée',
};

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const { lat, lon } = req.query;

  if (!lat || !lon) {
    return res.status(400).json({ error: 'Paramètres lat et lon requis' });
  }

  // Tentative APICarto IGN (public, pas de clé)
  try {
    const url = `https://apicarto.ign.fr/api/gpu/zone-urba?lon=${lon}&lat=${lat}`;
    const result = await fetchJSON(url);

    if (result.status === 200 && result.body?.features?.length > 0) {
      const props = result.body.features[0].properties;
      const zone  = props.libelle || props.typezone || 'U';
      return res.status(200).json({
        source:    'gpu-apicarto',
        zone:      zone,
        zoneFull:  props.libelong || ZONE_NAMES[zone] || `Zone ${zone}`,
        commune:   props.nomcom   || '',
        codeInsee: props.insee    || '',
        urlfic:    props.urlfic   || '',
        datappro:  props.datappro || '',
      });
    }
  } catch(e) {
    console.warn('APICarto failed:', e.message);
  }

  // Tentative WFS IGN avec clé (si configurée)
  const IGN_KEY = process.env.IGN_API_KEY;
  if (IGN_KEY) {
    try {
      const delta = 0.001;
      const bbox  = `${parseFloat(lon)-delta},${parseFloat(lat)-delta},${parseFloat(lon)+delta},${parseFloat(lat)+delta}`;
      const url   = `https://wxs.ign.fr/${IGN_KEY}/geoportail/wfs?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature&TYPENAMES=BDPU_V2:zone_urba&BBOX=${bbox},EPSG:4326&outputFormat=application/json&count=1`;
      const result = await fetchJSON(url);

      if (result.status === 200 && result.body?.features?.length > 0) {
        const props = result.body.features[0].properties;
        const zone  = props.libelle || 'U';
        return res.status(200).json({
          source:    'gpu-wfs',
          zone:      zone,
          zoneFull:  props.libelong || ZONE_NAMES[zone] || `Zone ${zone}`,
          commune:   props.nomcom   || '',
          codeInsee: props.insee    || '',
          urlfic:    props.urlfic   || '',
          datappro:  props.datappro || '',
        });
      }
    } catch(e) {
      console.warn('WFS failed:', e.message);
    }
  }

  // Aucune donnée trouvée
  res.status(200).json({
    source:   'not-found',
    zone:     null,
    zoneFull: null,
    commune:  null,
    message:  'Zone PLU non trouvée — commune sans PLU numérisé sur le GPU.'
  });
};
