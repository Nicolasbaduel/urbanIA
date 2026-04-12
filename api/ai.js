// api/ai.js — Fonction serverless Vercel
// Analyse PLU via Claude (Anthropic) — clé sécurisée côté serveur

const https = require('https');

function callAnthropic(payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const options = {
      hostname: 'api.anthropic.com',
      path:     '/v1/messages',
      method:   'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Length':    Buffer.byteLength(body)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch(e) { reject(new Error('Réponse Anthropic invalide')); }
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
  if (req.method !== 'POST')    return res.status(405).json({ error: 'Méthode non autorisée' });

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({
      error: 'Clé Anthropic manquante. Ajoutez ANTHROPIC_API_KEY dans Vercel → Settings → Environment Variables'
    });
  }

  const { question, zone, zoneFull, commune, postcode, address, urlfic, datappro } = req.body || {};

  if (!question) {
    return res.status(400).json({ error: 'Le champ "question" est requis' });
  }

  const zoneCtx = zone
    ? `Zone PLU : ${zone} — ${zoneFull || ''}
Commune : ${commune || 'non précisée'} (${postcode || ''})
Date approbation PLU : ${datappro || 'non renseignée'}
Règlement officiel : ${urlfic || 'non disponible'}`
    : `Zone PLU non identifiée. Adresse : ${address || 'non précisée'}`;

  const systemPrompt = `Tu es UrbanIA, expert en droit de l'urbanisme français et PLU (Plan Local d'Urbanisme).
Tu aides architectes, particuliers, investisseurs et agents immobiliers.
Tes réponses sont claires, factuelles, avec des valeurs chiffrées réelles.
Tu réponds UNIQUEMENT en JSON valide, sans markdown ni texte autour.`;

  const userPrompt = `CONTEXTE :
Adresse : ${address || 'non précisée'}
${zoneCtx}

QUESTION : "${question}"

Réponds avec ce JSON exact (sans balises markdown) :
{
  "verdict": "OUI" | "NON" | "SOUS_CONDITIONS" | "INFO",
  "resume": "Réponse directe en 1-2 phrases claires et factuelles",
  "conditions": [
    { "type": "ok" | "alert" | "info" | "warn", "text": "Règle précise avec valeur chiffrée" }
  ],
  "regles": [
    { "label": "Nom règle PLU", "valeur": "Valeur", "article": "ex: Art. 6" }
  ],
  "couts": {
    "present": true | false,
    "fourchette": "ex: 15 000 € – 35 000 €",
    "detail": "ex: Fondations + charpente + vitrage"
  },
  "etapes": ["Étape concrète 1", "Étape 2", "Étape 3"],
  "risques": ["Risque potentiel si applicable"],
  "disclaimer": "Note courte sur vérification en mairie"
}

Règles : max 5 conditions, 3 règles, 3 étapes. Valeurs chiffrées typiques pour zone ${zone || 'urbaine'} en France.`;

  try {
    const result = await callAnthropic({
      model:      'claude-sonnet-4-20250514',
      max_tokens: 1200,
      system:     systemPrompt,
      messages:   [{ role: 'user', content: userPrompt }]
    });

    if (result.status !== 200) {
      return res.status(500).json({ error: `Erreur Anthropic ${result.status}`, detail: result.body });
    }

    const text = result.body.content?.map(c => c.text || '').join('') || '';

    let parsed;
    try {
      parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
    } catch(e) {
      parsed = {
        verdict:    'INFO',
        resume:     text,
        conditions: [],
        regles:     [],
        couts:      { present: false },
        etapes:     [],
        risques:    [],
        disclaimer: 'Vérifiez ces informations auprès de votre mairie.'
      };
    }

    res.status(200).json(parsed);

  } catch(err) {
    res.status(500).json({ error: 'Erreur analyse IA', detail: err.message });
  }
};
