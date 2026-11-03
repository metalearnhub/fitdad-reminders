/* FitDad — wellness reminders engine
 * Uses Capacitor's native LocalNotifications (exact alarms) so reminders fire
 * with the app closed and the phone locked. Falls back to a no-op in a browser.
 */
(function () {
  'use strict';

  function showError(msg) {
    let b = document.getElementById('errBanner');
    if (!b) {
      b = document.createElement('div'); b.id = 'errBanner';
      b.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99;background:#7f1d1d;color:#fff;font:12px monospace;padding:8px;max-height:30vh;overflow:auto;pointer-events:none';
      document.body.appendChild(b);
    }
    b.textContent = 'FitDad error: ' + msg;
  }
  window.addEventListener('error', (e) => showError(e.message));
  window.addEventListener('unhandledrejection', (e) => showError(String(e.reason && e.reason.message || e.reason)));

  // ---------- Native bridges ----------
  const Cap = window.Capacitor;
  const isNative = !!(Cap && Cap.isNativePlatform && Cap.isNativePlatform());
  // Tiny plugin proxy over the native bridge (no @capacitor/core bundle needed)
  const plugin = (name) => new Proxy({}, {
    get: (_, method) => method === 'addListener'
      ? (eventName, cb) => Cap.addListener(name, eventName, cb)
      : (opts = {}) => Cap.nativePromise(name, method, opts),
  });
  const LN = isNative ? plugin('LocalNotifications') : null;
  const Prefs = isNative ? plugin('Preferences') : null;
  const AppPlugin = isNative ? plugin('App') : null;
  const Widget = isNative ? plugin('WidgetBridge') : null;

  // ---------- IDs & channels ----------
  const ID = { STAND: 1000, WATER: 2000, NUDGE: 3000, CHECK: 4000, SNOOZE: 5000, TEST: 9000 };
  const CH_ALARM = 'fitdad-alarm';
  const CH_WATER = 'fitdad-water';

  // ---------- Defaults ----------
  const DEFAULTS = {
    standEvery: 30,       // minutes
    waterEvery: 60,       // minutes (used when waterMode = 'fixed')
    waterMode: 'auto',    // 'auto' = spread remaining glasses from now until bedtime; 'fixed' = every N minutes
    waterGoal: 3000,      // ml
    glass: 250,           // ml
    nudgeTime: '09:00',
    nudgeRepeat: 45,      // minutes
    nudgeMax: 4,
    nudgeDays: [0, 1, 2, 3, 4, 5, 6], // Sun..Sat
    checkTime: '16:00',
    bedTime: '23:00',     // planned sleep time — water is spread from now until bedtime
    lastGlassBefore: 60,  // minutes before bed for the last glass (fewer bathroom trips at night)
  };

  let settings = { ...DEFAULTS };
  let days = {}; // { 'YYYY-MM-DD': { status, startedAt, pausedAt, pausedMs, water, stands } }

  // ---------- Utils ----------
  const $ = (id) => document.getElementById(id);
  const pad = (n) => String(n).padStart(2, '0');
  const dayKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const atTime = (base, hhmm) => {
    const [h, m] = hhmm.split(':').map(Number);
    const d = new Date(base); d.setHours(h, m, 0, 0); return d;
  };
  const fmtTime = (d) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const liters = (ml) => (ml / 1000).toFixed(2) + ' L';
  const totalGlasses = () => Math.ceil(settings.waterGoal / settings.glass);
  const glassesLeft = (water) => Math.max(0, Math.ceil((settings.waterGoal - water) / settings.glass));
  // planned interval (minutes) for a full day, used for the plan preview

  function rec(k) {
    if (!days[k]) days[k] = { status: 'idle', startedAt: null, pausedAt: null, pausedMs: 0, water: 0, stands: 0 };
    const r = days[k];
    if (!r.log) r.log = [];            // [{t, k:'water'|'stand'|'skip_w'|'skip_s'|'snooze_w'|'snooze_s', src:'notif'|'app', ml?}]
    if (!r.segments) r.segments = [];  // finished work segments [[start, end]]
    return r;
  }
  // A "day" runs from 4 AM to 4 AM, so late nights count toward the day you started
  const DAY_BOUNDARY_H = 4;
  const logicalKey = (ts = Date.now()) => dayKey(new Date(ts - DAY_BOUNDARY_H * 3600000));
  function today() { return rec(logicalKey()); }

  // Bedtime for a day (per-day override from the Today screen, else the usual one). 12–4 AM = after midnight.
  function bedtimeFor(key, bedOverride) {
    const [y, m, d] = key.split('-').map(Number);
    const base = new Date(y, m - 1, d);
    let bed = atTime(base, bedOverride || (days[key] && days[key].bedtime) || settings.bedTime).getTime();
    if (bed <= base.getTime() + DAY_BOUNDARY_H * 3600000) bed += 86400000;
    return bed;
  }
  // Today's water window: from when you started your day (Start / first glass) until 1 h before bed
  function currentWindow(bedOverride) {
    const key = logicalKey();
    const bedAt = bedtimeFor(key, bedOverride);
    return { key, start: rec(key).dayStart || null, bedAt, end: bedAt - settings.lastGlassBefore * 60000 };
  }
  function markDayStart(r) { if (!r.dayStart) r.dayStart = Date.now(); }
  function waterRec() { return today(); }

  function toast(msg) {
    const t = $('toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 2200);
  }

  // ---------- Storage ----------
  async function load() {
    try {
      const raw = isNative ? (await Prefs.get({ key: 'fitdad' })).value : localStorage.getItem('fitdad');
      if (raw) {
        const data = JSON.parse(raw);
        settings = { ...DEFAULTS, ...(data.settings || {}) };
        days = data.days || {};
      }
    } catch (e) { console.warn('load failed', e); }
    // keep only the last 60 days of history
    const keys = Object.keys(days).sort();
    while (keys.length > 60) delete days[keys.shift()];
  }

  async function save() {
    const raw = JSON.stringify({ settings, days });
    try {
      if (isNative) {
        await Prefs.set({ key: 'fitdad', value: raw });
        await Prefs.set({ key: 'fitdad_week', value: weekLine() });
        Widget.refresh().catch(() => {});
      } else localStorage.setItem('fitdad', raw);
    } catch (e) { console.warn('save failed', e); }
  }

  // ---------- Native setup ----------
  async function setupNative() {
    if (!isNative) return;
    try {
      let p = await LN.checkPermissions();
      if (p.display !== 'granted') p = await LN.requestPermissions();
      if (p.display !== 'granted') toast('Notifications are off — enable them in Settings');

      try {
        const ex = await LN.checkExactNotificationSetting();
        if (ex && ex.exact_alarm && ex.exact_alarm !== 'granted') await LN.changeExactNotificationSetting();
      } catch (_) { /* older Android: not needed */ }

      await LN.createChannel({
        id: CH_ALARM, name: 'Stand-up & nudges', description: 'Stand-up alarms and start-your-day nudges',
        importance: 5, visibility: 1, vibration: true, lights: true, lightColor: '#F59E0B', sound: 'fitdad_alarm.wav',
      });
      await LN.createChannel({
        id: CH_WATER, name: 'Water reminders', description: 'Drink-water reminders and check-ins',
        importance: 5, visibility: 1, vibration: true, sound: 'fitdad_water.wav',
      });

      await LN.registerActionTypes({
        types: [
          { id: 'STAND', actions: [{ id: 'done', title: 'Done ✓' }, { id: 'snooze', title: 'Snooze 5 min' }] },
          { id: 'WATER', actions: [{ id: 'drank', title: 'Drank a glass' }, { id: 'snooze', title: 'Snooze 10 min' }] },
          { id: 'NUDGE', actions: [{ id: 'start', title: 'Start now' }, { id: 'later', title: 'Later' }, { id: 'dayoff', title: 'Day off' }] },
        ],
      });

      LN.addListener('localNotificationActionPerformed', (ev) => handleAction(ev).catch(console.error));

      if (AppPlugin) {
        AppPlugin.addListener('resume', async () => { await load(); autoEndIfNeeded(); render(); await reschedule(); });
        AppPlugin.addListener('appUrlOpen', (e) => handleDeepLink(e && e.url));
        try { const l = await AppPlugin.getLaunchUrl(); if (l && l.url) setTimeout(() => handleDeepLink(l.url), 300); } catch (_) { }
      }
    } catch (e) {
      console.error('native setup failed', e);
    }
  }

  // ---------- Confirmations (single source of truth for analytics) ----------
  function logEvent(r, k, src, ml) { r.log.push(ml ? { t: Date.now(), k, src, ml } : { t: Date.now(), k, src }); }
  function confirmWater(src) {
    const r = waterRec(); markDayStart(r); r.water += settings.glass; logEvent(r, 'water', src, settings.glass);
    toast(`+${settings.glass} ml logged · ${liters(Math.max(0, settings.waterGoal - r.water))} to go`);
  }
  function undoWater() {
    const r = waterRec();
    for (let i = r.log.length - 1; i >= 0; i--) if (r.log[i].k === 'water') { r.water = Math.max(0, r.water - r.log[i].ml); r.log.splice(i, 1); return; }
    r.water = Math.max(0, r.water - settings.glass);
  }
  function confirmStand(src) { const r = today(); r.stands++; logEvent(r, 'stand', src); toast('Nice. Stand-up logged.'); }
  function skip(kind, src) { logEvent(kind === 'stand' ? today() : waterRec(), kind === 'stand' ? 'skip_s' : 'skip_w', src); toast('Skipped'); }

  // In-app confirm sheet — opening a notification lands here, so tap = same choices as the buttons
  function openSheet(kind) {
    const sheet = $('sheet'), body = $('sheetBody');
    const opts = kind === 'stand'
      ? { icon: '🧍', title: 'Did you stand up?', sub: 'Stand, stretch, walk for 2 minutes — take pressure off your back.',
          btns: [['Yes, I stood up', 'stand', () => confirmStand('notif')], ['Snooze 5 min', 'ghost', () => snooze('stand', 5)], ['Skip', 'ghost', () => skip('stand', 'notif')]] }
      : kind === 'nudge'
        ? { icon: '☀️', title: 'Start your wellness day?', sub: 'Turns on stand-up reminders for your work session.',
            btns: [['Start now', 'primary', startSession], ['Later', 'ghost', () => {}], ['Day off', 'ghost', dayOff]] }
        : { icon: '💧', title: `Drink a ${settings.glass} ml glass?`, sub: `${liters(Math.max(0, settings.waterGoal - waterRec().water))} left to reach ${liters(settings.waterGoal)}.`,
            btns: [['Drank it', 'water', () => confirmWater('notif')], ['Snooze 10 min', 'ghost', () => snooze('water', 10)], ['Skip', 'ghost', () => skip('water', 'notif')]] };
    body.innerHTML = `<div class="sheet-icon">${opts.icon}</div><h2>${opts.title}</h2><p class="muted">${opts.sub}</p><div class="sheet-btns"></div>`;
    const wrap = body.querySelector('.sheet-btns');
    opts.btns.forEach(([label, cls, fn]) => {
      const b = document.createElement('button'); b.className = 'btn ' + cls; b.textContent = label;
      b.onclick = async () => { closeSheet(); await fn(); await save(); render(); await reschedule(); };
      wrap.appendChild(b);
    });
    sheet.classList.add('show');
  }
  function openBedSheet() {
    const r = rec(currentWindow().key);
    const body = $('sheetBody');
    body.innerHTML = `<div class="sheet-icon">🌙</div><h2>What time will you sleep tonight?</h2>
      <p class="muted">Your remaining water is spread from now until 1 hour before bed.</p>
      <div class="chips center-chips" id="sheetBed"></div>
      <div class="sheet-btns"><button class="btn ghost" id="sheetBedDefault">Use my usual (${fmtTime(atTime(new Date(), settings.bedTime))})</button></div>`;
    const pick = async (bt) => { r.bedtime = bt; closeSheet(); await save(); render(); await reschedule(); toast(`Bedtime ${fmtTime(atTime(new Date(), bt))} — water re-planned`); };
    bedChips($('sheetBed'), r.bedtime || settings.bedTime, pick);
    $('sheetBedDefault').onclick = async () => { delete r.bedtime; closeSheet(); await save(); render(); await reschedule(); };
    $('sheet').classList.add('show');
  }
  function closeSheet() { $('sheet').classList.remove('show'); }

  // ---------- Deep links from the home-screen widget ----------
  function showTab(name) {
    document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x.dataset.view === name));
    document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + name));
    if (name === 'stats') renderStats();
    if (name === 'settings') renderSettings();
  }
  async function handleDeepLink(url) {
    if (!url || !url.startsWith('fitdad://')) return;
    await load();
    const what = url.replace('fitdad://', '').replace(/\/$/, '');
    if (what === 'start') {
      if (today().status !== 'active') startSession();
      showTab('today');
    } else if (what === 'stats') showTab('stats');
    else showTab('today');
    await save(); render(); await reschedule();
  }

  // ---------- Actions from notifications ----------
  async function handleAction(ev) {
    await load(); // pick up anything the widget logged meanwhile
    const n = ev.notification || {};
    const kind = (n.extra && n.extra.kind) || '';
    const a = ev.actionId;
    const k = kind === 'check' ? 'water' : kind;

    // Tapping the notification itself opens the app on a confirm sheet with the same choices
    if (a === 'tap') { if (['stand', 'water', 'nudge'].includes(k)) openSheet(k); return; }

    if (k === 'stand') {
      if (a === 'snooze') await snooze('stand', 5);
      else if (a === 'done') confirmStand('notif');
    } else if (k === 'water') {
      if (a === 'snooze') await snooze('water', 10);
      else if (a === 'drank') confirmWater('notif');
    } else if (k === 'nudge') {
      if (a === 'start') startSession();
      else if (a === 'dayoff') dayOff();
    }
    await save(); render(); await reschedule();
  }

  async function snooze(kind, minutes) {
    if (!isNative) { toast(`Snoozed ${minutes} min`); return; }
    const at = new Date(Date.now() + minutes * 60000);
    const isStand = kind === 'stand';
    logEvent(isStand ? today() : waterRec(), isStand ? 'snooze_s' : 'snooze_w', 'notif');
    await LN.schedule({ notifications: [{
      id: ID.SNOOZE + Math.floor(Math.random() * 900),
      title: isStand ? 'Stand up now 🧍' : 'Drink water 💧',
      body: isStand ? 'Snooze is over. Get up and move for 2 minutes.' : `Have a ${settings.glass} ml glass.`,
      channelId: isStand ? CH_ALARM : CH_WATER,
      actionTypeId: isStand ? 'STAND' : 'WATER',
      smallIcon: 'ic_stat_fitdad', iconColor: '#F59E0B',
      extra: { kind },
      schedule: { at, allowWhileIdle: true },
    }] });
    toast(`Snoozed ${minutes} min`);
  }

  // ---------- Session control ----------
  function startSession() {
    const t = today();
    if (t.status === 'paused' && t.pausedAt) { t.pausedMs += Date.now() - t.pausedAt; t.pausedAt = null; }
    if (!t.startedAt || t.status === 'ended' || t.status === 'off' || t.status === 'idle') {
      t.startedAt = Date.now(); t.pausedMs = 0; t.pausedAt = null;
    }
    if (t.status !== 'active') t.segStart = Date.now();
    markDayStart(t);
    t.status = 'active';
    toast('Day started — reminders on');
  }
  function closeSegment(t, at) { if (t.segStart) { t.segments.push([t.segStart, at]); t.segStart = null; } }
  function pauseSession() { const t = today(); closeSegment(t, Date.now()); t.status = 'paused'; t.pausedAt = Date.now(); toast('Paused'); }
  function endSession() { const t = today(); closeSegment(t, Date.now()); t.status = 'ended'; t.pausedAt = null; toast('Day ended. Good work.'); }
  function dayOff() { const t = today(); markDayStart(t); t.status = 'off'; toast('Day off — see you tomorrow'); }

  function sessionEnd(t) {
    return t.startedAt ? currentWindow().bedAt : 0; // stand-ups stop at bedtime
  }
  function autoEndIfNeeded() {
    const t = today();
    if (t.status === 'active' && Date.now() > sessionEnd(t)) { closeSegment(t, sessionEnd(t)); t.status = 'ended'; }
    // close a segment left open from a previous day
    Object.keys(days).forEach((k) => { const r = days[k]; if (k !== logicalKey() && r.segStart) { closeSegment(rec(k), Math.min(Date.now(), bedtimeFor(k))); if (r.status === 'active') r.status = 'ended'; } });
  }

  // ---------- Scheduling ----------
  function buildNotifications() {
    const out = [];
    const now = Date.now();
    const t = today();

    // 1) Session reminders (only while active)
    if (t.status === 'active') {
      const end = sessionEnd(t);
      // fixed grid from session start (shifted by pauses), so logging water never resets the stand timer
      const anchor = t.startedAt + t.pausedMs;
      const firstAfter = (every) => anchor + Math.max(1, Math.ceil((now + 30000 - anchor) / every)) * every;
      let i = 0;
      for (let ts = firstAfter(settings.standEvery * 60000); ts <= end && i < 60; ts += settings.standEvery * 60000, i++) {
        out.push({
          id: ID.STAND + i, title: 'Stand up 🧍', body: 'Time to get up — stretch, walk, take pressure off your back.',
          channelId: CH_ALARM, actionTypeId: 'STAND', extra: { kind: 'stand' }, at: ts,
        });
      }
    }

    // 2) Water: from now until 1 h before bed — only the glasses still needed, so it stops at the goal
    const total = totalGlasses();
    const cw = currentWindow();
    const wr = rec(cw.key);
    const left = glassesLeft(wr.water);
    if (cw.start && left > 0 && cw.end > now) {
      const times = [];
      if (settings.waterMode === 'fixed') {
        const step = settings.waterEvery * 60000;
        for (let ts = cw.start + step; ts <= cw.end && times.length < left; ts += step) if (ts > now + 30000) times.push(ts);
      } else {
        const step = Math.max(15 * 60000, (cw.end - now) / left);
        for (let k = 0; k < left; k++) { const ts = Math.round(now + step * (k + 0.5)); if (ts <= cw.end) times.push(ts); }
      }
      times.slice(0, 40).forEach((ts, k) => {
        const glassNo = total - left + k + 1;
        const after = Math.max(0, settings.waterGoal - (glassNo - 1) * settings.glass);
        out.push({
          id: ID.WATER + k, title: `Drink water 💧 Glass ${glassNo} of ${total}`,
          body: `${settings.glass} ml now · ${liters(after)} left to reach ${liters(settings.waterGoal)}`,
          channelId: CH_WATER, actionTypeId: 'WATER', extra: { kind: 'water' }, at: ts,
        });
      });
    }

    // 3) Water safety-net check-in today
    const wRemaining = Math.max(0, settings.waterGoal - wr.water);
    const check = atTime(new Date(), settings.checkTime).getTime();
    if (cw.start && check > now && check < cw.end && wRemaining > settings.waterGoal * 0.4) {
      out.push({
        id: ID.CHECK, title: `Behind on water: ${liters(wRemaining)} to go`,
        body: `You've had ${liters(wr.water)} of ${liters(settings.waterGoal)}. Drink a glass now.`,
        channelId: CH_WATER, actionTypeId: 'WATER', extra: { kind: 'check' }, at: check,
      });
    }

    // 4) Morning nudges for today (if not started) and the next 13 days
    let n = 0;
    for (let d = 0; d < 14; d++) {
      const date = new Date(); date.setDate(date.getDate() + d);
      if (!settings.nudgeDays.includes(date.getDay())) continue;
      const rec = days[dayKey(date)];
      if (d === 0 && (today().status !== 'idle' || today().dayStart)) continue;
      const first = atTime(date, settings.nudgeTime).getTime();
      for (let r = 0; r < settings.nudgeMax; r++) {
        const ts = first + r * settings.nudgeRepeat * 60000;
        if (ts <= now) continue;
        out.push({
          id: ID.NUDGE + n++,
          title: r === 0 ? 'Start your wellness day? ☀️' : 'Still not started — ready now?',
          body: 'Tap Start — water and stand-ups get planned from now until bedtime.',
          channelId: CH_ALARM, actionTypeId: 'NUDGE', extra: { kind: 'nudge' }, at: ts,
        });
      }
    }
    return out;
  }

  async function reschedule() {
    const list = buildNotifications();
    updateNextLabel(list);
    if (!isNative) return;
    try {
      const pending = await LN.getPending();
      const managed = (pending.notifications || []).filter((p) => p.id < ID.SNOOZE || p.id >= ID.TEST + 1000);
      if (managed.length) await LN.cancel({ notifications: managed.map((p) => ({ id: p.id })) });
      if (list.length) {
        await LN.schedule({
          notifications: list.map((x) => ({
            id: x.id, title: x.title, body: x.body, channelId: x.channelId, actionTypeId: x.actionTypeId,
            extra: x.extra, smallIcon: 'ic_stat_fitdad', iconColor: '#F59E0B', autoCancel: true,
            schedule: { at: new Date(x.at), allowWhileIdle: true },
          })),
        });
      }
    } catch (e) { console.error('reschedule failed', e); toast('Could not schedule reminders'); }
  }

  async function testNotif(kind) {
    if (!isNative) { toast('Test works on the phone app only'); return; }
    const isStand = kind === 'stand';
    await LN.schedule({ notifications: [{
      id: ID.TEST + (isStand ? 1 : 2), title: isStand ? 'Test: Stand up 🧍' : 'Test: Drink water 💧',
      body: 'If you heard this, reminders work.', channelId: isStand ? CH_ALARM : CH_WATER,
      actionTypeId: isStand ? 'STAND' : 'WATER', extra: { kind: 'test' },
      smallIcon: 'ic_stat_fitdad', iconColor: '#F59E0B',
      schedule: { at: new Date(Date.now() + 10000), allowWhileIdle: true },
    }] });
    toast('Test alarm in 10 seconds — lock your phone');
  }


  // ---------- Analytics ----------
  const fmtDur = (ms) => { const m = Math.round(ms / 60000); return m >= 60 ? `${Math.floor(m / 60)}h ${pad(m % 60)}m` : `${m}m`; };
  function dayStats(key) {
    const r = days[key] || { water: 0, stands: 0, log: [], segments: [] };
    const log = r.log || [];
    const segs = (r.segments || []).slice();
    if (r.segStart && key === logicalKey()) segs.push([r.segStart, Date.now()]);
    const standTimes = log.filter((e) => e.k === 'stand').map((e) => e.t).sort((a, b) => a - b);
    let workMs = 0, expected = 0, longest = 0;
    segs.forEach(([a, b]) => {
      workMs += b - a;
      expected += Math.floor((b - a) / (settings.standEvery * 60000));
      let last = a;
      standTimes.filter((t) => t > a && t < b).forEach((t) => { longest = Math.max(longest, t - last); last = t; });
      longest = Math.max(longest, b - last);
    });
    const water = r.water || 0;
    return {
      key, water, goalMet: water >= settings.waterGoal, glasses: log.filter((e) => e.k === 'water').length,
      stands: r.stands || 0, expected, workMs, longest,
      snoozes: log.filter((e) => e.k.startsWith('snooze')).length,
      skips: log.filter((e) => e.k.startsWith('skip')).length,
      fromNotif: log.filter((e) => (e.k === 'water' || e.k === 'stand') && e.src === 'notif').length,
      log,
    };
  }
  function lastNDays(n, offset = 0) {
    const out = [];
    for (let i = n - 1 + offset; i >= offset; i--) { const d = new Date(); d.setDate(d.getDate() - i); out.push({ date: d, s: dayStats(dayKey(d)) }); }
    return out;
  }
  function summarize(list) {
    const n = list.length, sum = (f) => list.reduce((a, x) => a + f(x.s), 0);
    const worked = list.filter((x) => x.s.workMs > 0);
    return {
      avgWater: sum((s) => s.water) / n, goalDays: list.filter((x) => x.s.goalMet).length,
      stands: sum((s) => s.stands), expected: sum((s) => s.expected),
      avgLongest: worked.length ? worked.reduce((a, x) => a + x.s.longest, 0) / worked.length : 0,
      work: sum((s) => s.workMs), snoozes: sum((s) => s.snoozes), skips: sum((s) => s.skips),
    };
  }
  function streak() {
    let n = 0; const d = new Date();
    if (!dayStats(dayKey(d)).goalMet) d.setDate(d.getDate() - 1); // today still in progress
    while (dayStats(dayKey(d)).goalMet) { n++; d.setDate(d.getDate() - 1); }
    return n;
  }
  function bars(list, val, goal, color, fmt) {
    const W = 320, H = 144, pb = 20, pt = 16, max = Math.max(goal || 0, ...list.map((x) => val(x.s)), 1);
    const bw = W / list.length;
    let svg = `<svg viewBox="0 0 ${W} ${H}" class="chart">`;
    if (goal) { const gy = pt + (H - pb - pt) * (1 - goal / max); svg += `<line x1="0" x2="${W}" y1="${gy}" y2="${gy}" class="goal-line"/>`; }
    list.forEach((x, i) => {
      const v = val(x.s), h = (H - pb - pt) * (v / max), xx = i * bw + bw * 0.2;
      svg += `<rect x="${xx}" y="${H - pb - h}" width="${bw * 0.6}" height="${Math.max(h, 1)}" rx="4" fill="${color}" opacity="${v ? 1 : .25}"/>`;
      if (v) svg += `<text x="${xx + bw * 0.3}" y="${H - pb - h - 4}" class="bar-val">${fmt(v)}</text>`;
      svg += `<text x="${xx + bw * 0.3}" y="${H - 5}" class="bar-lbl">${x.date.toLocaleDateString([], { weekday: 'narrow' })}</text>`;
    });
    return svg + '</svg>';
  }
  const delta = (a, b, unit, dec = 0) => {
    if (!b) return '';
    const d = a - b; const sign = d > 0 ? '▲' : d < 0 ? '▼' : '＝';
    return `<span class="delta ${d > 0 ? 'up' : d < 0 ? 'down' : ''}">${sign} ${Math.abs(d).toFixed(dec)}${unit} vs last week</span>`;
  };

  function weekLine() {
    const a = summarize(lastNDays(7));
    return `7 days: avg ${(a.avgWater / 1000).toFixed(1)} L · goal ${a.goalDays}/7 · ${a.stands} stand-ups · streak ${streak()}`;
  }

  function renderStats() {
    const t = dayStats(logicalKey());
    const tw = t;
    const pctStand = t.expected ? Math.round(100 * Math.min(1, t.stands / t.expected)) : null;
    $('statToday').innerHTML = `
      <div class="kpis">
        <div class="kpi"><div class="kv water-c">${liters(tw.water)}</div><div class="kl">of ${liters(settings.waterGoal)} · ${tw.glasses} glasses</div></div>
        <div class="kpi"><div class="kv stand-c">${t.stands}${t.expected ? '/' + t.expected : ''}</div><div class="kl">stand-ups${pctStand !== null ? ' · ' + pctStand + '%' : ''}</div></div>
        <div class="kpi"><div class="kv">${t.workMs ? fmtDur(t.longest) : '—'}</div><div class="kl">longest sitting stretch</div></div>
        <div class="kpi"><div class="kv">${t.workMs ? fmtDur(t.workMs) : '—'}</div><div class="kl">work time tracked</div></div>
      </div>
      <p class="muted small">${t.fromNotif + tw.log.filter((e) => e.k === 'water' && e.src === 'notif' && tw.key !== t.key).length} confirmed from notifications · ${t.snoozes + (tw.key !== t.key ? tw.snoozes : 0)} snoozed · ${t.skips + (tw.key !== t.key ? tw.skips : 0)} skipped</p>`;
    const names = { water: '💧 Drank a glass', stand: '🧍 Stood up', snooze_w: '💤 Snoozed water', snooze_s: '💤 Snoozed stand-up', skip_w: '⏭ Skipped water', skip_s: '⏭ Skipped stand-up' };
    const evs = (tw.key === t.key ? t.log : tw.log.concat(t.log)).slice().sort((a, b) => b.t - a.t).slice(0, 30);
    $('statTimeline').innerHTML = evs.length
      ? evs.map((e) => `<li><span>${names[e.k] || e.k}</span><span class="muted">${fmtTime(new Date(e.t))}${e.src === 'notif' ? ' · 🔔' : ''}</span></li>`).join('')
      : '<li class="muted">Nothing logged yet today.</li>';

    const wk = lastNDays(7), prev = lastNDays(7, 7);
    const a = summarize(wk), b = summarize(prev);
    const hasPrev = prev.some((x) => x.s.water || x.s.stands);
    $('statWeek').innerHTML = `
      <div class="kpis">
        <div class="kpi"><div class="kv water-c">${liters(a.avgWater)}</div><div class="kl">avg water / day</div>${hasPrev ? delta(a.avgWater / 1000, b.avgWater / 1000, ' L', 2) : ''}</div>
        <div class="kpi"><div class="kv">${a.goalDays}/7</div><div class="kl">days goal met · streak ${streak()}</div>${hasPrev ? delta(a.goalDays, b.goalDays, ' days') : ''}</div>
        <div class="kpi"><div class="kv stand-c">${a.stands}${a.expected ? '/' + a.expected : ''}</div><div class="kl">stand-ups${a.expected ? ' · ' + Math.round(100 * Math.min(1, a.stands / a.expected)) + '%' : ''}</div>${hasPrev ? delta(a.stands, b.stands, '') : ''}</div>
        <div class="kpi"><div class="kv">${a.avgLongest ? fmtDur(a.avgLongest) : '—'}</div><div class="kl">avg longest sit</div></div>
      </div>
      <h3>Water (L) — dashed line = goal</h3>
      ${bars(wk, (s) => s.water / 1000, settings.waterGoal / 1000, 'var(--water)', (v) => v.toFixed(1))}
      <h3>Stand-ups</h3>
      ${bars(wk, (s) => s.stands, 0, 'var(--stand)', (v) => v)}
      <p class="muted small">Work time this week: ${fmtDur(a.work)} · snoozes ${a.snoozes} · skips ${a.skips}</p>`;
  }

  // ---------- Rendering ----------
  function updateNextLabel(list) {
    const now = Date.now();
    const next = (kind) => list.filter((x) => x.extra.kind === kind && x.at > now).sort((a, b) => a.at - b.at)[0];
    const s = next('stand'), w = next('water'), nd = next('nudge');
    const parts = [];
    if (s) parts.push(`Next stand-up ${fmtTime(new Date(s.at))}`);
    if (w) parts.push(`${parts.length ? "next" : "Next"} water ${fmtTime(new Date(w.at))}`);
    if (!parts.length && nd) parts.push(`Next nudge ${new Date(nd.at).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}`);
    $('nextLabel').textContent = parts.join(' · ');
  }

  function render() {
    const t = today();
    $('todayLabel').textContent = new Date().toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });

    const pill = $('statusPill');
    pill.className = 'pill';
    const btns = $('sessionButtons');
    btns.innerHTML = '';
    const mk = (label, cls, fn) => {
      const b = document.createElement('button'); b.className = 'btn ' + cls; b.textContent = label;
      b.onclick = async () => { fn(); await save(); render(); await reschedule(); };
      btns.appendChild(b);
    };

    if (t.status === 'active') {
      pill.textContent = 'Working'; pill.classList.add('active');
      $('statusHeadline').textContent = 'Reminders are on';
      $('statusSub').textContent = `Stand-ups run until you end the day or bedtime (${fmtTime(new Date(sessionEnd(t)))}).`;
      $('sessionInfo').textContent = `Since ${fmtTime(new Date(t.startedAt))}`;
      mk('Pause', 'ghost', pauseSession); mk('End day', 'danger', endSession);
    } else if (t.status === 'paused') {
      pill.textContent = 'Paused'; pill.classList.add('paused');
      $('statusHeadline').textContent = 'On a break';
      $('statusSub').textContent = 'Reminders are paused. Resume when you sit back down.';
      $('sessionInfo').textContent = '';
      mk('Resume', 'primary', startSession); mk('End day', 'danger', endSession);
    } else if (t.status === 'ended') {
      pill.textContent = 'Done';
      $('statusHeadline').textContent = 'Day wrapped up';
      $('statusSub').textContent = 'Stand-ups off. Water reminders keep going until bedtime.';
      $('sessionInfo').textContent = '';
      mk('Start again', 'primary', startSession);
    } else if (t.status === 'off') {
      pill.textContent = 'Day off'; pill.classList.add('off');
      $('statusHeadline').textContent = 'Rest day';
      $('statusSub').textContent = 'No stand-up alarms today. Water reminders still run until bedtime.';
      $('sessionInfo').textContent = '';
      mk('Start anyway', 'primary', startSession);
    } else {
      pill.textContent = 'Not started';
      $('statusHeadline').textContent = 'Ready to work?';
      $('statusSub').textContent = `Tap Start — water and stand-ups get planned from now until bedtime (${fmtTime(new Date(currentWindow().bedAt))}). If you forget, I'll nudge you at ${fmtTime(atTime(new Date(), settings.nudgeTime))}.`;
      $('sessionInfo').textContent = '';
      mk('Start day', 'primary', startSession); mk('Day off', 'ghost', dayOff);
    }

    // water (today's start → bedtime)
    const wt = waterRec();
    const pct = Math.min(1, wt.water / settings.waterGoal);
    $('waterRing').style.strokeDashoffset = String(326.7 * (1 - pct));
    $('waterAmount').textContent = liters(wt.water);
    const left = settings.waterGoal - wt.water;
    $('waterLeft').textContent = left > 0 ? `${liters(left)} to go` : 'Goal reached 🎉';
    $('waterGoalLabel').textContent = `Goal ${liters(settings.waterGoal)}`;
    const total = totalGlasses(), gl = glassesLeft(wt.water);
    const cwin = currentWindow();
    $('waterPlan').textContent = !cwin.start && gl > 0 ? `${total} glasses × ${settings.glass} ml — plan starts when you tap Start (or log a glass)` : (gl > 0
      ? `Glass ${total - gl + 1} of ${total} · ${gl} × ${settings.glass} ml left`
      : `All ${total} glasses done — reminders stopped for today`)
      ;
    $('bedLabel').textContent = `Bedtime ${fmtTime(new Date(cwin.bedAt))} · last glass by ${fmtTime(new Date(cwin.end))}`;
    $('waterPlus').textContent = `+ ${settings.glass} ml`;

    // stand
    $('standCount').textContent = t.stands;
    $('standEveryLabel').textContent = `Every ${settings.standEvery} min`;
    if ($('view-stats').classList.contains('active')) renderStats();
  }

  function renderSettings() {
    $('s-standEvery').value = settings.standEvery;
    $('s-waterEvery').value = settings.waterEvery;
    modeDraft = null;
    $('s-waterGoal').value = settings.waterGoal;
    $('s-glass').value = settings.glass;
    $('s-nudgeTime').value = settings.nudgeTime;
    $('s-nudgeRepeat').value = settings.nudgeRepeat;
    $('s-nudgeMax').value = settings.nudgeMax;
    $('s-checkTime').value = settings.checkTime;
    bedDraft = null;
    renderWaterPlanner();
    const wrap = $('s-days'); wrap.innerHTML = '';
    ['S', 'M', 'T', 'W', 'T', 'F', 'S'].forEach((l, i) => {
      const b = document.createElement('button');
      b.className = 'day' + (settings.nudgeDays.includes(i) ? ' on' : ''); b.textContent = l;
      b.onclick = () => {
        settings.nudgeDays = settings.nudgeDays.includes(i)
          ? settings.nudgeDays.filter((x) => x !== i) : [...settings.nudgeDays, i];
        b.classList.toggle('on');
      };
      wrap.appendChild(b);
    });
  }

  let modeDraft = null;
  let bedDraft = null;
  const BEDTIMES = ['21:00', '22:00', '23:00', '00:00', '01:00', '02:00'];
  function bedChips(container, current, onPick) {
    container.innerHTML = '';
    BEDTIMES.forEach((bt) => {
      const b = document.createElement('button');
      b.className = 'chip' + (bt === current ? ' on' : ''); b.textContent = fmtTime(atTime(new Date(), bt));
      b.onclick = () => onPick(bt);
      container.appendChild(b);
    });
  }
  // Plan from right now: how much time is left until the last glass, and how many glasses remain
  function planFromNow(goal, glass, every, fixed, bed) {
    const now = Date.now();
    const w = currentWindow(bed);
    const from = now;
    const minsLeft = Math.max(0, Math.round((w.end - from) / 60000));
    const drank = waterRec().water;
    const left = Math.max(0, Math.ceil((goal - drank) / glass));
    const iv = fixed ? every : (left ? Math.max(15, Math.floor(minsLeft / left)) : 0);
    return { w, from, minsLeft, left, iv, fits: fixed ? Math.floor(minsLeft / every) : left };
  }
  const TEMPLATES = [
    { label: '2.0 L · 8 × 250', goal: 2000, glass: 250 },
    { label: '2.5 L · 10 × 250', goal: 2500, glass: 250 },
    { label: '3.0 L · 12 × 250', goal: 3000, glass: 250 },
    { label: '3.0 L · 6 × 500', goal: 3000, glass: 500 },
    { label: '3.5 L · 10 × 350', goal: 3500, glass: 350 },
  ];

  function renderWaterPlanner() {
    const tpl = $('s-templates'); tpl.innerHTML = '';
    TEMPLATES.forEach((x) => {
      const b = document.createElement('button');
      b.className = 'chip' + (Number($('s-waterGoal').value) === x.goal && Number($('s-glass').value) === x.glass ? ' on' : '');
      b.textContent = x.label;
      b.onclick = () => { $('s-waterGoal').value = x.goal; $('s-glass').value = x.glass; renderWaterPlanner(); };
      tpl.appendChild(b);
    });
    const bed = bedDraft || settings.bedTime;
    bedChips($('s-bed'), bed, (bt) => { bedDraft = bt; renderWaterPlanner(); });
    const fixed = (modeDraft || settings.waterMode) === 'fixed';
    $('s-waterMode-auto').classList.toggle('on', !fixed);
    $('s-waterMode-fixed').classList.toggle('on', fixed);
    $('s-waterEveryRow').style.display = fixed ? '' : 'none';
    // live preview from the current (unsaved) inputs
    const goal = Number($('s-waterGoal').value) || settings.waterGoal;
    const glass = Number($('s-glass').value) || settings.glass;
    const n = Math.ceil(goal / glass);
    const every = Number($('s-waterEvery').value) || settings.waterEvery;
    const p = planFromNow(goal, glass, every, fixed, bed);
    const h = (m) => `${Math.floor(m / 60)} h ${pad(m % 60)} m`;
    let msg = `${(goal / 1000).toFixed(2)} L = ${n} glasses × ${glass} ml. `;
    if (p.left === 0) msg += 'Goal already reached today. 🎉';
    else if (p.minsLeft === 0) msg += `It's past your last-glass time (${fmtTime(new Date(p.w.end))}). Tomorrow's plan starts when you start your day.`;
    else {
      msg += `${p.w.start ? 'From now' : 'If you start now'} (${fmtTime(new Date())}) until ${fmtTime(new Date(p.w.end))} (1 h before your ${fmtTime(new Date(p.w.bedAt))} bedtime) = ${h(p.minsLeft)} → ${p.left} glass${p.left > 1 ? 'es' : ''} left, one every ${p.iv} min.`;
      if (fixed && p.fits < p.left) msg += ` ⚠ Only ${p.fits} fit before bed at every ${every} min — shorten the interval or use bigger glasses.`;
      else msg += ' Reminders stop once the goal is met.';
    }
    $('s-waterPreview').textContent = msg;
  }

  function readSettings() {
    const num = (id, min, max, def) => {
      const v = Number($(id).value); return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : def;
    };
    settings.standEvery = num('s-standEvery', 10, 180, DEFAULTS.standEvery);
    settings.waterEvery = num('s-waterEvery', 15, 240, DEFAULTS.waterEvery);
    settings.waterMode = $('s-waterMode-fixed').classList.contains('on') ? 'fixed' : 'auto';
    settings.waterGoal = num('s-waterGoal', 1000, 6000, DEFAULTS.waterGoal);
    settings.glass = num('s-glass', 100, 1000, DEFAULTS.glass);
    settings.nudgeRepeat = num('s-nudgeRepeat', 15, 180, DEFAULTS.nudgeRepeat);
    settings.nudgeMax = num('s-nudgeMax', 1, 10, DEFAULTS.nudgeMax);
    settings.nudgeTime = $('s-nudgeTime').value || DEFAULTS.nudgeTime;
    settings.checkTime = $('s-checkTime').value || DEFAULTS.checkTime;
    settings.bedTime = bedDraft || settings.bedTime;
  }

  // ---------- Wire UI ----------
  function wire() {
    document.querySelectorAll('.tab').forEach((tab) => {
      tab.onclick = () => {
        showTab(tab.dataset.view);
      };
    });
    $('waterPlus').onclick = async () => { confirmWater('app'); await save(); render(); await reschedule(); };
    $('waterMinus').onclick = async () => { undoWater(); await save(); render(); await reschedule(); };
    $('standPlus').onclick = async () => { confirmStand('app'); await save(); render(); };
    $('backupCopy').onclick = async () => {
      const txt = JSON.stringify({ app: 'fitdad', v: 1, at: new Date().toISOString(), settings, days });
      $('backupText').value = txt;
      try { await navigator.clipboard.writeText(txt); toast('Backup copied — paste it somewhere safe'); }
      catch (_) { $('backupText').select(); toast('Backup ready — long-press the text to copy'); }
    };
    $('backupRestore').onclick = async () => {
      try {
        const data = JSON.parse($('backupText').value.trim());
        if (data.app !== 'fitdad' || !data.days) throw new Error('not a FitDad backup');
        if (!confirm(`Restore backup from ${new Date(data.at).toLocaleString()}? This replaces current data.`)) return;
        settings = { ...DEFAULTS, ...(data.settings || {}) }; days = data.days;
        await save(); render(); renderSettings(); await reschedule(); toast('Restored');
      } catch (e) { toast('Invalid backup: ' + e.message); }
    };
    $('sheet').onclick = (e) => { if (e.target.id === 'sheet') closeSheet(); };
    $('saveSettings').onclick = async () => { readSettings(); await save(); render(); await reschedule(); toast('Saved — reminders updated'); };
    $('testAlarm').onclick = () => testNotif('stand');
    $('testWater').onclick = () => testNotif('water');
    $('s-waterMode-auto').onclick = () => { modeDraft = 'auto'; renderWaterPlanner(); };
    $('s-waterMode-fixed').onclick = () => { modeDraft = 'fixed'; renderWaterPlanner(); };
    $('bedEdit').onclick = openBedSheet;
    ['s-waterGoal', 's-glass', 's-waterEvery'].forEach((id) => { $(id).oninput = renderWaterPlanner; });
  }

  // ---------- Boot ----------
  async function boot() {
    wire();
    await load();
    autoEndIfNeeded();
    render();
    await setupNative();
    await save();
    await reschedule();
    // refresh UI every minute (day rollover, next-reminder label)
    setInterval(() => { autoEndIfNeeded(); render(); updateNextLabel(buildNotifications()); }, 60000);
  }

  if (!isNative) window.__fitdad = { openSheet };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
