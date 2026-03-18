const express = require('express');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

let lastRequest = null;
let lastParamResponse = null;

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

app.get('/debug/last', (req, res) => {
  res.status(200).json({
    ok: true,
    lastRequest,
    lastParamResponse
  });
});

app.all('/param/init', async (req, res) => {
  try {
    lastRequest = {
      method: req.method,
      body: req.body,
      query: req.query,
      time: new Date().toISOString()
    };

    const body = req.body || {};

    const endpoint =
      process.env.PARAM_MODE === 'prod'
        ? 'https://posws.param.com.tr/turkpos.ws/service_turkpos_prod.asmx'
        : 'https://test-dmz.param.com.tr/turkpos.ws/service_turkpos_test.asmx';

    const soapAction = 'https://turkpos.com.tr/TP_Modal_Payment';

    const amount = toParamAmount(body.Islem_Tutar || '0');
    const orderId = String(body.Siparis_ID || 'NO_ORDER');
    const phone = normalizePhone(body.KK_Sahibi_GSM || '');
    const customerName = String(body.KK_Sahibi || 'Customer');
    const callbackUrl = ${process.env.PUBLIC_BASE_URL}/param/callback;

    const xml = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
               xmlns:xsd="http://www.w3.org/2001/XMLSchema"
               xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <TP_Modal_Payment xmlns="https://turkpos.com.tr/">
      <d>
        <Code>${xmlEscape(process.env.PARAM_CLIENT_CODE || '')}</Code>
        <User>${xmlEscape(process.env.PARAM_CLIENT_USERNAME || '')}</User>
        <Pass>${xmlEscape(process.env.PARAM_CLIENT_PASSWORD || '')}</Pass>
        <GUID>${xmlEscape(process.env.PARAM_GUID || '')}</GUID>
        <GSM>r|${xmlEscape(phone)}</GSM>
        <Amount>r|${xmlEscape(amount)}</Amount>
        <Order_ID>r|${xmlEscape(orderId)}</Order_ID>
        <TransactionId>r|${xmlEscape(orderId)}</TransactionId>
        <Callback_URL>r|${xmlEscape(callbackUrl)}</Callback_URL>
        <Customer_Name>r|${xmlEscape(customerName)}</Customer_Name>
        <installment>r|1</installment>
        <MaxInstallment>r|1</MaxInstallment>
      </d>
    </TP_Modal_Payment>
  </soap:Body>
</soap:Envelope>`;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        'SOAPAction': soapAction
      },
      body: xml
    });

    const responseText = await response.text();

    const resultCode = extractTag(responseText, 'ResultCode');
    const resultDescription = extractTag(responseText, 'ResultDescription');
    const paymentUrl = extractTag(responseText, 'URL');

    lastParamResponse = {
      endpoint,
      status: response.status,
      resultCode,
      resultDescription,
      paymentUrl,
      raw: responseText,
      sentXml: xml,
      time: new Date().toISOString()
    };

    console.log('=== PARAM RESPONSE ===');
    console.log(JSON.stringify(lastParamResponse, null, 2));

    if (response.ok && Number(resultCode) > 0 && paymentUrl) {
      return res.redirect(paymentUrl);
    }

    return res.status(500).send(`
      <html>
        <head><meta charset="UTF-8"><title>Param Error</title></head>
        <body style="font-family:Arial;padding:24px;background:#111;color:#fff;">
          <h1 style="color:#ffcc00;">PARAM ERROR</h1>
          <p><b>Endpoint:</b> ${escapeHtml(endpoint)}</p>
          <p><b>HTTP Status:</b> ${escapeHtml(String(response.status))}</p>
          <p><b>ResultCode:</b> ${escapeHtml(resultCode || '')}</p>
          <p><b>ResultDescription:</b> ${escapeHtml(resultDescription || '')}</p>
          <p><b>Payment URL:</b> ${escapeHtml(paymentUrl || '')}</p>
          <h3>Raw Response</h3>
          <pre style="white-space:pre-wrap;background:#000;padding:16px;border-radius:8px;">${escapeHtml(responseText)}</pre>
          <p><a style="color:#ffcc00;" href="/debug/last" target="_blank">Open debug/last</a></p>
        </body>
      </html>
    `);
  } catch (err) {
    console.error(err);

    lastParamResponse = {
      error: String(err),
      stack: String(err.stack || ''),
      time: new Date().toISOString()
    };

    return res.status(500).send(`
      <html>
        <head><meta charset="UTF-8"><title>Server Error</title></head>
        <body style="font-family:Arial;padding:24px;background:#111;color:#fff;">
          <h1 style="color:#ffcc00;">SERVER ERROR</h1>
          <pre style="white-space:pre-wrap;background:#000;padding:16px;border-radius:8px;">${escapeHtml(String(err.stack || err))}</pre>
          <p><a style="color:#ffcc00;" href="/debug/last" target="_blank">Open debug/last</a></p>
        </body>
      </html>
    `);
  }
});

app.all('/param/callback', (req, res) => {
  console.log('=== /param/callback called ===');
  console.log(JSON.stringify({ body: req.body, query: req.query }, null, 2));

  res.status(200).send(`
    <html>
      <head><meta charset="UTF-8"><title>Callback OK</title></head>
      <body style="font-family:Arial;padding:24px;">
        <h1>PARAM CALLBACK RECEIVED</h1>
        <pre>${escapeHtml(JSON.stringify({ body: req.body, query: req.query }, null, 2))}</pre>
      </body>
    </html>
  `);
});

app.listen(PORT, () => {
  console.log('Server started on port ' + PORT);
});

function extractTag(xml, tagName) {
  const regex = new RegExp(<${tagName}>([\\s\\S]*?)<\\/${tagName}>, 'i');
  const match = xml.match(regex);
  return match ? match[1].trim() : '';
}

function toParamAmount(value) {
  const n = String(value).replace(',', '.').trim();
  const num = Number(n || '0');
  return num.toFixed(2).replace('.', ',');
}

function normalizePhone(value) {
  const digits = String(value).replace(/\\D/g, '');
  if (digits.length >= 10) return digits.slice(-10);
  return digits;
}

function xmlEscape(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
