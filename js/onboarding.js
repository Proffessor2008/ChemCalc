const STEPS = [
  { title: 'Добро пожаловать в ChemCalc', tab: 'calculator', text: 'За пару минут покажу, как устроен калькулятор: два режима, таблица Менделеева, стехиометрия, семь справочников, экспорт, история, сообщество и личный кабинет. Всё работает локально — без внешних API.' },
  { title: 'Навигация и вкладки', tab: 'calculator', target: 'header.app-header', text: 'Сверху — основные разделы: Калькулятор, Стехиометрия, Справочники, История, Сообщество и Кабинет. На телефоне они собраны в нижнюю панель. Справа — язык, кнопка настроек и таблица Менделеева.' },
  { title: 'Режим «Проверка»', tab: 'calculator', mode: 'check', target: '#equation-form', text: 'Здесь вы вводите полное уравнение с продуктами и коэффициентами. Баланс по элементам виден в реальном времени, но вердикт появляется только после кнопки «Проверить». Есть «Уравнять всё», три подсказки и показ правильного ответа.' },
  { title: 'Режим «Авто»', tab: 'calculator', mode: 'auto', target: '[data-mode="auto"]', text: 'В режиме «Авто» вводятся только реагенты и условия (среда, концентрация, фаза, нагрев, ток, катализатор). Программа предсказывает продукты, уравнивает уравнение и объясняет «почему так», показывая уверенность и допущения.' },
  { title: 'Таблица Менделеева', tab: 'calculator', target: '.periodic-top', text: 'Кнопка «Таблица Менделеева» (или клавиша T) открывает интерактивную таблицу со 118 элементами: фильтры, раскраски и подробные карточки с описанием, применением и безопасностью. Символ элемента можно вставить в формулу.' },
  { title: 'Стехиометрия', tab: 'stoichiometry', target: '#stoich-form', text: 'Раздел «Стехиометрия» считает количества: массу, моли, объёмы газов и растворы. Задайте известное вещество и величину, при необходимости — наличия реагентов для лимитирующего, выход продукта в процентах и целевой продукт. Для газов появляется практический объём.' },
  { title: 'Семь справочников', tab: 'references', target: '#reference-nav', text: 'Справочники теперь включают «Вещества» с описаниями, а также растворимость, ряд активности, электроотрицательность, Ka/Kb и pH, электродные потенциалы и термодинамику. В каждой таблице есть поиск, сортировка и карточки подробностей.' },
  { title: 'Экспорт в PDF и DOCX', tab: 'references', target: '#reference-export-pdf', text: 'Любой результат — уравнение, предсказание, стехиометрию или справочник — можно скачать в PDF (сохраняет вёрстку страниц) или DOCX (редактируемый текст и таблицы). Кнопки экспорта есть во всех разделах.' },
  { title: 'История', tab: 'history', target: '#history-filter', text: 'Последние 20 уравнений сохраняются локально. Их можно фильтровать (Проверка / Авто / избранное), отмечать звёздочкой и открывать заново.' },
  { title: 'Сообщество: вопросы и заявки', tab: 'community', target: '#community-ask-question', text: 'По умолчанию открываются вопросы сообщества: задавайте свои, отвечайте, комментируйте и голосуйте. Вторая вкладка — «Заявки на правку»: предложения по правилам реакций проходят проверку модераторами и могут публиковаться.' },
  { title: 'Настройки', tab: 'calculator', target: '#settings-toggle', text: 'Кнопка ⚙ в шапке открывает настройки: светлая, тёмная или системная тема, компактный/обычный/крупный интерфейс и повторное прохождение обучения.' },
  { title: 'Личный кабинет', tab: 'account', target: '#panel-account', text: 'В кабинете можно сменить никнейм, загрузить аватар, настроить приватность профиля, а также посмотреть черновики заявок, уведомления и публичную историю. Роли admin, admin+ и GOD получают инструменты модерации.' },
  { title: 'Офлайн, язык и тема', tab: 'account', target: '#language-select', text: 'Приложение — PWA: после первого открытия работает офлайн, service worker кеширует модули и справочники. Язык RU/EN переключается в шапке, тема и размер интерфейса — в настройках. Готово — приятной работы!' }
];

