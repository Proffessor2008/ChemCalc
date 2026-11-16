import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createCommunityServer } from './server/app.mjs';
import { createStaticHandler } from './server/static.mjs';

const projectRoot = fileURLToPath(new URL('.', import.meta.url));
const staticHandler = createStaticHandler(projectRoot);

const production = process.env.NODE_ENV === 'production';
const god = {
  login: process.env.COMMUNITY_GOD_LOGIN || 'creator',
  password: process.env.COMMUNITY_GOD_PASSWORD || (production ? null : randomBytes(18).toString('base64url'))
};
if (!god.password) throw new Error('Задайте COMMUNITY_GOD_PASSWORD перед публичным запуском');

const app = await createCommunityServer({
  dbPath: process.env.COMMUNITY_DB || 'var/community.db',
  god,
  staticHandler,
  dbBackend: process.env.COMMUNITY_DB_BACKEND || (process.env.DATABASE_URL ? 'postgres' : 'sqlite'),
  connectionString: process.env.DATABASE_URL,
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || '',
  telegramWebhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET || '',
  publicUrl: process.env.APP_URL || process.env.PUBLIC_URL || 'https://chemcalc-a5y5.onrender.com'
});
const host = process.env.HOST || (production ? '0.0.0.0' : '127.0.0.1');
const port = Number(process.env.PORT || 8080);
app.server.listen(port, host, () => {
  console.log(`ChemCalc: http://${host}:${port}`);
  if (app.bootstrap) console.log(production ? `GOD login: ${app.bootstrap.login}; пароль берётся из секретной переменной окружения` : `GOD login: ${app.bootstrap.login}; password: ${app.bootstrap.password}`);
  if (process.env.TELEGRAM_BOT_TOKEN) console.log('Telegram Mini App: вход и вебхук включены');
});
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => app.close().then(() => process.exit(0)));
