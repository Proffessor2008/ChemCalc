export async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    let timer;
    try {
      await Promise.race([
        navigator.clipboard.writeText(text),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('Таймаут Clipboard API')), 1200);
        })
      ]);
      return;
    } catch {
    } finally {
      clearTimeout(timer);
    }
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  textarea.style.pointerEvents = 'none';
  document.body.append(textarea);
  try {
    textarea.select();
    textarea.setSelectionRange(0, text.length);
    if (!document.execCommand('copy')) throw new Error('Браузер отклонил копирование');
  } finally {
    textarea.remove();
  }
}