STEPS.splice(STEPS.length - 1, 0,
  { title: 'Лаборатория', tab: 'calculator', target: '[data-tab="lab"]', text: 'Новая вкладка «Лаборатория» объединяет три инструмента: приготовление и разбавление растворов, конвертер единиц и расчёт буферных систем.' },
  { title: 'Методика и примеры', tab: 'lab', target: '#panel-lab', text: 'В каждом окне лаборатории есть кнопка i: она открывает методику работы, формулы и числовой пример для выбранного действия. В поле формулы можно выбирать вещества из расширенной базы.' },
  { title: 'Распознавание по камере', tab: 'calculator', mode: 'check', target: '.ocr-trigger[data-ocr-target="equation-input"]', text: 'Кнопка камеры справа в поле уравнения открывает веб-камеру на компьютере или камеру телефона. Снимите уравнение, растяните рамку под нужную область и проверьте распознанный текст. В день доступно 5 сканов для авторизованных пользователей.' },
  { title: 'Отзыв о программе', tab: 'calculator', target: '#review-float', text: 'Кнопка отзыва слева внизу открывает форму с оценкой и предложениями. Отзыв можно изменить в любой момент, а публично показывается только общее количество оценок и их распределение.' },
  { title: 'Поддержка', tab: 'calculator', target: '#support-float', text: 'Кнопка поддержки справа внизу открывает личные обращения. Опишите проблему, приложите фото или скриншот — ответят администраторы. Здесь же можно посмотреть историю обращений.' }
);

export function initOnboarding({ storage, navigate, setMode }) {
  const KEY = 'chemcalc-onboarding-v4';

  function start() {
    storage.setItem(KEY, 'pending');
    build();
  }

  function build() {
    const overlay = document.createElement('div');
    overlay.className = 'tour-overlay';
    const card = document.createElement('div');
    card.className = 'tour-card';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-live', 'polite');
    card.innerHTML = `<p class="eyebrow">Обучение · <span class="tour-step"></span></p><h2 class="tour-title"></h2><p class="tour-text"></p><div class="tour-actions"><button type="button" class="button ghost tour-back">Назад</button><button type="button" class="button ghost tour-skip">Пропустить</button><button type="button" class="button primary tour-next">Далее</button></div>`;
    document.body.append(overlay, card);

    let index = 0;
    let highlighted = null;
    let frame = 0;
    document.querySelectorAll('.tour-target').forEach((element) => element.classList.remove('tour-target'));
    document.querySelectorAll('.tour-overlay, .tour-card').forEach((element) => {
      if (element !== overlay && element !== card) element.remove();
    });
    const stepEl = card.querySelector('.tour-step');
    const titleEl = card.querySelector('.tour-title');
    const textEl = card.querySelector('.tour-text');
    const backEl = card.querySelector('.tour-back');
    const skipEl = card.querySelector('.tour-skip');
    const nextEl = card.querySelector('.tour-next');

    const clearHighlight = () => {
      if (highlighted) {
        highlighted.classList.remove('tour-target');
        highlighted = null;
      }
    };

    const render = () => {
      const step = STEPS[index];
      stepEl.textContent = `${index + 1}/${STEPS.length}`;
      titleEl.textContent = step.title;
      textEl.textContent = step.text;
      backEl.hidden = index === 0;
      nextEl.textContent = index === STEPS.length - 1 ? 'Завершить' : 'Далее';
      if (step.tab) navigate(step.tab);
      if (step.mode) setMode(step.mode);
      clearHighlight();
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!card.isConnected) return;
        if (!step.target) return;
        const target = document.querySelector(step.target);
        if (!target) return;
        target.classList.add('tour-target');
        highlighted = target;
        try { target.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch { target.scrollIntoView(); }
      });
    };

    const finish = () => {
      cancelAnimationFrame(frame);
      clearHighlight();
      overlay.remove();
      card.remove();
      storage.setItem(KEY, 'seen');
    };

    backEl.addEventListener('click', () => { if (index > 0) { index -= 1; render(); } });
    skipEl.addEventListener('click', finish);
    nextEl.addEventListener('click', () => {
      if (index === STEPS.length - 1) finish();
      else { index += 1; render(); }
    });
    card.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') finish();
    });
    render();
    requestAnimationFrame(() => nextEl.focus());
  }

  if (storage.getItem(KEY) !== 'seen') build();
  return { restart: start };
}
