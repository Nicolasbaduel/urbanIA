const https = require('https');

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'Accept': 'application/json' }, timeout: 8000 }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch(e) { resolve({ status: res.statusCode, body: null }); }
      });
    }).on('error', reject).on('timeout', () => reject(new Error('Timeout')));
  });
}

// Icones et niveaux par type de risque
function enrichRisque(libelle) {
  const l = libelle.toLowerCase();
  if (l.includes('inond'))           return { icon: 'inondation',   label: libelle, level: 'warn' };
  if (l.includes('seis') || l.includes('sism')) return { icon: 'seisme', label: libelle, level: 'info' };
  if (l.includes('mouvement'))       return { icon: 'mouvement',    label: libelle, level: 'warn' };
  if (l.includes('tassement'))       return { icon: 'tassement',    label: libelle, level: 'warn' };
  if (l.includes('feu') || l.includes('incendie') || l.includes('foret')) return { icon: 'feu', label: libelle, level: 'warn' };
  if (l.includes('cavit') || l.includes('carriere')) return { icon: 'cavite', label: libelle, level: 'alert' };
  if (l.includes('technolog') || l.includes('industriel')) return { icon: 'industriel', label: libelle, level: 'alert' };
  if (l.includes('radon'))           return { icon: 'radon',        label: libelle, level: 'info' };
  if (l.includes('avalanche'))       return { icon: 'avalanche',    label: libelle, level: 'warn' };
  if (l.includes('volcan'))          return { icon: 'volcan',       label: libelle, level: 'alert' };
  return { icon: 'autre', label: libelle, level: 'info' };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const { code_insee } = req.query;
  if (!code_insee) return res.status(400).json({ error: 'code_insee requis' });

  try {
    const r = await fetchJSON(`https://georisques.gouv.fr/api/v1/gaspar/risques?code_insee=${code_insee}`);
    
    if (r.status !== 200 || !r.body?.data?.length) {
      return res.status(200).json({ risques: [], commune: '', found: false });
    }

    const commune = r.body.data[0];
    const risques = (commune.risques_detail || []).map(r => enrichRisque(r.libelle_risque_long));

    res.status(200).json({
      found:   true,
      commune: commune.libelle_commune,
      risques
    });

  } catch(e) {
    res.status(200).json({ risques: [], found: false, error: e.message });
  }
};
