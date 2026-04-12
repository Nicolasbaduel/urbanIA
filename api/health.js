// api/health.js — Vérification du serveur
module.exports = (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.status(200).json({
    status:    'ok',
    anthropic: !!process.env.ANTHROPIC_API_KEY,
    ign:       !!process.env.IGN_API_KEY,
    timestamp: new Date().toISOString()
  });
};
