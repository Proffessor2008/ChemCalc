# ChemCalc в Telegram Mini Apps: аудит и план интеграции

Документ фиксирует результаты аудита текущего клиента/сервера, уже выполненные мобильные улучшения и пошаговый план превращения ChemCalc в Telegram Mini App без потери текущего функционала.

## 0. Статус проекта

- Бот: **@ChemCalk_bot**.
- Публичный адрес: **https://chemcalc-a5y5.onrender.com**.
- В коде уже реализованы Telegram shell, серверная проверка `initData`, вход `tg_<id>`, привязка Telegram к существующему аккаунту и скрипт настройки меню/вебхука.
- Локальная E2E-проверка пройдена: автоматический вход, никнейм/логин из Telegram, привязка к обычному аккаунту, мобильный профиль.
- Публичный домен всё ещё отдаёт старую сборку (`/api/health` → `schemaVersion: 5`). Нужен деплой текущего кода и переменные Render.
- Bot token **не хранится в репозитории**: только `TELEGRAM_BOT_TOKEN` в секретах Render/окружении.

## 1. Краткий вывод

Интеграция **технически возможна без переписывания приложения**. ChemCalc уже состоит из статического ES-модульного клиента, PWA/service worker и отдельного Node-сервера (SQLite/PostgreSQL). Основная работа требуется не в химическом движке, а в четырёх слоях:

1. **Telegram shell** — загрузка `telegram-web-app.js`, viewport, safe-area, тема, кнопки Telegram.
2. **Telegram-аутентификация** — проверка `initData` на сервере и привязка Telegram ID к пользователю.
3. **Мобильный UX** — уменьшение перекрытий, короткие подписи, 16px поля, safe-area, нижние листы.
4. **Деплой** — публичный HTTPS-домен, bot token, PostgreSQL, прокси для SSE/cookie.

Калькулятор, справочники, стехиометрия, история и офлайн-часть могут работать в Telegram WebView сразу после HTTPS-деплоя. Сообщество, заявки, вопросы и профиль требуют серверной части и новой авторизации.

## 2. Аудит текущего решения

### 2.1. Размер и состав

| Часть | Метрика |
|---|---:|
| JS-модули | 40 файлов, ≈481 KB |
| CSS | ≈58 KB |
| HTML | ≈44 KB |
| Данные JSON | 17 файлов, ≈1.11 MB |
| Сервер | 10 файлов, ≈113 KB |
| Зависимости | только `pg` (PostgreSQL) |
| Тесты | 60 файлов, все проходят |
| Валидация данных | 0 ошибок, 0 предупреждений |

Сильные стороны:

- нет сборщика и фреймворка — минимум зависимостей и совместимость с WebView;
- ленивая загрузка тяжёлых разделов (справочники, таблица, стехиометрия, термодинамика);
- PWA/service worker и офлайн-кэш;
- точный химический движок не зависит от UI;
- сервер уже поддерживает SQLite и PostgreSQL, миграции и SSE.

Ограничения:

- данные и часть модулей при первом открытии заметно крупнее обычного Mini App;
- service worker может отдавать старый JS/CSS после деплоя — версия кэша требует дисциплины;
- авторизация паролем не подходит для бесшовного входа из Telegram;
- SSE и cookie-сессии нужно проверить через обратный прокси;
- CSP пока отсутствует, а Telegram SDK загружается с внешнего домена.

### 2.2. Клиент

- `index.html` — статическая разметка всех разделов, SVG-иконки, PWA-манифест.
- `js/ui.js` — вкладки, темы, настройки, онбординг, связь с калькулятором.
- `js/community-ui.js` — заявки, профиль, уведомления, роли, вход/регистрация.
- `js/qa-ui.js` — вопросы/ответы/комментарии, голоса, отметка полезного, черновики.
- `js/periodic-table.js`, `reference-ui.js`, `stoichiometry-ui.js` — ленивые тяжёлые разделы.
- `styles.css` — адаптивная вёрстка, тёмная/светлая темы, диалоги, нижняя навигация.
- `sw.js` — кэш оболочки и полного офлайн-набора.

