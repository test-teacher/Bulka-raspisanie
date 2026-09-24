/* =====================================================================
   «Расписание преподавателя» — логика приложения (app.js)

   Что здесь есть:
     1. Резервная копия данных (FALLBACK_CONFIG_TEXT) — используется, если
        config.json не удалось загрузить (например, страница открыта
        двойным щелчком, через file://).
     2. Загрузка config.json и exceptions.json.
     3. Четыре экрана: Сегодня, Завтра, Неделя, Настройки.
     4. Таймеры активного урока и перемен.
     5. Темы оформления: как в Telegram (или в системе), либо светлая/тёмная
        по выбору пользователя.
     6. Заметки к урокам: еженедельные и на конкретную дату, хранятся
        в localStorage устройства.

   Токенов бота, запросов к API бота и серверного кода здесь нет
   и быть не должно.
   ===================================================================== */

'use strict';

/* ---------- Константы ---------- */

const CONFIG_URL = 'config.json';
const EXCEPTIONS_URL = 'exceptions.json';
const STORAGE_KEY = 'paspisanie.settings.v1';
const NOTES_KEY = 'paspisanie.notes.v1';
const DEFAULT_TZ = 'Europe/Moscow';

const TAB_NAMES = ['today', 'tomorrow', 'week', 'settings'];

/* Режимы темы: 'auto' — как в Telegram (или в системе), либо жёстко светлая/тёмная */
const THEME_MODES = ['auto', 'light', 'dark'];

/* Максимальная длина заметки (совпадает с maxlength у поля ввода) */
const NOTE_MAX = 600;

/* Telegram WebApp SDK. Если страница открыта не в Telegram — будет null. */
const tg = (window.Telegram && window.Telegram.WebApp) ? window.Telegram.WebApp : null;

const themeMedia = window.matchMedia('(prefers-color-scheme: dark)');

/* ---------- Палитра ----------
   Используется, когда Telegram не сообщил themeParams (или страница
   открыта в обычном браузере). Значения совпадают с style.css. */

const PALETTE = {
  light: {
    '--bg': '#eef1f7',
    '--bg-secondary': '#ffffff',
    '--bg-elevated': '#ffffff',
    '--bg-sunken': '#e6eaf3',
    '--text': '#121722',
    '--text-soft': '#39414f',
    '--hint': '#6b7484',
    '--accent': '#3b82f6',
    '--accent-text': '#ffffff',
    '--border': 'rgba(18, 23, 34, 0.09)',
    '--border-strong': 'rgba(18, 23, 34, 0.16)',
    '--shadow': '0 6px 18px rgba(18, 23, 34, 0.08)',
    '--shadow-soft': '0 2px 8px rgba(18, 23, 34, 0.06)'
  },
  dark: {
    '--bg': '#0f1420',
    '--bg-secondary': '#18202e',
    '--bg-elevated': '#1c2534',
    '--bg-sunken': '#131b28',
    '--text': '#eef2f8',
    '--text-soft': '#cdd6e4',
    '--hint': '#96a2b6',
    '--accent': '#4f9cf9',
    '--accent-text': '#ffffff',
    '--border': 'rgba(255, 255, 255, 0.09)',
    '--border-strong': 'rgba(255, 255, 255, 0.18)',
    '--shadow': '0 8px 22px rgba(0, 0, 0, 0.38)',
    '--shadow-soft': '0 2px 10px rgba(0, 0, 0, 0.28)'
  }
};

/* ---------- Тема оформления ---------- */

/** Светлая или тёмная тема. По умолчанию — как в Telegram (или в системе). */
function currentScheme() {
  const mode = (state.settings && state.settings.theme) || 'auto';
  if (mode === 'light' || mode === 'dark') return mode;
  if (tg && tg.colorScheme) return tg.colorScheme === 'dark' ? 'dark' : 'light';
  return themeMedia.matches ? 'dark' : 'light';
}

/** Брать ли цвета из Telegram: только в режиме «как в Telegram».
    Если тема выбрана вручную, цвета Telegram игнорируются. */
function useTelegramColors() {
  const mode = (state.settings && state.settings.theme) || 'auto';
  if (mode !== 'auto') return false;
  return !!(tg && tg.themeParams && Object.keys(tg.themeParams).length);
}

const THEME_MODE_NAMES = {
  auto: 'как в Telegram (или в системе)',
  light: 'светлая, выбрана вручную',
  dark: 'тёмная, выбрана вручную'
};

/** '#rrggbb' → 'rgba(r, g, b, alpha)'. Нужно для рамок из темы Telegram. */
function hexToRgba(hex, alpha) {
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!match) return null;
  let value = match[1];
  if (value.length === 3) {
    value = value[0] + value[0] + value[1] + value[1] + value[2] + value[2];
  }
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return 'rgba(' + r + ', ' + g + ', ' + b + ', ' + alpha + ')';
}

function applyTheme() {
  const root = document.documentElement;
  const scheme = currentScheme();
  const base = PALETTE[scheme] || PALETTE.light;
  // Цвета Telegram берём только в режиме «как в Telegram».
  // Если тема выбрана вручную, themeParams пустые и палитра не перезаписывается.
  const themeParams = useTelegramColors() ? tg.themeParams : {};

  // 1. Базовая палитра (гарантирует читаемость даже без Telegram).
  Object.keys(base).forEach(function (name) {
    root.style.setProperty(name, base[name]);
  });

  // 2. Цвета темы Telegram — они важнее базовой палитры.
  const fromTelegram = {
    '--bg': themeParams.bg_color,
    '--bg-secondary': themeParams.secondary_bg_color || themeParams.bg_color,
    '--bg-elevated': themeParams.secondary_bg_color || themeParams.bg_color,
    '--bg-sunken': themeParams.header_bg_color || themeParams.secondary_bg_color || themeParams.bg_color,
    '--text': themeParams.text_color,
    '--text-soft': themeParams.text_color,
    '--hint': themeParams.hint_color,
    '--accent': themeParams.button_color || themeParams.link_color,
    '--accent-text': themeParams.button_text_color || '#ffffff'
  };
  Object.keys(fromTelegram).forEach(function (name) {
    if (fromTelegram[name]) root.style.setProperty(name, fromTelegram[name]);
  });

  const border = hexToRgba(themeParams.hint_color, scheme === 'dark' ? 0.22 : 0.18);
  if (border) root.style.setProperty('--border', border);

  root.setAttribute('data-theme', scheme);
  // Системные элементы (полосы прокрутки, курсор, автозаполнение) — под тему
  root.style.colorScheme = scheme;

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', themeParams.bg_color || base['--bg']);

  // 3. В Telegram просим подходящий цвет шапки и фона.
  if (tg) {
    if (typeof tg.setHeaderColor === 'function') {
      try { tg.setHeaderColor(themeParams.bg_color || base['--bg']); } catch (error) { /* старые версии */ }
    }
    if (typeof tg.setBackgroundColor === 'function') {
      try { tg.setBackgroundColor(themeParams.bg_color || base['--bg']); } catch (error) { /* старые версии */ }
    }
  }

  const schemeText = scheme === 'dark' ? 'Тёмная' : 'Светлая';
  const modeText = THEME_MODE_NAMES[(state.settings && state.settings.theme) || 'auto'] || THEME_MODE_NAMES.auto;
  setText('infoTheme', schemeText + ' — ' + modeText);
}

/* ---------- Мелкие утилиты ---------- */

