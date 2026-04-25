const express = require('express');
const dotenv = require('dotenv');
const crypto = require('crypto');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Чистые настройки (без лишнего сохранения rawBody)
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

let lastRequest = null;
let lastParamResponse = null;

// Храним данные заказа до прихода callback от Param
const orderStore = new Map();

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
  const token = req.query.token || '';
  if (!process.env.DEBUG_TOKEN || token !== process.env.DEBUG_TOKEN) {
    return res.status(403).json({ ok: false, error: 'Forbidden' });
  }
  res.status(200).json({
    ok: true,
    lastRequest,
    lastParamResponse
  });
});

app.all('/param/init', async (req, res) => {
  try {
    const body = req.body || {};

    lastRequest = {
      method: req.method,
      body,
      query: req.query || {},
      time: new Date().toISOString()
    };

    const endpoint =
      process.env.PARAM_MODE === 'prod'
        ? 'https://posws.param.com.tr/api/parampos/modalpayment'
        : 'https://test-dmz.param.com.tr/api/parampos/modalpayment';

    const orderId = String(body.Siparis_ID || 'NO_ORDER');
    const transactionId = `${orderId}-${Date.now()}`;

    const amount = toParamAmount(body.Islem_Tutar || '0');
    const phone = normalizePhone(body.KK_Sahibi_GSM || body.phone || '');
    const customerName = String(body.KK_Sahibi || body.name || 'Customer');

    const publicBaseUrl = String(process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
    const callbackUrl = `${publicBaseUrl}/param/callback`;

    const successUrl = String(body.Basarili_URL || '');
    const failUrl = String(body.Basarisiz_URL || '');
    const notificationUrl = String(body.Notification_URL || '');

    // Сохраняем заказ до callback в очищенном виде
    orderStore.set(orderId, {
      successUrl,
      failUrl,
      notificationUrl,
      rawBody: body,
      createdAt: new Date().toISOString()
    });

    const payload = {
      Code: Number(process.env.PARAM_CLIENT_CODE || 0),
      User: String(process.env.PARAM_CLIENT_USERNAME || ''),
      Pass: String(process.env.PARAM_CLIENT_PASSWORD || ''),
      GUID: String(process.env.PARAM_GUID || ''),
      GSM: phone,
      Amount: amount,
      Order_ID: orderId,
      TransactionId: transactionId,
      Callback_URL: callbackUrl,
      Installment: 1,
      MaxInstallment: 1,
      Customer_Name: customerName
    };

    console.log(`Инициализация платежа для заказа: ${orderId}`);
    console.log('PARAM INIT PAYLOAD:', JSON.stringify(payload, null, 2));

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const responseText = await response.text();

    let responseJson = null;
    try {
      responseJson = JSON.parse(responseText);
    } catch (e) {
      responseJson = null;
    }

    const resultCode = responseJson?.ResultCode ?? '';
    const resultDescription = responseJson?.ResultDescription ?? '';
    const paymentUrl = responseJson?.URL ?? '';

    lastParamResponse = {
      stage: 'init',
      endpoint,
      status: response.status,
      payload,
      resultCode,
      resultDescription,
      paymentUrl,
      raw: responseText,
      time: new Date().toISOString()
    };

    if (response.ok && Number(resultCode) > 0 && paymentUrl) {
      return res.redirect(paymentUrl);
    }

    return res.status(500).send(`
      <html>
        <head>
          <meta charset="UTF-8">
          <title>Param Error</title>
        </head>
        <body style="font-family:Arial;padding:24px;background:#111;color:#fff;">
          <h1 style="color:#ffcc00;">PARAM ERROR</h1>
          <p><b>Endpoint:</b> ${escapeHtml(endpoint)}</p>
          <p><b>HTTP Status:</b> ${escapeHtml(String(response.status))}</p>
          <p><b>ResultCode:</b> ${escapeHtml(String(resultCode))}</p>
          <p><b>ResultDescription:</b> ${escapeHtml(String(resultDescription))}</p>
          <p><b>Payment URL:</b> ${escapeHtml(String(paymentUrl))}</p>
          <h3>Raw Response</h3>
          <pre style="white-space:pre-wrap;background:#000;padding:16px;border-radius:8px;">${escapeHtml(responseText)}</pre>
          <p><a style="color:#ffcc00;" href="/debug/last" target="_blank">Open /debug/last</a></p>
        </body>
      </html>
    `);
  } catch (err) {
    console.error('INIT ERROR:', err);
    lastParamResponse = {
      stage: 'init_error',
      error: String(err),
      stack: String(err.stack || ''),
      time: new Date().toISOString()
    };
    return res.status(500).send(`
      <html>
        <head>
          <meta charset="UTF-8">
          <title>Server Error</title>
        </head>
        <body style="font-family:Arial;padding:24px;background:#111;color:#fff;">
          <h1 style="color:#ffcc00;">SERVER ERROR</h1>
          <pre style="white-space:pre-wrap;background:#000;padding:16px;border-radius:8px;">${escapeHtml(String(err.stack || err))}</pre>
          <p><a style="color:#ffcc00;" href="/debug/last" target="_blank">Open /debug/last</a></p>
        </body>
      </html>
    `);
  }
});

app.all('/param/callback', async (req, res) => {
  try {
    const data = req.method === 'POST' ? (req.body || {}) : (req.query || {});

    console.log('=== /param/callback called ===');
    console.log(JSON.stringify(data, null, 2));

    const sonuc = String(data.TURKPOS_RETVAL_Sonuc || '');
    const siparisId = String(data.TURKPOS_RETVAL_Siparis_ID || '');
    const dekontId = String(data.TURKPOS_RETVAL_Dekont_ID || '');
    const islemId = String(data.TURKPOS_RETVAL_Islem_ID || '');
    const tahsilatTutari = String(data.TURKPOS_RETVAL_Tahsilat_Tutari || '');
    const returnedHash = String(data.TURKPOS_RETVAL_Hash || '');

    const localHash = createParamCallbackHash({
      code: String(process.env.PARAM_CLIENT_CODE || ''),
      guid: String(process.env.PARAM_GUID || ''),
      dekontId,
      tahsilatTutari,
      siparisId,
      islemId
    });

    const hashValid = returnedHash !== '' && returnedHash === localHash;

    if (!hashValid) {
      console.error(`КРИТИЧЕСКАЯ ОШИБКА: Неверный хэш для заказа ${siparisId}.`);
      lastParamResponse = {
        stage: 'callback_invalid_hash',
        data,
        returnedHash,
        localHash,
        time: new Date().toISOString()
      };
      return res.status(400).send('Invalid Security Hash');
    }

    const orderMeta = orderStore.get(siparisId) || {};
    const successUrl = String(orderMeta.successUrl || '');
    const failUrl = String(orderMeta.failUrl || '');
    const notificationUrl = String(orderMeta.notificationUrl || '');

    lastParamResponse = {
      stage: 'callback',
      callback: true,
      method: req.method,
      data,
      hashValid,
      successUrl,
      failUrl,
      notificationUrl,
      time: new Date().toISOString()
    };

    // УСПЕШНАЯ ОПЛАТА
    if (sonuc === '1' && Number(dekontId) > 0) {
      console.log(`Заказ ${siparisId} успешно оплачен. Dekont: ${dekontId}`);

      const originalAmount =
        orderMeta.rawBody && orderMeta.rawBody.Islem_Tutar
          ? String(orderMeta.rawBody.Islem_Tutar)
          : String(tahsilatTutari).replace(',', '.');

      // Сообщаем Тильде, что заказ оплачен
      if (notificationUrl) {
        try {
         // 1. Собираем данные в объект
          const notifyObj = {
            TURKPOS_RETVAL_Sonuc: '1',
            Siparis_ID: siparisId,
            Islem_Tutar: originalAmount,
            TURKPOS_RETVAL_Dekont_ID: dekontId
          };

          // 2. Сортируем ключи строго по алфавиту
          const sortedKeys = Object.keys(notifyObj).sort();

          // 3. Склеиваем все значения в одну сплошную строку
          let stringToHash = '';
          for (const key of sortedKeys) {
            stringToHash += notifyObj[key];
          }

   // 4. сначала делаем HEX-текст, а уже его кодируем в Base64
const hexHash = crypto.createHash('sha1').update(stringToHash, 'utf8').digest('hex');
const tildaHash = Buffer.from(hexHash).toString('base64');

          // 5. Отправляем под именем signature
          notifyObj.signature = tildaHash;

          const notifyPayload = new URLSearchParams(notifyObj);
          
          const webhookRes = await fetch(notificationUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: notifyPayload.toString()
          });
          const webhookText = await webhookRes.text();

          console.log('TILDA NOTIFY URL:', notificationUrl);
          console.log('TILDA NOTIFY STATUS:', webhookRes.status);
          console.log('TILDA NOTIFY RESPONSE:', webhookText);

          lastParamResponse.tildaNotify = {
            url: notificationUrl,
            status: webhookRes.status,
            response: webhookText,
            payload: notifyPayload.toString()
          };
        } catch (webhookErr) {
          console.error('Ошибка отправки сигнала в Тильду:', webhookErr);
          lastParamResponse.tildaNotify = {
            url: notificationUrl,
            error: String(webhookErr),
            time: new Date().toISOString()
          };
        }
      }

      // Заглушка под Paraşüt
      if (orderMeta.rawBody) {
        await createParasutInvoice(orderMeta.rawBody, dekontId);
      }

      // Перенаправляем клиента на success page
      if (successUrl) {
        try {
          const finalUrl = new URL(successUrl);
          finalUrl.searchParams.set('TURKPOS_RETVAL_Siparis_ID', siparisId);
          finalUrl.searchParams.set('TURKPOS_RETVAL_Tahsilat_Tutari', tahsilatTutari);
          finalUrl.searchParams.set('order_id', siparisId);
          finalUrl.searchParams.set('amount', tahsilatTutari);

          return res.redirect(finalUrl.toString());
        } catch (e) {
          console.error('Некорректный successUrl:', successUrl, e);
        }
      }
      return res.send('Оплата прошла успешно!');
    }

    // НЕУСПЕШНАЯ ОПЛАТА
    if (failUrl) {
      try {
        return res.redirect(failUrl);
      } catch (e) {
        console.error('Некорректный failUrl:', failUrl, e);
      }
    }

    return res.status(400).send('Оплата не прошла.');
  } catch (err) {
    console.error('CALLBACK ERROR:', err);
    lastParamResponse = {
      stage: 'callback_error',
      error: String(err),
      stack: String(err.stack || ''),
      time: new Date().toISOString()
    };
    return res.status(500).send('Callback Error');
  }
});