Мобильный аудит (Edge/Chromium, ширина 390/360/320 px):

- горизонтального переполнения документа нет ни на одной вкладке (`scrollWidth === innerWidth`);
- широкие справочные таблицы скроллятся внутри контейнера, а не ломают страницу;
- поля ввода на мобильных получают `font-size: 16px` (иначе iOS увеличивает масштаб);
- настройки на узком экране переходят в одну колонку;
- добавлены `viewport-fit=cover`, `interactive-widget=resizes-content`, `dvh`, safe-area;
- нижняя навигация использует короткие подписи на очень узких экранах;
- плавающая кнопка таблицы Менделеева на мобильных убрана (она перекрывала карточки); доступ к таблице перенесён в настройки;
- кнопки голосования/тегов/текстовые кнопки увеличены до удобных touch-зон.

Остающиеся мобильные задачи:

- проверить iOS Safari/Telegram iOS: клавиатура, `visualViewport`, закрытие диалогов;
- добавить явную подсказку горизонтальной прокрутки для широких таблиц;
- проверить длинные русские названия в навигации на 320 px (сейчас используются сокращения);
- для Telegram — учитывать `safeAreaInset` и `contentSafeAreaInset` из WebApp API.

### 2.3. Сервер и безопасность

- Node `http`, статика с защитой от path traversal, Brotli/Gzip, ETag.
- SQLite/PostgreSQL, параметризованные SQL-запросы.
- Пароли — scrypt-хэши.
- Сессия — HttpOnly cookie `chemcalc_session`, `SameSite=Lax`, 12 часов.
- CSRF — заголовок `X-CSRF-Token`, проверка Origin.
- Ограничение попыток входа, лимит JSON 250 KB.
- Аватар — data URL PNG/JPEG/WebP, ограничение 120 KB, клиентское уменьшение до 128×128.
- Приватность профиля: `public`/`private`, 403 для чужих приватных профилей.
- Вопросы/ответы: экранирование HTML, Markdown-рендер без вставки сырого HTML.
- Черновики комментариев/ответов сохраняются при перерисовке; это важно для WebView, где часто приходят события авторизации/SSE.

Риски перед Telegram:

- нет Content-Security-Policy; при добавлении `telegram.org` нужен явный allowlist;
- авторизация по логину/паролю неудобна в Telegram;
- `Origin` в WebView может отсутствовать или отличаться — CSRF-проверку нужно адаптировать;
- cookie должны быть `Secure` на HTTPS; `SameSite=None` может понадобиться только если WebView считается third-party (обычно Mini App first-party);
- SSE за прокси нужно проверить без буферизации;
- service worker не должен кэшировать `/api/*` и ответы с приватными данными;
- `initData` нельзя доверять без HMAC-проверки и проверки `auth_date`.

## 3. Что уже сделано для мобильных/Telegram

- `viewport-fit=cover`, `interactive-widget=resizes-content`.
- `100dvh`, safe-area для шапки, нижней навигации, тостов и тура.
- Поля ввода 16px на мобильных.
- Настройки — одна колонка на узком экране; диалоги ограничены `85dvh` и скроллятся.
- Нижняя навигация: короткие подписи на ≤420px, touch-зоны ≥56px.
- Кнопка «Таблица Менделеева» в настройках; плавающая кнопка скрыта на мобильных.
- Правки профиля: отдельный режим просмотра/редактирования, никнейм и логин разделены.
- Вход/регистрация только в личном кабинете.
- Черновики комментариев/ответов не теряются при перерисовке.
- Тесты: 60 файлов, данные валидны.

## 4. Целевая архитектура Telegram Mini App

```
Telegram client
  └─ WebView (HTTPS)
       ├─ index.html + styles.css + js/*
       ├─ Telegram.WebApp (telegram-web-app.js)
       └─ fetch('/api/...') + cookie-сессия + CSRF
                         │
Node server (Render/аналог) ─ SQLite/PostgreSQL
       ├─ /api/auth/telegram  (валидация initData)
       ├─ /api/auth/profile, /api/proposals, /api/questions, ...
       ├─ /api/events (SSE)
       └─ статика + service worker
                         │
Telegram Bot API (только сервер; bot token — секрет)
```