function el(id) {
  return document.getElementById(id);
}

function setText(id, value) {
  const node = el(id);
  if (node) node.textContent = value;
}

/** Экранирование текста из config.json перед вставкой в HTML. */
function esc(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** '08:40' → 520 (минуты от полуночи). */
function parseTime(value) {
  if (!value) return null;
  const parts = String(value).trim().split(':');
  const hours = Number(parts[0]);
  const minutes = Number(parts[1]);
  if (isNaN(hours) || isNaN(minutes)) return null;
  return hours * 60 + minutes;
}

/** 70 → '1 ч 10 мин' */
function fmtDuration(totalMinutes) {
  const total = Math.max(0, Math.round(totalMinutes || 0));
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (hours > 0 && minutes > 0) return hours + ' ч ' + minutes + ' мин';
  if (hours > 0) return hours + ' ч';
  return minutes + ' мин';
}

function pad2(number) {
  return (number < 10 ? '0' : '') + number;
}

/* ---------- Чтение JSON с комментариями ----------
   В config.json и exceptions.json можно писать комментарии // // (строчные и блочные),
   а также оставлять «висячие» запятые. Ниже — простой разборщик, который
   это терпит, прежде чем отдать текст обычному JSON.parse. */

function stripJsonComments(text) {
  let result = '';
  let index = 0;
  let inString = false;
  let inLineComment = false;
  let inBlockComment = false;

  while (index < text.length) {
    const symbol = text[index];
    const next = text[index + 1];

    if (inLineComment) {
      if (symbol === '\n') {
        inLineComment = false;
        result += symbol;
      }
      index += 1;
      continue;
    }

    if (inBlockComment) {
      if (symbol === '*' && next === '/') {
        inBlockComment = false;
        index += 2;
        continue;
      }
      index += 1;
      continue;
    }

    if (inString) {
      result += symbol;
      if (symbol === '\\') {
        result += next === undefined ? '' : next;
        index += 2;
        continue;
      }
      if (symbol === '"') inString = false;
      index += 1;
      continue;
    }

    if (symbol === '"') {
      inString = true;
      result += symbol;
      index += 1;
      continue;
    }

    if (symbol === '/' && next === '/') {
      inLineComment = true;
      index += 2;
      continue;
    }

    if (symbol === '/' && next === '*') {
      inBlockComment = true;
      index += 2;
      continue;
    }

    result += symbol;
    index += 1;
  }

  return removeTrailingCommas(result);
}

function removeTrailingCommas(text) {
  let result = '';
  let inString = false;

  for (let index = 0; index < text.length; index += 1) {
    const symbol = text[index];

    if (inString) {
      result += symbol;
      if (symbol === '\\') {
        result += text[index + 1] === undefined ? '' : text[index + 1];
        index += 1;
        continue;
      }
      if (symbol === '"') inString = false;
      continue;
    }

    if (symbol === '"') {
      inString = true;
      result += symbol;
      continue;
    }

    if (symbol === ',') {
      let look = index + 1;
      while (look < text.length && /\s/.test(text[look])) look += 1;
      if (text[look] === '}' || text[look] === ']') continue; // запятая лишняя — выбрасываем
    }

    result += symbol;
  }

  return result;
}

function parseJsonc(text) {
  return JSON.parse(removeTrailingCommas(stripJsonComments(text)));
}

/* ---------- Резервная копия данных ----------
   Копия config.json и exceptions.json на случай, если файлы не удалось
   прочитать (страница открыта двойным щелчком через file://, нет сети
   и т. п.). На GitHub Pages всегда читаются настоящие config.json
   и exceptions.json, а эти данные не используются.

   ВАЖНО: если вы правите config.json, но смотрите приложение двойным
   щелчком по index.html — внесите те же правки и в блок ниже. */


const FALLBACK_CONFIG_TEXT = String.raw`
{
  "title": "Расписание преподавателя",
  "subtitle": "Русский язык и литература",
  "timezone": "Europe/Moscow",
  "calls": [
    { "n": 1, "start": "08:40", "end": "09:20" },
    { "n": 2, "start": "09:30", "end": "10:10" },
    { "n": 3, "start": "10:20", "end": "11:00" },
    { "n": 4, "start": "11:20", "end": "12:00" },
    { "n": 5, "start": "12:10", "end": "12:50" },
    { "n": 6, "start": "13:00", "end": "13:40" },
    { "n": 7, "start": "13:50", "end": "14:30" }
  ],
  "days": [
    { "key": "mon", "short": "Пн", "full": "Понедельник" },
    { "key": "tue", "short": "Вт", "full": "Вторник" },
    { "key": "wed", "short": "Ср", "full": "Среда" },
    { "key": "thu", "short": "Чт", "full": "Четверг" },
    { "key": "fri", "short": "Пт", "full": "Пятница", "dayOff": true },
    { "key": "sat", "short": "Сб", "full": "Суббота" },
    { "key": "sun", "short": "Вс", "full": "Воскресенье", "dayOff": true }
  ],
  "schedule": {
    "mon": {
      "2": { "class": "5Б", "subject": "Русский язык", "type": "lesson" },
      "3": { "class": "5Б", "subject": "Литература", "type": "lesson" },
      "4": { "class": "5А", "subject": "Русский язык", "type": "lesson" },
      "5": { "class": "9А", "subject": "Литература", "type": "lesson" },
      "6": { "class": "5А", "subject": "Литература", "type": "lesson" }
    },
    "tue": {
      "1": { "class": "5Б", "subject": "Русский язык", "type": "lesson" },
      "2": { "class": "5Б", "subject": "Русский язык", "type": "lesson" },
      "3": { "class": "5А", "subject": "Русский язык", "type": "lesson" },
      "4": { "class": "5А", "subject": "Русский язык", "type": "lesson" }
    },
    "wed": {
      "2": { "class": "9А", "subject": "Литература", "type": "lesson" },
      "3": { "class": "5Б", "subject": "Литература", "type": "lesson" },
      "4": { "class": "5А", "subject": "Литература", "type": "lesson" }
    },
    "thu": {
      "1": { "class": "5Б", "subject": "Русский язык", "type": "lesson" },
      "2": { "class": "5А", "subject": "Русский язык", "type": "lesson" },
      "4": { "class": "9А", "subject": "Литература", "type": "lesson" },
      "5": { "class": "5Б", "subject": "Литература", "type": "lesson" },
      "6": { "class": "5А", "subject": "Литература", "type": "lesson" }
    },
    "fri": {},
    "sat": {
      "1": { "class": "5Б", "subject": "Русский язык", "type": "lesson" },
      "2": { "class": "5А", "subject": "Русский язык", "type": "lesson" },
      "4": { "class": "5Б", "subject": "Внеурочка", "type": "extra" },
      "5": { "class": "5А", "subject": "Внеурочка", "type": "extra" }
    },
    "sun": {}
  },
  "tutoring": [
    { "name": "Артур", "day": "mon", "start": "18:00", "end": "19:00", "subject": "Русский язык" },
    { "name": "Артур", "day": "tue", "start": "18:00", "end": "19:00", "subject": "Математика" },
    { "name": "Артур", "day": "thu", "start": "18:00", "end": "19:00", "subject": "Математика" }
  ],
  "classColors": { "5А": "#3b82f6", "5Б": "#ef4444", "9А": "#10b981" },
  "typeColors": { "lesson": "#3b82f6", "extra": "#a855f7", "tutoring": "#f59e0b" },
  "typeNames": { "lesson": "Урок", "extra": "Внеурочка", "tutoring": "Репетиторство" },
  "texts": {
    "noLessons": "Сегодня занятий нет",
    "noLessonsTomorrow": "Занятий нет",
    "holiday": "Выходной / праздник",
    "dayOff": "Выходной",
    "break": "Перемена",
    "window": "Окно",
    "tutoring": "Репетиторство"
  }
}
`;


const FALLBACK_EXCEPTIONS_TEXT = String.raw`
[
  "2026-01-01",
  { "date": "2026-01-02", "title": "Новогодние каникулы" }
]
`;

/* ---------- Состояние приложения ---------- */

const state = {
  config: null,        // данные из config.json (или резервной копии)
  exceptions: [],      // нормализованный список исключений
  settings: {
    tutoring: true,    // показывать ли блок репетиторства
    tab: 'today',      // последняя открытая вкладка
    theme: 'auto'      // 'auto' — как в Telegram/системе, 'light' или 'dark'
  },
  notes: {},           // заметки к урокам: ключ → { text, updatedAt }
  source: '',          // откуда взяты данные (для экрана «Настройки»)
  updatedAt: null,     // когда данные были прочитаны
  configError: '',     // текст ошибки, если config.json сломан
  ready: false
};

/* ---------- Настройки в localStorage ---------- */

function loadSettings() {
  let saved = null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) saved = JSON.parse(raw);
  } catch (error) {
    saved = null; // приватный режим — просто работаем на значениях по умолчанию
  }
  if (!saved || typeof saved !== 'object') return;
  if (typeof saved.tutoring === 'boolean') state.settings.tutoring = saved.tutoring;
  if (TAB_NAMES.indexOf(saved.tab) >= 0) state.settings.tab = saved.tab;
  if (THEME_MODES.indexOf(saved.theme) >= 0) state.settings.theme = saved.theme;
}

