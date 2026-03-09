/**
 * ICS (iCalendar) parser — no dependencies, works with Google Calendar,
 * Apple Calendar, Outlook, and any RFC 5545-compliant .ics file.
 */

const EVENT_COLORS = ['#2dd4bf', '#60a5fa', '#f472b6', '#a78bfa', '#fb923c', '#34d399', '#facc15'];

// ── Line unfolding (RFC 5545 §3.1) ───────────────────────────────────────────
function unfold(text) {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n[ \t]/g, '');   // continuation lines begin with a space/tab
}

// ── Property parser ───────────────────────────────────────────────────────────
// Returns { name, params: {key:value}, value }
function parseProp(line) {
  const colonIdx = line.indexOf(':');
  if (colonIdx === -1) return null;

  const head  = line.slice(0, colonIdx);
  const value = line.slice(colonIdx + 1);

  const parts  = head.split(';');
  const name   = parts[0].toUpperCase();
  const params = {};
  for (let i = 1; i < parts.length; i++) {
    const eq = parts[i].indexOf('=');
    if (eq !== -1) params[parts[i].slice(0, eq).toUpperCase()] = parts[i].slice(eq + 1);
  }
  return { name, params, value };
}

// ── Text value unescaping (RFC 5545 §3.3.11) ─────────────────────────────────
function unescape(s) {
  return (s || '')
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\');
}

// ── Date / datetime parsing ───────────────────────────────────────────────────
// Returns { date: 'YYYY-MM-DD', time: 'HH:MM' | '' }
function parseDateTime(value, params) {
  const v = value.trim();

  // Date-only (VALUE=DATE or 8-char string)
  if (params?.VALUE === 'DATE' || v.length === 8) {
    return { date: `${v.slice(0,4)}-${v.slice(4,6)}-${v.slice(6,8)}`, time: '' };
  }

  // Datetime: YYYYMMDDTHHMMSS[Z]
  const tIdx = v.indexOf('T');
  if (tIdx === -1) return { date: `${v.slice(0,4)}-${v.slice(4,6)}-${v.slice(6,8)}`, time: '' };

  const datePart = v.slice(0, tIdx);
  const timePart = v.slice(tIdx + 1).replace('Z', '');

  const date = `${datePart.slice(0,4)}-${datePart.slice(4,6)}-${datePart.slice(6,8)}`;
  const time = `${timePart.slice(0,2)}:${timePart.slice(2,4)}`;
  return { date, time };
}

// ── UID → stable extension ID ─────────────────────────────────────────────────
function uidToId(uid) {
  // Truncate + sanitize to keep IDs clean
  return 'ics-' + (uid || crypto.randomUUID()).replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 48);
}

// ── Map a raw VEVENT property map → extension event record ───────────────────
function mapEvent(raw) {
  const uid     = raw['UID']?.value || crypto.randomUUID();
  const summary = unescape(raw['SUMMARY']?.value || 'Untitled');
  const desc    = unescape(raw['DESCRIPTION']?.value || '');
  const loc     = unescape(raw['LOCATION']?.value || '');

  const dtstart = raw['DTSTART'];
  if (!dtstart) return null;

  const { date, time: startTime } = parseDateTime(dtstart.value, dtstart.params);
  if (!date) return null;

  let endTime = '';
  if (raw['DTEND']) {
    const end = parseDateTime(raw['DTEND'].value, raw['DTEND'].params);
    endTime = end.time || '';
  }

  // Treat as 'meeting' if there are attendees or a conference link
  const hasMeetingFields = !!(raw['ATTENDEE'] || raw['ORGANIZER'] ||
    raw['X-GOOGLE-CONFERENCE'] || raw['CONFERENCE']);
  const type = hasMeetingFields ? 'meeting' : 'event';

  // Status
  const icsStatus = (raw['STATUS']?.value || '').toLowerCase();
  const status = icsStatus === 'cancelled' ? 'cancelled'
               : icsStatus === 'tentative' ? 'tentative'
               : 'confirmed';

  // Pick a color from the palette (rotate by hash of UID)
  const colorIdx = uid.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0) % EVENT_COLORS.length;
  const color = EVENT_COLORS[colorIdx];

  return {
    id:          uidToId(uid),
    type,
    date,
    title:       summary,
    startTime,
    endTime,
    color,
    notes:       desc,       // description field
    location:    loc,
    status,
    recurrence:  raw['RRULE'] ? 'custom' : 'none',
    attendees:   [],
    noteId:      null,
    attachments: [],
    dashPinned:  false,
    createdAt:   Date.now(),
    updatedAt:   Date.now(),
  };
}

// ── Main parse function ───────────────────────────────────────────────────────
/**
 * parseICS(text) — parse raw .ics file text.
 * Returns an array of event objects ready to be stored in IndexedDB.
 */
export function parseICS(text) {
  const lines  = unfold(text).split('\n');
  const events = [];
  let current  = null;  // raw property map for current VEVENT
  let lastProp = null;  // track the last property name (for multi-value like ATTENDEE)

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (trimmed === 'BEGIN:VEVENT') {
      current  = {};
      lastProp = null;
      continue;
    }
    if (trimmed === 'END:VEVENT') {
      if (current) {
        const ev = mapEvent(current);
        if (ev) events.push(ev);
      }
      current  = null;
      lastProp = null;
      continue;
    }

    if (!current) continue;

    const prop = parseProp(trimmed);
    if (!prop) continue;

    // For duplicate keys (e.g. multiple ATTENDEE lines), keep the first
    // occurrence unless it's not set yet. ATTENDEE signals a meeting.
    if (prop.name === 'ATTENDEE') {
      current['ATTENDEE'] = current['ATTENDEE'] || prop;
    } else {
      current[prop.name] = prop;
    }
    lastProp = prop.name;
  }

  return events;
}
