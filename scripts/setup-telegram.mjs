const token = process.env.TELEGRAM_BOT_TOKEN;
const appUrl = (process.env.APP_URL || process.env.PUBLIC_URL || 'https://chemcalc-a5y5.onrender.com').replace(/\/+$/, '');
const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET || '';

if (!token) {
  console.error('Задайте TELEGRAM_BOT_TOKEN (не храните токен в репозитории).');
  process.exit(1);
}

async function call(method, payload) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10000)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    throw new Error(`${method}: ${data.description || response.status}`);
  }
  return data.result;
}

const bot = await call('getMe');
console.log(`Бот: @${bot.username} (${bot.id})`);

const webAppUrl = `${appUrl}${appUrl.includes('?') ? '&' : '?'}tg=1`;
await call('setChatMenuButton', {
  menu_button: { type: 'web_app', text: 'ChemCalc', web_app: { url: webAppUrl } }
});
console.log(`Меню-кнопка: ${webAppUrl}`);

if (webhookSecret) {
  await call('setWebhook', {
    url: `${appUrl}/api/telegram/webhook`,
    secret_token: webhookSecret,
    allowed_updates: ['message'],
    drop_pending_updates: true
  });
  console.log(`Вебхук: ${appUrl}/api/telegram/webhook`);
} else {
  console.log('TELEGRAM_WEBHOOK_SECRET не задан: вебхук не установлен, /start в чате не будет отвечать.');
}