/* ---------- Заметки к урокам (localStorage) ----------
   Ключ заметки:
     W|день|урок  — заметка на этот урок каждую неделю;
     D|дата|урок  — заметка только на конкретную дату.
   Слот урока — это подпись занятия: 'n2:5А' (номер урока и класс)
   или 't:18:00:Артур' (репетиторство). */

function loadNotes() {
  try {
    const raw = localStorage.getItem(NOTES_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    if (saved && typeof saved === 'object' && saved.items && typeof saved.items === 'object') {
      state.notes = saved.items;
    }
  } catch (error) {
    state.notes = {}; // испорченные заметки не должны ломать приложение
  }
}

function saveNotes() {
  try {
    localStorage.setItem(NOTES_KEY, JSON.stringify({ version: 1, items: state.notes }));
    return true;
  } catch (error) {
    toast('Не удалось сохранить заметку: нет места в памяти устройства');
    return false;
  }
}

/** Сколько заметок сохранено (для экрана «Настройки»). */
function notesCount() {
  return Object.keys(state.notes).filter(function (key) {
    const item = state.notes[key];
    return item && String(item.text || '').trim();
  }).length;
}

function noteKey(scope, day, slot, iso) {
  return scope === 'date' ? 'D|' + iso + '|' + slot : 'W|' + day + '|' + slot;
}

function noteText(scope, day, slot, iso) {
  if (scope === 'date' && !iso) return '';
  const item = state.notes[noteKey(scope, day, slot, iso)];
  return item && typeof item.text === 'string' ? item.text : '';
}

/** Что показать на карточке: сначала заметка на дату, потом еженедельная. */
function resolveNote(day, slot, iso) {
  if (!day || !slot) return { scope: 'week', text: '' };
  const dated = noteText('date', day, slot, iso);
  if (dated) return { scope: 'date', text: dated };
  const weekly = noteText('week', day, slot, iso);
  if (weekly) return { scope: 'week', text: weekly };
  return { scope: 'week', text: '' };
}

function setNote(scope, day, slot, iso, text) {
  if (!day || !slot) return false;
  if (scope === 'date' && !iso) return false;
  const key = noteKey(scope, day, slot, iso);
  const trimmed = String(text || '').slice(0, NOTE_MAX).trim();
  if (trimmed) {
    state.notes[key] = { text: trimmed, day: day, slot: slot, updatedAt: Date.now() };
  } else {
    delete state.notes[key];
  }
  return saveNotes();
}

function removeAllNotes() {
  state.notes = {};
  return saveNotes();
}

function saveSettings() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.settings));
  } catch (error) {
    /* не смогли сохранить — не критично */
  }
}

/* ---------- Загрузка данных ---------- */

function fetchText(url) {
  return fetch(url + '?v=' + Date.now(), { cache: 'no-store' }).then(function (response) {
    if (!response.ok) throw new Error('HTTP ' + response.status);
    return response.text();
  });
}

function normalizeExceptions(list) {
  if (!Array.isArray(list)) return [];
  return list.map(function (item) {
    if (typeof item === 'string') return { date: item.trim(), title: '' };
    if (item && typeof item === 'object' && item.date) {
      return { date: String(item.date).trim(), title: item.title ? String(item.title) : '' };
    }
    return null;
  }).filter(function (item) {
    return item && /^\d{4}-\d{2}-\d{2}$/.test(item.date);
  });
}

async function loadData() {
  const fromFile = location.protocol === 'file:';
  let configText = null;
  let exceptionsText = null;

  if (!fromFile) {
    try {
      configText = await fetchText(CONFIG_URL);
    } catch (error) {
      configText = null;
    }
    try {
      exceptionsText = await fetchText(EXCEPTIONS_URL);
    } catch (error) {
      exceptionsText = null;
    }
  }

  state.configError = '';

  if (configText) {
    state.source = 'config.json из репозитория';
  } else {
    configText = FALLBACK_CONFIG_TEXT;
    state.source = fromFile
      ? 'встроенные данные (страница открыта из файла)'
      : 'встроенные данные (config.json не прочитан)';
  }

  try {
    state.config = parseJsonc(configText);
  } catch (error) {
    // config.json сломан: показываем расписание из резервной копии
    // и предупреждаем об ошибке на экране «Настройки».
    state.config = parseJsonc(FALLBACK_CONFIG_TEXT);
    state.source = 'встроенные данные (ошибка в config.json)';
    state.configError = 'Не удалось разобрать config.json (' + error.message +
      '). Показана резервная копия — проверьте кавычки и запятые в файле.';
  }

  if (exceptionsText === null) exceptionsText = FALLBACK_EXCEPTIONS_TEXT;
  try {
    state.exceptions = normalizeExceptions(parseJsonc(exceptionsText));
  } catch (error) {
    state.exceptions = [];
    state.configError = (state.configError ? state.configError + ' ' : '') +
      'Не удалось разобрать exceptions.json (' + error.message + ').';
  }

  state.updatedAt = new Date();
  state.ready = true;
}

/* ---------- Время (всегда Europe/Moscow) ----------
   Часовой пояс зафиксирован: время берётся не «как на телефоне», а по
   Москве, поэтому расписание не поедет при смене часового пояса. */

const MONTHS_RU = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'
];

