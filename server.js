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

app.all('/param/init', async (req, res) => {
  try {
    const body = req.body || {};
    
    // Определяем URL шлюза (боевой или тестовый)
    const endpoint = process.env.PARAM_MODE === 'prod'
        ? 'https://posws.param.com.tr/api/parampos/modalpayment'
        : 'https://test-dmz.param.com.tr/api/parampos/modalpayment';

    const orderId = String(body.Siparis_ID || 'NO_ORDER');
    // Уникальный ID транзакции (решает проблему дублей)
    const transactionId = `${orderId}-${Date.now()}`;

    const amount = toParamAmount(body.Islem_Tutar || '0');
    const phone = normalizePhone(body.KK_Sahibi_GSM || body.phone || '');
    
    // URL для возврата от банка на наш сервер
    const callbackUrl = `${String(process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '')}/param/callback`;

    // Ссылки, которые присылает Тильда
    const successUrl = String(body.Basarili_URL || '');
    const failUrl = String(body.Basarisiz_URL || '');
    const notificationUrl = String(body.Notification_URL || ''); // Тот самый Webhook Тильды

    // Сохраняем в память сервера, чтобы использовать после оплаты
    orderStore.set(orderId, {
      successUrl,
      failUrl,
      notificationUrl,
      rawBody: body, // Сохраняем все данные (включая adres, buyer_type) для Paraşüt
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

    console.log(`Инициализация платежа для заказа: ${orderId}`);

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const responseText = await response.text();
    let responseJson = null;
    try { responseJson = JSON.parse(responseText); } catch (e) {}

    const resultCode = responseJson?.ResultCode ?? '';
    const paymentUrl = responseJson?.URL ?? '';

    // Если банк дал добро — перекидываем клиента на страницу ввода карты Param
    if (response.ok && Number(resultCode) > 0 && paymentUrl) {
      return res.redirect(paymentUrl);
    }

    return res.status(500).send(`Ошибка Param: ${resultCode}`);
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

    const orderMeta = orderStore.get(siparisId) || {};
    const successUrl = orderMeta.successUrl || '';
    const failUrl = orderMeta.failUrl || '';
    const notificationUrl = orderMeta.notificationUrl || '';

    // БЛОК 1: УСПЕШНАЯ ОПЛАТА
    if (sonuc === '1' && Number(dekontId) > 0) {
      console.log(`Заказ ${siparisId} успешно оплачен. Dekont: ${dekontId}`);

      // 1. Отправляем скрытый сигнал в Тильду (Зеленая пометка в CRM)
      if (notificationUrl) {
        try {
          await fetch(notificationUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              TURKPOS_RETVAL_Sonuc: '1',
              TURKPOS_RETVAL_Siparis_ID: siparisId,
              TURKPOS_RETVAL_Dekont_ID: dekontId
            }).toString()
          });
          console.log('Сигнал в Тильду отправлен успешно.');
        } catch (webhookErr) {
          console.error('Ошибка отправки сигнала в Тильду:', webhookErr);
        }
      }

      // 2. Запускаем создание фатуры в Paraşüt (Пока в режиме подготовки)
      if (orderMeta.rawBody) {
        createParasutInvoice(orderMeta.rawBody, dekontId);
      }

      // 3. Перенаправляем клиента на страницу успеха (blacksymbols.com/payment_success)
      if (successUrl) {
        return res.redirect(successUrl);
      }
      return res.send('Оплата прошла успешно!');
    }

    // БЛОК 2: ОШИБКА ОПЛАТЫ (нехватка средств, отмена)
    if (failUrl) {
      return res.redirect(failUrl);
    }
    return res.status(400).send('Оплата не прошла.');

  } catch (err) {
    console.error('CALLBACK ERROR:', err);
    return res.status(500).send('Callback Error');
  }
});

// === ФУНКЦИЯ PARAŞÜT (Скелет для будущего автовыставления) ===
async function createParasutInvoice(tildaData, dekontId) {
  try {
    console.log('--- ПОДГОТОВКА ДАННЫХ ДЛЯ PARAŞÜT ---');
    
    // Вытаскиваем все данные, которые вы добавили в "Дополнительные поля"
    const buyerType = tildaData.buyer_type || 'Bireysel';
    const name = tildaData.name || tildaData.KK_Sahibi || 'Müşteri';
    const email = tildaData.email || tildaData.Data1 || '';
    const phone = tildaData.phone || tildaData.KK_Sahibi_GSM || '';
    const address = tildaData.adres || 'Adres belirtilmedi';
    const il = tildaData.il || '';
    const vkn = tildaData.company_vkn || '11111111111'; // По умолчанию для физлиц
    const amount = tildaData.Islem_Tutar || '0';

    console.log(`Покупатель: ${name} (${buyerType})`);
    console.log(`Адрес: ${il}, ${address}`);
    console.log(`Сумма: ${amount} TRY. Квитанция: ${dekontId}`);
    
    /* TODO (После отпуска): 
      1. Написать функцию получения OAuth-токена Paraşüt.
      2. Сделать POST-запрос на /contacts для создания клиента.
      3. Сделать POST-запрос на /sales_invoices для создания E-Arşiv.
      4. Сделать POST-запрос на /e_archives/{id}/emails для отправки клиенту.
    */
    
    console.log('Данные для фатуры успешно собраны. Ожидается подключение API ключей Paraşüt.');
  } catch (error) {
    console.error('Ошибка подготовки данных для Paraşüt:', error);
  }
}

app.listen(PORT, () => {
  console.log('Server started on port ' + PORT);
});

// --- Вспомогательные функции ---
function toParamAmount(value) {
  const num = Number(String(value).replace(',', '.').trim() || '0');
  return num.toFixed(2).replace('.', ',');
}

function normalizePhone(value) {
  const digits = String(value).replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : digits;
}
        
