// api/ai.js - Analyse PLU via Claude
// Lit le PDF officiel du reglement PLU si disponible
const https = require('https');
const http  = require('http');

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
        catch(e) { reject(new Error('Reponse Anthropic invalide')); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function downloadPDF(url, redirectCount) {
  redirectCount = redirectCount || 0;
  if (redirectCount > 5) return Promise.reject(new Error('Trop de redirections'));
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    const chunks = [];
    const req = protocol.get(url, {
      headers: { 'User-Agent': 'UrbanIA/1.0', 'Accept': 'application/pdf,*/*' },
      timeout: 20000
    }, (res) => {
      if ([301,302,307,308].includes(res.statusCode) && res.headers.location) {
        return downloadPDF(res.headers.location, redirectCount + 1).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) return reject(new Error('HTTP ' + res.statusCode));
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout PDF')); });
  });
}

function extractTextFromPDF(buffer) {
  try {
    const content = buffer.toString('latin1');
    const texts = [];
    const btPattern = /BT([\s\S]*?)ET/g;
    let match;
    while ((match = btPattern.exec(content)) !== null) {
      const block = match[1];
      const tjP = /\(([^)]*)\)\s*Tj/g;
      const tjAP = /\[([^\]]*)\]\s*TJ/g;
      let m;
      while ((m = tjP.exec(block)) !== null) {
        const t = m[1].replace(/\\n/g,'\n').replace(/\\\(/g,'(').replace(/\\\)/g,')').replace(/\\\\/g,'\\');
        if (t.trim().length > 1) texts.push(t);
      }
      while ((m = tjAP.exec(block)) !== null) {
        const parts = (m[1].match(/\(([^)]*)\)/g)||[]).map(p=>p.slice(1,-1));
        const t = parts.join('');
        if (t.trim().length > 1) texts.push(t);
      }
    }
    let result = texts.join(' ').replace(/\s+/g,' ').trim();
    if (result.length < 300) {
      const lines = content.split(/\r?\n/);
      const kept = [];
      for (const line of lines) {
        const clean = line.replace(/[^\x20-\x7E\xA0-\xFF]/g,' ').replace(/\s+/g,' ').trim();
        if (clean.length > 15 && /[aeioueeeauAEIOU]{2,}/.test(clean) && !/^[\d\s.+\-*/=()[\]{}|<>]+$/.test(clean)) kept.push(clean);
      }
      result = kept.join('\n');
    }
    return result.substring(0, 60000);
  } catch(e) { return ''; }
}

