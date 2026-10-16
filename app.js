'use strict';
// Madeira-Reiseplaner – Offline-PWA. Daten: data.js, Zustand: localStorage, Fotos: IndexedDB.

const LS_STATE = 'madeira26-state-v1';
const LS_WX = 'madeira26-weather-v1';
const LS_IMG = 'madeira26-img-v1';
const WD = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const TYPE_ICON = { hike: '🥾', sight: '📍', relax: '🌴', food: '🍽️', event: '🎉', travel: '✈️' };
const TYPE_NAME = { hike: 'Wandern', sight: 'Sehenswert', relax: 'Entspannung', food: 'Essen', event: 'Termin', travel: 'Reise' };
const A = Object.fromEntries(ACTIVITIES.map(a => [a.id, a]));

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const toMin = hm => { const [h, m] = String(hm || '08:30').split(':').map(Number); return h * 60 + (m || 0); };
const fmt = m => `${pad(Math.floor(((m % 1440) + 1440) % 1440 / 60))}:${pad(Math.round(m) % 60)}`;
const ymd = dt => `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
const parseD = d => new Date(d + 'T12:00:00');
const addDays = (d, n) => { const x = parseD(d); x.setDate(x.getDate() + n); return ymd(x); };
const dLabel = d => { const x = parseD(d); return `${WD[x.getDay()]} ${pad(x.getDate())}.${pad(x.getMonth() + 1)}.`; };
const clone = o => JSON.parse(JSON.stringify(o));

function tripDates() {
  const out = []; for (let d = TRIP.start; d <= TRIP.end; d = addDays(d, 1)) out.push(d); return out;
}

// ---------- Zustand ----------
function defaultState() {
  return { days: clone(DEFAULT_PLAN), done: {}, notes: {}, komoot: {}, custom: [], check: {},
    demo: false, demoSeed: 1, simDate: '', simTime: '', tab: 'today', sel: '', planMode: 'day', poolFilter: 'all' };
}
function loadState() {
  let s; try { s = JSON.parse(localStorage.getItem(LS_STATE)); } catch { s = null; }
  s = Object.assign(defaultState(), s || {});
  for (const d of tripDates()) if (!s.days[d]) s.days[d] = clone(DEFAULT_PLAN[d] || { start: '08:30', fixed: [], program: [] });
  return s;
}
let S = loadState();
function save() { try { localStorage.setItem(LS_STATE, JSON.stringify(S)); } catch (e) { toast('Speichern fehlgeschlagen'); } }

const act = id => A[id] || S.custom.find(c => c.id === id);
function now() {
  const n = new Date();
  if (S.demo && S.simDate) { const [h, m] = (S.simTime || `${n.getHours()}:${n.getMinutes()}`).split(':').map(Number); return { d: S.simDate, m: h * 60 + m }; }
  return { d: ymd(n), m: n.getHours() * 60 + n.getMinutes() };
}
const inTrip = d => d >= TRIP.start && d <= TRIP.end;
function plannedDate(id) { for (const d of tripDates()) if (S.days[d].program.includes(id)) return d; return null; }

// ---------- Geo & Fahrzeit ----------
function km(a, b) {
  const R = 6371, r = x => x * Math.PI / 180, dLat = r(b.lat - a.lat), dLon = r(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
// Madeira: kurvige Bergstraßen → Luftlinie × 1,5 bei ~32 km/h, plus Parken
function travelMin(a, b) { const k = km(a, b); return k < 0.6 ? 0 : Math.round(k * 1.5 / 32 * 60 + 5); }
const pos = a => (a.lat != null ? a : ZONES[a.zone] || TRIP.hotel);

// ---------- Wetter ----------
let W = (() => { try { return JSON.parse(localStorage.getItem(LS_WX)) || null; } catch { return null; } })();

async function fetchWeather(force) {
  if (!navigator.onLine) return false;
  if (!force && W && Date.now() - W.ts < 3 * 3600e3) return false;
  const z = Object.entries(ZONES);
  const p = new URLSearchParams({
    latitude: z.map(([, v]) => v.lat).join(','), longitude: z.map(([, v]) => v.lon).join(','), elevation: z.map(([, v]) => v.elev).join(','),
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,cloud_cover_mean,wind_speed_10m_max,wind_gusts_10m_max,sunrise,sunset',
    current: 'temperature_2m,weather_code,cloud_cover,wind_speed_10m,precipitation',
    timezone: 'Atlantic/Madeira', forecast_days: '16'
  });
  try {
    const r = await fetch('https://api.open-meteo.com/v1/forecast?' + p); if (!r.ok) throw new Error(r.status);
    let j = await r.json(); if (!Array.isArray(j)) j = [j];
    W = { ts: Date.now(), zones: Object.fromEntries(z.map(([k], i) => [k, { daily: j[i].daily, current: j[i].current }])) };
    localStorage.setItem(LS_WX, JSON.stringify(W));
    return true;
  } catch (e) { console.warn('Wetter', e); return false; }
}

function hash(str) { let h = 2166136261; for (const c of str) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return ((h >>> 0) % 10000) / 10000; }
// Testmodus: plausibles, deterministisches Wetter (Fronten betreffen Norden/Berge stärker)
function demoW(zone, d) {
  const f = hash(d + ':' + S.demoSeed), r = hash(zone + d + S.demoSeed);
  const wet = { north: 1.4, mountain: 1.2, west: 1.2, northwest: 1.2, south: .6, east: .5 }[zone];
  const precip = Math.max(0, (f - .45) * 30 * wet + (r - .6) * 6);
  const cloud = Math.min(100, Math.max(5, 20 + f * 60 * wet + (r - .5) * 30));
  const wind = 12 + f * 30 + (zone === 'mountain' ? 18 : 0) + r * 10;
  const tmax = { south: 20, east: 19, mountain: 7, north: 15, west: 11, northwest: 17 }[zone] + (r - .5) * 3;
  const code = precip > 8 ? 63 : precip > 1.5 ? 61 : precip > .3 ? 80 : cloud > 80 ? 3 : cloud > 50 ? 2 : cloud > 25 ? 1 : 0;
  return { code, tmax, tmin: tmax - 6, precip: Math.round(precip * 10) / 10, pprob: Math.min(100, Math.round(precip * 9 + f * 20)), cloud: Math.round(cloud), wind: Math.round(wind), gust: Math.round(wind * 1.6), demo: true };
}
function dayW(zone, d) {
  if (S.demo) return demoW(zone, d);
  const z = W?.zones?.[zone]?.daily; if (!z) return null;
  const i = z.time.indexOf(d); if (i < 0) return null;
  return { code: z.weather_code[i], tmax: z.temperature_2m_max[i], tmin: z.temperature_2m_min[i], precip: z.precipitation_sum[i],
    pprob: z.precipitation_probability_max[i], cloud: z.cloud_cover_mean?.[i], wind: z.wind_speed_10m_max[i], gust: z.wind_gusts_10m_max?.[i],
    sunrise: z.sunrise[i], sunset: z.sunset[i] };
}
const hasW = d => !!dayW('south', d);
function wxIcon(c) {
  if (c == null) return '·';
  if (c === 0) return '☀️'; if (c === 1) return '🌤️'; if (c === 2) return '⛅'; if (c === 3) return '☁️';
  if (c === 45 || c === 48) return '🌫️'; if (c >= 51 && c <= 57) return '🌦️'; if (c >= 61 && c <= 67) return '🌧️';
  if (c >= 71 && c <= 77) return '🌨️'; if (c >= 80 && c <= 82) return '🌦️'; if (c >= 85 && c <= 86) return '🌨️'; return '⛈️';
}
const wxText = w => w ? `${wxIcon(w.code)} ${Math.round(w.tmax)}° · 💧${w.precip ?? 0} mm${w.pprob != null ? ` (${w.pprob}%)` : ''} · ☁️${w.cloud ?? '–'}% · 💨${Math.round(w.wind)} km/h` : 'keine Vorhersage';

function sunTimes(d) {
  const w = !S.demo && dayW('south', d);
  if (w?.sunrise) return { rise: toMin(w.sunrise.slice(11, 16)), set: toMin(w.sunset.slice(11, 16)) };
  // Näherung Funchal Ende Dez./Anfang Jan. (WET)
  const n = Math.max(0, Math.min(14, (parseD(d) - parseD(TRIP.start)) / 864e5));
  return { rise: Math.round(484 + n * 0.45), set: Math.round(1088 + n * 0.65) };
}

// ---------- Wetterbewertung ----------
// [Regen mm, Regenwahrsch., Wolken, Wind]-Gewichte je Profil
const PROF = { summit: [14, .35, .9, 1.6], view: [8, .2, .6, .8], levada: [6, .15, .15, .6], coast: [7, .2, .3, 1.0], city: [3, .08, .05, .3], fog: [5, .1, -.2, .6] };
function scoreAct(a, d) {
  if (!a || a.type === 'food' || a.profile === 'indoor') return null;
  const w = dayW(a.zone, d); if (!w) return null;
  const P = PROF[a.profile] || PROF.levada;
  let s = 100;
  s -= Math.min(60, P[0] * (w.precip || 0));
  s -= P[1] * (w.pprob ?? 40);
  s -= P[2] * Math.max(0, (w.cloud ?? 50) - 30) * .6;
  s -= P[3] * Math.max(0, (w.wind || 0) - 30);
  if (a.profile === 'levada' && w.precip > 15) s -= 25; // Steinschlag/Sperrungen
  return Math.round(Math.max(0, Math.min(100, s)));
}
const scoreCls = s => s == null ? '' : s >= 70 ? 'good' : s >= 45 ? 'ok' : 'bad';
const scoreDot = s => s == null ? '' : s >= 70 ? '🟢' : s >= 45 ? '🟡' : '🔴';
const weight = a => a.type === 'hike' ? ({ schwer: 4, mittel: 3, leicht: 2 }[a.diff] || 2) : a.type === 'sight' ? 1.5 : a.type === 'relax' ? 1 : 0;
function dayScore(d, prog) {
  let sw = 0, ss = 0;
  for (const id of prog) { const a = act(id), s = scoreAct(a, d); if (s == null) continue; const w = weight(a); sw += w; ss += s * w; }
  if (!hasW(d)) return null;
  return sw ? Math.round(ss / sw) : 88;
}
const mainOf = prog => prog.map(act).filter(Boolean).sort((x, y) => weight(y) - weight(x))[0];

// ---------- Zeitachse ----------
function timeline(d, prog, start) {
  const day = S.days[d]; prog = prog || day.program;
  const sun = sunTimes(d), wd = parseD(d).getDay(), holiday = d.endsWith('12-25') || d.endsWith('01-01');
  let t = toMin(start || day.start), p = TRIP.hotel;
  const rows = [], warns = [];
  const fx = (day.fixed || []).map(act).filter(Boolean).map(a => ({ a, at: toMin(a.time) })).sort((x, y) => x.at - y.at);
  let fi = 0;
  while (fi < fx.length && fx[fi].at <= t) { const f = fx[fi++]; rows.push({ a: f.a, start: f.at, end: f.at + f.a.dur * 60, fixed: true }); t = Math.max(t, f.at + f.a.dur * 60); p = pos(f.a); }
  prog.forEach((id, i) => {
    const a = act(id); if (!a) return;
    const tr = travelMin(p, pos(a));
    if (tr) rows.push({ travel: tr, start: t });
    t += tr;
    if (a.notBefore && t < toMin(a.notBefore)) { rows.push({ free: toMin(a.notBefore) - t, start: t }); t = toMin(a.notBefore); }
    const r = { a, i, start: t, end: t + a.dur * 60, warn: [] };
    if (a.type === 'hike' && r.end > sun.set - 15) r.warn.push(`endet ca. ${fmt(r.end)}, Sonnenuntergang ${fmt(sun.set)} → Stirnlampe!`);
    if (a.type === 'hike' && r.start < sun.rise - 10) r.warn.push(`Start vor Sonnenaufgang (${fmt(sun.rise)})`);
    if (a.openDays && !a.openDays.includes(wd)) r.warn.push(`laut Info heute geschlossen (offen: ${a.openDays.map(x => WD[x]).join(', ')})`);
    if (a.type === 'food' && holiday) r.warn.push('Feiertag: viele Lokale geschlossen, Picknick einplanen');
    rows.push(r); t = r.end; p = pos(a);
  });
  let conflict = false;
  for (; fi < fx.length; fi++) {
    const f = fx[fi], tr = travelMin(p, pos(f.a));
    if (tr) rows.push({ travel: tr, start: t });
    if (t + tr > f.at) { conflict = true; warns.push(`Programm zu lang: ${f.a.title} um ${f.a.time} wird knapp (Ankunft ca. ${fmt(t + tr)})`); }
    t = Math.max(t + tr, f.at);
    rows.push({ a: f.a, start: t, end: t + f.a.dur * 60, fixed: true }); t += f.a.dur * 60; p = pos(f.a);
  }
  if (!fx.some(f => f.a.id === 'departure')) {
    const tr = travelMin(p, TRIP.hotel);
    if (tr) rows.push({ travel: tr, start: t });
    t += tr; rows.push({ home: true, start: t });
  }
  rows.forEach(r => r.warn && warns.push(...r.warn.map(w => `${r.a.title}: ${w}`)));
  return { rows, end: t, warns, conflict, sun };
}

// ---------- Optimierer ----------
// Tauscht ganze Tagesprogramme (inkl. Startzeit) zwischen nicht gesperrten Tagen mit Vorhersage,
// um Wetter-Score zu maximieren; Strafen für Termin-Konflikte, geschlossene Lokale und schwere Touren an Folgetagen.
function planValue(plan) {
  let v = 0; const ds = tripDates();
  ds.forEach((d, k) => {
    const pr = plan[d];
    const s = dayScore(d, pr.program); if (s != null) v += s;
    const tl = timeline(d, pr.program, pr.start);
    if (tl.conflict) v -= 40;
    v -= tl.rows.filter(r => r.warn?.some(w => w.includes('geschlossen'))).length * 25;
    v -= tl.rows.filter(r => r.warn?.some(w => w.includes('Stirnlampe'))).length * 8;
    const hard = x => x.program.some(id => act(id)?.diff === 'schwer');
    if (k > 0 && hard(pr) && hard(plan[ds[k - 1]])) v -= 15;
  });
  return v;
}
function optimize() {
  const n = now();
  const cand = tripDates().filter(d => hasW(d) && !S.days[d].locked && S.days[d].program.length &&
    (d > n.d || (d === n.d && n.m < toMin(S.days[d].start))));
  const plan = Object.fromEntries(tripDates().map(d => [d, { program: S.days[d].program.slice(), start: S.days[d].start, title: S.days[d].title }]));
  const before = clone(plan);
  // Stabilität: jede Umstellung kostet, damit nur lohnende Tausche vorgeschlagen werden
  const value = () => planValue(plan) - 8 * cand.filter(d => plan[d].program.join() !== before[d].program.join()).length;
  let cur = value();
  for (let iter = 0; iter < 40; iter++) {
    let best = null;
    for (let i = 0; i < cand.length; i++) for (let j = i + 1; j < cand.length; j++) {
      const a = cand[i], b = cand[j];[plan[a], plan[b]] = [plan[b], plan[a]];
      const v = value(); if (v > cur + 1 && (!best || v > best.v)) best = { a, b, v };
      [plan[a], plan[b]] = [plan[b], plan[a]];
    }
    if (!best) break;
    [plan[best.a], plan[best.b]] = [plan[best.b], plan[best.a]]; cur = best.v;
  }
  const changes = cand.filter(d => before[d].program.join() !== plan[d].program.join()).map(d => ({
    d, from: before[d], to: plan[d], sFrom: dayScore(d, before[d].program), sTo: dayScore(d, plan[d].program)
  }));
  // Für weiterhin schlechte Tage: Schlechtwetter-Alternativen vorschlagen
  const alts = [];
  for (const d of cand) {
    plan[d].program.forEach((id, i) => {
      const a = act(id), s = scoreAct(a, d);
      if (s != null && s < 45 && a.rainAlt?.length) {
        const best = a.rainAlt.map(x => ({ x, s: scoreAct(act(x), d) ?? 85 })).filter(o => !plannedDate(o.x) || plannedDate(o.x) === d).sort((p, q) => q.s - p.s)[0];
        if (best && best.s > s + 15) alts.push({ d, i, id, alt: best.x, s, sAlt: best.s });
      }
    });
  }
  return { plan, changes, alts, cand: cand.length };
}

// ---------- Vorschläge „Was jetzt?“ ----------
function suggestNow() {
  const n = now(), d = inTrip(n.d) ? n.d : TRIP.start, sun = sunTimes(d);
  const left = sun.set - n.m;
  const here = TRIP.hotel;
  const list = [...ACTIVITIES, ...S.custom].filter(a => !a.fixed && !a.util && ['hike', 'sight', 'relax'].includes(a.type) && !S.done[a.id])
    .map(a => {
      const tr = travelMin(here, pos(a)), need = tr + a.dur * 60;
      const s = scoreAct(a, d) ?? (a.profile === 'indoor' ? 60 : 65);
      const fits = a.type !== 'hike' || need + 15 <= left;
      return { a, tr, s, fits, rank: s - tr / 3 - (plannedDate(a.id) && plannedDate(a.id) !== d ? 5 : 0) };
    }).filter(o => o.fits).sort((x, y) => y.rank - x.rank).slice(0, 8);
  return { d, left, list };
}

// ---------- Bilder (Wikimedia Commons) ----------
let IMG = (() => { try { return JSON.parse(localStorage.getItem(LS_IMG)) || {}; } catch { return {}; } })();
async function images(a) {
  if (!a || a.type === 'food' || a.type === 'travel' || a.custom) return [];
  const q = a.imgQ || `${a.title} Madeira`;
  if (IMG[q]) return IMG[q];
  if (!navigator.onLine) return [];
  try {
    const u = 'https://commons.wikimedia.org/w/api.php?' + new URLSearchParams({ action: 'query', format: 'json', origin: '*', generator: 'search',
      gsrnamespace: '6', gsrlimit: '6', gsrsearch: q + ' filetype:bitmap', prop: 'imageinfo', iiprop: 'url', iiurlwidth: '900' });
    const j = await (await fetch(u)).json();
    const pages = Object.values(j.query?.pages || {}).sort((x, y) => x.index - y.index);
    IMG[q] = pages.map(p => ({ src: p.imageinfo?.[0]?.thumburl, page: p.imageinfo?.[0]?.descriptionurl })).filter(x => x.src);
    localStorage.setItem(LS_IMG, JSON.stringify(IMG));
    return IMG[q];
  } catch { return []; }
}

// ---------- Eigene Fotos (IndexedDB) ----------
const Photos = (() => {
  let p;
  const db = () => p || (p = new Promise((res, rej) => {
    const r = indexedDB.open('madeira26', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('photos', { keyPath: 'id', autoIncrement: true }).createIndex('key', 'key');
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  }));
  const tx = async (mode, fn) => { const d = await db(); return new Promise((res, rej) => { const t = d.transaction('photos', mode); const r = fn(t.objectStore('photos')); t.oncomplete = () => res(r?.result); t.onerror = () => rej(t.error); }); };
  return {
    add: (key, blob) => tx('readwrite', s => s.add({ key, blob, ts: Date.now() })),
    list: key => tx('readonly', s => s.index('key').getAll(key)),
    all: () => tx('readonly', s => s.getAll()),
    get: id => tx('readonly', s => s.get(id)),
    del: id => tx('readwrite', s => s.delete(id))
  };
})();
async function shrink(file) {
  try {
    const bmp = await createImageBitmap(file), k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    return await new Promise(r => c.toBlob(r, 'image/jpeg', .85));
  } catch { return file; }
}
const objUrls = [];
function photoUrl(blob) { const u = URL.createObjectURL(blob); objUrls.push(u); return u; }
async function fillPhotos(el, key) {
  const list = await Photos.list(key).catch(() => []);
  el.innerHTML = list.length ? list.map(ph => `<img src="${photoUrl(ph.blob)}" data-a="photo" data-id="${ph.id}" alt="">`).join('') : '<span class="muted small">Noch keine eigenen Fotos.</span>';
}

// ---------- Links ----------
const L = {
  nav: a => `https://www.google.com/maps/dir/?api=1&destination=${a.lat},${a.lon}&travelmode=driving`,
  apple: a => `https://maps.apple.com/?daddr=${a.lat},${a.lon}&dirflg=d`,
  place: a => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(a.mapsQ || `${a.lat},${a.lon}`)}`,
  komoot: a => S.komoot[a.id] || a.komoot || `https://www.komoot.com/plan/@${a.lat},${a.lon},14z`
};

