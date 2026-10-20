// Today's meetings (timed ones, on your own calendar) for the top bar and Home, read from Google Calendar's day view
// in a hidden window that shares the Mail tab's Google sign-in (persist:mail). Nothing to set up.
const { BrowserWindow } = require('electron');

const KEEP_MS = 5 * 60e3;
let cache = { at: 0, events: [], error: null };
let loading = null;

// Runs inside calendar.google.com: every event on the day view, as Google's own screen-reader line,
// e.g. "8:30am to 9:30am, University of Regina meeting, Dakotah K, Accepted, No location, October 20, 2026".
async function pageReadDay() {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 60; i++) {
    if (location.hostname !== 'calendar.google.com') return { error: 'signed-out' };
    if (document.querySelector('[data-eventid]') || document.querySelector('[data-datekey]')) break;
    await sleep(250);
  }
  await sleep(1200); // let the rest of the day's chips draw
  // Whose calendar this is: the Google account button reads "Google Account: Name (you@example.com)".
  const account = ([...document.querySelectorAll('[aria-label*="@"]')].map((e) => e.getAttribute('aria-label')).find((l) => /google account/i.test(l)) || '')
    .match(/[\w.+-]+@[\w-]+(\.[\w-]+)+/)?.[0]?.toLowerCase() || null;
  // The time zone Google shows times in: its own setting, which can differ from the computer's (travelling, say).
  // The day view prints it over the hours, "GMT-07". With a second time zone there are two; the one next to the grid (the last) is the main one.
  const zone = [...document.querySelectorAll('div, span')].filter((e) => !e.children.length)
    .map((e) => e.textContent.trim()).filter((t) => /^(GMT|UTC)([+\-−]\d{1,2}(:?\d{2})?)?$/.test(t)).pop() || null;
  // An event id is base64 of "<event> <calendar>", so each event says which calendar it's on.
  const calOf = (id) => { try { return atob(id.replace(/-/g, '+').replace(/_/g, '/')).split(' ')[1]?.toLowerCase() || null; } catch { return null; } };
  const seen = new Set(), out = [];
  for (const el of document.querySelectorAll('[data-eventid]')) {
    const id = el.dataset.eventid;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const texts = [...el.querySelectorAll('div, span')].map((d) => d.textContent.replace(/\s+/g, ' ').trim());
    const label = texts.find((t) => /,/.test(t) && /\b(to|all day)\b/i.test(t)) || el.getAttribute('aria-label') || '';
    out.push({ id, cal: calOf(id), label, lines: el.innerText.split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 3) });
  }
  return { account, zone, events: out };
}

// "GMT-07" → -420, "GMT+05:30" → 330, "GMT" → 0; null if there's no label (then times are taken as the computer's own).
function zoneOffset(label) {
  const m = /^(?:GMT|UTC)(?:([+\-−])(\d{1,2}):?(\d{2})?)?$/.exec(label || '');
  if (!m) return null;
  return m[1] ? (m[1] === '+' ? 1 : -1) * (+m[2] * 60 + (+m[3] || 0)) : 0;
}

// Only the signed-in person's own calendar (not coworkers', shared or holiday calendars).
// Gmail addresses are shortened to "name@m" in event ids. If no event matches, nothing is filtered, so a change on Google's side shows too much rather than nothing.
function ownOnly(raw, account) {
  if (!account) return raw;
  const mine = (c) => c === account || c === account.replace(/@gmail\.com$/, '@m');
  return raw.some((e) => mine(e.cal)) ? raw.filter((e) => !e.cal || mine(e.cal)) : raw;
}

// "8:30am", "8:30", "13:00", "9pm" → minutes after midnight. ampm is the fallback for "8:30 to 9:30am".
function minutes(h, m, ampm) {
  let hh = +h % 12;
  if (!ampm) hh = +h; // 24-hour clock
  else if (/p/i.test(ampm)) hh += 12;
  return hh * 60 + (+m || 0);
}

// One screen-reader line → { title, start, end, allDay } for that day, or null for declined or unreadable events.
// offset: minutes from UTC of the time zone Google showed the times in (see zoneOffset).
function parse(raw, day, offset = null) {
  const label = raw.label.replace(/\s+/g, ' ').trim();
  if (!label || /,\s*Declined\b/i.test(label)) return null;
  const at = (min) => (offset == null
    ? new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, min).getTime()
    : Date.UTC(day.getFullYear(), day.getMonth(), day.getDate(), 0, min) - offset * 60e3);
  const allDay = /^all day\b/i.exec(label);
  const time = /^(\d{1,2})(?::(\d{2}))?\s*([ap]\.?m\.?)?\s*(?:to|–|-)\s*(\d{1,2})(?::(\d{2}))?\s*([ap]\.?m\.?)?/i.exec(label);
  if (!allDay && !time) return null;
  const rest = label.slice((allDay || time)[0].length).replace(/^,\s*/, '');
  const title = (rest.split(', ')[0] || raw.lines[0] || 'Busy').replace(/,\s*$/, '').trim();
  if (allDay) return { title, start: at(0), end: at(24 * 60), allDay: true };
  const [, h1, m1, ap1, h2, m2, ap2] = time;
  let s = minutes(h1, m1, ap1 || ap2);
  const e = minutes(h2, m2, ap2 || ap1);
  if (!ap1 && ap2 && s > e) s -= 12 * 60; // "11 to 1pm" starts at 11am
  return { title, start: at(s), end: at(e > s ? e : e + 24 * 60), allDay: false };
}

async function readDay(day) {
  const w = new BrowserWindow({ show: false, width: 1300, height: 1000, webPreferences: { partition: 'persist:mail', backgroundThrottling: false } });
  w.webContents.setAudioMuted(true);
  try {
    await w.loadURL(`https://calendar.google.com/calendar/u/0/r/day/${day.getFullYear()}/${day.getMonth() + 1}/${day.getDate()}`);
    const r = await w.webContents.executeJavaScript(`(${pageReadDay})()`, true);
    if (r.error) return r;
    // Discrete meetings only: no all-day events.
    const offset = zoneOffset(r.zone);
    return { events: ownOnly(r.events, r.account).map((e) => parse(e, day, offset)).filter((e) => e && !e.allDay) };
  } finally {
    w.destroy();
  }
}

// Today's, sorted, cached for a few minutes.
async function events(force) {
  if (!force && Date.now() - cache.at < KEEP_MS) return cache;
  if (loading) return loading;
  loading = (async () => {
    try {
      const a = await readDay(new Date());
      if (a.error) cache = { at: Date.now(), events: [], error: a.error };
      else cache = { at: Date.now(), events: a.events.sort((x, y) => x.start - y.start), error: null };
    } catch (e) {
      cache = { ...cache, at: Date.now(), error: e.message };
    }
    return cache;
  })().finally(() => { loading = null; });
  return loading;
}

module.exports = { events, parse, zoneOffset };
