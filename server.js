const express = require('express');
const dotenv = require('dotenv');
const crypto = require('crypto');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

let lastRequest = null;
let lastParamResponse = null;

// Храним данные заказа в памяти для коллбэка
const orderStore = new Map();

app.get('/', (req, res) => {
  res.status(200).send('PAY SERVER ROOT WORKS');
});

app.get('/health', (req, res) => {
  res.status(200).json({ ok: true, service: 'pay-blacksymbols', message: 'Server is running' });
});

// ВОЗВРАЩЕННАЯ СТРАНИЦА ДИАГНОСТИКИ
app.get('/debug/last', (req, res) => {
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
      body: body,
      time: new Date().toISOString()
    };

    // Определяем URL шлюза (боевой или тестовый)
    const endpoint = process.env.PARAM_MODE === 'prod'
        ? 'https://posws.param.com.tr/api/parampos/modalpayment'
        : 'https://test-dmz.param.com.tr/api/parampos/modalpayment';

    const orderId = String(body.Siparis_ID || 'NO_ORDER');
    // Уникальный ID транзакции (решает проблему дублей)
    const transactionId = ${orderId}-${Date.now()};

    const amount = toParamAmount(body.Islem_Tutar || '0');
    const phone = normalizePhone(body.KK_Sahibi_GSM || body.phone || '');
    
    // URL для возврата от банка на наш сервер
    const callbackUrl = ${String(process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '')}/param/callback;

    // Ссылки, которые присылает Тильда
    const successUrl = String(body.Basarili_URL || '');
    const failUrl = String(body.Basarisiz_URL || '');
    const notificationUrl = String(body.Notification_URL || '');

    // Сохраняем в память сервера, чтобы использовать после оплаты
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
      MaxInstallment: 1
    };

    console.log(Инициализация платежа для заказа: ${orderId});

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const responseText = await response.text();
    let responseJson = null;
    try { responseJson = JSON.parse(responseText); } catch (e) {}

    const resultCode = responseJson?.ResultCode ?? '';
    const resultDescription = responseJson?.ResultDescription ?? '';
    const paymentUrl = responseJson?.URL ?? '';

    // СОХРАНЯЕМ ОТВЕТ ДЛЯ DEBUG СТРАНИЦЫ
    lastParamResponse = {
      endpoint,
      status: response.status,
      payload,
      resultCode,
      resultDescription,
      paymentUrl,
      raw: responseText,
      time: new Date().toISOString()
    };

    // Если банк дал добро — перекидываем клиента на страницу ввода карты Param
    if (response.ok && Number(resultCode) > 0 && paymentUrl) {
      return res.redirect(paymentUrl);
    }

    // ВОЗВРАЩЕННЫЙ ЧЕРНЫЙ ЭКРАН С ОШИБКОЙ
    return res.status(500).send(`
      <html>
        <head><meta charset="UTF-8"><title>Param Error</title></head>
        <body style="font-family:Arial;padding:24px;background:#111;color:#fff;">
          <h1 style="color:#ffcc00;">PARAM ERROR</h1>
          <p><b>HTTP Status:</b> ${escapeHtml(String(response.status))}</p>
          <p><b>ResultCode:</b> ${escapeHtml(String(resultCode))}</p>
          <p><b>ResultDescription:</b> ${escapeHtml(String(resultDescription))}</p>
          <h3>Raw Response (Сырой ответ банка):</h3>
          <pre style="white-space:pre-wrap;background:#000;padding:16px;border-radius:8px;">${escapeHtml(responseText)}</pre>
          <p><a style="color:#ffcc00;" href="/debug/last" target="_blank">Открыть /debug/last</a></p>
        </body>
      </html>
    `);
  } catch (err) {
    console.error('INIT ERROR:', err);
    return res.status(500).send('Server Error');
  }
});