// ---------- Rendering ----------
const view = () => $('#view');
function render() {
  objUrls.splice(0).forEach(u => URL.revokeObjectURL(u));
  document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === S.tab));
  $('#net').classList.toggle('off', !navigator.onLine);
  const n = now();
  $('#topSub').textContent = (S.demo ? '🧪 Testmodus · ' : '') + (W && !S.demo ? `Wetter: ${new Date(W.ts).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}` : '20.12.2026 – 03.01.2027 · Caniço de Baixo');
  ({ today: renderToday, plan: renderPlan, pool: renderPool, weather: renderWeather, info: renderInfo })[S.tab]();
  if (S.tab === 'plan') document.querySelector('.datebar .on')?.scrollIntoView({ inline: 'center', block: 'nearest' });
  $('#topTitle').textContent = { today: 'Madeira · Heute', plan: 'Madeira · Plan', pool: 'Madeira · Ideen', weather: 'Madeira · Wetter', info: 'Madeira · Infos' }[S.tab];
  void n;
}

function itemRow(r, d, opts = {}) {
  if (r.travel) return `<li class="travel"><div class="t">${fmt(r.start)}</div><div class="dot"></div><div class="body">🚗 ca. ${r.travel} Min. Fahrt</div></li>`;
  if (r.free) return `<li class="travel"><div class="t">${fmt(r.start)}</div><div class="dot"></div><div class="body">☕ freie Zeit (${Math.floor(r.free / 60)} h ${r.free % 60} Min.)</div></li>`;
  if (r.home) return `<li class="travel"><div class="t">${fmt(r.start)}</div><div class="dot"></div><div class="body">🏨 zurück im Hotel</div></li>`;
  const a = r.a, s = scoreAct(a, d), done = S.done[a.id];
  const meta = [TYPE_ICON[a.type] + ' ' + (a.dur >= 1 ? `${a.dur} h` : `${Math.round(a.dur * 60)} Min.`), a.km && `${a.km} km`, a.hm && `${a.hm} Hm`, a.diff, a.price, a.pr].filter(Boolean).join(' · ');
  const acts = r.fixed || opts.compact ? '' : `<div class="acts">
      <button data-a="up" data-d="${d}" data-i="${r.i}" aria-label="nach oben">↑</button>
      <button data-a="down" data-d="${d}" data-i="${r.i}" aria-label="nach unten">↓</button>
      <button data-a="move" data-d="${d}" data-i="${r.i}">📅 Tag</button>
      <button data-a="done" data-id="${a.id}">${done ? '↺' : '✓'}</button>
      <button data-a="rm" data-d="${d}" data-i="${r.i}" aria-label="entfernen">✕</button></div>`;
  const alt = !r.fixed && s != null && s < 45 && a.rainAlt?.length
    ? `<div class="badline">Wetter ungünstig → <a href="#" data-a="replace" data-d="${d}" data-old="${a.id}" data-alt="${a.rainAlt[0]}">${esc(act(a.rainAlt[0])?.title)}</a></div>` : '';
  return `<li class="type-${a.type}${done ? ' done' : ''}"><div class="t">${fmt(r.start)}</div><div class="dot"></div><div class="body">
    <div class="item-title" data-a="detail" data-id="${a.id}" data-d="${d}">${esc(a.title)} ${s != null ? `<span class="chip ${scoreCls(s)}">${s}</span>` : ''}${r.fixed ? ' 📌' : ''}</div>
    <div class="meta">${meta} · bis ${fmt(r.end)}</div>
    ${(r.warn || []).map(w => `<div class="warn">⚠️ ${esc(w)}</div>`).join('')}${alt}${acts}</div></li>`;
}