function filterZoneText(text, zone) {
  if (!text || text.length < 200) return text;
  const z = (zone||'').toUpperCase();
  const keywords = ['article','hauteur','recul','implantation','emprise','surface','coefficient','pleine terre','cloture','toiture','facade','extension','annexe','destination','interdit','autorise','declaration','permis','piscine','veranda','garage','alignement','prospect','limite'];
  const lines = text.split(/\n/);
  const relevant = [];
  let capturing = false;
  let captured = 0;
  for (const line of lines) {
    const lower = line.toLowerCase();
    if (z && (line.includes('ZONE '+z) || line.includes('Zone '+z) || new RegExp('^'+z+'\\b').test(line.trim()))) {
      capturing = true; captured = 0;
    }
    if (capturing && captured > 300 && /^ZONE\s+[A-Z]{1,3}[\s$]/.test(line.trim()) && !line.includes(z)) {
      capturing = false;
    }
    if (capturing || keywords.some(kw => lower.includes(kw))) {
      relevant.push(line); captured += line.length;
    }
    if (relevant.join('\n').length > 45000) break;
  }
  const filtered = relevant.join('\n').trim();
  return filtered.length > 300 ? filtered : text.substring(0, 40000);
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Methode non autorisee' });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: 'Cle Anthropic manquante dans Vercel -> Settings -> Environment Variables' });

  const { question, zone, zoneFull, commune, postcode, address, urlfic, datappro, cadastre } = req.body || {};
  if (!question) return res.status(400).json({ error: 'Champ "question" requis' });

  // Lecture du PDF PLU officiel
  let pluText = '';
  let pluAvailable = false;

  if (urlfic) {
    try {
      console.log('[AI] Telechargement PLU:', urlfic);
      const pdfBuffer = await downloadPDF(urlfic);
      const fullText = extractTextFromPDF(pdfBuffer);
      if (fullText.length > 300) {
        pluText = filterZoneText(fullText, zone);
        pluAvailable = true;
        console.log('[AI] PLU extrait:', pluText.length, 'caracteres');
      }
    } catch(e) {
      console.warn('[AI] PDF non lisible:', e.message);
    }
  }

  const zoneCtx = zone
    ? `Zone PLU : ${zone} - ${zoneFull||''}\nCommune : ${commune||'non precisee'} (${postcode||''})\nDate approbation : ${datappro||'non renseignee'}`
    : `Adresse : ${address||'non precisee'} - Zone PLU non identifiee`;

  // Contexte cadastral
  const c = cadastre;
  const cadastreCtx = c && c.calculs ? [
    'DONNEES CADASTRALES OFFICIELLES (API Cadastre IGN) :',
    '- Surface parcelle         : ' + c.calculs.surfaceParcelle + ' m2',
    '- Emprise bati existant    : ' + (c.calculs.empriseExistante > 0 ? c.calculs.empriseExistante + ' m2' : 'Non disponible'),
    '- Taux occupation actuel   : ' + (c.calculs.tauxOccupationActuel !== null ? c.calculs.tauxOccupationActuel + '%' : 'Non calcule'),
    '- Ref. cadastrale          : Section ' + (c.parcelle && c.parcelle.section || '?') + ' n' + (c.parcelle && c.parcelle.numero || '?'),
    'MARGES CONSTRUCTIBLES :',
    '- Si CES 50% (dense)       : ' + c.calculs.disponibleSi50pct + ' m2 disponibles',
    '- Si CES 40% (mixte)       : ' + c.calculs.disponibleSi40pct + ' m2 disponibles',
    '- Si CES 30% (pavillonnaire): ' + c.calculs.disponibleSi30pct + ' m2 disponibles',
    '- Veranda max sans permis  : ' + c.calculs.verandaSansPermis + ' m2'
  ].join('\n') : '';


  const systemPrompt = `Tu es UrbanIA, expert en droit de l'urbanisme francais et PLU.
${pluAvailable ? 'Tu disposes du TEXTE REEL du reglement PLU officiel. Cite les articles precis.' : 'PDF PLU non disponible. Reponds sur regles generales francaises.'}
${cadastreCtx ? 'Tu as les DONNEES CADASTRALES REELLES. Utilise ces chiffres precis.' : ''}
Reponds UNIQUEMENT en JSON valide, sans markdown.`;


  const pluContext = pluAvailable ? `\n\n=== REGLEMENT PLU OFFICIEL (${urlfic}) ===\n${pluText}\n=== FIN ===` : '';

  const surfaceParcelle = cadastreData && cadastreData.surfaceParcelle ? cadastreData.surfaceParcelle : null;
  const cos = 0.4; // COS moyen zone U France
  const shonMax = surfaceParcelle ? Math.round(surfaceParcelle * cos) : null;
  const tauxTA = 820; // Taux taxe amenagement moyen France 2024 (EUR/m2)

  const userPrompt = `CONTEXTE :
Adresse : ${address||'non non precisee'}
${zoneCtx}
Source PLU : ${pluAvailable ? 'PDF officiel (' + pluText.length + ' car.)' : 'Regles generales'}
${cadastreCtx}
${surfaceParcelle ? 'Surface parcelle reelle : ' + surfaceParcelle + ' m2' : ''}
${shonMax ? 'SHON max estimee (COS 0.4) : ' + shonMax + ' m2' : ''}
${pluContext}

QUESTION : "${question}"

INSTRUCTIONS SUPPLEMENTAIRES :
1. PRIX DU MARCHE : Estime le prix au m2 actuel pour cette commune (maison et appartement separement) base sur tes donnees DVF 2023-2024. Format: "2800-3500 EUR/m2"
2. SHON/EMPRISE : Calcule la surface constructible max sur cette parcelle selon les regles PLU de la zone. Detaille par niveau si pertinent.
3. DELAIS : Estime les delais d instruction realistes (DP = 1 mois, PC = 2-3 mois, recours tiers = 2 mois apres affichage).
4. TAXE AMENAGEMENT : Calcule la taxe d amenagement estimee pour le projet decrit. Formule : surface x ${tauxTA}EUR x taux communal (generalement 1-5%).

JSON de reponse (sans markdown) :
{
  "verdict": "OUI"|"NON"|"SOUS_CONDITIONS"|"INFO",
  "resume": "Reponse directe 1-2 phrases${pluAvailable ? ' avec citation article si possible' : ''}",
  "source_plu": "${pluAvailable ? 'pdf_officiel' : 'regles_generales'}",
  "conditions": [{"type":"ok"|"alert"|"info"|"warn","text":"regle precise${pluAvailable ? ' + ndeg article' : ' + valeur chiffree'}"}],
  "regles": [{"label":"nom","valeur":"valeur","article":"${pluAvailable ? 'Art. X PLU ' + (commune||'') : 'Zone ' + (zone||'U') + ' France'}"}],
  "couts": {"present":true|false,"fourchette":"ex: 15 000EUR - 35 000EUR","detail":"detail travaux"},
  "etapes": ["etape 1","etape 2","etape 3"],
  "risques": ["risque si applicable"],
  "marche": {
    "prix_maison": "ex: 2800-3500 EUR/m2",
    "prix_appart": "ex: 2200-2800 EUR/m2",
    "source": "DVF 2023-2024"
  },
  "constructibilite": {
    "shon_max": "ex: 130 m2",
    "detail": "ex: RDC 80m2 + R+1 50m2 selon COS 0.4 et hauteur max 9m"
  },
  "delais": {
    "instruction": "ex: 1 mois (DP) ou 2-3 mois (PC)",
    "recours_tiers": "2 mois apres affichage",
    "total_estime": "ex: 3-5 mois"
  },
  "taxe_amenagement": {
    "montant_estime": "ex: 1 200 - 2 400 EUR",
    "detail": "Surface x taux x valeur forfaitaire"
  },
  "disclaimer": "${pluAvailable ? 'Analyse sur PLU officiel ' + (commune||'') + '. Verifiez en mairie avant depot.' : 'PLU non disponible. Verifiez en mairie.'}"
}
Max 5 conditions, 3 regles, 4 etapes.`;

  try {
    const result = await callAnthropic({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1500,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });

    if (result.status !== 200) return res.status(500).json({ error: 'Erreur Anthropic ' + result.status });

    const text = result.body.content?.map(c => c.text||'').join('') || '';
    let parsed;
    try {
      parsed = JSON.parse(text.replace(/```json|```/g,'').trim());
    } catch(e) {
      parsed = { verdict:'INFO', resume: text, source_plu: pluAvailable?'pdf_officiel':'regles_generales', conditions:[], regles:[], couts:{present:false}, etapes:[], risques:[], disclaimer:'Verifiez en mairie.' };
    }
    parsed.source_plu = pluAvailable ? 'pdf_officiel' : 'regles_generales';
    parsed.plu_available = pluAvailable;
    res.status(200).json(parsed);

  } catch(err) {
    console.error('[AI]', err.message);
    res.status(500).json({ error: 'Erreur analyse IA', detail: err.message });
  }
};
// fixed
