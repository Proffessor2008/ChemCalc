let controller = null;
let sdkPromise = null;

export function getTelegramWebApp() {
  return typeof window !== 'undefined' ? window.Telegram?.WebApp || null : null;
}

export function getTelegramInitData() {
  return getTelegramWebApp()?.initData || '';
}

export async function ensureTelegramSdk({ timeout = 2500 } = {}) {
  if (getTelegramWebApp()) return getTelegramWebApp();
  if (typeof document === 'undefined') return null;
  if (sdkPromise) return sdkPromise;
  const params = new URLSearchParams(location.search);
  const likelyTelegram = /Telegram/i.test(navigator.userAgent || '')
    || params.has('tg')
    || 'TelegramWebviewProxy' in window
    || 'TelegramWebviewProxyProto' in window
    || /https?:\/\/([^/]+\.)?t\.me\//i.test(document.referrer || '');
  if (!likelyTelegram) return null;
  sdkPromise = new Promise((resolve) => {
    let settled = false;
    const finish = () => { if (!settled) { settled = true; resolve(getTelegramWebApp()); } };
    const script = document.createElement('script');
    script.src = 'https://telegram.org/js/telegram-web-app.js';
    script.async = true;
    script.onload = finish;
    script.onerror = finish;
    document.head.append(script);
    setTimeout(finish, timeout);
  });
  return sdkPromise;
}

export function initTelegramApp({ getThemePreference = () => 'system', onBack = () => {} } = {}) {
  const webApp = getTelegramWebApp();
  if (!webApp) return null;
  if (!webApp.initData && webApp.platform === 'unknown') return null;
  const root = document.documentElement;
  root.dataset.platform = 'telegram';
  try { webApp.ready(); } catch { /* старый клиент Telegram */ }
  try { webApp.expand(); } catch { /* старый клиент Telegram */ }
  try { webApp.disableVerticalSwipes?.(); } catch { /* необязательный API */ }

  const refreshViewport = () => {
    const viewportHeight = Number(webApp.viewportStableHeight || webApp.viewportHeight || window.innerHeight);
    if (viewportHeight > 0) root.style.setProperty('--tg-viewport-height', `${viewportHeight}px`);
    const safe = webApp.safeAreaInset || {};
    root.style.setProperty('--tg-safe-top', `${Math.max(0, Number(safe.top) || 0)}px`);
    root.style.setProperty('--tg-safe-right', `${Math.max(0, Number(safe.right) || 0)}px`);
    root.style.setProperty('--tg-safe-bottom', `${Math.max(0, Number(safe.bottom) || 0)}px`);
    root.style.setProperty('--tg-safe-left', `${Math.max(0, Number(safe.left) || 0)}px`);
  };

  const refreshTheme = () => {
    if (getThemePreference() !== 'system') return;
    root.dataset.theme = webApp.colorScheme === 'dark' ? 'dark' : 'light';
  };

  refreshViewport();
  refreshTheme();
  webApp.onEvent?.('viewportChanged', refreshViewport);
  webApp.onEvent?.('themeChanged', refreshTheme);

  if (webApp.BackButton) {
    webApp.BackButton.onClick(() => onBack());
    webApp.BackButton.show();
  }

  controller = {
    webApp,
    get initData() { return webApp.initData || ''; },
    refreshViewport,
    refreshTheme,
    setBackVisible(visible) {
      if (!webApp.BackButton) return;
      if (visible) webApp.BackButton.show();
      else webApp.BackButton.hide();
    },
    haptic(style = 'light') {
      try { webApp.HapticFeedback?.impactOccurred(style); } catch { /* необязательный API */ }
    },
    share(url) {
      try { webApp.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(url)}`); }
      catch { window.open(url, '_blank', 'noopener'); }
    },
    downloadFile(url, fileName) {
      if (typeof webApp.downloadFile !== 'function') {
        try { webApp.openLink(url); return Promise.resolve(true); }
        catch { return Promise.resolve(false); }
      }
      return new Promise((resolve) => {
        let settled = false;
        const finish = (value) => { if (!settled) { settled = true; resolve(Boolean(value)); } };
        try { webApp.downloadFile({ url, file_name: fileName }, (accepted) => finish(accepted)); }
        catch { finish(false); }
        setTimeout(() => finish(true), 4000);
      });
    },
    close() {
      try { webApp.close(); } catch { /* необязательный API */ }
    },
    enableClosingConfirmation() {
      try { webApp.enableClosingConfirmation?.(); } catch { /* необязательный API */ }
    },
    disableClosingConfirmation() {
      try { webApp.disableClosingConfirmation?.(); } catch { /* необязательный API */ }
    }
  };
  return controller;
}

export function getTelegramController() {
  return controller;
}