Клиент остаётся тем же SPA. Telegram добавляет:

- `window.Telegram.WebApp` — shell и данные пользователя;
- `initData` — подписанная строка для серверной авторизации;
- `BackButton`, `MainButton`, `HapticFeedback`, `themeChanged`, safe-area.

## 5. План работ по этапам

### Этап 0. Мобильная база (частично выполнен)

- [x] viewport, safe-area, dvh, 16px поля;
- [x] короткие подписи навигации;
- [x] перенос таблицы Менделеева в настройки на мобильных;
- [x] проверка отсутствия горизонтального переполнения на 320/360/390;
- [ ] iOS Safari/Telegram iOS ручная проверка;
- [ ] явные аффордансы горизонтальной прокрутки таблиц.

### Этап 1. Telegram shell (0.5–1 день)

1. Подключить `https://telegram.org/js/telegram-web-app.js` перед модулем UI (только в Telegram-сборке или с graceful fallback).
2. Добавить `js/telegram.js`:
   - `initTelegramApp()` — `ready()`, `expand()`, `disableVerticalSwipes()` (по необходимости);
   - вычисление viewport/safe-area и CSS-переменных;
   - синхронизация `colorScheme` с темой (если пользователь не выбрал явную тему);
   - `BackButton` (показать/скрыть, обработчик);
   - `MainButton` для основных действий (по желанию);
   - haptic feedback для голосов/отправки;
   - `enableClosingConfirmation()` при несохранённых формах;
   - `openTelegramLink`/`openLink`/`shareMessage` для внешних ссылок и «Поделиться».
3. CSS: `[data-platform="telegram"]` — safe-area, высота viewport, отключение лишних анимаций.
4. Feature flag: вне Telegram приложение работает как сейчас, без SDK-зависимостей.

### Этап 2. Авторизация через Telegram (2–3 дня)

1. Создать бота у `@BotFather`, задать Web App URL (HTTPS), menu button.
2. Сервер: `POST /api/auth/telegram` с `{ initData }`.
3. Проверка:
   - `secret = HMAC_SHA256(bot_token, "WebAppData")`;
   - `data_check_string` — отсортированные `key=value` без `hash`;
   - `HMAC_SHA256(secret, data_check_string) === hash`;
   - `auth_date` не старше 5–24 минут/часов; защита от replay по `query_id`/`auth_date`;
   - `user` из initData — источник Telegram ID, имени, username, photo_url.
4. Схема БД:
   - `users.telegram_id BIGINT UNIQUE`,
   - `telegram_username TEXT`,
   - `telegram_photo_url TEXT`,
   - `nickname` уже есть, `login` остаётся стабильным.
5. Сценарий первого входа:
   - если `telegram_id` найден — вход;
   - если нет — создать пользователя `login = tg_<id>`, `nickname` из `first_name`/`last_name`;
   - предложить привязку к существующему аккаунту через одноразовый код в кабинете (не автоматически по username — иначе возможен захват аккаунта).
6. Сессия: тот же HttpOnly cookie + CSRF; `Secure` в production; `SameSite=Lax` для first-party WebView; проверить `Origin` в Telegram WebView и при необходимости принимать запросы с проверкой CSRF + `Sec-Fetch-Site`.
7. Аватар: `photo_url` Telegram — внешний URL. Либо хранить URL с allowlist домена, либо сервер скачивает и сохраняет data URL 128×128.
8. Приватность/согласие: политика конфиденциальности, удаление аккаунта, понятное объяснение, какие Telegram-данные сохраняются.

### Этап 3. Telegram UX (1–2 дня)

