const https = require('https');
const querystring = require('querystring');

function stripePost(path, data) {
  return new Promise((resolve, reject) => {
    const body = querystring.stringify(data);
    const options = {
      hostname: 'api.stripe.com',
      path: path,
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + process.env.STRIPE_SECRET_KEY,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body)
      }
    };
    const req = https.request(options, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(d) }); }
        catch(e) { reject(e); }
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
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email } = req.body || {};
  const BASE_URL = 'https://votreparcelle.eu';

  try {
    const session = await stripePost('/v1/checkout/sessions', {
      'payment_method_types[]': 'card',
      'line_items[0][price]': 'price_1TM8vuLnIPgvNzwc50NfDS0k',
      'line_items[0][quantity]': '1',
      'mode': 'subscription',
      'success_url': BASE_URL + '/index.html?upgrade=success',
      'cancel_url':  BASE_URL + '/index.html?upgrade=cancel',
      ...(email ? { 'customer_email': email } : {})
    });

    if (session.body.url) {
      res.status(200).json({ url: session.body.url });
    } else {
      res.status(500).json({ error: 'Stripe error', detail: session.body });
    }
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
};