const WEEKDAY_BY_INDEX = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/** Текущие дата и время в часовом поясе расписания. */
function tzNow(date) {
  const timeZone = (state.config && state.config.timezone) || DEFAULT_TZ;
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  });

  const parts = {};
  formatter.formatToParts(date || new Date()).forEach(function (part) {
    parts[part.type] = part.value;
  });

  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  const dateISO = parts.year + '-' + parts.month + '-' + parts.day;

  return {
    dateISO: dateISO,
    weekday: weekdayKeyOfISO(dateISO),
    minutes: minutes,
    seconds: Number(parts.second),
    totalSeconds: minutes * 60 + Number(parts.second),
    clock: parts.hour + ':' + parts.minute
  };
}

/** '2026-09-24' + 1 → '2026-09-25' */
function addDaysISO(iso, delta) {
  const parts = iso.split('-').map(Number);
  const date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  date.setUTCDate(date.getUTCDate() + delta);
  return date.getUTCFullYear() + '-' + pad2(date.getUTCMonth() + 1) + '-' + pad2(date.getUTCDate());
}

/** '2026-09-24' → 'thu' */
function weekdayKeyOfISO(iso) {
  const parts = iso.split('-').map(Number);
  const date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], 12));
  return WEEKDAY_BY_INDEX[date.getUTCDay()];
}

/** '2026-09-24' → '24 сентября 2026, четверг' */
function fmtDateHuman(iso) {
  const parts = iso.split('-').map(Number);
  const weekdayKey = weekdayKeyOfISO(iso);
  const dayInfo = dayMeta(weekdayKey);
  const weekdayText = (dayInfo.full || '').toLowerCase();
  return parts[2] + ' ' + MONTHS_RU[parts[1] - 1] + ' ' + parts[0] +
    (weekdayText ? ', ' + weekdayText : '');
}

/** Дата и время, когда данные были прочитаны: '24.09.2026, 14:32' */
function fmtDateTime(date) {
  const now = tzNow(date);
  return now.dateISO.split('-').reverse().join('.') + ', ' + now.clock;
}

/* ---------- Доступ к данным расписания ---------- */

function callByNum(number) {
  const calls = (state.config && state.config.calls) || [];
  for (let index = 0; index < calls.length; index += 1) {
    if (Number(calls[index].n) === Number(number)) return calls[index];
  }
  return null;
}

function dayMeta(dayKey) {
  const days = (state.config && state.config.days) || [];
  for (let index = 0; index < days.length; index += 1) {
    if (days[index].key === dayKey) return days[index];
  }
  return { key: dayKey, short: dayKey, full: '' };
}

/** Подпись урока внутри дня — она же ключ заметки ('n2:5А'). */
function lessonSlot(number, cls) {
  return 'n' + number + ':' + (cls || '');
}

/** Подпись занятия репетитора — ключ заметки ('t:18:00:Артур'). */
function tutorSlot(start, name) {
  return 't:' + (start || '') + ':' + (name || '');
}

/** Уроки одного дня, отсортированные по времени начала. */
function dayLessons(dayKey) {
  const schedule = (state.config && state.config.schedule) || {};
  const day = schedule[dayKey] || {};
  const lessons = [];

  Object.keys(day).forEach(function (number) {
    const raw = day[number] || {};
    const call = callByNum(number);
    if (!call) return;
    lessons.push({
      n: Number(number),
      cls: raw.class || '',
      subject: raw.subject || '',
      type: raw.type || 'lesson',
      start: call.start,
      end: call.end,
      startMin: parseTime(call.start),
      endMin: parseTime(call.end),
      slot: lessonSlot(number, raw.class)
    });
  });

  lessons.sort(function (a, b) { return a.startMin - b.startMin; });
  return lessons;
}

/** Занятия репетитора в указанный день. */
function tutoringFor(dayKey) {
  const list = (state.config && state.config.tutoring) || [];
  return list.filter(function (item) {
    return item && item.day === dayKey;
  }).map(function (item) {
    return {
      n: null,
      name: item.name || '',
      cls: '',
      subject: item.subject || '',
      type: 'tutoring',
      start: item.start,
      end: item.end,
      startMin: parseTime(item.start),
      endMin: parseTime(item.end),
      slot: tutorSlot(item.start, item.name)
    };
  }).sort(function (a, b) { return a.startMin - b.startMin; });
}

function findException(iso) {
  return state.exceptions.filter(function (item) { return item.date === iso; })[0] || null;
}

/** Состояние занятия: 'active' — идёт, 'past' — прошло, 'future' — впереди. */
function lessonState(item, nowSeconds) {
  if (nowSeconds < 0) return 'future';
  if (nowSeconds >= item.endMin * 60) return 'past';
  if (nowSeconds >= item.startMin * 60) return 'active';
  return 'future';
}

function typeColor(type) {
  const colors = (state.config && state.config.typeColors) || {};
  return colors[type] || '#3b82f6';
}

function classColor(cls) {
  const colors = (state.config && state.config.classColors) || {};
  return colors[cls] || null;
}

function colorFor(item) {
  return classColor(item.cls) || typeColor(item.type);
}

function typeName(type) {
  const names = (state.config && state.config.typeNames) || {};
  return names[type] || type;
}

/** Тексты сообщений из config.json (ключ + запасной вариант). */
function textOf(key, fallback) {
  const texts = (state.config && state.config.texts) || {};
  const value = texts[key];
  return (typeof value === 'string' && value) ? value : fallback;
}

/* ---------- Отрисовка: общее ---------- */

function renderTabs() {
  TAB_NAMES.forEach(function (tab) {
    const screen = el('screen-' + tab);
    if (screen) screen.classList.toggle('screen--active', tab === state.settings.tab);
  });

  const buttons = document.querySelectorAll('.tabbar__btn');
  for (let index = 0; index < buttons.length; index += 1) {
    const button = buttons[index];
    const isActive = button.dataset.tab === state.settings.tab;
    button.classList.toggle('tabbar__btn--active', isActive);
    button.setAttribute('aria-current', isActive ? 'page' : 'false');
  }
}

function renderHeader() {
  setText('appTitle', state.config.title || 'Расписание преподавателя');
  setText('appSubtitle', state.config.subtitle || '');
}

function emptyCardHtml(icon, title, message) {
  return '<div class="empty-card">' +
    '<div class="empty-card__icon">' + icon + '</div>' +
    '<div class="empty-card__title">' + esc(title) + '</div>' +
    (message ? '<div class="empty-card__text">' + esc(message) + '</div>' : '') +
    '</div>';
}

/* ---------- Заметки к урокам: разметка ---------- */

/** Описание занятия для панели заметок: «2) 5А Русский язык, 09:30–10:10» */
function noteTitle(item) {
  const parts = [];
  if (item.n) parts.push(item.n + ')');
  if (item.cls) parts.push(item.cls);
  if (item.name) parts.push(item.name);
  if (item.subject) parts.push(item.subject);
  return parts.join(' ') + (item.start ? ', ' + item.start + '–' + item.end : '');
}

/** data-атрибуты, по которым открывается редактор заметки. */
function noteAttrs(item, context, note) {
  return ' data-note-day="' + esc(context.day || '') + '"' +
    ' data-note-slot="' + esc(item.slot || '') + '"' +
    ' data-note-date="' + esc(context.iso || '') + '"' +
    ' data-note-dated="' + (context.dated ? '1' : '0') + '"' +
    ' data-note-scope="' + esc(note.scope) + '"' +
    ' data-note-title="' + esc(noteTitle(item)) + '"';
}

/** Карандаш в углу карточки: добавить или изменить заметку. */
function noteButtonHtml(item, context, note) {
  const label = note.text ? 'Изменить заметку' : 'Добавить заметку';
  return '<button class="lesson-card__note-btn' + (note.text ? ' lesson-card__note-btn--filled' : '') +
    '" type="button" aria-label="' + label + '"' +
    noteAttrs(item, context, note) + '>✏️</button>';
}

