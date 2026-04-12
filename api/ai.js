const https = require('https');
 
function callAnthropic(payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const options = {
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(body)
      }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch(e) { reject(new Error('Reponse invalide')); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}
 
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Methode non autorisee' });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: 'Cle Anthropic manquante' });
 
  const { question, zone, zoneFull, commune, postcode, address, cadastre } = req.body || {};
  if (!question) return res.status(400).json({ error: 'Question requise' });
 
  const c = cadastre && cadastre.calculs;
  let cadastreCtx = '';
  if (c) {
    cadastreCtx = 'DONNEES CADASTRALES :\n';
    cadastreCtx += '- Parcelle : ' + c.surfaceParcelle + ' m2\n';
    cadastreCtx += '- Bati existant : ' + (c.empriseExistante > 0 ? c.empriseExistante + ' m2' : 'Non disponible') + '\n';
    cadastreCtx += '- Constructible estime (CES 50%) : ' + c.disponibleSi50pct + ' m2\n';
    cadastreCtx += '- Veranda max sans permis : ' + c.verandaSansPermis + ' m2\n';
  }
 
  const prompt = 'Tu es UrbanIA, expert PLU France. Reponds UNIQUEMENT en JSON valide sans markdown.\n\n'
    + 'CONTEXTE :\n'
    + 'Adresse : ' + (address || 'non precisee') + '\n'
    + 'Zone PLU : ' + (zone || 'U') + ' - ' + (zoneFull || 'Zone Urbaine') + '\n'
    + 'Commune : ' + (commune || 'non precisee') + ' (' + (postcode || '') + ')\n'
    + cadastreCtx + '\n'
    + 'QUESTION : "' + question + '"\n\n'
    + 'Reponds avec ce JSON (sans markdown) :\n'
    + '{\n'
    + '  "verdict": "OUI" ou "NON" ou "SOUS_CONDITIONS" ou "INFO",\n'
    + '  "resume": "reponse directe 1-2 phrases avec chiffres si cadastre disponible",\n'
    + '  "conditions": [{"type":"ok ou alert ou info ou warn","text":"regle precise"}],\n'
    + '  "regles": [{"label":"nom","valeur":"valeur","article":"reference"}],\n'
    + '  "couts": {"present":true,"fourchette":"ex: 8000 - 25000 euros","detail":"detail"},\n'
    + '  "etapes": ["etape 1","etape 2","etape 3"],\n'
    + '  "risques": ["risque si applicable"],\n'
    + '  "disclaimer": "Verifiez en mairie avant tout depot."\n'
    + '}';
 
  try {
    const result = await callAnthropic({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1200,
      messages: [{ role: 'user', content: prompt }]
    });
 
    if (result.status !== 200) {
      return res.status(500).json({ error: 'Erreur Anthropic ' + result.status });
    }
 
    const text = result.body.content
      ? result.body.content.map(function(c) { return c.text || ''; }).join('')
      : '';
 
    let parsed;
    try {
      parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
    } catch(e) {
      parsed = {
        verdict: 'INFO',
        resume: text,
        conditions: [],
        regles: [],
        couts: { present: false },
        etapes: [],
        risques: [],
        disclaimer: 'Verifiez en mairie.'
      };
    }
    res.status(200).json(parsed);
 
  } catch(err) {
    res.status(500).json({ error: 'Erreur IA', detail: err.message });
  }
};
 


