const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

let lastRequest = null;

app.get('/', (req, res) => {
  res.status(200).send('PAY SERVER ROOT WORKS');
});

app.get('/health', (req, res) => {
  res.status(200).json({
    ok: true,
    service: 'pay-blacksymbols',
    message: 'Server is running'
  });
});

app.all('/param/init', (req, res) => {
  lastRequest = {
    method: req.method,
    body: req.body,
    query: req.query,
    time: new Date().toISOString()
  };

  console.log('=== /param/init called ===');
  console.log(JSON.stringify(lastRequest, null, 2));

  const body = req.body || {};

  res.status(200).send(`
    <!doctype html>
    <html>
      <head>
        <meta charset="UTF-8" />
        <title>Param Debug</title>
        <style>
          body {
            font-family: Arial, sans-serif;
            padding: 24px;
            background: #111;
            color: #fff;
            line-height: 1.45;
          }
          .box {
            max-width: 1100px;
            margin: 0 auto;
            background: #1b1b1b;
            border-radius: 12px;
            padding: 24px;
          }
          h1 { color: #ffd54a; margin-top: 0; }
          h2 { margin-top: 28px; }
          pre {
            white-space: pre-wrap;
            word-break: break-word;
            background: #000;
            padding: 16px;
            border-radius: 8px;
            overflow: auto;
          }
          .row {
            margin: 8px 0;
          }
          .label {
            color: #aaa;
            display: inline-block;
            min-width: 180px;
          }
          a {
            color: #ffd54a;
          }
        </style>
      </head>
      <body>
        <div class="box">
          <h1>PARAM DEBUG SCREEN</h1>
          <div class="row"><span class="label">Method:</span> ${escapeHtml(req.method)}</div>
          <div class="row"><span class="label">Siparis_ID:</span> ${escapeHtml(body.Siparis_ID || '')}</div>
          <div class="row"><span class="label">Islem_Tutar:</span> ${escapeHtml(body.Islem_Tutar || '')}</div>
          <div class="row"><span class="label">Currency:</span> ${escapeHtml(body.Doviz_Kodu || '')}</div>
          <div class="row"><span class="label">Country:</span> ${escapeHtml(body.COUNTRY || '')}</div>
          <div class="row"><span class="label">Customer Email:</span> ${escapeHtml(body.Data1 || '')}</div>
          <div class="row"><span class="label">Customer Phone:</span> ${escapeHtml(body.KK_Sahibi_GSM || '')}</div>
          <div class="row"><span class="label">Customer Name:</span> ${escapeHtml(body.KK_Sahibi || '')}</div>

          <h2>Raw Body</h2>
          <pre>${escapeHtml(JSON.stringify(body, null, 2))}</pre>

          <h2>Last Request API</h2>
          <p><a href="/debug/last" target="_blank">Open /debug/last</a></p>
        </div>
      </body>
    </html>
  `);
});

app.get('/debug/last', (req, res) => {
  res.status(200).json({
    ok: true,
    lastRequest
  });
});

app.all('/param/success', (req, res) => {
  console.log('=== /param/success called ===');
  console.log('Body:', req.body);
  console.log('Query:', req.query);
  res.status(200).send('SUCCESS HANDLER WORKS');
});

app.all('/param/fail', (req, res) => {
  console.log('=== /param/fail called ===');
  console.log('Body:', req.body);
  console.log('Query:', req.query);
  res.status(200).send('FAIL HANDLER WORKS');
});

app.listen(PORT, () => {
  console.log('Server started on port ' + PORT);
});

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