/** Текст заметки в карточке — нажатие открывает редактор. */
function noteBlockHtml(item, context, note) {
  return '<button class="lesson-note" type="button"' + noteAttrs(item, context, note) + '>' +
    '<span class="lesson-note__icon" aria-hidden="true">📝</span>' +
    '<span class="lesson-note__text">' + esc(note.text) + '</span>' +
    '</button>';
}

/* ---------- Отрисовка: карточка занятия ---------- */

function lessonCardHtml(item, next, nowSeconds, kind, isNext, ctx) {
  const type = item.type || 'lesson';
  const status = lessonState(item, nowSeconds);
  const classes = ['lesson-card'];
  const context = ctx || {};
  const note = resolveNote(context.day, item.slot, context.iso);

  if (kind === 'tutoring') classes.push('lesson-card--tutor');
  if (status === 'active') classes.push('lesson-card--active');
  if (status === 'past') classes.push('lesson-card--past');

  const style = '--type-color:' + esc(typeColor(type));
  const numberHtml = item.n
    ? '<div class="lesson-card__num">' + item.n + '</div>'
    : '<div class="lesson-card__num lesson-card__num--wide">' + esc(item.name) + '</div>';

  let meta = '';
  if (item.cls) {
    meta += '<span class="chip chip--class" style="--class-color:' + esc(colorFor(item)) + '">' +
      esc(item.cls) + '</span>';
  }
  if (item.subject) {
    meta += '<span class="chip">' + esc(item.subject) + '</span>';
  }
  meta += '<span class="chip chip--type">' + esc(typeName(type)) + '</span>';
  if (status === 'active') {
    meta += '<span class="chip chip--now">' + esc(textOf('now', 'идёт сейчас')) + '</span>';
  }
  if (next) {
    const gap = next.startMin - item.endMin;
    if (gap > 0) {
      const label = gap > 25 ? textOf('window', 'Окно') : textOf('break', 'Перемена');
      meta += '<span class="chip chip--break">' + esc(label) + ' ' + fmtDuration(gap) + '</span>';
    }
  }

  let timer = '';
  if (status === 'active') {
    timer = '<div class="lesson-card__timer" data-countdown-to="' + item.endMin + '">до конца занятия</div>' +
      '<div class="progress"><div class="progress__bar" data-progress="' + item.startMin + ':' + item.endMin + '"></div></div>';
  } else if (isNext) {
    timer = '<div class="lesson-card__timer" data-countdown-from="' + item.startMin + '" data-start-text="' +
      esc(item.start) + '">начнётся в ' + esc(item.start) + '</div>';
  }

  return '<article class="' + classes.join(' ') + '" style="' + style + '">' +
    numberHtml +
    '<div class="lesson-card__body">' +
      '<div class="lesson-card__top">' +
        '<span class="lesson-card__subject">' + esc(item.subject || typeName(type)) + '</span>' +
        '<span class="lesson-card__time">' + esc(item.start) + ' – ' + esc(item.end) + '</span>' +
      '</div>' +
      (meta ? '<div class="lesson-card__meta">' + meta + '</div>' : '') +
      timer +
      (note.text ? noteBlockHtml(item, context, note) : '') +
    '</div>' +
    noteButtonHtml(item, context, note) +
    '</article>';
}

/* ---------- Отрисовка: «Сегодня» и «Завтра» ---------- */

function renderDay(which) {
  if (!state.ready) return;

  const now = tzNow();
  const isToday = which === 'today';
  const iso = isToday ? now.dateISO : addDaysISO(now.dateISO, 1);
  const dayKey = weekdayKeyOfISO(iso);
  const meta = dayMeta(dayKey);
  const body = el(which + 'Body');
  const badge = el(which + 'Badge');
  const nowSeconds = isToday ? now.totalSeconds : -1;
  /* Контекст заметок: день, дата и признак «можно заметку на конкретную дату» */
  const noteContext = { day: dayKey, iso: iso, dated: true };

  setText(which + 'Date', fmtDateHuman(iso));

  const exception = findException(iso);
  if (badge) {
    if (exception) {
      badge.hidden = false;
      badge.textContent = textOf('holiday', 'Выходной / праздник');
    } else if (meta.dayOff) {
      badge.hidden = false;
      badge.textContent = textOf('dayOff', 'Выходной');
    } else {
      badge.hidden = true;
      badge.textContent = '';
    }
  }

  if (!body) return;

  const lessons = dayLessons(dayKey);
  const tutors = state.settings.tutoring ? tutoringFor(dayKey) : [];
  let html = '';

  if (exception) {
    html += emptyCardHtml('🎉', textOf('holiday', 'Выходной / праздник'),
      exception.title || 'Занятий в этот день нет.');
  } else if (!lessons.length) {
    const title = isToday
      ? textOf('noLessons', 'Сегодня занятий нет')
      : textOf('noLessonsTomorrow', 'Занятий нет');
    html += emptyCardHtml('☕', title,
      meta.full ? meta.full + ' — уроков по расписанию нет.' : '');
  } else {
    const nextIndex = isToday
      ? lessons.map(function (lesson) {
          return lessonState(lesson, nowSeconds);
        }).indexOf('future')
      : -1;
    lessons.forEach(function (lesson, index) {
      html += lessonCardHtml(lesson, lessons[index + 1], nowSeconds, 'lesson', index === nextIndex, noteContext);
    });
  }

  if (tutors.length) {
    html += '<div class="section-title">' + esc(textOf('tutoring', 'Репетиторство')) + '</div>';
    tutors.forEach(function (tutor, index) {
      html += lessonCardHtml(tutor, tutors[index + 1], nowSeconds, 'tutoring', false, noteContext);
    });
  }

  body.innerHTML = html;
}

/* ---------- Отрисовка: «Неделя» ---------- */

/** Плитка недели — это кнопка: нажатие открывает заметку к этому уроку. */
function weekChipHtml(item, isToday, dayKey) {
  const type = item.type || 'lesson';
  const style = '--chip-class:' + esc(colorFor(item)) + ';--chip-type:' + esc(typeColor(type));
  /* В «Неделе» показывается постоянное расписание, поэтому доступна только
     еженедельная заметка: dated: false и пустая дата. */
  const context = { day: dayKey || '', iso: '', dated: false };
  const note = resolveNote(context.day, item.slot, '');
  const attrs = (context.day && item.slot) ? noteAttrs(item, context, note) : '';

  let pill = '';
  if (item.cls) {
    pill = '<span class="week-chip__class">' + esc(item.cls) + '</span>';
  } else if (item.name) {
    pill = '<span class="week-chip__class" style="background:var(--chip-type)">' + esc(item.name) + '</span>';
  }

  let inner = pill + '<span class="week-chip__subject">' + esc(item.subject || typeName(type)) + '</span>';
  if (item.start) {
    inner += '<span class="week-chip__time">' + esc(item.start) + '–' + esc(item.end) + '</span>';
  }
  if (note.text) {
    inner += '<span class="week-chip__note" title="Есть заметка">📝</span>';
  }

  return '<button class="week-chip' + (isToday ? ' week-chip--today' : '') + '" type="button"' +
    attrs + ' style="' + style + '">' + inner + '</button>';
}

