export function toISODate(date) {
  return date.toISOString().slice(0, 10);
}

export function todayISO() {
  return toISODate(new Date());
}

export function parseISODate(str) {
  // Parse YYYY-MM-DD as local date (avoid UTC offset issues)
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function formatDate(date, opts = {}) {
  return date.toLocaleDateString(undefined, opts);
}

export function formatTime(date, format24 = false) {
  return date.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: !format24,
  });
}

export function formatMonthYear(year, month) {
  return new Date(year, month, 1).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  });
}

// Returns array of {date, iso} for a full calendar month grid (6 weeks)
export function getMonthGrid(year, month, weekStartsOn = 0) {
  const firstDay = new Date(year, month, 1);
  const lastDay  = new Date(year, month + 1, 0);

  let startOffset = firstDay.getDay() - weekStartsOn;
  if (startOffset < 0) startOffset += 7;

  const cells = [];
  const start = new Date(firstDay);
  start.setDate(start.getDate() - startOffset);

  for (let i = 0; i < 42; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    cells.push({
      date:       d,
      iso:        toISODate(d),
      isThisMonth: d.getMonth() === month,
      isToday:    toISODate(d) === todayISO(),
    });
  }
  return cells;
}

// Returns array of 7 dates for a week containing the given date
export function getWeekDates(date, weekStartsOn = 0) {
  const d = new Date(date);
  const day = d.getDay();
  let diff = day - weekStartsOn;
  if (diff < 0) diff += 7;
  d.setDate(d.getDate() - diff);
  return Array.from({ length: 7 }, (_, i) => {
    const wd = new Date(d);
    wd.setDate(d.getDate() + i);
    return wd;
  });
}

export function DAY_NAMES_SHORT(weekStartsOn = 0) {
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return [...names.slice(weekStartsOn), ...names.slice(0, weekStartsOn)];
}

export function friendlyDate(isoOrDate) {
  const d = typeof isoOrDate === 'string' ? parseISODate(isoOrDate) : isoOrDate;
  const today = new Date();
  const tomorrow = new Date(); tomorrow.setDate(today.getDate() + 1);
  const yesterday = new Date(); yesterday.setDate(today.getDate() - 1);

  if (toISODate(d) === toISODate(today))     return 'Today';
  if (toISODate(d) === toISODate(tomorrow))  return 'Tomorrow';
  if (toISODate(d) === toISODate(yesterday)) return 'Yesterday';
  return formatDate(d, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function daysUntil(isoDate) {
  const target = parseISODate(isoDate);
  const today  = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target - today) / 86400000);
}