async function createParasutInvoice(tildaData, dekontId) {
  try {
    const buyerType = tildaData.buyer_type || 'Bireysel';
    const name = tildaData.name || tildaData.KK_Sahibi || 'Müşteri';
    const il = tildaData.il || '';
    const address = tildaData.adres || 'Adres belirtilmedi';
    const amount = tildaData.Islem_Tutar || '0';

    console.log('--- ДАННЫЕ PARAŞÜT ---');
    console.log(`Покупатель: ${name} (${buyerType}). Сумма: ${amount} TRY.`);
    console.log(`İl: ${il}`);
    console.log(`Adres: ${address}`);
    console.log(`Dekont ID: ${dekontId}`);
  } catch (error) {
    console.error('Ошибка Paraşüt:', error);
  }
}

app.listen(PORT, () => {
  console.log('Server started on port ' + PORT);
});

function createParamCallbackHash({ code, guid, dekontId, tahsilatTutari, siparisId, islemId }) {
  const raw = `${code}${guid}${dekontId}${tahsilatTutari}${siparisId}${islemId}`;
  const sha1 = crypto.createHash('sha1').update(raw, 'utf8').digest();
  return sha1.toString('base64');
}

function toParamAmount(value) {
  const num = Number(String(value).replace(',', '.').trim() || '0');
  return num.toFixed(2).replace('.', ',');
}

function normalizePhone(value) {
  const digits = String(value).replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