function dayCard(d, opts = {}) {
  const day = S.days[d], tl = timeline(d), s = dayScore(d, day.program), zones = [...new Set(day.program.map(id => act(id)?.zone).filter(Boolean))];
  const m = mainOf(day.program);
  const wx = zones.length ? zones.map(z => `<div class="wxline"><b>${ZONES[z].short}:</b> ${wxText(dayW(z, d))}</div>`).join('') : `<div class="wxline">${wxText(dayW('south', d))}</div>`;
  return `<div class="card">
    <div class="day-head"><div style="flex:1">
      <div class="date">${dLabel(d)} · ${esc(day.title || (m ? m.title : 'Freier Tag'))}${(day.fixed || []).map(id => ` · 📌 ${esc(act(id)?.title)}`).join('')}</div>
      <div class="wxline">🌅 ${fmt(tl.sun.rise)} · 🌇 ${fmt(tl.sun.set)}${s != null ? ` · Tageswertung <span class="chip ${scoreCls(s)}">${s}</span>` : ''}</div>
      ${wx}</div>
      ${opts.compact ? '' : `<button class="btn sm" data-a="lock" data-d="${d}" title="Tag fixieren">${day.locked ? '🔒' : '🔓'}</button>`}
    </div>
    ${opts.compact ? '' : `<div class="row" style="margin-top:8px"><label class="small muted" style="white-space:nowrap">Start</label><input type="time" value="${day.start}" data-c="start" data-d="${d}" style="width:110px"><span class="spacer"></span>
      <button class="btn sm" data-a="add" data-d="${d}">＋ Aktivität</button><button class="btn sm" data-a="custom" data-d="${d}">✎ Eigene</button></div>`}
    ${tl.warns.filter(w => w.startsWith('Programm')).map(w => `<div class="badline">⚠️ ${esc(w)}</div>`).join('')}
    <ul class="tl">${tl.rows.map(r => itemRow(r, d, opts)).join('')}</ul>
    ${opts.compact ? '' : `<label class="fld">Tagesnotiz</label><textarea data-c="daynote" data-d="${d}" placeholder="z. B. Reservierung, Parkplatz, Eindrücke …">${esc(day.note || '')}</textarea>
    <div class="row" style="margin-top:8px"><b class="small">📷 Fotos des Tages</b><span class="spacer"></span><button class="btn sm" data-a="photoAdd" data-key="day:${d}">＋ Foto</button></div>
    <div class="photos" data-photos="day:${d}" style="margin-top:6px"></div>`}
  </div>`;
}