app.all('/param/callback', async (req, res) => {
  try {
    const data = req.method === 'POST' ? (req.body || {}) : (req.query || {});
    
    const sonuc = String(data.TURKPOS_RETVAL_Sonuc || '');
    const siparisId = String(data.TURKPOS_RETVAL_Siparis_ID || '');
    const dekontId = String(data.TURKPOS_RETVAL_Dekont_ID || '');
    const islemId = String(data.TURKPOS_RETVAL_Islem_ID || '');
    
    // ДАННЫЕ ДЛЯ ПРОВЕРКИ ХЭША (БЕЗОПАСНОСТЬ)
    const tahsilatTutari = String(data.TURKPOS_RETVAL_Tahsilat_Tutari || '');
    const returnedHash = String(data.TURKPOS_RETVAL_Hash || '');

    // Вычисляем локальный хэш
    const localHash = createParamCallbackHash({
      code: String(process.env.PARAM_CLIENT_CODE || ''),
      guid: String(process.env.PARAM_GUID || ''),
      dekontId,
      tahsilatTutari,
      siparisId,
      islemId
    });

    const hashValid = (returnedHash !== '' && returnedHash === localHash);

    // Если хэш не совпал - прерываем операцию (защита от взлома)
    if (!hashValid) {
      console.error(КРИТИЧЕСКАЯ ОШИБКА: Неверный хэш для заказа ${siparisId}. Попытка подделки!);
      return res.status(400).send('Invalid Security Hash');
    }

    const orderMeta = orderStore.get(siparisId) || {};
    const successUrl = orderMeta.successUrl || '';
    const failUrl = orderMeta.failUrl || '';
    const notificationUrl = orderMeta.notificationUrl || '';

    // БЛОК 1: УСПЕШНАЯ ОПЛАТА
    if (sonuc === '1' && Number(dekontId) > 0) {
      console.log(Заказ ${siparisId} успешно оплачен. Dekont: ${dekontId});

      // 1. Отправляем скрытый сигнал в Тильду (Исправлены имена переменных!)
      if (notificationUrl) {
        try {
          await fetch(notificationUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              TURKPOS_RETVAL_Sonuc: '1',
              Siparis_ID: siparisId,       // Тильда ищет именно это имя
              Islem_Tutar: tahsilatTutari  // Отправляем сумму для сверки
            }).toString()
          });
          console.log('Сигнал в Тильду отправлен.');
        } catch (webhookErr) {
          console.error('Ошибка отправки сигнала в Тильду:', webhookErr);
        }
      }

      // 2. Запускаем создание фатуры в Paraşüt
      if (orderMeta.rawBody) {
        createParasutInvoice(orderMeta.rawBody, dekontId);
      }

      // 3. Перенаправляем клиента на страницу успеха с передачей данных
      if (successUrl) {
        const finalUrl = new URL(successUrl);
        finalUrl.searchParams.append('TURKPOS_RETVAL_Siparis_ID', siparisId);
        finalUrl.searchParams.append('TURKPOS_RETVAL_Tahsilat_Tutari', tahsilatTutari);
        return res.redirect(finalUrl.toString());
      }
      return res.send('Оплата прошла успешно!');
    }

    // БЛОК 2: ОШИБКА ОПЛАТЫ
    if (failUrl) {
      return res.redirect(failUrl);
    }
    return res.status(400).send('Оплата не прошла.');

  } catch (err) {
    console.error('CALLBACK ERROR:', err);
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

    console.log(--- ДАННЫЕ PARAŞÜT ---);
    console.log(Покупатель: ${name} (${buyerType}). Сумма: ${amount} TRY.);
  } catch (error) {
    console.error('Ошибка Paraşüt:', error);
  }
}

app.listen(PORT, () => {
  console.log('Server started on port ' + PORT);
});

// ФУНКЦИЯ ПРОВЕРКИ ПОДПИСИ (БЕЗОПАСНОСТЬ)
function createParamCallbackHash({ code, guid, dekontId, tahsilatTutari, siparisId, islemId }) {
  const raw = ${code}${guid}${dekontId}${tahsilatTutari}${siparisId}${islemId};
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
