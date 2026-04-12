// ─────────────────────────────────────────
// UrbanIA — Serveur principal
// ─────────────────────────────────────────
require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const fetch   = require('node-fetch');
const path    = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// ── Importation des routes ──
const geocodeRouter = require('./routes/geocode');
const gpuRouter     = require('./routes/gpu');
const aiRouter      = require('./routes/ai');

app.use('/api/geocode', geocodeRouter);
app.use('/api/gpu',     gpuRouter);
app.use('/api/ai',      aiRouter);

// ── Health check ──
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    anthropic: !!process.env.ANTHROPIC_API_KEY,
    ign:       !!process.env.IGN_API_KEY,
    timestamp: new Date().toISOString()
  });
});

// ── Fallback → index.html ──
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.listen(PORT, () => {
  console.log(`\n✅ UrbanIA démarré sur http://localhost:${PORT}`);
  console.log(`   Anthropic API : ${process.env.ANTHROPIC_API_KEY ? '✅ configurée' : '❌ manquante'}`);
  console.log(`   IGN API       : ${process.env.IGN_API_KEY       ? '✅ configurée' : '❌ manquante'}\n`);
});