function renderToday() {
  const n = now();
  if (n.d < TRIP.start) {
    const days = Math.ceil((parseD(TRIP.start) - parseD(n.d)) / 864e5);
    const all = CHECKLIST.flatMap(g => g.items), done = all.filter(i => S.check[i]).length;
    const fcDay = addDays(TRIP.start, -15);
    view().innerHTML = `<div class="card hero"><div class="muted">Noch</div><div class="big">${days} Tage</div><div class="muted">bis Madeira · 20.12.2026</div></div>
      <div class="card"><h3>Vorbereitung</h3><div class="muted small">${done} von ${all.length} Punkten erledigt</div>
        <div class="row" style="margin-top:8px"><button class="btn" data-a="tab" data-t="info">Checkliste öffnen</button></div></div>
      <div class="card"><h3>Wetter-Optimierung</h3><div class="small">Die Vorhersage reicht 16 Tage voraus. Ab ca. <b>${dLabel(fcDay)}</b> erscheinen echte Werte für die Reise, dann kann der Plan nach Wetter umsortiert werden.
        Bis dahin kannst du alles im <b>Testmodus</b> (Infos) mit simuliertem Wetter ausprobieren.</div></div>
      <h2>Erster Tag</h2>${dayCard(TRIP.start, { compact: true })}`;
    return;
  }
  if (n.d > TRIP.end) {
    view().innerHTML = `<div class="card hero"><div class="big">Obrigado, Madeira!</div><div class="muted">Eure Fotos findet ihr in jedem Tag im Plan.</div></div>`;
    return;
  }
  const d = n.d, tl = timeline(d), day = S.days[d];
  const cur = tl.rows.find(r => r.a && r.start <= n.m && r.end > n.m) || tl.rows.find(r => r.a && r.start > n.m);
  const curW = !S.demo && W?.zones?.south?.current;
  const left = tl.sun.set - n.m;
  view().innerHTML = `<div class="card hero">
      <div class="muted">${dLabel(d)} · Tag ${tripDates().indexOf(d) + 1} von ${tripDates().length}</div>
      <div class="big" style="font-size:22px">${esc(day.title || 'Heute')}${(day.fixed || []).map(id => ` · ${esc(act(id)?.title)}`).join('')}</div>
      <div class="muted">${curW ? `${wxIcon(curW.weather_code)} jetzt ${Math.round(curW.temperature_2m)}° in Caniço · ` : ''}🌇 ${fmt(tl.sun.set)}${left > 0 ? ` · noch ${Math.floor(left / 60)} h ${left % 60} Min. Tageslicht` : ''}</div>
    </div>
    ${cur ? `<div class="card"><div class="muted small">${cur.start <= n.m ? 'Jetzt' : 'Als Nächstes · ' + fmt(cur.start)}</div><h3 data-a="detail" data-id="${cur.a.id}" data-d="${d}">${TYPE_ICON[cur.a.type]} ${esc(cur.a.title)}</h3>
      <div class="links">
        <a class="primary" href="${L.nav(cur.a)}" target="_blank" rel="noopener">🚗 Navigation</a>
        <a href="${L.apple(cur.a)}" target="_blank" rel="noopener">🗺️ Apple Karten</a>
        ${cur.a.type === 'hike' ? `<a href="${L.komoot(cur.a)}" target="_blank" rel="noopener">🥾 Komoot</a>` : ''}
        <a href="#" data-a="detail" data-id="${cur.a.id}" data-d="${d}">ℹ️ Details</a></div></div>` : ''}
    <div class="row wrap"><button class="btn primary" data-a="suggest">✨ Was jetzt? (spontan)</button><button class="btn" data-a="optimize">🔄 Plan nach Wetter</button></div>
    ${dayCard(d)}`;
  loadDayPhotos();
}

function renderPlan() {
  const ds = tripDates();
  if (!S.sel || !ds.includes(S.sel)) S.sel = inTrip(now().d) ? now().d : TRIP.start;
  const bar = ds.map(d => {
    const x = parseD(d), s = dayScore(d, S.days[d].program), w = dayW(mainOf(S.days[d].program)?.zone || 'south', d);
    return `<button data-a="sel" data-d="${d}" class="${d === S.sel ? 'on' : ''}"><small>${WD[x.getDay()]}</small><b>${x.getDate()}</b><span class="wx">${w ? wxIcon(w.code) : (S.days[d].locked ? '🔒' : '·')}${scoreDot(s)}</span></button>`;
  }).join('');
  const mode = S.planMode;
  let body;
  if (mode === 'all') {
    body = ds.map(d => {
      const day = S.days[d], s = dayScore(d, day.program), tl = timeline(d);
      return `<button class="list-btn" data-a="sel" data-d="${d}" data-mode="day"><div class="row"><b>${dLabel(d)}</b><span class="spacer"></span>${day.locked ? '🔒' : ''}${s != null ? `<span class="chip ${scoreCls(s)}">${s}</span>` : ''}</div>
        <div>${esc(day.title || '')}</div><div class="muted small">${day.program.map(id => TYPE_ICON[act(id)?.type] + ' ' + esc(act(id)?.title)).join(' · ')} ${(day.fixed || []).map(id => '· 📌 ' + esc(act(id)?.title)).join(' ')}</div>
        <div class="muted small">${fmt(toMin(day.start))} – ${fmt(tl.end)}${tl.warns.length ? ` · ⚠️ ${tl.warns.length}` : ''}</div></button>`;
    }).join('');
  } else body = dayCard(S.sel);
  view().innerHTML = `<div class="row" style="margin-bottom:6px">
      <button class="btn sm ${mode === 'day' ? 'primary' : ''}" data-a="mode" data-m="day">Tag</button>
      <button class="btn sm ${mode === 'all' ? 'primary' : ''}" data-a="mode" data-m="all">Übersicht</button>
      <span class="spacer"></span><button class="btn sm" data-a="optimize">🔄 Nach Wetter optimieren</button></div>
    ${mode === 'day' ? `<div class="datebar">${bar}</div>` : ''}${body}`;
  loadDayPhotos();
}
function loadDayPhotos() { document.querySelectorAll('[data-photos]').forEach(el => fillPhotos(el, el.dataset.photos)); }