function legendHtml() {
  const config = state.config || {};
  const items = [];

  Object.keys(config.classColors || {}).forEach(function (cls) {
    items.push('<span class="legend__item"><span class="legend__dot" style="--dot:' +
      esc(config.classColors[cls]) + '"></span>' + esc(cls) + '</span>');
  });

  Object.keys(config.typeNames || {}).forEach(function (type) {
    if (type === 'tutoring' && !state.settings.tutoring) return;
    items.push('<span class="legend__item"><span class="legend__dot" style="--dot:' +
      esc(typeColor(type)) + '"></span>' + esc(config.typeNames[type]) + '</span>');
  });

  return '<div class="legend">' + items.join('') + '</div>';
}

function renderWeek() {
  const body = el('weekBody');
  if (!body || !state.ready) return;

  const config = state.config;
  const days = config.days || [];
  const calls = config.calls || [];
  const todayKey = weekdayKeyOfISO(tzNow().dateISO);

  let head = '<tr><th class="week-corner">№</th>';
  days.forEach(function (day) {
    const classes = ['week-day-head'];
    if (day.dayOff) classes.push('week-day-head--off');
    if (day.key === todayKey) classes.push('week-day-head--today');

    let tag = '';
    if (day.key === todayKey) {
      tag = '<span class="week-day-head__tag">сегодня</span>';
    } else if (day.dayOff) {
      tag = '<span class="week-day-head__tag week-day-head__tag--off">выходной</span>';
    }

    head += '<th class="' + classes.join(' ') + '">' +
      '<span class="week-day-head__short">' + esc(day.short) + '</span>' +
      '<span class="week-day-head__full">' + esc(day.full) + '</span>' + tag + '</th>';
  });
  head += '</tr>';

  let rows = '';
  calls.forEach(function (call) {
    let cells = '';
    days.forEach(function (day) {
      const raw = ((config.schedule || {})[day.key] || {})[String(call.n)];
      if (!raw) {
        cells += '<td class="week-cell week-cell--empty">—</td>';
        return;
      }
      cells += '<td class="week-cell">' + weekChipHtml({
        n: call.n,
        cls: raw.class || '',
        subject: raw.subject || '',
        type: raw.type || 'lesson',
        start: call.start,
        end: call.end,
        slot: lessonSlot(call.n, raw.class)
      }, day.key === todayKey, day.key) + '</td>';
    });

    rows += '<tr><th class="week-time">' +
      '<span class="week-time__n">' + call.n + '</span>' +
      '<span class="week-time__t">' + esc(call.start) + '–' + esc(call.end) + '</span>' +
      '</th>' + cells + '</tr>';
  });

  // Отдельная строка репетиторства
  if (state.settings.tutoring && (config.tutoring || []).length) {
    let cells = '';
    days.forEach(function (day) {
      const list = tutoringFor(day.key);
      if (!list.length) {
        cells += '<td class="week-cell week-cell--empty">—</td>';
        return;
      }
      cells += '<td class="week-cell">' + list.map(function (item) {
        return weekChipHtml(item, day.key === todayKey, day.key);
      }).join('') + '</td>';
    });

    rows += '<tr><th class="week-time">' +
      '<span class="week-time__n">Реп.</span>' +
      '<span class="week-time__t">после уроков</span>' +
      '</th>' + cells + '</tr>';
  }

  body.innerHTML = '<div class="week-scroll"><table class="week-table">' +
    '<thead>' + head + '</thead><tbody>' + rows + '</tbody></table></div>' + legendHtml();
}

/* ---------- Отрисовка: «Настройки» ---------- */

/* «Удалить все заметки» срабатывает со второго нажатия — защита от случайного тапа */
let clearNotesArmed = false;

function themeButtonHtml(mode, label) {
  const active = (state.settings.theme || 'auto') === mode;
  return '<button class="segmented__btn' + (active ? ' segmented__btn--active' : '') +
    '" type="button" data-theme-mode="' + mode + '"' +
    (active ? ' aria-pressed="true"' : '') + '>' + label + '</button>';
}

/** Переключение темы: «Авто», «Светлая», «Тёмная». */
function setThemeMode(mode) {
  if (THEME_MODES.indexOf(mode) < 0 || state.settings.theme === mode) return;
  state.settings.theme = mode;
  saveSettings();
  applyTheme();
  renderAll();
  const names = {
    auto: 'Тема: как в Telegram (или в системе)',
    light: 'Включена светлая тема',
    dark: 'Включена тёмная тема'
  };
  toast(names[mode] || 'Тема изменена');
}

function renderSettings() {
  const body = el('settingsBody');
  if (!body || !state.ready) return;

  const timeZone = state.config.timezone || DEFAULT_TZ;
  const errorNote = state.configError
    ? '<p class="note note--error">⚠️ ' + esc(state.configError) + '</p>'
    : '';

  const notesTotal = notesCount();

  body.innerHTML =
    /* Тема оформления: авто (как в Telegram/системе) либо вручную */
    '<div class="settings-group">' +
      '<div class="settings-row settings-row--column">' +
        '<div class="settings-row__text">' +
          '<div class="settings-row__label">Тема оформления</div>' +
          '<div class="settings-row__hint">«Авто» — тема Telegram (в браузере — системная). ' +
            'Можно зафиксировать светлую или тёмную.</div>' +
        '</div>' +
        '<div class="segmented" id="themeSegment">' +
          themeButtonHtml('auto', 'Авто') +
          themeButtonHtml('light', 'Светлая') +
          themeButtonHtml('dark', 'Тёмная') +
        '</div>' +
      '</div>' +
    '</div>' +

    '<div class="settings-group">' +
      '<div class="settings-row">' +
        '<div class="settings-row__text">' +
          '<div class="settings-row__label">Показывать репетиторство</div>' +
          '<div class="settings-row__hint">Блок «Репетиторство» на экранах «Сегодня», «Завтра» и в «Неделе»</div>' +
        '</div>' +
        '<label class="switch" for="settingTutoring">' +
          '<input type="checkbox" id="settingTutoring" class="switch__input"' +
            (state.settings.tutoring ? ' checked' : '') + ' />' +
          '<span class="switch__track"><span class="switch__thumb"></span></span>' +
        '</label>' +
      '</div>' +
    '</div>' +

    /* Заметки к урокам */
    '<div class="settings-group">' +
      '<div class="settings-row">' +
        '<div class="settings-row__text">' +
          '<div class="settings-row__label">Заметки к урокам</div>' +
          '<div class="settings-row__hint">Хранятся только в этом устройстве. ' +
            'Нажмите карандаш на карточке урока, чтобы написать заметку.</div>' +
        '</div>' +
        '<div class="settings-row__value">' + notesTotal + '</div>' +
      '</div>' +
      '<div class="settings-row">' +
        '<button class="btn btn--danger btn--small" id="btnClearNotes" type="button"' +
          (notesTotal ? '' : ' disabled') + '>' +
          (clearNotesArmed ? 'Нажмите ещё раз — удалить все' : 'Удалить все заметки') +
        '</button>' +
      '</div>' +
    '</div>' +

    '<button class="btn btn--primary" id="btnRefresh" type="button">Обновить данные</button>' +

    '<div class="settings-group">' +
      '<dl class="info-list">' +
        '<div class="info-list__row"><dt>Часовой пояс</dt><dd>' + esc(timeZone) + ' (МСК)</dd></div>' +
        '<div class="info-list__row"><dt>Источник данных</dt><dd>' + esc(state.source || '—') + '</dd></div>' +
        '<div class="info-list__row"><dt>Данные обновлены</dt><dd>' +
          esc(state.updatedAt ? fmtDateTime(state.updatedAt) : '—') + '</dd></div>' +
        '<div class="info-list__row"><dt>Исключений в файле</dt><dd>' +
          state.exceptions.length + '</dd></div>' +
        '<div class="info-list__row"><dt>Тема оформления</dt><dd id="infoTheme">—</dd></div>' +
      '</dl>' +
    '</div>' +

    errorNote +

    '<p class="note">Расписание меняется в файлах <b>config.json</b> и <b>exceptions.json</b> ' +
    'в репозитории. После правки файлов нажмите «Обновить данные». Часовой пояс зафиксирован: ' +
    esc(timeZone) + '.</p>';

  const toggle = el('settingTutoring');
  if (toggle) {
    toggle.addEventListener('change', function () {
      state.settings.tutoring = !!toggle.checked;
      saveSettings();
      renderAll();
      toast(state.settings.tutoring ? 'Репетиторство показывается' : 'Репетиторство скрыто');
    });
  }

  const themeSegment = el('themeSegment');
  if (themeSegment) {
    themeSegment.addEventListener('click', function (event) {
      const button = event.target && event.target.closest ? event.target.closest('[data-theme-mode]') : null;
      if (button) setThemeMode(button.dataset.themeMode);
    });
  }

  const clearNotes = el('btnClearNotes');
  if (clearNotes) {
    clearNotes.addEventListener('click', function () {
      if (!clearNotesArmed) {
        clearNotesArmed = true;
        renderSettings();
        toast('Нажмите кнопку ещё раз, чтобы удалить все заметки');
        return;
      }
      clearNotesArmed = false;
      removeAllNotes();
      renderAll();
      toast('Все заметки удалены');
    });
  }

  const refresh = el('btnRefresh');
  if (refresh) {
    refresh.addEventListener('click', async function () {
      refresh.disabled = true;
      refresh.textContent = 'Обновляем…';
      try {
        await loadData();
        renderAll();
        toast('Данные обновлены: ' + fmtDateTime(state.updatedAt));
      } catch (error) {
        toast('Не удалось обновить данные');
      } finally {
        refresh.disabled = false;
        refresh.textContent = 'Обновить данные';
      }
    });
  }
}

