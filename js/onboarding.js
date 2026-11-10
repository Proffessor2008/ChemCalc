const STEPS = [
  ['Два режима калькулятора', 'В режиме «Проверка» вы сами указываете продукты и коэффициенты. Правильный ответ раскрывается только после явного подтверждения.'],
  ['Предсказание по правилам', 'В режиме «Авто» введите реагенты и условия. Приложение показывает уверенность, объяснение и допущения, но не утверждает полноту химических знаний.'],
  ['Таблица и справочники', 'Нажмите «Таблица Менделеева» или клавишу T. Шесть справочников содержат инструменты pH, ЭДС, Нернста и закона Гесса. Всё работает локально.']
];

export function initOnboarding(storage) {
  if (storage.getItem('chemcalc-onboarding-v1') === 'seen') return;
  const dialog = document.createElement('dialog');
  dialog.className = 'dialog onboarding-dialog';
  dialog.setAttribute('aria-labelledby', 'onboarding-title');
  dialog.innerHTML = `<p class="eyebrow">Первый запуск · <span id="onboarding-step">1/3</span></p><h2 id="onboarding-title"></h2><p id="onboarding-text"></p><div class="dialog-actions"><button type="button" class="button ghost" id="onboarding-skip">Пропустить</button><button type="button" class="button primary" id="onboarding-next">Далее</button></div>`;
  document.body.append(dialog);
  let index = 0;
  const render = () => {
    dialog.querySelector('#onboarding-step').textContent = `${index + 1}/${STEPS.length}`;
    dialog.querySelector('#onboarding-title').textContent = STEPS[index][0];
    dialog.querySelector('#onboarding-text').textContent = STEPS[index][1];
    dialog.querySelector('#onboarding-next').textContent = index === STEPS.length - 1 ? 'Начать работу' : 'Далее';
  };
  const finish = () => {
    storage.setItem('chemcalc-onboarding-v1', 'seen');
    dialog.close();
    dialog.remove();
  };
  dialog.querySelector('#onboarding-skip').addEventListener('click', finish);
  dialog.querySelector('#onboarding-next').addEventListener('click', () => {
    if (index === STEPS.length - 1) finish();
    else { index += 1; render(); }
  });
  dialog.addEventListener('cancel', (event) => { event.preventDefault(); finish(); });
  render();
  dialog.showModal();
}