- `BackButton`: вопрос → список, диалог → закрыть, вкладка → калькулятор.
- `MainButton`: «Проверить», «Опубликовать вопрос», «Сохранить профиль» — по контексту.
- Тема: системная/светлая/тёмная; учесть `themeChanged`.
- Safe-area и `viewportChanged`; не допускать перекрытия нижней навигацией.
- Закрытие с подтверждением при несохранённом вопросе/ответе.
- «Поделиться вопросом» через `switchInlineQuery`/`shareMessage` или `openTelegramLink`.
- Deep links вида `?startapp=q_<id>` / hash-маршруты: открыть вопрос/справочник.
- Haptics: только на значимых действиях, с отключением при `prefers-reduced-motion`/настройке.

### Этап 4. Деплой (0.5–1 день)

- Публичный HTTPS-домен (Telegram не принимает localhost).
- Render + PostgreSQL (уже есть `render.yaml` и `DATABASE_URL`) или VPS + reverse proxy.
- Переменные:
  - `TELEGRAM_BOT_TOKEN` (секрет только сервер),
  - `COMMUNITY_GOD_PASSWORD`,
  - `DATABASE_URL`,
  - `NODE_ENV=production`.
- Cookie: `Secure`, корректный `SameSite`; CSRF/Origin.
- SSE: отключить буферизацию прокси, таймауты.
- CSP: разрешить `https://telegram.org` (скрипт) и при необходимости `https://t.me`/CDN аватаров.
- Service worker: не кэшировать `/api/*`; версия кэша при каждом деплое.
- BotFather: Web App URL, menu button, описание, иконка.

### Этап 5. Тестирование (1–2 дня)

- Юнит-тесты `initData` на фикстурах (валидный/просроченный/поддельный hash).
- API-тесты Telegram-входа, привязки, приватности, аватара.
- Регрессия 60 текущих тестов + data validation.
- Telegram Desktop, iOS, Android: клавиатура, back button, safe-area, темы, SSE, cookie.
- Медленная сеть/офлайн: первый экран, справочники, повторная загрузка.
- Безопасность: replay initData, чужой Telegram ID, приватный профиль, XSS в вопросах, path traversal статики.

### Этап 6. Запуск и откат (0.5 дня)

- Feature flag `TELEGRAM_MODE`; обычный сайт продолжает работать.
- Мониторинг ошибок и медленных запросов.
- Инструкция для пользователей: «Открыть в Telegram», резервный вход по логину.
- Откат: выключить бота/Web App URL; сервер и PWA остаются доступны.

## 6. Ключевые технические решения

### 6.1. Проверка initData (эскиз)

```js
import { createHmac, timingSafeEqual } from 'node:crypto';

function verifyTelegramInitData(initData, botToken) {
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  params.delete('hash');
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const expected = createHmac('sha256', secret).update(dataCheckString).digest('hex');
  if (!hash || !timingSafeEqual(Buffer.from(hash), Buffer.from(expected))) return null;
  const authDate = Number(params.get('auth_date'));
  if (!authDate || Date.now() / 1000 - authDate > 3600) return null;
  return { user: JSON.parse(params.get('user') || '{}'), queryId: params.get('query_id') };
}
```

Дополнительно: хранить использованные `query_id`/`auth_date` в БД/кэше на час, чтобы исключить повтор.

### 6.2. Привязка существующего аккаунта

- Не связывать автоматически по `@username` — username можно сменить/занять.
- В кабинете: «Привязать Telegram» → одноразовый код (6–8 символов, TTL 10 минут) → ввод кода в боте/WebApp.
- После привязки вход через Telegram идёт в тот же аккаунт; логин для входа остаётся.

### 6.3. Cookie, CSRF и WebView

- Mini App открывается с HTTPS-домена приложения, поэтому cookie first-party.
- `Secure` обязателен; `HttpOnly`; `SameSite=Lax` обычно достаточно.
- CSRF-заголовок сохраняется; Origin-проверку ослабить только при явной проверке `initData`/сессии, не глобально.
- Если WebView не присылает Origin, проверять `Sec-Fetch-Site`/`Referer` и CSRF-токен.

