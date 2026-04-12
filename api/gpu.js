const https = require('https');
const http = require('http');

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    const options = { headers: { 'Accept': 'application/json', 'User-Agent': 'UrbanIA/1.0' }, timeout: 15000 };
    protocol.get(url, options, (res) => {
      let data = '';
      if ([301,302,307].includes(res.statusCode) && res.headers.location) {
        return fetchJSON(res.headers.location).then(resolve).catch(reject);
      }
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(data) }); } catch(e) { resolve({ status: res.statusCode, body: null }); } });
    }).on('error', reject).on('timeout', () => reject(new Error('Timeout')));
  });
}

const ZONES = { 'U':'Zone Urbaine','UA':'Zone Urbaine Centrale','UB':'Zone Urbaine Résidentielle','UC':'Zone Urbaine à Dom. Résidentielle','UD':'Zone Urbaine Diffuse','UE':'Zone Urbaine Équipements','UX':'Zone Urbaine Économique','AU':'Zone à Urbaniser','1AU':'Zone à Urbaniser Immédiate','2AU':'Zone à Urbaniser Différée','A':'Zone Agricole','AP':'Zone Agricole Protégée','N':'Zone Naturelle','NL':'Zone Naturelle de Loisirs','NP':'Zone Naturelle Protégée' };

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const { lat, lon } = req.query;
  if (!lat || !lon) return res.status(400).json({ error: 'lat et lon requis' });

  const apis = [
    `https://apicarto.ign.fr/api/gpu/zone-urba?lon=${lon}&lat=${lat}`,
    `https://apicarto.ign.fr/api/gpu/zone-urba?geom=%7B%22type%22%3A%22Point%22%2C%22coordinates%22%3A%5B${lon}%2C${lat}%5D%7D`,
    `https://wxs.ign.fr/essentiels/geoportail/wfs?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature&TYPENAMES=BDPU_V2:zone_urba&BBOX=${parseFloat(lon)-.002},${parseFloat(lat)-.002},${parseFloat(lon)+.002},${parseFloat(lat)+.002},EPSG:4326&outputFormat=application/json&count=1`
  ];

  if (process.env.IGN_API_KEY) {
    apis.push(`https://wxs.ign.fr/${process.env.IGN_API_KEY}/geoportail/wfs?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature&TYPENAMES=BDPU_V2:zone_urba&BBOX=${parseFloat(lon)-.001},${parseFloat(lat)-.001},${parseFloat(lon)+.001},${parseFloat(lat)+.001},EPSG:4326&outputFormat=application/json&count=1`);
  }

  for (const url of apis) {
    try {
      const r = await fetchJSON(url);
      if (r.status === 200 && r.body?.features?.length > 0) {
        const p = r.body.features[0].properties;
        const zone = p.libelle || p.typezone || 'U';
        return res.status(200).json({
          source: 'gpu',
          zone, zoneFull: p.libelong || ZONES[zone] || 'Zone ' + zone,
          commune: p.nomcom || '', codeInsee: p.insee || '',
          urlfic: p.urlfic || '', datappro: p.datappro || ''
        });
      }
    } catch(e) { console.warn('[GPU]', e.message); }
  }

  res.status(200).json({ source: 'not-found', zone: null, zoneFull: null, commune: null, message: 'Zone PLU non trouvée' });
};
