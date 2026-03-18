const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.get('/health', (req, res) => {
  res.status(200).json({
    ok: true,
    service: 'pay-blacksymbols',
    message: 'Server is running'
  });
});

app.all('/param/init', (req, res) => {
  console.log('=== /param/init called ===');
  console.log('Method:', req.method);
  console.log('Body:', req.body);
  console.log('Query:', req.query);

  res.status(200).send(
    '<!doctype html>' +
    '<html>' +
    '<head>' +
    '<meta charset="UTF-8">' +
    '<title>Pay Server OK</title>' +
    '</head>' +
    '<body style="font-family:Arial,sans-serif;padding:40px;background:#111;color:#fff;">' +
    '<h1 style="color:#ffd54a;">HELLO FROM PAY SERVER</h1>' +
    '<p>Tilda successfully reached <b>/param/init</b>.</p>' +
    '<h3>Method</h3>' +
    '<pre>' + req.method + '</pre>' +
    '<h3>Body</h3>' +
    '<pre>' + JSON.stringify(req.body, null, 2) + '</pre>' +
    '<h3>Query</h3>' +
    '<pre>' + JSON.stringify(req.query, null, 2) + '</pre>' +
    '</body>' +
    '</html>'
  );
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
