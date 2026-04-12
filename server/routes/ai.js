// ─────────────────────────────────────────
// Route : /api/ai
// Analyse PLU via Claude (Anthropic)
// La clé API reste côté serveur — jamais exposée au front
// ─────────────────────────────────────────
const express = require('express');
const fetch   = require('node-fetch');
const router  = express.Router();

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL         = 'claude-sonnet-4-20250514';

// ── POST /api/ai/analyze ──
// Corps : { question, zone, commune, address, urlfic? }
router.post('/analyze', async (req, res) => {

  if (!ANTHROPIC_KEY) {
    return res.status(500).json({
      error: 'Clé Anthropic non configurée. Ajoutez ANTHROPIC_API_KEY dans votre fichier .env'
    });
  }

  const { question, zone, zoneFull, commune, postcode, address, urlfic, datappro } = req.body;

  if (!question) {
    return res.status(400).json({ error: 'Le champ "question" est requis' });
  }

  // Construction du prompt contextualisé
  const zoneContext = zone
    ? `Zone PLU : ${zone} — ${zoneFull || ''}
Commune : ${commune || 'non précisée'} (${postcode || ''})
Date d'approbation du PLU : ${datappro || 'non renseignée'}
Lien règlement officiel : ${urlfic || 'non disponible'}`
    : `Zone PLU : non identifiée (commune sans PLU numérisé sur le GPU)
Adresse : ${address || 'non précisée'}`;

  const systemPrompt = `Tu es UrbanIA, un assistant expert en droit de l'urbanisme français et en PLU (Plan Local d'Urbanisme).
Tu aides architectes, particuliers, investisseurs et agents immobiliers à comprendre ce qu'ils peuvent construire ou modifier.

Tes réponses sont :
- CLAIRES : verdict immédiat OUI / NON / SOUS_CONDITIONS / INFO
- FACTUELLES : tu cites des valeurs chiffrées réelles typiques pour ce type de zone
- PRATIQUES : tu expliques les démarches concrètes
- HONNÊTES : tu signales quand il faut vérifier en mairie

Tu réponds UNIQUEMENT en JSON valide (sans balises markdown ni texte autour).`;

  const userPrompt = `CONTEXTE DU PROJET :
Adresse : ${address || 'non précisée'}
${zoneContext}

QUESTION DE L'UTILISATEUR :
"${question}"

Réponds avec ce JSON exact :
{
  "verdict": "OUI" | "NON" | "SOUS_CONDITIONS" | "INFO",
  "resume": "Réponse directe en 1-2 phrases, claire et factuelle",
  "conditions": [
    { "type": "ok" | "alert" | "info" | "warn", "text": "Règle ou condition précise avec valeur chiffrée si applicable" }
  ],
  "regles": [
    { "label": "Nom de la règle PLU", "valeur": "Valeur applicable", "article": "Article type ex: Art. 6 - Implantation" }
  ],
  "couts": {
    "present": true | false,
    "fourchette": "ex: 15 000 € – 35 000 €",
    "detail": "ex: Fondations + charpente + vitrage, pose incluse"
  },
  "etapes": ["Étape 1 concrète", "Étape 2", "Étape 3"],
  "risques": ["Risque de refus potentiel 1 si applicable"],
  "disclaimer": "Note sur la vérification obligatoire en mairie"
}

Règles de réponse :
- Maximum 5 conditions, 3 règles, 3 étapes, 2 risques
- Les valeurs chiffrées sont typiques pour la zone ${zone || 'urbaine'} en France
- Si la zone est N ou A : construction très limitée, sois strict
- Si PLU non numérisé : base-toi sur les règles générales françaises de la zone`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':         'application/json',
        'x-api-key':            ANTHROPIC_KEY,
        'anthropic-version':    '2023-06-01'
      },
      body: JSON.stringify({
        model:      MODEL,
        max_tokens: 1200,
        system:     systemPrompt,
        messages:   [{ role: 'user', content: userPrompt }]
      })
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Anthropic ${response.status}: ${err}`);
    }

    const data = await response.json();
    const text = data.content?.map(c => c.text || '').join('') || '';

    // Parse JSON
    let parsed;
    try {
      const clean = text.replace(/```json|```/g, '').trim();
      parsed = JSON.parse(clean);
    } catch(e) {
      // Si le JSON est mal formé, on renvoie le texte brut
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

    res.json(parsed);

  } catch (err) {
    console.error('[AI]', err.message);
    res.status(500).json({
      error:  'Erreur lors de l\'analyse IA',
      detail: err.message
    });
  }
});

module.exports = router;