### 6.4. Тема и safe-area

- `themeChanged` → CSS-переменные, но приоритет у явного выбора пользователя.
- `viewportChanged` → `--tg-viewport-height`, `--tg-safe-area-top/bottom`.
- Не полагаться только на `100vh`: использовать `100dvh`/переменные Telegram.
- Мобильная нижняя навигация и тосты не должны попадать под home-indicator.

### 6.5. Офлайн и service worker

- Калькулятор и локальные данные могут работать без сети.
- API/SSE/cookie — никогда не кэшировать.
- При деплое обновлять версию кэша (`chemcalc-v46` и выше).
- В Telegram первый запуск обычно онлайн; офлайн-режим — бонус, не обязательное условие.

## 7. Риски и митигация

| Риск | Митигация |
|---|---|
| Подделка initData | HMAC-проверка, auth_date, replay-защита |
| Захват аккаунта по username | только одноразовый код привязки |
| Cookie не проходят в WebView | HTTPS, Secure, SameSite, тест iOS/Android, fallback на token-сессию |
| SSE не работает через прокси | отключить буферизацию, heartbeat, polling fallback |
| Старый service worker | версионирование, `skipWaiting`, проверка после деплоя |
| Тяжёлый первый экран | ленивые разделы уже есть; кэш, Brotli, предзагрузка калькулятора |
| Telegram SDK недоступен | feature detection, приложение работает как обычный сайт |
| Приватность Telegram-данных | политика, согласие, удаление, минимум данных |
| Потеря черновиков в WebView | сохранение черновиков уже реализовано; не перерисовывать при вводе |

## 8. Деплой и настройка бота

1. Задеплоить текущий код на Render (auto-deploy из репозитория или ручной деплой).
2. В Render → Environment добавить:
   - `APP_URL=https://chemcalc-a5y5.onrender.com`
   - `TELEGRAM_BOT_TOKEN` — токен из `@BotFather` (секрет, не в репозиторий);
   - `TELEGRAM_WEBHOOK_SECRET` — случайная строка, например `openssl rand -hex 32`.
3. Убедиться, что `/api/health` отдаёт `schemaVersion: 6`.
4. Настроить меню и вебхук (локально или в Render Shell):

```powershell
$env:TELEGRAM_BOT_TOKEN='<токен>'
$env:TELEGRAM_WEBHOOK_SECRET='<секрет>'
$env:APP_URL='https://chemcalc-a5y5.onrender.com'
node scripts/setup-telegram.mjs
```

Скрипт выставит menu button с URL `https://chemcalc-a5y5.onrender.com/?tg=1` и вебхук `/api/telegram/webhook`.

5. В `@BotFather`:
   - `/setmenubutton` → URL приложения (если не используется скрипт);
   - при необходимости `/setdescription`, `/setuserpic`.
6. Проверить в Telegram Desktop/iOS/Android:
   - `/start` в боте → кнопка «Открыть ChemCalc»;
   - первый запуск создаёт пользователя `tg_<id>`;
   - профиль показывает `@username`, никнейм и Telegram;
   - обычный веб-пользователь может привязать Telegram в профиле;
   - после перезапуска Mini App сессия сохраняется.

## 9. Что осталось от владельца проекта

1. Задеплоить текущий код и прописать секреты Render (без этого публичный домен остаётся на schema 5).
2. Политика конфиденциальности и правила сообщества для Telegram-данных.
3. Тестовые Telegram-аккаунты iOS/Android/Desktop для финальной проверки.
4. Решение по модерации/репутации Telegram-пользователей (сейчас новые получают `basic`).

## 10. Ориентировочная оценка

- Мобильная полировка: выполнена, осталась ручная проверка iOS — 0.5 дня.
- Telegram shell и UX: реализовано в коде, проверено локально.
- initData-авторизация и привязка аккаунта: реализовано в коде, покрыто тестом.
- Деплой/SSL/прокси/мониторинг: осталось 0.5–1 день.
- Тестирование на реальных устройствах и исправления: 1–2 дня.
