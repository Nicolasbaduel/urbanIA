// api/plu.js — Téléchargement et extraction du PDF PLU officiel
// Récupère le règlement PLU depuis le Géoportail de l'Urbanisme
// et extrait le texte de la zone concernée

const https  = require('https');
const http   = require('http');
const Buffer = require('buffer').Buffer;

// ── Téléchargement d'un PDF depuis une URL ──
function downloadPDF(url) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    const chunks   = [];

    const req = protocol.get(url, {
      headers: {
        'User-Agent': 'UrbanIA/1.0 (urbanisme-assistant)',
        'Accept':     'application/pdf,*/*'
      },
      timeout: 15000
    }, (res) => {
      // Suivre les redirections
      if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307) {
        if (res.headers.location) {
          return downloadPDF(res.headers.location).then(resolve).catch(reject);
        }
      }

      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} pour ${url}`));
      }

      res.on('data',  chunk => chunks.push(chunk));
      res.on('end',   ()    => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });

    req.on('error',   reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout téléchargement PDF')); });
  });
}

// ── Extraction de texte depuis un PDF (sans librairie externe) ──
// Technique : lecture des flux de texte bruts dans le PDF
function extractTextFromPDF(buffer) {
  try {
    const content = buffer.toString('latin1');
    const texts   = [];

    // Extraction des blocs de texte PDF (BT...ET)
    const btPattern = /BT([\s\S]*?)ET/g;
    let match;

    while ((match = btPattern.exec(content)) !== null) {
      const block = match[1];

      // Extraction des chaînes Tj et TJ
      const tjPattern = /\(([^)]*)\)\s*Tj/g;
      const tjArrPattern = /\[([^\]]*)\]\s*TJ/g;

      let m;
      while ((m = tjPattern.exec(block)) !== null) {
        const text = decodePDFString(m[1]);
        if (text.trim().length > 1) texts.push(text);
      }

      while ((m = tjArrPattern.exec(block)) !== null) {
        const arr   = m[1];
        const parts = arr.match(/\(([^)]*)\)/g) || [];
        const text  = parts.map(p => decodePDFString(p.slice(1,-1))).join('');
        if (text.trim().length > 1) texts.push(text);
      }
    }

    // Nettoyage et assemblage
    let result = texts
      .join(' ')
      .replace(/\s+/g, ' ')
      .replace(/[^\x20-\x7E\xA0-\xFF\n]/g, ' ')
      .trim();

    // Si extraction directe échoue, tentative sur le contenu brut
    if (result.length < 200) {
      result = extractTextFallback(content);
    }

    return result;

  } catch(e) {
    return '';
  }
}

function decodePDFString(str) {
  return str
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\\(/g, '(')
    .replace(/\\\)/g, ')')
    .replace(/\\\\/g, '\\');
}

function extractTextFallback(content) {
  // Extraction heuristique du texte lisible
  const lines   = content.split(/\r?\n/);
  const results = [];

  for (const line of lines) {
    const clean = line
      .replace(/[^\x20-\x7E\xA0-\xFF]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    // Garder uniquement les lignes qui ressemblent à du texte français
    if (clean.length > 15 &&
        /[aeiouéèêàùîïôAEIOUÉÈÊÀÙÎÏÔ]{2,}/.test(clean) &&
        !/^[\d\s.+\-*/=()[\]{}|<>]+$/.test(clean)) {
      results.push(clean);
    }
  }

  return results.join('\n').substring(0, 80000);
}

// ── Filtrage du texte PLU pour une zone spécifique ──
// Extrait les articles pertinents pour la zone (ex: UC, UB, N...)
function filterZoneText(fullText, zone) {
  if (!fullText || fullText.length < 100) return fullText;

  const zoneUpper = (zone || '').toUpperCase();
  const lines     = fullText.split(/\n/);
  const relevant  = [];
  let   capturing = false;
  let   score     = 0;

  // Mots-clés toujours pertinents
  const alwaysKeep = [
    'article', 'hauteur', 'recul', 'implantation', 'emprise',
    'coefficient', 'surface', 'pleine terre', 'stationnement',
    'clôture', 'toiture', 'façade', 'extension', 'annexe',
    'destination', 'usage', 'interdite', 'autorisée', 'permis'
  ];

  for (const line of lines) {
    const lower = line.toLowerCase();

    // Détecter le début d'une section de zone
    if (zoneUpper && (
      line.includes(`ZONE ${zoneUpper}`) ||
      line.includes(`Zone ${zoneUpper}`) ||
      new RegExp(`^${zoneUpper}\\s`).test(line.trim())
    )) {
      capturing = true;
      score     = 0;
    }

    // Détecter la fin d'une section (nouvelle zone)
    if (capturing && score > 50 && (
      /^ZONE\s+[A-Z]{1,3}[\s$]/.test(line.trim()) &&
      !line.includes(zoneUpper)
    )) {
      capturing = false;
    }

    if (capturing || alwaysKeep.some(kw => lower.includes(kw))) {
      relevant.push(line);
      score += line.length;
    }

    // Limite à ~40 000 caractères pour ne pas dépasser le contexte IA
    if (relevant.join('\n').length > 40000) break;
  }

  const filtered = relevant.join('\n').trim();

  // Si filtrage trop restrictif, retourner le début du document
  return filtered.length > 500
    ? filtered
    : fullText.substring(0, 40000);
}

// ── Route principale ──
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const { urlfic, zone } = req.query;

  if (!urlfic) {
    return res.status(400).json({ error: 'Paramètre urlfic requis' });
  }

  try {
    console.log(`[PLU] Téléchargement : ${urlfic}`);

    // Télécharger le PDF
    const pdfBuffer = await downloadPDF(urlfic);
    console.log(`[PLU] PDF téléchargé : ${pdfBuffer.length} octets`);

    // Extraire le texte
    const fullText = extractTextFromPDF(pdfBuffer);
    console.log(`[PLU] Texte extrait : ${fullText.length} caractères`);

    if (fullText.length < 100) {
      return res.status(200).json({
        success:   false,
        message:   'PDF non lisible (probablement scanné/image). Analyse sur règles générales.',
        text:      '',
        charCount: 0
      });
    }

    // Filtrer pour la zone concernée
    const zoneText = filterZoneText(fullText, zone);
    console.log(`[PLU] Texte zone ${zone} : ${zoneText.length} caractères`);

    res.status(200).json({
      success:   true,
      text:      zoneText,
      charCount: zoneText.length,
      source:    urlfic
    });

  } catch(err) {
    console.error('[PLU]', err.message);
    res.status(200).json({
      success: false,
      message: `Impossible de lire le PDF : ${err.message}`,
      text:    '',
      charCount: 0
    });
  }
};