/* ---------- Редактор заметки (нижняя панель) ---------- */

/* Что редактируем прямо сейчас: день, слот урока, дата и выбранный охват */
let noteEditor = null;

function openNoteEditor(dataset) {
  if (!dataset || !dataset.noteDay || !dataset.noteSlot || !state.ready) return;

  const dated = dataset.noteDated === '1';
  noteEditor = {
    day: dataset.noteDay,
    slot: dataset.noteSlot,
    iso: dataset.noteDate || '',
    dated: dated,
    scope: (dataset.noteScope === 'date' && dated) ? 'date' : 'week'
  };

  setText('noteSheetSubtitle', dataset.noteTitle || '');
  setText('noteScopeDate', noteEditor.iso ? fmtDateHuman(noteEditor.iso).split(',')[0] : 'дату');

  const scopeField = el('noteScopeField');
  if (scopeField) scopeField.hidden = !dated;

  const textarea = el('noteText');
  if (textarea) {
    textarea.value = noteText(noteEditor.scope, noteEditor.day, noteEditor.slot, noteEditor.iso);
  }

  updateNoteEditorUi();

  const backdrop = el('sheetBackdrop');
  const sheet = el('noteSheet');
  if (backdrop) backdrop.hidden = false;
  if (sheet) sheet.hidden = false;
  document.body.classList.add('sheet-open');

  /* Автофокус — с небольшой задержкой, чтобы iOS успел отрисовать панель
     и клавиатура встала на своё место */
  if (textarea) {
    setTimeout(function () {
      try { textarea.focus(); } catch (error) { /* iOS может отказать — не критично */ }
    }, 80);
  }
}

function closeNoteEditor() {
  noteEditor = null;
  const backdrop = el('sheetBackdrop');
  const sheet = el('noteSheet');
  if (backdrop) backdrop.hidden = true;
  if (sheet) sheet.hidden = true;
  document.body.classList.remove('sheet-open');
  const textarea = el('noteText');
  if (textarea) textarea.value = '';
}

/** Подсветка выбранного охвата, подсказка, кнопка «Удалить», счётчик символов. */
function updateNoteEditorUi() {
  if (!noteEditor) return;

  const buttons = document.querySelectorAll('[data-note-scope-btn]');
  for (let index = 0; index < buttons.length; index += 1) {
    const button = buttons[index];
    button.classList.toggle('segmented__btn--active', button.dataset.noteScopeBtn === noteEditor.scope);
  }

  const hint = el('noteScopeHint');
  if (hint) {
    hint.textContent = noteEditor.scope === 'date'
      ? 'Заметка появится только ' + fmtDateHuman(noteEditor.iso) + '.'
      : 'Заметка будет у этого урока каждую неделю.';
  }

  const del = el('noteDelete');
  if (del) {
    del.hidden = !noteText(noteEditor.scope, noteEditor.day, noteEditor.slot, noteEditor.iso);
  }

  updateNoteCounter();
}

function updateNoteCounter() {
  const textarea = el('noteText');
  const counter = el('noteCounter');
  if (counter) counter.textContent = String(textarea ? textarea.value.length : 0);
}

function switchNoteScope(scope) {
  if (!noteEditor || scope === noteEditor.scope) return;
  if (scope === 'date' && (!noteEditor.dated || !noteEditor.iso)) return;
  noteEditor.scope = scope;
  const textarea = el('noteText');
  if (textarea) textarea.value = noteText(scope, noteEditor.day, noteEditor.slot, noteEditor.iso);
  updateNoteEditorUi();
}

function saveNoteFromEditor() {
  if (!noteEditor) return;
  const textarea = el('noteText');
  const text = textarea ? textarea.value.trim() : '';
  const saved = setNote(noteEditor.scope, noteEditor.day, noteEditor.slot, noteEditor.iso, text);
  closeNoteEditor();
  if (!saved) return; // сообщение об ошибке уже показано в saveNotes()
  renderAll();
  toast(text ? 'Заметка сохранена' : 'Заметка удалена');
}

function deleteNoteFromEditor() {
  if (!noteEditor) return;
  setNote(noteEditor.scope, noteEditor.day, noteEditor.slot, noteEditor.iso, '');
  closeNoteEditor();
  renderAll();
  toast('Заметка удалена');
}

/* ---------- Полная перерисовка ---------- */

function renderAll() {
  if (!state.ready) return;
  renderTabs();
  renderHeader();
  renderDay('today');
  renderDay('tomorrow');
  renderWeek();
  renderSettings();
  applyTheme();
  lastSignature = stateSignature();
  updateCounters();
}

/* ---------- Таймеры и «живое» обновление ---------- */

let lastSignature = '';

/** Отпечаток состояния: меняется, когда начинается/заканчивается занятие,
    меняются сутки или переключатель репетиторства. */
