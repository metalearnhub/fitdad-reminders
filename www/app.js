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

  // ---------- IDs & channels ----------
  const ID = { STAND: 1000, WATER: 2000, NUDGE: 3000, CHECK: 4000, SNOOZE: 5000, TEST: 9000 };
  const CH_ALARM = 'fitdad-alarm';
  const CH_WATER = 'fitdad-water';

  // ---------- Defaults ----------
  const DEFAULTS = {
    standEvery: 30,       // minutes
    waterEvery: 60,       // minutes (used when waterMode = 'fixed')
    waterMode: 'auto',    // 'auto' = spread remaining glasses over the remaining workday; 'fixed' = every N minutes
    waterGoal: 3000,      // ml
    glass: 250,           // ml
    maxHours: 10,         // auto-end session
    nudgeTime: '09:00',
    nudgeRepeat: 45,      // minutes
    nudgeMax: 4,
    nudgeDays: [0, 1, 2, 3, 4, 5, 6], // Sun..Sat
    checkTime: '16:00',
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
  const plannedInterval = () => settings.waterMode === 'fixed'
    ? settings.waterEvery
    : Math.max(15, Math.floor((settings.maxHours * 60) / totalGlasses()));

  function today() {
    const k = dayKey();
    if (!days[k]) days[k] = { status: 'idle', startedAt: null, pausedAt: null, pausedMs: 0, water: 0, stands: 0 };
    return days[k];
  }

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
      if (isNative) await Prefs.set({ key: 'fitdad', value: raw });
      else localStorage.setItem('fitdad', raw);
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
      }
    } catch (e) {
      console.error('native setup failed', e);
    }
  }

  // ---------- Actions from notifications ----------
  async function handleAction(ev) {
    const n = ev.notification || {};
    const kind = (n.extra && n.extra.kind) || '';
    const a = ev.actionId;
    const t = today();

    if (kind === 'stand') {
      if (a === 'snooze') await snooze('stand', 5);
      else if (a === 'done') { t.stands++; toast('Nice. Stand-up logged.'); }
    } else if (kind === 'water' || kind === 'check') {
      if (a === 'snooze') await snooze('water', 10);
      else if (a === 'drank') { t.water += settings.glass; toast(`+${settings.glass} ml logged`); }
    } else if (kind === 'nudge') {
      if (a === 'start') startSession();
      else if (a === 'dayoff') dayOff();
      // 'later' or tap → the next pre-scheduled nudge will still ring
    }
    await save(); render(); await reschedule();
  }

  async function snooze(kind, minutes) {
    if (!isNative) return;
    const at = new Date(Date.now() + minutes * 60000);
    const isStand = kind === 'stand';
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
    t.status = 'active';
    toast('Day started — reminders on');
  }
  function pauseSession() { const t = today(); t.status = 'paused'; t.pausedAt = Date.now(); toast('Paused'); }
  function endSession() { const t = today(); t.status = 'ended'; t.pausedAt = null; toast('Day ended. Good work.'); }
  function dayOff() { const t = today(); t.status = 'off'; toast('Day off — see you tomorrow'); }

  function sessionEnd(t) {
    return t.startedAt ? t.startedAt + t.pausedMs + settings.maxHours * 3600000 : 0;
  }
  function autoEndIfNeeded() {
    const t = today();
    if (t.status === 'active' && Date.now() > sessionEnd(t)) t.status = 'ended';
  }

  // ---------- Scheduling ----------
  function buildNotifications() {
    const out = [];
    const now = Date.now();
    const t = today();
    const remaining = Math.max(0, settings.waterGoal - t.water);

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
      // Water: only as many reminders as glasses still needed — stops once the goal is met
      const left = glassesLeft(t.water);
      const total = totalGlasses();
      let times = [];
      if (left > 0) {
        if (settings.waterMode === 'fixed') {
          const step = settings.waterEvery * 60000;
          for (let ts = firstAfter(step); ts <= end && times.length < left; ts += step) times.push(ts);
        } else {
          // auto: spread the remaining glasses evenly across the remaining workday
          const step = Math.max(15 * 60000, Math.floor((end - now) / left));
          for (let k = 1; k <= left; k++) { const ts = now + k * step; if (ts <= end) times.push(ts); }
        }
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

    // 2) Water safety-net check-in today
    const check = atTime(new Date(), settings.checkTime).getTime();
    if (check > now && t.status !== 'off' && remaining > settings.waterGoal * 0.4) {
      out.push({
        id: ID.CHECK, title: `Behind on water: ${liters(remaining)} to go`,
        body: `You've had ${liters(t.water)} of ${liters(settings.waterGoal)}. Drink a glass now.`,
        channelId: CH_WATER, actionTypeId: 'WATER', extra: { kind: 'check' }, at: check,
      });
    }

    // 3) Morning nudges for today (if not started) and the next 13 days
    let n = 0;
    for (let d = 0; d < 14; d++) {
      const date = new Date(); date.setDate(date.getDate() + d);
      if (!settings.nudgeDays.includes(date.getDay())) continue;
      const rec = days[dayKey(date)];
      if (d === 0 && rec && rec.status !== 'idle') continue;
      const first = atTime(date, settings.nudgeTime).getTime();
      for (let r = 0; r < settings.nudgeMax; r++) {
        const ts = first + r * settings.nudgeRepeat * 60000;
        if (ts <= now) continue;
        out.push({
          id: ID.NUDGE + n++,
          title: r === 0 ? 'Start your wellness day? ☀️' : 'Still not started — ready now?',
          body: 'Tap Start to turn on stand-up and water reminders.',
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

  // ---------- Rendering ----------
  function updateNextLabel(list) {
    const now = Date.now();
    const next = (kind) => list.filter((x) => x.extra.kind === kind && x.at > now).sort((a, b) => a.at - b.at)[0];
    const s = next('stand'), w = next('water'), nd = next('nudge');
    const parts = [];
    if (s) parts.push(`Next stand-up ${fmtTime(new Date(s.at))}`);
    if (w) parts.push(`next water ${fmtTime(new Date(w.at))}`);
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
      $('statusSub').textContent = `Auto-ends at ${fmtTime(new Date(sessionEnd(t)))} if you forget.`;
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
      $('statusSub').textContent = 'Back at it? You can restart reminders anytime.';
      $('sessionInfo').textContent = '';
      mk('Start again', 'primary', startSession);
    } else if (t.status === 'off') {
      pill.textContent = 'Day off'; pill.classList.add('off');
      $('statusHeadline').textContent = 'Rest day';
      $('statusSub').textContent = 'No nudges today. Changed your mind?';
      $('sessionInfo').textContent = '';
      mk('Start anyway', 'primary', startSession);
    } else {
      pill.textContent = 'Not started';
      $('statusHeadline').textContent = 'Ready to work?';
      $('statusSub').textContent = `Tap Start when you sit down. If you forget, I'll nudge you at ${fmtTime(atTime(new Date(), settings.nudgeTime))}.`;
      $('sessionInfo').textContent = '';
      mk('Start day', 'primary', startSession); mk('Day off', 'ghost', dayOff);
    }

    // water
    const pct = Math.min(1, t.water / settings.waterGoal);
    $('waterRing').style.strokeDashoffset = String(326.7 * (1 - pct));
    $('waterAmount').textContent = liters(t.water);
    const left = settings.waterGoal - t.water;
    $('waterLeft').textContent = left > 0 ? `${liters(left)} to go` : 'Goal reached 🎉';
    $('waterGoalLabel').textContent = `Goal ${liters(settings.waterGoal)}`;
    const total = totalGlasses(), gl = glassesLeft(t.water);
    $('waterPlan').textContent = gl > 0
      ? `Glass ${total - gl + 1} of ${total} · ${gl} × ${settings.glass} ml left`
      : `All ${total} glasses done — reminders stopped for today`;
    $('waterPlus').textContent = `+ ${settings.glass} ml`;

    // stand
    $('standCount').textContent = t.stands;
    $('standEveryLabel').textContent = `Every ${settings.standEvery} min`;
  }

  function renderSettings() {
    $('s-standEvery').value = settings.standEvery;
    $('s-waterEvery').value = settings.waterEvery;
    modeDraft = null;
    $('s-waterGoal').value = settings.waterGoal;
    $('s-glass').value = settings.glass;
    $('s-maxHours').value = settings.maxHours;
    $('s-nudgeTime').value = settings.nudgeTime;
    $('s-nudgeRepeat').value = settings.nudgeRepeat;
    $('s-nudgeMax').value = settings.nudgeMax;
    $('s-checkTime').value = settings.checkTime;
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
    const fixed = (modeDraft || settings.waterMode) === 'fixed';
    $('s-waterMode-auto').classList.toggle('on', !fixed);
    $('s-waterMode-fixed').classList.toggle('on', fixed);
    $('s-waterEveryRow').style.display = fixed ? '' : 'none';
    // live preview from the current (unsaved) inputs
    const goal = Number($('s-waterGoal').value) || settings.waterGoal;
    const glass = Number($('s-glass').value) || settings.glass;
    const hours = Number($('s-maxHours').value) || settings.maxHours;
    const n = Math.ceil(goal / glass);
    const every = fixed ? (Number($('s-waterEvery').value) || settings.waterEvery) : Math.max(15, Math.floor(hours * 60 / n));
    const needed = n * every;
    let msg = `${(goal / 1000).toFixed(2)} L = ${n} glasses × ${glass} ml, one every ${every} min (${(needed / 60).toFixed(1)} h).`;
    if (fixed && needed > hours * 60) msg += ` ⚠ That's longer than your ${hours} h day — the last ${Math.ceil((needed - hours * 60) / every)} glass(es) won't fit. Shorten the interval or use bigger glasses.`;
    else msg += ' Reminders stop once the goal is met.';
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
    settings.maxHours = num('s-maxHours', 2, 16, DEFAULTS.maxHours);
    settings.nudgeRepeat = num('s-nudgeRepeat', 15, 180, DEFAULTS.nudgeRepeat);
    settings.nudgeMax = num('s-nudgeMax', 1, 10, DEFAULTS.nudgeMax);
    settings.nudgeTime = $('s-nudgeTime').value || DEFAULTS.nudgeTime;
    settings.checkTime = $('s-checkTime').value || DEFAULTS.checkTime;
  }

  // ---------- Wire UI ----------
  function wire() {
    document.querySelectorAll('.tab').forEach((tab) => {
      tab.onclick = () => {
        document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === tab));
        document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + tab.dataset.view));
        if (tab.dataset.view === 'settings') renderSettings();
      };
    });
    $('waterPlus').onclick = async () => { today().water += settings.glass; await save(); render(); await reschedule(); };
    $('waterMinus').onclick = async () => { const t = today(); t.water = Math.max(0, t.water - settings.glass); await save(); render(); await reschedule(); };
    $('standPlus').onclick = async () => { today().stands++; await save(); render(); toast('Stand-up logged'); };
    $('saveSettings').onclick = async () => { readSettings(); await save(); render(); await reschedule(); toast('Saved — reminders updated'); };
    $('testAlarm').onclick = () => testNotif('stand');
    $('testWater').onclick = () => testNotif('water');
    $('s-waterMode-auto').onclick = () => { modeDraft = 'auto'; renderWaterPlanner(); };
    $('s-waterMode-fixed').onclick = () => { modeDraft = 'fixed'; renderWaterPlanner(); };
    ['s-waterGoal', 's-glass', 's-waterEvery', 's-maxHours'].forEach((id) => { $(id).oninput = renderWaterPlanner; });
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

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