function renderPool() {
  const f = S.poolFilter;
  const items = [...ACTIVITIES, ...S.custom].filter(a => !a.fixed && !a.util && a.type !== 'travel')
    .filter(a => f === 'all' || (f === 'free' ? !plannedDate(a.id) : a.type === f));
  const filters = [['all', 'Alle'], ['free', 'Nicht verplant'], ['hike', '🥾 Wandern'], ['sight', '📍 Sehenswert'], ['relax', '🌴 Entspannung'], ['food', '🍽️ Essen']];
  view().innerHTML = `<div class="filters">${filters.map(([k, t]) => `<button class="btn sm ${f === k ? 'on' : ''}" data-a="pf" data-f="${k}">${t}</button>`).join('')}</div>
    ${items.map(a => {
      const pd = plannedDate(a.id);
      const best = tripDates().map(d => ({ d, s: scoreAct(a, d) })).filter(x => x.s != null).sort((x, y) => y.s - x.s)[0];
      return `<div class="card pool-card" data-a="detail" data-id="${a.id}"><div class="thumb" data-thumb="${a.id}">${TYPE_ICON[a.type]}</div>
        <div style="flex:1;min-width:0"><h3>${esc(a.title)}</h3>
        <div class="chips"><span class="chip">${ZONES[a.zone]?.short || ''}</span><span class="chip">${a.dur} h</span>${a.diff ? `<span class="chip">${a.diff}</span>` : ''}${a.price ? `<span class="chip">${a.price}</span>` : ''}${S.done[a.id] ? '<span class="chip good">✓ erledigt</span>' : ''}</div>
        <div class="muted small">${pd ? `📅 ${dLabel(pd)}` : 'nicht verplant'}${best ? ` · bestes Wetter: ${dLabel(best.d)} ${scoreDot(best.s)}` : ''}</div></div></div>`;
    }).join('')}
    <button class="btn" data-a="custom" data-d="">✎ Eigene Idee hinzufügen</button>`;
  items.forEach(async a => { const im = await images(a); const el = document.querySelector(`[data-thumb="${a.id}"]`); if (el && im[0]) { el.style.backgroundImage = `url("${im[0].src}")`; el.textContent = ''; } });
}

function renderWeather() {
  let ds = tripDates().filter(hasW), note = '';
  if (!ds.length && W?.zones?.south?.daily && !S.demo) { ds = W.zones.south.daily.time.slice(0, 7); note = '<div class="muted small">Für den Reisezeitraum gibt es noch keine Vorhersage. Angezeigt werden die nächsten 7 Tage.</div>'; }
  const zs = Object.keys(ZONES);
  view().innerHTML = `<div class="card"><div class="row"><div><h3>Vorhersage nach Inselzonen</h3>
      <div class="muted small">${S.demo ? '🧪 Simuliertes Testwetter' : W ? 'Stand ' + new Date(W.ts).toLocaleString('de-DE') : 'noch nicht geladen'} · Quelle Open-Meteo</div></div><span class="spacer"></span>
      <button class="btn sm" data-a="wx">↻</button></div>${note}
    ${ds.length ? `<div class="wxscroll"><table class="wxtable"><thead><tr><th>Tag</th>${zs.map(z => `<th>${ZONES[z].short}</th>`).join('')}</tr></thead><tbody>
      ${ds.map(d => `<tr><td>${dLabel(d)}</td>${zs.map(z => { const w = dayW(z, d); return `<td>${w ? `${wxIcon(w.code)}<br>${Math.round(w.tmax)}°<br><span class="muted">${w.precip ?? 0}mm</span>` : '–'}</td>`; }).join('')}</tr>`).join('')}
      </tbody></table></div>` : '<p class="muted">Keine Daten (offline?).</p>'}</div>
    <div class="card small"><h3>So liest du das Madeira-Wetter</h3><ul class="tips">
      <li><b>Gipfel</b> (Arieiro/Ruivo) liegen oft <i>über</i> den Wolken. Hohe Bewölkung im Modell heißt nicht automatisch Nebel oben. Vor dem Losfahren Webcams checken.</li>
      <li><b>Norden</b> ist feuchter (Passat). Der <b>Süden und Osten</b> bleiben oft trocken, wenn es im Norden regnet.</li>
      <li>Bei Wind &gt; 50 km/h am Gipfel und nach Starkregen keine Gratwege oder Levadas mit Abbruchkanten.</li>
      <li>Fanal ist im Nebel am schönsten und deshalb eine gute Alternative, wenn die Gipfel zu sind.</li></ul>
      <a href="https://www.netmadeira.com/webcams-madeira" target="_blank" rel="noopener">📷 Webcams</a> · <a href="https://www.ipma.pt/en/" target="_blank" rel="noopener">IPMA</a> · <a href="https://www.windy.com/32.736/-16.928" target="_blank" rel="noopener">Windy</a></div>`;
}

function renderInfo() {
  view().innerHTML = `<div class="card"><h3>Reise</h3><div class="small">✈️ ${esc(TRIP.flightOut)}<br>✈️ ${esc(TRIP.flightBack)}<br>🏨 <a href="${L.place({ mapsQ: TRIP.hotel.q })}" target="_blank" rel="noopener">${esc(TRIP.hotel.name)}, Caniço de Baixo</a><br>🚗 ${esc(TRIP.car)}</div></div>
    <div class="card"><h3>Wandern 2026: Regeln</h3><ul class="tips small">
      <li>Klassifizierte PR-Wege kosten <b>4,50 € p. P.</b>, der <b>PR1 10,50 €</b>. Reservierung und Bezahlung nur online über <a href="https://simplifica.madeira.gov.pt/" target="_blank" rel="noopener">SIMplifica</a>. Ohne Reservierung drohen Bußgelder.</li>
      <li>PR1 ist seit der Wiedereröffnung 2026 <b>Einbahn</b> Richtung Pico Ruivo.</li>
      <li>Wege können kurzfristig gesperrt werden (Steinschlag, Sturm). Den Status vor jeder Tour prüfen.</li>
      <li>Tipp: wegen des Wetter-Optimierers erst 1–2 Tage vorher buchen.</li></ul>
      <div class="muted small">Stand der Recherche: Okt. 2026. Gebühren und Regeln können sich ändern.</div></div>
    ${CHECKLIST.map(g => `<div class="card"><h3>${g.g}</h3>${g.items.map(it => `<label class="check ${S.check[it] ? 'on' : ''}"><input type="checkbox" data-c="check" data-k="${esc(it)}" ${S.check[it] ? 'checked' : ''}><span>${esc(it)}</span></label>`).join('')}</div>`).join('')}
    <div class="card"><h3>Madeira-Küche zum Probieren</h3><div class="small">Espetada (Rindfleischspieß), Bolo do caco mit Knoblauchbutter, Prego no bolo do caco, Espada com banana (Degenfisch), Lapas (Napfschnecken), Milho frito, Bife de atum, Bolo de mel (Honigkuchen, Weihnachten!), Poncha, Maracuja-Pudding, Madeira-Wein.</div></div>
    <div class="card"><h3>Links</h3>${LINKS.map(l => `<a class="list-btn" href="${l.u}" target="_blank" rel="noopener">${esc(l.t)}</a>`).join('')}</div>
    <div class="card"><h3>Notfall</h3>${EMERGENCY.map(e => `<a class="list-btn" href="${e.tel ? 'tel:' + e.tel : L.place({ mapsQ: e.maps })}" target="_blank" rel="noopener"><b>${esc(e.t)}</b><br><span class="muted small">${esc(e.v)}</span></a>`).join('')}</div>
    <div class="card"><h3>Offline & Daten</h3>
      <div class="row wrap"><button class="btn primary" data-a="offline">⬇️ Alles offline laden</button>
      <button class="btn" data-a="export">📤 Plan exportieren</button><button class="btn" data-a="import">📥 Plan importieren</button></div>
      <div class="muted small" style="margin-top:6px">Plan und Notizen liegen nur auf diesem Gerät. Für das zweite iPhone: exportieren, per AirDrop schicken, dort importieren. Fotos bleiben auf dem Gerät, also zusätzlich in der Fotos-App sichern.</div>
      <div class="row" style="margin-top:8px"><button class="btn sm" data-a="reset">Plan zurücksetzen</button></div></div>
    <div class="card"><h3>🧪 Testmodus</h3><div class="small muted">Simuliertes Wetter und Datum, um Optimierung und „Heute“ schon jetzt auszuprobieren.</div>
      <label class="check"><input type="checkbox" data-c="demo" ${S.demo ? 'checked' : ''}><span>Testmodus aktiv</span></label>
      ${S.demo ? `<label class="fld">Simuliertes Datum</label><input type="date" min="${TRIP.start}" max="${TRIP.end}" value="${S.simDate}" data-c="simDate">
      <label class="fld">Simulierte Uhrzeit</label><input type="time" value="${S.simTime}" data-c="simTime">
      <div class="row" style="margin-top:8px"><button class="btn sm" data-a="reroll">🎲 Anderes Testwetter</button></div>` : ''}</div>
    <div class="muted small" style="text-align:center;margin:16px 0">Bilder: Wikimedia Commons · Wetter: Open-Meteo</div>`;
}

