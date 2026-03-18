const express = require('express');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Чтобы принимать form-data / x-www-form-urlencoded от Tilda
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Проверка сервера
app.get('/health', (req, res) => {
  res.status(200).json({
    ok: true,
    service: 'pay.blacksymbols.com',
    message: 'Server is running'
  });
});

// Главная точка, куда Tilda будет отправлять покупателя/данные
app.all('/param/init', (req, res) => {
  console.log('=== /param/init called ===');
  console.log('Method:', req.method);
  console.log('Headers:', req.headers);
  console.log('Body:', req.body);
  console.log('Query:', req.query);

  res.status(200).send(`
    <!doctype html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <title>Pay Server OK</title>
        <style>
          body {
            font-family: Arial, sans-serif;
            padding: 40px;
            background: #111;
            color: #fff;
          }
          .box {
            max-width: 900px;
            margin: 0 auto;
            background: #1c1c1c;
            border-radius: 12px;
            padding: 24px;
          }
          pre {
            white-space: pre-wrap;
            word-break: break-word;
            background: #000;
            padding: 16px;
            border-radius: 8px;
            overflow: auto;
          }
          h1 { color: #ffd54a; }
        </style>
      </head>
      <body>
        <div class="box">
          <h1>HELLO FROM PAY SERVER</h1>
          <p>Tilda successfully reached <b>/param/init</b>.</p>
          <h3>Method</h3>
          <pre>${req.method}</pre>
          <h3>Body</h3>
          <pre>${escapeHtml(JSON.stringify(req.body, null, 2))}</pre>
          <h3>Query</h3>
          <pre>${escapeHtml(JSON.stringify(req.query, null, 2))}</pre>
        </div>
      </body>
    </html>
  `);
});

// Успех
app.all('/param/success', (req, res) => {
  console.log('=== /param/success called ===');
  console.log('Body:', req.body);
  console.log('Query:', req.query);

  res.status(200).send('SUCCESS HANDLER WORKS');
});

// Ошибка
app.all('/param/fail', (req, res) => {
  console.log('=== /param/fail called ===');
  console.log('Body:', req.body);
  console.log('Query:', req.query);

  res.status(200).send('FAIL HANDLER WORKS');
});

app.listen(PORT, () => {
  console.log(Server started on port ${PORT});
});

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
