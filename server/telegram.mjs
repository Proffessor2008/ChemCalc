import { createHmac, timingSafeEqual } from 'node:crypto';

export const TELEGRAM_AUTH_MAX_AGE_SECONDS = 24 * 60 * 60;

export function verifyTelegramInitData(initData, botToken, { maxAge = TELEGRAM_AUTH_MAX_AGE_SECONDS, now = Date.now() } = {}) {
  if (!initData || !botToken) return null;
  let parameters;
  try { parameters = new URLSearchParams(String(initData)); } catch { return null; }
  const hash = parameters.get('hash');
  if (!hash || !/^[0-9a-f]{64}$/i.test(hash)) return null;
  parameters.delete('hash');
  const dataCheckString = [...parameters.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const expected = createHmac('sha256', secret).update(dataCheckString).digest();
  const actual = Buffer.from(hash, 'hex');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  const authDate = Number(parameters.get('auth_date'));
  if (!Number.isSafeInteger(authDate) || authDate <= 0) return null;
  if (Math.abs(now / 1000 - authDate) > maxAge) return null;
  let user;
  try { user = JSON.parse(parameters.get('user') || 'null'); } catch { return null; }
  if (!user || !Number.isSafeInteger(Number(user.id)) || Number(user.id) <= 0) return null;
  return { user, authDate, queryId: parameters.get('query_id') || '', hash: hash.toLowerCase() };
}

export function telegramDisplayName(user) {
  const full = [user?.first_name, user?.last_name].filter(Boolean).join(' ').trim();
  const raw = full || user?.username || `tg_${user?.id}`;
  return String(raw).replace(/[^\p{L}\p{N} ._-]/gu, '').trim().slice(0, 40) || `tg_${user?.id}`;
}

export function telegramLogin(telegramId) {
  return `tg_${Number(telegramId)}`;
}