// ---------- Sheets ----------
function openSheet(title, html, after) {
  $('#sheet').innerHTML = `<div class="grab"><h3>${title}</h3><button class="btn sm ghost" data-a="close" aria-label="schließen">✕</button></div>${html}`;
  $('#sheet').classList.add('on'); $('#sheetBg').classList.add('on'); $('#sheet').scrollTop = 0;
  after?.();
}
function closeSheet() { $('#sheet').classList.remove('on'); $('#sheetBg').classList.remove('on'); }

async function openDetail(id, d) {
  const a = act(id); if (!a) return;
  const pd = plannedDate(id) || d;
  const facts = [['Dauer', a.dur + ' h'], a.km && ['Strecke', a.km + ' km'], a.hm && ['Höhenmeter', a.hm], a.diff && ['Schwierigkeit', a.diff],
    a.pr && ['Weg', a.pr], a.fee && ['Gebühr', a.fee], a.price && ['Preis', a.price], ['Zone', ZONES[a.zone]?.short], ['Fahrt ab Hotel', `ca. ${travelMin(TRIP.hotel, pos(a))} Min.`]].filter(Boolean);
  const scores = tripDates().map(x => ({ x, s: scoreAct(a, x) })).filter(o => o.s != null);
  const isCustomKomoot = !!S.komoot[a.id];
  openSheet(esc(a.title), `
    <div class="gallery" id="gal"><div class="ph">${TYPE_ICON[a.type]}</div></div>
    <div class="chips"><span class="chip">${TYPE_ICON[a.type]} ${TYPE_NAME[a.type]}</span>${pd ? `<span class="chip">📅 ${dLabel(pd)}</span>` : '<span class="chip">nicht verplant</span>'}${S.done[a.id] ? '<span class="chip good">✓ erledigt</span>' : ''}</div>
    <p>${esc(a.desc || '')}</p>
    <div class="facts">${facts.map(([k, v]) => `<div>${k}<b>${esc(v)}</b></div>`).join('')}</div>
    ${a.lat != null ? `<div class="links">
      <a class="primary" href="${L.nav(a)}" target="_blank" rel="noopener">🚗 Navigation</a>
      <a href="${L.apple(a)}" target="_blank" rel="noopener">🗺️ Apple Karten</a>
      <a href="${L.place(a)}" target="_blank" rel="noopener">📍 Google Maps</a>
      ${a.type === 'hike' || a.type === 'sight' ? `<a href="${L.komoot(a)}" target="_blank" rel="noopener">🥾 Komoot${isCustomKomoot || a.komoot ? '-Tour' : ' (Planer)'}</a>` : ''}
      ${a.info ? `<a href="${a.info}" target="_blank" rel="noopener">ℹ️ Infos</a>` : ''}
      ${a.pr ? `<a href="https://simplifica.madeira.gov.pt/" target="_blank" rel="noopener">🎟️ Reservieren</a>` : ''}
    </div>` : ''}
    ${a.tips?.length ? `<h3>Tipps</h3><ul class="tips">${a.tips.map(t => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
    ${scores.length ? `<h3>Wetter-Eignung</h3><div class="chips">${scores.map(o => `<span class="chip ${scoreCls(o.s)}">${dLabel(o.x)} ${o.s}</span>`).join('')}</div>` : ''}
    ${a.rainAlt?.length ? `<h3>Schlechtwetter-Alternativen</h3><div class="chips">${a.rainAlt.map(x => `<button class="chip" style="border:0" data-a="detail" data-id="${x}">${esc(act(x)?.title)}</button>`).join('')}</div>` : ''}
    ${a.type === 'hike' || a.type === 'sight' ? `<label class="fld">Eigener Komoot-Link (Tour aus der App teilen → hier einfügen)</label><input type="url" placeholder="https://www.komoot.com/tour/…" value="${esc(S.komoot[a.id] || '')}" data-c="komoot" data-id="${a.id}">` : ''}
    <label class="fld">Notizen</label><textarea data-c="note" data-id="${a.id}" placeholder="Eindrücke, Parkplatz, Bewertung …">${esc(S.notes[a.id] || '')}</textarea>
    <div class="row" style="margin-top:10px"><b>📷 Eigene Fotos</b><span class="spacer"></span><button class="btn sm" data-a="photoAdd" data-key="act:${a.id}">＋ Foto</button></div>
    <div class="photos" data-photos="act:${a.id}" style="margin-top:6px"></div>
    <div class="row wrap" style="margin-top:14px">
      ${a.fixed ? '' : `<button class="btn primary" data-a="pickDay" data-id="${a.id}">📅 ${pd ? 'Anderen Tag wählen' : 'Einplanen'}</button>`}
      <button class="btn" data-a="done" data-id="${a.id}">${S.done[a.id] ? '↺ Nicht erledigt' : '✓ Erledigt'}</button>
      ${a.custom ? `<button class="btn" data-a="delCustom" data-id="${a.id}">🗑 Löschen</button>` : ''}</div>`,
    () => fillPhotos(document.querySelector(`#sheet [data-photos="act:${a.id}"]`), 'act:' + a.id));
  const im = await images(a);
  const gal = $('#gal');
  if (gal && im.length) gal.innerHTML = im.map(x => `<a href="${x.page}" target="_blank" rel="noopener"><img src="${x.src}" loading="lazy" alt=""></a>`).join('');
}

function openPickDay(id) {
  const a = act(id), cur = plannedDate(id);
  openSheet('Tag wählen: ' + esc(a.title), tripDates().map(d => {
    const s = scoreAct(a, d), tl = timeline(d, [...S.days[d].program.filter(x => x !== id), id]);
    return `<button class="list-btn" data-a="placeOn" data-id="${id}" data-d="${d}" ${d === cur ? 'disabled' : ''}><div class="row"><b>${dLabel(d)}</b> <span class="muted small">${esc(S.days[d].title || '')}</span><span class="spacer"></span>${S.days[d].locked ? '🔒' : ''}${s != null ? `<span class="chip ${scoreCls(s)}">${s}</span>` : ''}</div>
      <div class="muted small">${S.days[d].program.length} Programmpunkte · Ende ca. ${fmt(tl.end)}${tl.warns.length ? ' · ⚠️ ' + esc(tl.warns[0]) : ''}${d === cur ? ' · aktuell' : ''}</div></button>`;
  }).join('') + (cur ? `<button class="list-btn" data-a="unplan" data-id="${id}">↩︎ Aus dem Plan nehmen (zurück zu Ideen)</button>` : ''));
}

function openAdd(d) {
  const list = [...ACTIVITIES, ...S.custom].filter(a => !a.fixed && a.type !== 'travel' && !S.days[d].program.includes(a.id))
    .map(a => ({ a, s: scoreAct(a, d), pd: plannedDate(a.id), tr: travelMin(TRIP.hotel, pos(a)) }))
    .sort((x, y) => (!!x.pd - !!y.pd) || ((y.s ?? 70) - (x.s ?? 70)));
  openSheet('Hinzufügen: ' + dLabel(d), `<input type="text" placeholder="Suchen …" data-c="filterAdd">` + list.map(o =>
    `<button class="list-btn" data-a="placeOn" data-id="${o.a.id}" data-d="${d}" data-q="${esc((o.a.title + ' ' + o.a.type + ' ' + (ZONES[o.a.zone]?.name || '')).toLowerCase())}"><div class="row"><b>${TYPE_ICON[o.a.type]} ${esc(o.a.title)}</b><span class="spacer"></span>${o.s != null ? `<span class="chip ${scoreCls(o.s)}">${o.s}</span>` : ''}</div>
     <div class="muted small">${o.a.dur} h · ${ZONES[o.a.zone]?.short} · ${o.tr} Min. ab Hotel${o.pd ? ` · bisher ${dLabel(o.pd)} (wird verschoben)` : ''}</div></button>`).join(''));
}

function openCustom(d) {
  openSheet('Eigene Aktivität', `
    <label class="fld">Titel</label><input type="text" id="cTitle" placeholder="z. B. Strandbar in Machico">
    <label class="fld">Art</label><select id="cType">${Object.entries(TYPE_NAME).filter(([k]) => !['event', 'travel'].includes(k)).map(([k, v]) => `<option value="${k}">${TYPE_ICON[k]} ${v}</option>`).join('')}</select>
    <label class="fld">Dauer (Stunden)</label><input type="text" inputmode="decimal" id="cDur" value="1.5">
    <label class="fld">Region (für Wetter)</label><select id="cZone">${Object.entries(ZONES).map(([k, z]) => `<option value="${k}">${z.name}</option>`).join('')}</select>
    <label class="fld">Ort: Google-Maps-Link (mit @Koordinaten) oder Suchbegriff</label><input type="text" id="cPlace" placeholder="https://maps.google.com/…@32.71,-16.76…">
    <label class="fld">Komoot-Link (optional)</label><input type="url" id="cKomoot">
    <label class="fld">Beschreibung</label><textarea id="cDesc"></textarea>
    <div class="row" style="margin-top:12px"><button class="btn primary" data-a="saveCustom" data-d="${d || ''}">Speichern${d ? ' & am ' + dLabel(d) + ' einplanen' : ''}</button></div>`);
}

function openSuggest() {
  const r = suggestNow();
  openSheet('✨ Was jetzt?', `<div class="muted small">Nach Wetter heute, Fahrzeit ab Hotel und verbleibendem Tageslicht (${Math.max(0, Math.floor(r.left / 60))} h ${Math.max(0, r.left % 60)} Min.).</div>` +
    (r.list.length ? r.list.map(o => `<div class="card"><div class="row"><b data-a="detail" data-id="${o.a.id}">${TYPE_ICON[o.a.type]} ${esc(o.a.title)}</b><span class="spacer"></span><span class="chip ${scoreCls(o.s)}">${o.s}</span></div>
      <div class="muted small">${o.a.dur} h · ${o.tr} Min. Fahrt · ${ZONES[o.a.zone]?.short}${plannedDate(o.a.id) ? ' · geplant ' + dLabel(plannedDate(o.a.id)) : ''}</div>
      <div class="row" style="margin-top:6px"><a class="btn sm primary" href="${L.nav(o.a)}" target="_blank" rel="noopener">🚗 Los</a><button class="btn sm" data-a="placeOn" data-id="${o.a.id}" data-d="${r.d}">＋ Heute einplanen</button></div></div>`).join('')
      : '<p>Für heute passt draußen nichts mehr. Wie wäre es mit Poncha und Abendessen? 🍹</p>'));
}

let lastOpt = null;
function openOptimize() {
  if (!tripDates().some(hasW)) { toast('Noch keine Vorhersage für den Reisezeitraum. Den Testmodus nutzen.'); return; }
  lastOpt = optimize();
  const { changes, alts, plan } = lastOpt;
  const progTxt = p => esc(p.title || mainOf(p.program)?.title || '–');
  openSheet('🔄 Wetter-Optimierung', `<div class="muted small">${lastOpt.cand} Tage mit Vorhersage und ohne 🔒 wurden geprüft. Termine (📌) bleiben an ihrem Datum.</div>
    ${changes.length ? `<h3 style="margin-top:12px">Vorgeschlagene Umstellung</h3>${changes.map(c => `<div class="diffrow"><b style="width:74px">${dLabel(c.d)}</b><div style="flex:1">${progTxt(c.to)}<div class="muted small">statt ${progTxt(c.from)}</div></div>
      <span class="chip ${scoreCls(c.sFrom)}">${c.sFrom ?? '–'}</span>→<span class="chip ${scoreCls(c.sTo)}">${c.sTo ?? '–'}</span></div>`).join('')}
      <div class="row" style="margin-top:12px"><button class="btn primary" data-a="applyOpt">Übernehmen</button><button class="btn" data-a="close">Verwerfen</button></div>`
      : '<p>👍 Der aktuelle Plan passt schon am besten zum Wetter.</p>'}
    ${alts.length ? `<h3 style="margin-top:14px">Trotzdem ungünstig, Alternativen</h3>${alts.map(x => `<div class="diffrow"><b style="width:74px">${dLabel(x.d)}</b><div style="flex:1">${esc(act(x.id).title)} <span class="chip bad">${x.s}</span><div class="muted small">→ ${esc(act(x.alt).title)} <span class="chip ${scoreCls(x.sAlt)}">${x.sAlt}</span></div></div>
      <button class="btn sm" data-a="replace" data-d="${x.d}" data-old="${x.id}" data-alt="${x.alt}" data-fromopt="1">Tauschen</button></div>`).join('')}` : ''}
    ${changes.length && alts.length ? '<div class="muted small">Die Alternativen beziehen sich auf den umgestellten Plan. Erst „Übernehmen“, dann tauschen.</div>' : ''}`);
  void plan;
}

// ---------- Aktionen ----------
function removeEverywhere(id) { for (const d of tripDates()) { const p = S.days[d].program, i = p.indexOf(id); if (i >= 0) p.splice(i, 1); } }
const H = {
  tab: ds => { S.tab = ds.t; save(); render(); scrollTo(0, 0); },
  sel: ds => { S.sel = ds.d; if (ds.mode) S.planMode = ds.mode; S.tab = 'plan'; save(); render(); },
  mode: ds => { S.planMode = ds.m; save(); render(); },
  pf: ds => { S.poolFilter = ds.f; save(); render(); },
  up: ds => { const p = S.days[ds.d].program, i = +ds.i; if (i > 0) [p[i - 1], p[i]] = [p[i], p[i - 1]]; save(); render(); },
  down: ds => { const p = S.days[ds.d].program, i = +ds.i; if (i < p.length - 1) [p[i + 1], p[i]] = [p[i], p[i + 1]]; save(); render(); },
  rm: ds => { const t = act(S.days[ds.d].program[+ds.i])?.title; S.days[ds.d].program.splice(+ds.i, 1); save(); render(); toast(`„${t}“ → Ideen`); },
  done: ds => { S.done[ds.id] = !S.done[ds.id]; save(); render(); if ($('#sheet').classList.contains('on')) openDetail(ds.id); },
  move: ds => openPickDay(S.days[ds.d].program[+ds.i]),
  pickDay: ds => openPickDay(ds.id),
  placeOn: ds => { removeEverywhere(ds.id); S.days[ds.d].program.push(ds.id); save(); closeSheet(); render(); toast(`Eingeplant: ${dLabel(ds.d)}`); },
  unplan: ds => { removeEverywhere(ds.id); save(); closeSheet(); render(); },
  lock: ds => { S.days[ds.d].locked = !S.days[ds.d].locked; save(); render(); toast(S.days[ds.d].locked ? 'Tag fixiert: wird nicht umgeplant' : 'Tag freigegeben'); },
  detail: ds => openDetail(ds.id, ds.d),
  add: ds => openAdd(ds.d),
  custom: ds => openCustom(ds.d),
  suggest: () => openSuggest(),
  optimize: () => openOptimize(),
  applyOpt: () => {
    for (const c of lastOpt.changes) Object.assign(S.days[c.d], { program: c.to.program.slice(), start: c.to.start, title: c.to.title });
    save(); closeSheet(); render(); toast('Plan umgestellt ✓');
  },
  replace: ds => {
    const p = S.days[ds.d].program, old = act(ds.old);
    if (!p.includes(ds.old)) return toast('Erst die Umstellung übernehmen');
    removeEverywhere(ds.alt); p.splice(p.indexOf(ds.old), 1, ds.alt);
    save(); render(); toast(`${old.title} → Ideen, ${act(ds.alt).title} eingeplant`);
    if (ds.fromopt) openOptimize(); else closeSheet();
  },
  saveCustom: ds => {
    const title = $('#cTitle').value.trim(); if (!title) return toast('Bitte Titel angeben');
    const place = $('#cPlace').value.trim(), m = place.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/) || place.match(/(-?\d{1,2}\.\d{3,}),\s*(-?\d{1,3}\.\d{3,})/);
    const zone = $('#cZone').value, z = ZONES[zone];
    const a = { id: 'c-' + Date.now(), custom: true, title, type: $('#cType').value, dur: parseFloat($('#cDur').value.replace(',', '.')) || 1, zone,
      profile: $('#cType').value === 'food' ? 'indoor' : 'coast', lat: m ? +m[1] : z.lat, lon: m ? +m[2] : z.lon,
      mapsQ: m ? null : (place && !place.startsWith('http') ? place : null), komoot: $('#cKomoot').value.trim() || null, desc: $('#cDesc').value.trim(), tips: [] };
    if (place.startsWith('http') && !m) a.info = place;
    S.custom.push(a); if (ds.d) S.days[ds.d].program.push(a.id); save(); closeSheet(); render(); toast('Gespeichert');
  },
  delCustom: ds => { if (!confirm('Eigene Aktivität löschen?')) return; removeEverywhere(ds.id); S.custom = S.custom.filter(c => c.id !== ds.id); save(); closeSheet(); render(); },
  close: () => closeSheet(),
  wx: async () => { toast('Lade Wetter …'); const ok = await fetchWeather(true); toast(ok ? 'Wetter aktualisiert' : 'Kein Netz, alte Daten bleiben'); render(); },
  reroll: () => { S.demoSeed++; save(); render(); toast('Neues Testwetter 🎲'); },
  photoAdd: ds => { photoKey = ds.key; $('#photoInput').click(); },
  photo: async ds => {
    const ph = await Photos.get(+ds.id); if (!ph) return;
    openSheet('Foto', `<img src="${photoUrl(ph.blob)}" style="width:100%;border-radius:12px" alt=""><div class="muted small">${new Date(ph.ts).toLocaleString('de-DE')}</div>
      <div class="row" style="margin-top:10px"><button class="btn" data-a="sharePhoto" data-id="${ph.id}">📤 Teilen/Sichern</button><button class="btn" data-a="photoDel" data-id="${ph.id}">🗑 Löschen</button></div>`);
  },
  sharePhoto: async ds => {
    const ph = await Photos.get(+ds.id); const f = new File([ph.blob], `madeira-${ph.id}.jpg`, { type: 'image/jpeg' });
    if (navigator.canShare?.({ files: [f] })) navigator.share({ files: [f] }).catch(() => {}); else toast('Teilen nicht verfügbar');
  },
  photoDel: async ds => { if (!confirm('Foto löschen?')) return; await Photos.del(+ds.id); closeSheet(); render(); },
  export: async () => {
    const blob = new Blob([JSON.stringify({ app: 'madeira26', v: 1, state: S }, null, 1)], { type: 'application/json' });
    const f = new File([blob], `madeira-plan-${ymd(new Date())}.json`, { type: 'application/json' });
    if (navigator.canShare?.({ files: [f] })) { navigator.share({ files: [f], title: 'Madeira-Plan' }).catch(() => {}); return; }
    const u = URL.createObjectURL(blob), l = document.createElement('a'); l.href = u; l.download = f.name; l.click(); setTimeout(() => URL.revokeObjectURL(u), 2000);
  },
  import: () => $('#importInput').click(),
  reset: () => { if (!confirm('Plan auf den Standard zurücksetzen? Notizen, Checkliste und eigene Aktivitäten bleiben erhalten.')) return; S.days = clone(DEFAULT_PLAN); save(); render(); },
  offline: async () => {
    if (!navigator.onLine) return toast('Dafür wird Netz gebraucht');
    await fetchWeather(true);
    const acts = [...ACTIVITIES, ...S.custom]; let n = 0;
    for (const a of acts) {
      const im = await images(a);
      await Promise.all(im.map(x => fetch(x.src, { mode: 'no-cors' }).catch(() => {})));
      toast(`Offline laden … ${++n}/${acts.length}`);
    }
    toast('Fertig: Bilder, Wetter und App sind offline verfügbar ✓'); render();
  }
};
let photoKey = null;

document.addEventListener('click', e => {
  const tab = e.target.closest('.tabs button'); if (tab) return H.tab({ t: tab.dataset.tab });
  const b = e.target.closest('[data-a]'); if (!b) return;
  if (b.tagName === 'A' && b.getAttribute('href') !== '#') return;
  e.preventDefault(); e.stopPropagation();
  H[b.dataset.a]?.(b.dataset, b);
});
$('#sheetBg').addEventListener('click', closeSheet);
document.addEventListener('change', e => {
  const el = e.target, c = el.dataset.c; if (!c) return;
  if (c === 'start') { S.days[el.dataset.d].start = el.value || '08:30'; save(); render(); }
  if (c === 'daynote') { S.days[el.dataset.d].note = el.value; save(); }
  if (c === 'note') { S.notes[el.dataset.id] = el.value; save(); }
  if (c === 'komoot') { if (el.value.trim()) S.komoot[el.dataset.id] = el.value.trim(); else delete S.komoot[el.dataset.id]; save(); toast('Komoot-Link gespeichert'); }
  if (c === 'check') { S.check[el.dataset.k] = el.checked; el.closest('.check').classList.toggle('on', el.checked); save(); }
  if (c === 'demo') { S.demo = el.checked; if (S.demo && !S.simDate) { S.simDate = '2026-12-21'; S.simTime = '08:00'; } save(); render(); }
  if (c === 'simDate') { S.simDate = el.value; save(); render(); }
  if (c === 'simTime') { S.simTime = el.value; save(); render(); }
});
document.addEventListener('input', e => {
  if (e.target.dataset.c !== 'filterAdd') return;
  const q = e.target.value.toLowerCase();
  document.querySelectorAll('#sheet [data-q]').forEach(b => { b.style.display = b.dataset.q.includes(q) ? '' : 'none'; });
});
$('#photoInput').addEventListener('change', async e => {
  const files = [...e.target.files]; e.target.value = ''; if (!files.length || !photoKey) return;
  toast('Speichere Fotos …');
  for (const f of files) await Photos.add(photoKey, await shrink(f));
  toast(`${files.length} Foto(s) gespeichert`);
  document.querySelectorAll(`[data-photos="${photoKey}"]`).forEach(el => fillPhotos(el, photoKey));
});
$('#importInput').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  try {
    const j = JSON.parse(await f.text()); if (j.app !== 'madeira26') throw new Error();
    if (!confirm('Plan aus Datei übernehmen? Der aktuelle Plan wird ersetzt.')) return;
    S = Object.assign(defaultState(), j.state); save(); render(); toast('Plan importiert ✓');
  } catch { toast('Datei nicht erkannt'); }
});
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove('on'), 2600); }
addEventListener('online', async () => { await fetchWeather(); render(); });
addEventListener('offline', render);
document.addEventListener('visibilitychange', async () => { if (document.visibilityState === 'visible') { if (await fetchWeather()) render(); else if (S.tab === 'today') render(); } });

// ---------- Start ----------
{ const q = new URLSearchParams(location.search); if (q.get('tab')) S.tab = q.get('tab'); if (q.get('d')) S.sel = q.get('d'); }
render();
fetchWeather().then(ok => ok && render());
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
