const dictionaries = {
  ru: {
    appName: 'Химический калькулятор',
    appShort: 'ChemCalc',
    calculator: 'Калькулятор',
    stoichiometry: 'Стехиометрия',
    references: 'Справочники',
    history: 'История',
    periodic: 'Таблица Менделеева',
    checkMode: 'Проверка',
    autoMode: 'Авто',
    checkDescription: 'Вы составляете продукты и коэффициенты — программа проверяет только после команды.',
    autoDescription: 'Введите только реагенты. Предсказание продуктов будет подключено на этапе 2.',
    editorTitle: 'Уравнение реакции',
    equationLabel: 'Полное уравнение с коэффициентами',
    equationHelp: 'Допустимы =, ->, → и ⇄; скобки, кристаллогидраты и заряды: Fe^3+, SO4^2-, e-.',
    examples: 'Примеры',
    check: 'Проверить',
    balanceAll: 'Уравнять всё',
    reset: 'Сбросить коэффициенты',
    reveal: 'Показать правильный ответ',
    hint: 'Подсказка',
    coefficients: 'Коэффициенты',
    attempts: 'Попытки',
    hints: 'Подсказки',
    liveBalance: 'Баланс в реальном времени',
    liveBalanceHelp: 'Индикатор по элементам не раскрывает итоговый вердикт.',
    resultTitle: 'Результат проверки',
    emptyResult: 'Введите уравнение и нажмите «Проверить». До этого правильный ответ не показывается.',
    element: 'Элемент',
    left: 'Слева',
    right: 'Справа',
    charge: 'Заряд',
    matched: 'сошлось',
    mismatched: 'не сошлось',
    redoxTitle: 'Электронный баланс',
    substances: 'Вещества и молярные массы',
    formula: 'Формула',
    name: 'Название',
    molarMass: 'M, г/моль',
    oxidation: 'Степени окисления',
    unknown: 'Нет данных в локальной базе',
    autoTitle: 'Реагенты',
    autoLabel: 'Левая часть уравнения',
    autoPlaceholder: 'Например: Zn + HCl',
    autoPending: 'Правила предсказания появятся на этапе 2. Переключитесь в «Проверку», чтобы проверить готовое уравнение.',
    stagedTitle: 'Раздел запланирован по ТЗ',
    stoichiometryText: 'Расчёты количества вещества, массы, объёма и выхода продукта будут реализованы на этапе 2.',
    referencesText: 'Шесть интерактивных справочников будут реализованы на этапе 4.',
    historyText: 'История последних 20 уравнений и избранное появятся на этапе 2.',
    periodicText: 'Интерактивная таблица со всеми 118 элементами будет подключена на этапе 3. Сейчас данные символов и атомных масс уже используются калькулятором.',
    close: 'Закрыть',
    cancel: 'Отмена',
    confirm: 'Продолжить',
    confirmBalance: 'Уравнять автоматически? Сначала попробуйте самостоятельно: решение раскроет коэффициенты.',
    confirmAnswer: 'Показать правильный ответ и пошаговое решение?',
    copy: 'Копировать Unicode',
    copied: 'Уравнение скопировано',
    copyError: 'Не удалось получить доступ к буферу обмена',
    solution: 'Пошаговое решение',
    theme: 'Переключить тему',
    language: 'Язык интерфейса',
    navigation: 'Основная навигация',
    skip: 'Перейти к содержимому',
    offline: 'Все расчёты выполняются локально, без внешних API.',
    statusCorrect: 'Верно',
    statusNonminimal: 'Баланс верный, коэффициенты не минимальные',
    statusNotBalanced: 'Баланс не сошёлся',
    statusWarning: 'Возможна ошибка в продуктах',
    statusPartial: 'Не удалось полностью проверить',
    statusSyntax: 'Ошибка в записи формулы'
  },
  en: {
    appName: 'Chemistry calculator',
    appShort: 'ChemCalc',
    calculator: 'Calculator',
    stoichiometry: 'Stoichiometry',
    references: 'References',
    history: 'History',
    periodic: 'Periodic table',
    checkMode: 'Check',
    autoMode: 'Auto',
    checkDescription: 'You write products and coefficients — the app checks them only on demand.',
    autoDescription: 'Enter reactants only. Product prediction will be added in stage 2.',
    editorTitle: 'Reaction equation',
    equationLabel: 'Complete equation with coefficients',
    equationHelp: 'Use =, ->, → or ⇄; brackets, hydrates and charges are supported: Fe^3+, SO4^2-, e-.',
    examples: 'Examples',
    check: 'Check',
    balanceAll: 'Balance all',
    reset: 'Reset coefficients',
    reveal: 'Show correct answer',
    hint: 'Hint',
    coefficients: 'Coefficients',
    attempts: 'Attempts',
    hints: 'Hints',
    liveBalance: 'Live balance',
    liveBalanceHelp: 'Per-element indicators do not reveal the final verdict.',
    resultTitle: 'Check result',
    emptyResult: 'Enter an equation and select “Check”. The answer stays hidden until you request it.',
    element: 'Element',
    left: 'Left',
    right: 'Right',
    charge: 'Charge',
    matched: 'matched',
    mismatched: 'mismatched',
    redoxTitle: 'Electron balance',
    substances: 'Substances and molar masses',
    formula: 'Formula',
    name: 'Name',
    molarMass: 'M, g/mol',
    oxidation: 'Oxidation states',
    unknown: 'Not in the local database',
    autoTitle: 'Reactants',
    autoLabel: 'Left-hand side',
    autoPlaceholder: 'For example: Zn + HCl',
    autoPending: 'Prediction rules will be added in stage 2. Switch to “Check” to verify a complete equation.',
    stagedTitle: 'Section planned in the specification',
    stoichiometryText: 'Amount, mass, volume and product-yield calculations will be added in stage 2.',
    referencesText: 'Six interactive reference tables will be added in stage 4.',
    historyText: 'The latest 20 equations and favourites will be added in stage 2.',
    periodicText: 'The interactive table with all 118 elements will be added in stage 3. Element symbols and atomic masses already power the calculator.',
    close: 'Close',
    cancel: 'Cancel',
    confirm: 'Continue',
    confirmBalance: 'Balance automatically? Try it yourself first: this reveals the coefficients.',
    confirmAnswer: 'Show the correct answer and step-by-step solution?',
    copy: 'Copy Unicode',
    copied: 'Equation copied',
    copyError: 'Could not access the clipboard',
    solution: 'Step-by-step solution',
    theme: 'Toggle theme',
    language: 'Interface language',
    navigation: 'Main navigation',
    skip: 'Skip to content',
    offline: 'All calculations run locally, without external APIs.',
    statusCorrect: 'Correct',
    statusNonminimal: 'Balanced, but coefficients are not minimal',
    statusNotBalanced: 'Not balanced',
    statusWarning: 'Products may be incorrect',
    statusPartial: 'Only a partial check was possible',
    statusSyntax: 'Formula syntax error'
  }
};
Object.assign(dictionaries.ru, {
  autoDescription: 'Введите реагенты и условия — приложение применит локальное правило и уравняет продукты.',
  autoHelp: 'Введите только реагенты. Условия ниже реально изменяют выбор правила.',
  electrolysisExample: 'Электролиз NaCl', conditions: 'Условия и среда', medium: 'Среда', neutral: 'Нейтральная', acidic: 'Кислая (H+)', alkaline: 'Щелочная (OH-)',
  acidConcentration: 'Концентрация кислоты', unspecified: 'Не задана', dilute: 'Разбавленная', concentrated: 'Концентрированная', solvent: 'Фаза / растворитель', aqueous: 'Водный раствор', melt: 'Расплав', gasPhase: 'Газовая фаза', organicSolvent: 'Органический растворитель',
  ratio: 'Соотношение реагентов', normalRatio: 'Обычное / избыток щёлочи', deficitRatio: 'Недостаток щёлочи', catalyst: 'Катализатор', heating: 'Нагревание (t°)', electricCurrent: 'Электрический ток',
  predict: 'Предсказать и уравнять', predictionResult: 'Результат предсказания', autoEmpty: 'Продукты появятся только после применения подходящего правила.', why: 'Почему так', restoreCoefficients: 'Восстановить коэффициенты правила',
  ionicEquations: 'Ионные уравнения', fullIonic: 'Полное', netIonic: 'Краткое', share: 'Поделиться ссылкой', openCheck: 'Открыть в «Проверке»', openStoich: 'Рассчитать количества',
  useCurrent: 'Взять уравнение из калькулятора', balancedEquation: 'Уравнение (коэффициенты будут подобраны автоматически)', knownSubstance: 'Известное вещество', inputKind: 'Исходная величина', mass: 'Масса, г', amount: 'Количество, моль', gasVolume: 'Объём газа, л', solutionVolume: 'Объём раствора, л', value: 'Значение', concentration: 'Концентрация, моль/л', gasConditions: 'Условия для газов', normalConditions: 'н. у.: 22,4 л/моль', yield: 'Выход продукта, %', calculate: 'Рассчитать',
  clearHistory: 'Очистить историю', historyHelp: 'Сохраняются последние 20 уравнений. Избранное можно отметить звёздочкой.', historyEmpty: 'История пока пуста. Проверьте или предскажите уравнение.',
  highConfidence: 'Высокая уверенность', mediumConfidence: 'Средняя уверенность', lowConfidence: 'Низкая / неоднозначно', noReaction: 'Реакция не идёт', noRule: 'Нет подходящего правила', ambiguous: 'Нужно выбрать условия', needsConditions: 'Недостаточно условий',
  diluteCondition: 'Разбавленная кислота', concentratedCondition: 'Концентрированная кислота', availableAmounts: 'Наличие реагентов, моль (необязательно)', availableHelp: 'Если заданы хотя бы два реагента, расчёт выполняется по лимитирующему.', actualProduct: 'Практический выход', usedAmount: 'n, моль', theoreticalMass: 'm, г', gasVolumeShort: 'V(газ), л', actualMassShort: 'm практ., г', favorite: 'В избранное', removeFavorite: 'Убрать из избранного', delete: 'Удалить', open: 'Открыть', clearHistoryConfirm: 'Удалить все 20 последних записей, включая избранные?', linked: 'Ссылка скопирована', copiedEquation: 'Уравнение скопировано', noHistory: 'Нет записей'
});
Object.assign(dictionaries.en, {
  autoDescription: 'Enter reactants and conditions — the app applies a local rule and balances the products.',
  autoHelp: 'Enter reactants only. The conditions below change rule selection.', electrolysisExample: 'NaCl electrolysis', conditions: 'Conditions and medium', medium: 'Medium', neutral: 'Neutral', acidic: 'Acidic (H+)', alkaline: 'Alkaline (OH-)',
  acidConcentration: 'Acid concentration', unspecified: 'Not specified', dilute: 'Dilute', concentrated: 'Concentrated', solvent: 'Phase / solvent', aqueous: 'Aqueous solution', melt: 'Melt', gasPhase: 'Gas phase', organicSolvent: 'Organic solvent',
  ratio: 'Reactant ratio', normalRatio: 'Normal / excess base', deficitRatio: 'Base deficit', catalyst: 'Catalyst', heating: 'Heating (t°)', electricCurrent: 'Electric current', predict: 'Predict and balance', predictionResult: 'Prediction result', autoEmpty: 'Products appear only after a suitable local rule is applied.', why: 'Why', restoreCoefficients: 'Restore rule coefficients',
  ionicEquations: 'Ionic equations', fullIonic: 'Complete', netIonic: 'Net', share: 'Share link', openCheck: 'Open in Check mode', openStoich: 'Calculate amounts', useCurrent: 'Use calculator equation', balancedEquation: 'Equation (coefficients will be balanced automatically)', knownSubstance: 'Known substance', inputKind: 'Input quantity', mass: 'Mass, g', amount: 'Amount, mol', gasVolume: 'Gas volume, L', solutionVolume: 'Solution volume, L', value: 'Value', concentration: 'Concentration, mol/L', gasConditions: 'Gas conditions', normalConditions: 'STP: 22.4 L/mol', yield: 'Product yield, %', calculate: 'Calculate',
  clearHistory: 'Clear history', historyHelp: 'The latest 20 equations are stored. Star an item to favourite it.', historyEmpty: 'No history yet. Check or predict an equation.', highConfidence: 'High confidence', mediumConfidence: 'Medium confidence', lowConfidence: 'Low / ambiguous', noReaction: 'No reaction', noRule: 'No suitable rule', ambiguous: 'Choose conditions', needsConditions: 'More conditions needed', diluteCondition: 'Dilute acid', concentratedCondition: 'Concentrated acid', availableAmounts: 'Available reactants, mol (optional)', availableHelp: 'With at least two values, the limiting reactant determines the calculation.', actualProduct: 'Actual yield', usedAmount: 'n, mol', theoreticalMass: 'm, g', gasVolumeShort: 'V(gas), L', actualMassShort: 'Actual m, g', favorite: 'Add to favourites', removeFavorite: 'Remove from favourites', delete: 'Delete', open: 'Open', clearHistoryConfirm: 'Delete all recent entries, including favourites?', linked: 'Link copied', copiedEquation: 'Equation copied', noHistory: 'No entries'
});
Object.assign(dictionaries.ru, {
  elementSearch: 'Поиск по символу, названию или номеру', colorMode: 'Раскраска', byCategory: 'По категории', byPhase: 'По агрегатному состоянию', byElectronegativity: 'По электроотрицательности', byRadius: 'По радиусу', byDensity: 'По плотности', byDiscovery: 'По году открытия', referenceMode: 'Справка', insertMode: 'Вставка', clickHint: 'Щелчок по элементу откроет подробную справку.', filters: 'Фильтры', elementType: 'Тип', all: 'Все', metals: 'Металлы', nonmetals: 'Неметаллы', metalloids: 'Металлоиды', group: 'Группа', period: 'Период', radioactiveOnly: 'Только радиоактивные', temperature: 'Температура'
});
Object.assign(dictionaries.en, {
  elementSearch: 'Search by symbol, name or number', colorMode: 'Colour mode', byCategory: 'By category', byPhase: 'By physical state', byElectronegativity: 'By electronegativity', byRadius: 'By atomic radius', byDensity: 'By density', byDiscovery: 'By discovery year', referenceMode: 'Reference', insertMode: 'Insert', clickHint: 'Select an element to open its reference card.', filters: 'Filters', elementType: 'Type', all: 'All', metals: 'Metals', nonmetals: 'Nonmetals', metalloids: 'Metalloids', group: 'Group', period: 'Period', radioactiveOnly: 'Radioactive only', temperature: 'Temperature'
});
Object.assign(dictionaries.ru, { documentation: 'Документация' });
Object.assign(dictionaries.en, { documentation: 'Documentation' });
Object.assign(dictionaries.ru, {
  latex: 'Копировать LaTeX', copiedLatex: 'LaTeX скопирован', copying: 'Копирование…', predicted: 'Типовое предсказание', ruleSource: 'Источник правила: {source}', reactionType: 'Тип: {type}',
  thermoReaction: 'Термодинамика реакции', thermoIonic: 'Термодинамика по краткому ионному уравнению', tryIonicThermo: 'Попробовать по краткому ионному уравнению', ionicThermoNote: 'Расчёт выполнен по краткому ионному уравнению; ионы-наблюдатели исключены.',
  dissociationSteps: 'Ступенчатая диссоциация и равновесия', alreadyIonic: 'Уравнение уже записано в ионной форме; нейтральные частицы оставлены без изменений.', weakPolyprotic: 'Слабые многоосновные кислоты не разбиваются полностью: их ступенчатые равновесия показаны отдельно.',
  yieldProduct: 'Целевой продукт для выхода', yieldTarget: 'Практический выход применён к продукту: {product}.', historyFilter: 'Фильтр истории', historyAll: 'Все записи', historyAuto: 'Только Авто', historyCheck: 'Только Проверка', historyFavorites: 'Только избранное', historyNoFilter: 'По выбранному фильтру записей нет.',
  similarExample: 'Похожий пример, не предсказание исходной реакции', similarRule: 'Похожее правило из локальной базы.', addReactants: 'Добавьте: {formulas}.', conditionsLabel: 'Условия: {conditions}.',
  inputValid: 'Синтаксис корректен. Распознано реагентов: {count}. Условия и продукты проверяются после нажатия кнопки.', inputEquationHint: 'Здесь вводятся только реагенты. Полное уравнение откройте в режиме «Проверка».',
  balanceOk: '✓ Баланс атомов и зарядов сходится.', balanceBad: '× Баланс не сходится: проверьте изменённые коэффициенты.', coefficientError: 'Коэффициент должен быть положительным целым числом',
  nitrateConcentrationRequired: 'Для нитрата или сульфата укажите концентрацию кислоты.', activityPositive: 'Активность {formula} должна быть положительным числом', quotientPositive: 'Реакционное частное Q должно быть положительным конечным числом',
  potentialNoReaction: 'Для известной пары полуреакций {label} = {value} В ≤ 0: при заданных условиях реакция не идёт.', standardPotential: 'Стандартная ЭДС: E° = {value} В > 0.', standardPotentialValue: 'Стандартная ЭДС: E° = {value} В.', nernstResult: 'По уравнению Нернста при Q = {quotient}: E = {value} В > 0.',
  ionicRedoxWhy: 'Продукты выбраны из локальной библиотеки электродных пар; полуреакции уравнены по атомам, заряду и электронам.'
});
Object.assign(dictionaries.en, {
  latex: 'Copy LaTeX', copiedLatex: 'LaTeX copied', copying: 'Copying…', predicted: 'Typical prediction', ruleSource: 'Rule source: {source}', reactionType: 'Type: {type}',
  thermoReaction: 'Reaction thermodynamics', thermoIonic: 'Thermodynamics using the net ionic equation', tryIonicThermo: 'Try the net ionic equation', ionicThermoNote: 'Calculated using the net ionic equation; spectator ions are excluded.',
  dissociationSteps: 'Stepwise dissociation and equilibria', alreadyIonic: 'The equation is already in ionic form; neutral species are unchanged.', weakPolyprotic: 'Weak polyprotic acids are not fully split: their stepwise equilibria are shown separately.',
  yieldProduct: 'Target product for yield', yieldTarget: 'Actual yield is applied to product: {product}.', historyFilter: 'History filter', historyAll: 'All entries', historyAuto: 'Auto only', historyCheck: 'Check only', historyFavorites: 'Favourites only', historyNoFilter: 'No entries match this filter.',
  similarExample: 'Similar example, not a prediction for your reaction', similarRule: 'Similar rule from the local database.', addReactants: 'Add: {formulas}.', conditionsLabel: 'Conditions: {conditions}.',
  inputValid: 'Syntax is valid. Reactants found: {count}. Conditions and products are checked after you run the prediction.', inputEquationHint: 'Enter reactants only here. Open the complete equation in Check mode.',
  balanceOk: '✓ Atoms and charge are balanced.', balanceBad: '× Not balanced: check the edited coefficients.', coefficientError: 'Coefficient must be a positive integer',
  nitrateConcentrationRequired: 'Select the acid concentration for nitrate or sulfate.', activityPositive: 'Activity of {formula} must be a positive number', quotientPositive: 'Reaction quotient Q must be a finite positive number',
  potentialNoReaction: 'For the known half-reaction pair, {label} = {value} V ≤ 0: no reaction under these conditions.', standardPotential: 'Standard EMF: E° = {value} V > 0.', standardPotentialValue: 'Standard EMF: E° = {value} V.', nernstResult: 'Using the Nernst equation at Q = {quotient}: E = {value} V > 0.',
  ionicRedoxWhy: 'Products are selected from the local electrode-pair library; half-reactions are balanced for atoms, charge and electrons.'
});
Object.assign(dictionaries.ru, {
  hessSteps: 'Показать слагаемые по закону Гесса', reductionHalf: 'Восстановление', oxidationHalf: 'Окисление', predictionNotice: 'Типовое предсказание, проверьте условия реакции.',
  missingThermo: 'Нет термодинамических данных с подходящим стандартным состоянием: {formulas}. Расчёт не выполнен.', ionicThermoUnavailable: 'Расчёт по краткому ионному уравнению невозможен: {message}'
});
Object.assign(dictionaries.en, {
  hessSteps: 'Show terms in Hess’s law', reductionHalf: 'Reduction', oxidationHalf: 'Oxidation', predictionNotice: 'Typical prediction; verify the reaction conditions.',
  missingThermo: 'No thermodynamic data for the required standard state: {formulas}. Calculation cancelled.', ionicThermoUnavailable: 'Cannot calculate using the net ionic equation: {message}'
});
Object.assign(dictionaries.ru, { docsSubtitle: 'Руководство, логика вычислений и возможности программы.', openReadme: 'Открыть README' });
Object.assign(dictionaries.en, { docsSubtitle: 'Guide, calculation logic and application features.', openReadme: 'Open README' });
Object.assign(dictionaries.ru, { nonAqueousIonic: 'Ионные уравнения не составляются для безводных сред.' });
Object.assign(dictionaries.en, { nonAqueousIonic: 'Ionic equations are not available for non-aqueous media.' });
Object.assign(dictionaries.ru, {
  nonAqueousPrediction: 'Реакция не идёт: водный ионный механизм неприменим в выбранной неводной среде. Нужно отдельное правило для этой фазы.',
  nonAqueousThermo: 'Это формальный расчёт по стандартным состояниям, а не доказательство протекания реакции в выбранной неводной среде.'
});
Object.assign(dictionaries.en, {
  nonAqueousPrediction: 'No reaction: the aqueous ionic mechanism is not applicable in the selected non-aqueous medium. A phase-specific rule is required.',
  nonAqueousThermo: 'This is a formal standard-state calculation, not evidence that the reaction proceeds in the selected non-aqueous medium.'
});
const siteDataSource = 'Глинка Н. Л., Общая химия: степени окисления в многоатомных ионах; внутримолекулярное окисление-восстановление';
Object.assign(dictionaries.ru, {
  аммоний: 'аммоний', нитрат: 'нитрат', нитрит: 'нитрит', дихромат: 'дихромат', хлорат: 'хлорат', оксид: 'оксид',
  internalRedoxTransfer: 'Внутримолекулярный перенос: {transitions}',
  redoxAgents: 'Окислитель: {oxidizers}; восстановитель: {reducers}',
  redoxElectronBalance: 'Электронный баланс: отдано {lost}e⁻, принято {gained}e⁻ — {status}',
  redoxBalanced: 'сходится', redoxUnbalanced: 'не сходится',
  redoxSiteReduction: '{label} ({symbol}) восстанавливается: {from} → {to}',
  redoxSiteOxidation: '{label} ({symbol}) окисляется: {from} → {to}',
  internalRedoxSource: siteDataSource
});
Object.assign(dictionaries.en, {
  аммоний: 'ammonium', нитрат: 'nitrate', нитрит: 'nitrite', дихромат: 'dichromate', хлорат: 'chlorate', оксид: 'oxide',
  internalRedoxTransfer: 'Intramolecular electron transfer: {transitions}',
  redoxAgents: 'Oxidizer: {oxidizers}; reducer: {reducers}',
  redoxElectronBalance: 'Electron balance: {lost}e⁻ lost, {gained}e⁻ gained — {status}',
  redoxBalanced: 'balanced', redoxUnbalanced: 'not balanced',
  redoxSiteReduction: '{label} ({symbol}) is reduced: {from} → {to}',
  redoxSiteOxidation: '{label} ({symbol}) is oxidized: {from} → {to}',
  internalRedoxSource: 'Glinka, General Chemistry: oxidation states in polyatomic ions; intramolecular redox'
});
Object.assign(dictionaries.ru, {
  community: 'Сообщество', communitySubtitle: 'Проверенные пользователями дополнения к базе реакций.', communityOffline: 'Сервер сообщества недоступен. Калькулятор продолжает работать с локальной базой.', serverUnavailable: 'Сервис сообщества временно недоступен. Попробуйте повторить действие позже.', pollingFallback: 'Онлайн-обновление прервано; список обновляется периодически.',
  account: 'Аккаунт', login: 'Логин', password: 'Пароль', confirmPassword: 'Подтверждение пароля', signIn: 'Войти', signOut: 'Выйти', createAccount: 'Создать аккаунт', register: 'Зарегистрироваться', signedIn: 'Вход выполнен', role: 'Привилегии', registered: 'Дата регистрации', lastSession: 'Последний вход', pendingMine: 'Ожидающие заявки', userManagement: 'Пользователи и роли', userManagementHelp: 'Только GOD назначает администраторов. Пароли в списке не отображаются.', roleUpdated: 'Роль пользователя обновлена',
  newProposal: 'Новая заявка', editProposal: 'Редактирование заявки', correctionProposal: 'Исправление ответа', proposalFeed: 'Лента предложений', sort: 'Сортировка', byRating: 'По рейтингу', byDate: 'Сначала новые', feedHelp: 'Голоса помогают модераторам заметить заявку. Публикацию подтверждает только admin, admin+ или GOD.', moderation: 'Модерация', moderationHelp: 'Сравните уравнение с источником, проверьте условия и ионный состав. После утверждения правило станет активным для пользователей.', myProposals: 'Мои заявки', noProposals: 'Ожидающих заявок пока нет.', noOwnProposals: 'У вас пока нет заявок.',
  kind_new: 'Новое правило', kind_correction: 'Исправление', rating: 'Рейтинг', source: 'Источник', source_glinka: 'Учебник Глинки', source_lidine: 'Справочник Лидина', source_textbook: 'Другой учебник или статья', source_lab: 'Лабораторная работа', source_personal: 'Личное мнение', sourceDetails: 'Точное описание источника: страница, раздел, ссылка или условия опыта', comment: 'Пояснение и условия применимости', issues: 'Что нужно исправить', issue_products: 'Продукты реакции', issue_conditions: 'Условия реакции', issue_coefficients: 'Коэффициенты', issue_ionic: 'Ионное уравнение', issue_substance: 'Название или свойства вещества', issue_thermo: 'Термодинамика', issue_code: 'Ошибка обработки формулы',
  originalAnswer: 'Текущий ответ', reviewNote: 'Примечание модератора', publishedBy: 'Утвердил', voteCorrect: 'Верно (+1)', voteIncorrect: 'Неверно (−1)', edit: 'Редактировать', withdraw: 'Снять заявку', moderate: 'Проверить и утвердить', reviewNotePlaceholder: 'Комментарий для автора и других модераторов', approve: 'Утвердить и опубликовать', needsEvidence: 'Запросить источник', reject: 'Отклонить', proposalApproved: 'Правило опубликовано и добавлено в калькулятор',
  status_pending: 'Ожидает проверки', status_approved: 'Опубликовано', status_rejected: 'Отклонено', status_needs_evidence: 'Нужен источник', status_changes_requested: 'Нужны исправления', status_withdrawn: 'Снято автором', proposalSubmitted: 'Заявка отправлена на проверку сообществу и модераторам',
  proposalValidationHelp: 'Укажите полное уравнение и условия. Программа проверит атомы, заряд и ионный состав до отправки. Голосование не заменяет проверку модератором.', outcome: 'Результат в выбранных условиях', reactionProducts: 'Есть продукты реакции', proposedEquation: 'Предлагаемое уравнение или только реагенты', reactionTypeLabel: 'Тип реакции', communityRule: 'Правило сообщества', phaseSpecific: 'Это отдельное, подтверждённое источником правило для неводной фазы', phaseSpecificHelp: 'Обычные водные правила обмена нельзя переносить в органическую среду, расплав или газ. Отдельный неводный процесс требует независимого источника и модерации.',
  newSubstances: 'Данные новых веществ', newSubstancesHelp: 'Для веществ вне локальной базы заполните карточки. Ионы записываются через запятую: Li^+:1, OH^-:1.', substanceName: 'Название вещества', substanceClass: 'Класс вещества', solubility: 'Растворимость', strongElectrolyte: 'Сильный электролит', ionComposition: 'Ионный состав: ион:коэффициент', ionsFormat: 'Проверьте запись ионов для {formula}: нужен формат Li^+:1, OH^-:1', ionicPreview: 'Предварительные ионные уравнения',
  atomsBalanced: '✓ Атомы и суммарный заряд сбалансированы.', atomsUnbalanced: 'Атомы или заряд не уравнены. Проверьте коэффициенты перед отправкой.', notMinimal: 'Коэффициенты не минимальные.', noReactionProposal: 'Будет предложен ответ «Реакция не идёт» для указанных реагентов и условий.', invalidEquation: 'Введите корректное уравнение с обеими сторонами или выберите «Реакция не идёт».', fixBalanceBeforeSubmit: 'Сначала исправьте ошибку в уравнении.', loginToPropose: 'Войдите или зарегистрируйтесь, чтобы отправить заявку.', suggestSolution: 'Предложить верное решение', reportInaccuracy: 'Нашли неточность? Предложите правки для этого случая', pendingAlternatives: 'Предложенные пользователями варианты', unverifiedAnswer: 'Ответ предложен пользователем и ещё не подтверждён', openInCommunity: 'Проверить в сообществе', reportCheckIssue: 'Предложить исправление условий или химического результата'
});
Object.assign(dictionaries.en, {
  community: 'Community', communitySubtitle: 'Community contributions, verified before publication.', communityOffline: 'The community server is unavailable. The calculator still uses its local database.', serverUnavailable: 'The community service is temporarily unavailable. Please try again later.', pollingFallback: 'Live updates disconnected; the feed will use periodic polling.',
  account: 'Account', login: 'Login', password: 'Password', confirmPassword: 'Confirm password', signIn: 'Sign in', signOut: 'Sign out', createAccount: 'Create account', register: 'Register', signedIn: 'Signed in', role: 'Privileges', registered: 'Registered', lastSession: 'Last sign-in', pendingMine: 'Pending proposals', userManagement: 'Users and roles', userManagementHelp: 'Only GOD assigns administrators. Passwords are never shown.', roleUpdated: 'User role updated',
  newProposal: 'New proposal', editProposal: 'Edit proposal', correctionProposal: 'Correct the answer', proposalFeed: 'Proposal feed', sort: 'Sort', byRating: 'By rating', byDate: 'Newest first', feedHelp: 'Votes help moderators find proposals. Only admin, admin+ or GOD can publish a rule.', moderation: 'Moderation', moderationHelp: 'Check the source, conditions and ion composition. Approval makes the rule active for users.', myProposals: 'My proposals', noProposals: 'No pending proposals.', noOwnProposals: 'You have no proposals yet.',
  kind_new: 'New rule', kind_correction: 'Correction', rating: 'Rating', source: 'Source', source_glinka: 'Glinka textbook', source_lidine: 'Lidin reference', source_textbook: 'Other textbook or article', source_lab: 'Laboratory work', source_personal: 'Personal opinion', sourceDetails: 'Exact source: page, section, link or experiment conditions', comment: 'Explanation and applicability', issues: 'What needs correction', issue_products: 'Reaction products', issue_conditions: 'Reaction conditions', issue_coefficients: 'Coefficients', issue_ionic: 'Ionic equation', issue_substance: 'Substance name or properties', issue_thermo: 'Thermodynamics', issue_code: 'Formula-processing error',
  originalAnswer: 'Current answer', reviewNote: 'Moderator note', publishedBy: 'Approved by', voteCorrect: 'Correct (+1)', voteIncorrect: 'Incorrect (−1)', edit: 'Edit', withdraw: 'Withdraw', moderate: 'Review and approve', reviewNotePlaceholder: 'Comment for the author and other moderators', approve: 'Approve and publish', needsEvidence: 'Request evidence', reject: 'Reject', proposalApproved: 'The rule is published and available in the calculator',
  status_pending: 'Pending', status_approved: 'Published', status_rejected: 'Rejected', status_needs_evidence: 'Evidence required', status_changes_requested: 'Changes requested', status_withdrawn: 'Withdrawn', proposalSubmitted: 'The proposal is available for community review',
  proposalValidationHelp: 'Provide the full equation and conditions. Atoms, charge and ion composition are checked before submission. Voting does not replace moderation.', outcome: 'Outcome under these conditions', reactionProducts: 'Reaction products', proposedEquation: 'Proposed equation or reactants only', reactionTypeLabel: 'Reaction type', communityRule: 'Community rule', phaseSpecific: 'This is a separate source-backed rule for a non-aqueous phase', phaseSpecificHelp: 'Do not transfer aqueous exchange mechanisms to organic solvents, melts or gases. A specific non-aqueous process needs an independent source and moderation.',
  newSubstances: 'New substance data', newSubstancesHelp: 'Fill in cards for substances outside the local database. List ions as Li^+:1, OH^-:1.', substanceName: 'Substance name', substanceClass: 'Substance class', solubility: 'Solubility', strongElectrolyte: 'Strong electrolyte', ionComposition: 'Ion composition: ion:coefficient', ionsFormat: 'Check the ions for {formula}: use Li^+:1, OH^-:1', ionicPreview: 'Ionic equation preview',
  atomsBalanced: '✓ Atoms and total charge are balanced.', atomsUnbalanced: 'Atoms or charge are unbalanced. Check the coefficients before submitting.', notMinimal: 'The coefficients are not minimal.', noReactionProposal: 'This proposes “No reaction” for the specified reactants and conditions.', invalidEquation: 'Enter a valid equation with both sides, or select “No reaction”.', fixBalanceBeforeSubmit: 'Correct the equation error first.', loginToPropose: 'Sign in or register to submit a proposal.', suggestSolution: 'Suggest the correct solution', reportInaccuracy: 'Found an inaccuracy? Suggest a correction', pendingAlternatives: 'Community alternatives', unverifiedAnswer: 'User-submitted answer, not yet verified', openInCommunity: 'Review in Community', reportCheckIssue: 'Suggest a correction to the conditions or chemical result'
});
Object.assign(dictionaries.ru, { gas: 'Газовая фаза', organic: 'Органический растворитель', submitProposal: 'Отправить заявку', saveChanges: 'Сохранить изменения' });
Object.assign(dictionaries.en, { gas: 'Gas phase', organic: 'Organic solvent', submitProposal: 'Submit proposal', saveChanges: 'Save changes' });
Object.assign(dictionaries.ru, {
  specialCase: 'Частный случай / программная неточность', specialCaseHelp: 'Отметьте, если нужно отправить расчёт на разбор несмотря на предупреждение баланса или ионного модуля. Это не разрешает публикацию несбалансированного правила. Admin+ и GOD могут отправлять такие предупреждения без флажка.', specialCaseBadge: 'Частный случай / возможная программная неточность — требуется особая проверка', issue_balance_engine: 'Возможная ошибка уравнивания программы',
  manualIonicTitle: 'Ручное редактирование ионных уравнений (необязательно)', manualIonicHelp: 'Можно оставить оба поля пустыми. Заполненные формы проверяются по атомам и заряду; при отмеченном частном случае допускается отправка на разбор, но не публикация с ошибкой.', manualFull: 'Полное ионное уравнение', manualNet: 'Краткое ионное уравнение', manualIonicUnbalanced: 'Ручная ионная форма не сбалансирована по атомам или заряду', manualIonicApproved: 'Показана ручная ионная форма, проверенная модератором.', reviewWarning: 'Предупреждение: заявка будет отправлена на разбор, но не может быть опубликована без исправления баланса.',
  ionsRequired: 'Для сильного растворимого электролита укажите ионы и их коэффициенты.', ionsOptional: 'Оставьте пустым для металла, газа, воды, осадка или слабого электролита.'
});
Object.assign(dictionaries.en, {
  specialCase: 'Special case / program inaccuracy', specialCaseHelp: 'Use this to submit a calculation for review despite balance or ionic warnings. An unbalanced rule cannot be published. Admin+ and GOD may submit such warnings without this flag.', specialCaseBadge: 'Special case / possible program inaccuracy — requires careful review', issue_balance_engine: 'Possible balancing-engine error',
  manualIonicTitle: 'Manual ionic equations (optional)', manualIonicHelp: 'Both fields may remain empty. Filled equations are checked for atoms and charge. A special-case proposal can be reviewed but not published with an invalid balance.', manualFull: 'Complete ionic equation', manualNet: 'Net ionic equation', manualIonicUnbalanced: 'The manual ionic form is not balanced for atoms or charge', manualIonicApproved: 'Showing the manual ionic form reviewed by a moderator.', reviewWarning: 'Warning: the proposal can be reviewed, but cannot be published until its balance is corrected.',
  ionsRequired: 'For a soluble strong electrolyte, specify its ions and coefficients.', ionsOptional: 'Leave empty for a metal, gas, water, precipitate or weak electrolyte.'
});
Object.assign(dictionaries.ru, { selfReviewBlocked: 'Admin и admin+ не могут утверждать собственные заявки. Нужен другой модератор.' });
Object.assign(dictionaries.en, { selfReviewBlocked: 'Admin and admin+ cannot approve their own proposals. Another moderator is required.' });
let locale = 'ru';
export function t(key, parameters = {}) {
  const template = dictionaries[locale][key] ?? dictionaries.ru[key] ?? key;
  return Object.entries(parameters).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, String(value)), template);
}
export function getLocale() {
  return locale;
}
export function setLocale(nextLocale) {
  locale = dictionaries[nextLocale] ? nextLocale : 'ru';
  document.documentElement.lang = locale;
  document.querySelectorAll('[data-i18n]').forEach((element) => {
    element.textContent = t(element.dataset.i18n);
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((element) => {
    element.placeholder = t(element.dataset.i18nPlaceholder);
  });
  document.querySelectorAll('[data-i18n-aria]').forEach((element) => {
    element.setAttribute('aria-label', t(element.dataset.i18nAria));
  });
  document.querySelectorAll('[data-doc-lang]').forEach((element) => {
    element.hidden = element.dataset.docLang !== locale;
  });
}