function stateSignature() {
  const now = tzNow();
  const parts = [now.dateISO, state.settings.tutoring ? 'tutoring-on' : 'tutoring-off'];

  ['today', 'tomorrow'].forEach(function (which) {
    const isToday = which === 'today';
    const iso = isToday ? now.dateISO : addDaysISO(now.dateISO, 1);
    const dayKey = weekdayKeyOfISO(iso);
    const nowSeconds = isToday ? now.totalSeconds : -1;

    const lessons = dayLessons(dayKey).map(function (item) {
      return item.n + ':' + lessonState(item, nowSeconds);
    }).join(',');

    const tutors = (state.settings.tutoring ? tutoringFor(dayKey) : []).map(function (item) {
      return item.start + ':' + lessonState(item, nowSeconds);
    }).join(',');

    parts.push(iso + '|' + (findException(iso) ? 'exception' : 'working') + '|' + lessons + '|' + tutors);
  });

  return parts.join('#');
}

/** Обновляет часы, обратный отсчёт и полоску прогресса. */
function updateCounters() {
  if (!state.ready) return;
  const now = tzNow();
  setText('appClock', now.clock);

  document.querySelectorAll('[data-countdown-to]').forEach(function (node) {
    const left = Number(node.dataset.countdownTo) * 60 - now.totalSeconds;
    node.textContent = left > 0
      ? 'до конца ' + fmtDuration(Math.ceil(left / 60))
      : 'занятие заканчивается';
  });

  document.querySelectorAll('[data-countdown-from]').forEach(function (node) {
    const left = Number(node.dataset.countdownFrom) * 60 - now.totalSeconds;
    const startText = node.dataset.startText || '';
    node.textContent = left > 0
      ? 'начнётся в ' + startText + ' · через ' + fmtDuration(Math.ceil(left / 60))
      : 'начинается сейчас';
  });

  document.querySelectorAll('[data-progress]').forEach(function (node) {
    const parts = String(node.dataset.progress).split(':');
    const start = Number(parts[0]) * 60;
    const end = Number(parts[1]) * 60;
    const span = Math.max(1, end - start);
    const percent = Math.max(0, Math.min(100, ((now.totalSeconds - start) / span) * 100));
    node.style.width = percent.toFixed(1) + '%';
  });
}

/** Вызывается каждую секунду. */
function tick() {
  if (!state.ready) return;
  updateCounters();

  const signature = stateSignature();
  if (signature === lastSignature) return;
  lastSignature = signature;

  const weekScroll = document.querySelector('.week-scroll');
  const weekScrollLeft = weekScroll ? weekScroll.scrollLeft : 0;

  renderDay('today');
  renderDay('tomorrow');
  renderWeek();
  renderSettings();

  const newWeekScroll = document.querySelector('.week-scroll');
  if (newWeekScroll) newWeekScroll.scrollLeft = weekScrollLeft;

  updateCounters();
}

/* ---------- Всплывающее сообщение ---------- */

let toastTimer = null;

function toast(message) {
  const node = el('toast');
  if (!node) return;
  node.textContent = message;
  node.classList.add('toast--visible');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(function () {
    node.classList.remove('toast--visible');
  }, 2600);
}

/* ---------- Переключение разделов ---------- */

function switchTab(tab) {
  if (TAB_NAMES.indexOf(tab) < 0) return;
  if (tab !== state.settings.tab) {
    state.settings.tab = tab;
    saveSettings();
    renderTabs();
  }
  /* Уходя с «Настроек», снимаем «взведённую» кнопку удаления заметок,
     чтобы она не сработала от случайного нажатия потом */
  if (tab !== 'settings' && clearNotesArmed) {
    clearNotesArmed = false;
    renderSettings();
  }
  window.scrollTo(0, 0);
  updateCounters();
}

/* ---------- Telegram WebApp ----------
   Только тема и раскрытие на весь экран. Никаких запросов к API бота. */

function initTelegram() {
  if (!tg) return;

  if (typeof tg.ready === 'function') {
    try { tg.ready(); } catch (error) { /* не критично */ }
  }
  if (typeof tg.expand === 'function') {
    try { tg.expand(); } catch (error) { /* не критично */ }
  }
  if (typeof tg.disableVerticalSwipes === 'function') {
    try { tg.disableVerticalSwipes(); } catch (error) { /* не критично */ }
  }
  if (typeof tg.onEvent === 'function') {
    tg.onEvent('themeChanged', function () {
      applyTheme();
      renderAll();
    });
  }
}

/* ---------- Обработчики событий ---------- */

function bindEvents() {
  const tabbar = el('tabbar');
  if (tabbar) {
    tabbar.addEventListener('click', function (event) {
      const button = event.target && event.target.closest ? event.target.closest('.tabbar__btn') : null;
      if (!button) return;
      switchTab(button.dataset.tab);
    });
  }

  /* Заметки: нажатие на карандаш в карточке или на текст заметки.
     Слушатель один на всю страницу — карточки и плитки перерисовываются. */
  document.addEventListener('click', function (event) {
    const trigger = event.target && event.target.closest ? event.target.closest('[data-note-slot]') : null;
    if (!trigger) return;
    event.preventDefault();
    openNoteEditor(trigger.dataset);
  });

  /* Панель заметок: выбор охвата, сохранение, удаление, отмена */
  const sheet = el('noteSheet');
  if (sheet) {
    sheet.addEventListener('click', function (event) {
      const scopeButton = event.target && event.target.closest ? event.target.closest('[data-note-scope-btn]') : null;
      if (scopeButton) switchNoteScope(scopeButton.dataset.noteScopeBtn);
    });
  }

  const saveNoteButton = el('noteSave');
  if (saveNoteButton) saveNoteButton.addEventListener('click', saveNoteFromEditor);

  const deleteNoteButton = el('noteDelete');
  if (deleteNoteButton) deleteNoteButton.addEventListener('click', deleteNoteFromEditor);

  const cancelNoteButton = el('noteCancel');
  if (cancelNoteButton) cancelNoteButton.addEventListener('click', closeNoteEditor);

  const backdrop = el('sheetBackdrop');
  if (backdrop) backdrop.addEventListener('click', closeNoteEditor);

  const noteTextarea = el('noteText');
  if (noteTextarea) noteTextarea.addEventListener('input', updateNoteCounter);

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && noteEditor) closeNoteEditor();
  });

  /* Потянуть панель за «язычок» вниз — закрыть (привычный жест в iOS) */
  const sheetHandle = el('sheetHandle');
  if (sheetHandle) {
    let touchStartY = null;
    sheetHandle.addEventListener('touchstart', function (event) {
      touchStartY = event.touches && event.touches[0] ? event.touches[0].clientY : null;
    }, { passive: true });
    sheetHandle.addEventListener('touchmove', function (event) {
      if (touchStartY === null) return;
      const currentY = event.touches && event.touches[0] ? event.touches[0].clientY : null;
      if (currentY !== null && currentY - touchStartY > 70) {
        touchStartY = null;
        closeNoteEditor();
      }
    }, { passive: true });
  }

  // Смена системной темы (когда приложение открыто не в Telegram)
  themeMedia.addEventListener('change', function () {
    applyTheme();
    renderAll();
  });

  // Вернулись во вкладку — сразу пересчитываем время
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) updateCounters();
  });
}

/* ---------- Запуск ---------- */

async function init() {
  initTelegram();
  loadSettings();
  loadNotes();
  applyTheme();
  bindEvents();
  renderTabs();

  try {
    await loadData();
  } catch (error) {
    const body = el('todayBody');
    if (body) {
      body.innerHTML = emptyCardHtml('⚠️', 'Не удалось загрузить данные',
        String(error && error.message ? error.message : error));
    }
    return;
  }

  renderAll();
  setInterval(tick, 1000);
  tick();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
