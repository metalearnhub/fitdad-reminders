/* Upkeep — in-app help: ⓘ buttons (data-help="topic"), a first-run tour, and "What's new" after updates. */
window.UpkeepHelp = (function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const li = (xs) => `<ul class="help-list">${xs.map((x) => `<li>${x}</li>`).join('')}</ul>`;

  // ---------- Help topics ----------
  const HELP = {
    water: { icon: '💧', title: 'Water', body: li([
      'Tap the blue <b>+ 250 ml</b> button (your glass size) each time you drink; <b>−</b> undoes the last one.',
      'Upkeep spreads your remaining glasses evenly until <b>1 hour before bed</b> and re-plans after every tap — in the app, the widget or a notification.',
      'Tap <b>🌙 Bed … change</b> to set a different bedtime for tonight only.',
      'The chip shows <b>On pace</b>, <b>Ahead</b> or <b>Behind · no rush</b>. Being behind never makes reminders come faster.',
      'From a notification: <b>Drank a glass</b> logs it without opening the app; <b>Snooze 10 min</b> waits.',
    ]) + '<p class="small muted">See also: <a data-help="kidney">kidney-safe pace</a> · <a data-help="late">logged late?</a></p>' },
    kidney: { icon: '🫘', title: 'Kidney-safe pace', body:
      '<p>Kidneys clear only about <b>0.8–1 L of water per hour</b>. Drinking faster dilutes the salt in your blood (hyponatremia).</p>' + li([
      'Upkeep never plans faster than your pace — pick it in <b>Settings → Water plan</b> (default 500 ml/h).',
      'It counts every glass you logged in the last hour, from anywhere.',
      'Missed some? It <b>won\'t squeeze</b> them closer. Glasses that don\'t fit before bed just roll off — the Today card shows your kidney-safe total.',
      'Log more than your pace in an hour and you\'ll get a gentle warning; over 1 L, a stronger one.',
    ]) + '<p class="small muted">Kidney, heart or liver condition, or on water pills? Use your doctor\'s limit.</p>' },
    late: { icon: '🕘', title: 'Forgot to log? Logged late?', body: li([
      'Just tap the blue <b>+ ml</b> button once for each glass you already drank.',
      'Taps less than 3 minutes apart show a box: <b>Spread since …</b> spaces them between your previous glass and now; <b>Pick times</b> lets you set first and last; <b>Just now</b> keeps them as is.',
      'That way the kidney-safe pace isn\'t fooled into thinking you just drank them all at once.',
    ]) },
    stand: { icon: '🧍', title: 'Stand-ups', body: li([
      'Reminders only ring <b>while you\'re working</b> — tap <b>Start</b> first.',
      'Tap <b>I stood up ✓</b> (or <b>Done ✓</b> on the notification, or <b>Stood up</b> on the widget). The next reminder counts from then.',
      '<b>Snooze 5 min</b> from the notification if you can\'t stand right now.',
      'Not answered? A follow-up asks again after the time you set in <a data-help="follow">Confirm follow-ups</a>.',
    ]) + '<p class="small muted">See also: <a data-help="work">Start, Pause and Done working</a> · <a data-help="widget">widget</a></p>' },
    work: { icon: '⏯', title: 'Start, Pause, Done working', body: li([
      '<b>Start</b> — from the app or the widget. Stand-up reminders begin.',
      '<b>Pause</b> — stepping out or on a break: from the widget or the stand-up notification. Stand-ups stay quiet until you tap Start again. Water keeps going.',
      '<b>Done working</b> — only in the app, so you can\'t end your day by accident. Shows your results; stand-ups stop for the day.',
      '<b>Day off</b> — from the morning nudge or the app: no stand-up reminders today.',
    ]) },
    stats: { icon: '📊', title: 'Stats', body: li([
      '<b>Today</b>: water, stand-ups, time worked and your longest sit.',
      '<b>Today\'s log</b>: every tap with where it came from (app, widget, notification).',
      '<b>This week</b>: daily bars against your goals.',
    ]) },
    widget: { icon: '📱', title: 'Home-screen widget', body: li([
      'Long-press your home screen → <b>Widgets</b> → <b>Upkeep</b>.',
      'Right side: big <b>countdowns</b> to the next glass (blue) and next stand-up (green).',
      '<b>+ 250 ml</b> and <b>Stood up</b> log instantly; the "x ago" timers show your last taps.',
      'The work button is only <b>▶ Start</b> / <b>⏸ Pause</b>. Done working is in the app.',
      'Turned Stand-ups off in Settings? The widget shows water only.',
    ]) },
    follow: { icon: '🔁', title: 'Confirm follow-ups', body: li([
      'If you don\'t answer a reminder, Upkeep asks again after this many minutes, up to the number you choose.',
      'A follow-up only comes after a main reminder really rang — and stays quiet once you answer anywhere.',
    ]) },
    nudge: { icon: '🌅', title: 'Morning nudge', body: li([
      'If you haven\'t tapped Start by this time on your workdays, Upkeep nudges you.',
      'Answer <b>Start now</b>, <b>Later</b> or <b>Day off</b> right from the notification.',
    ]) },
    silent: { icon: '🔕', title: 'Sound, Silent & Do Not Disturb', body: li([
      '<b>Ring even on Silent OFF</b>: reminders follow your phone — Silent is silent, Do Not Disturb is quiet.',
      '<b>ON</b>: stand-up and water reminders ring on the alarm volume when the phone is on Silent or Vibrate.',
      '<b>Do Not Disturb always wins</b>, and Upkeep never plays a sound without a notification you can see.',
      'Feel which one it is: 💧 water <b>· · — / · · — / · · —</b> · 🧍 stand-up <b>· · / · · / · · —</b>.',
      'Use <b>Test alarm</b> / <b>Test water</b> to check.',
    ]) },
    features: { icon: '🎛', title: 'Features', body: li([
      'Use Upkeep for water only, stand-ups only, car only — or all three.',
      'Turning one off hides it and stops its reminders. Your data is kept.',
    ]) },
    backup: { icon: '💾', title: 'Backup, restore & reset', body: li([
      '<b>Back up now</b> saves a ZIP (data + receipts) to <b>Downloads/Upkeep</b>.',
      '<b>Restore</b>: pick a dated backup, preview it, choose which parts to bring back.',
      '<b>Reset</b> always makes a backup first.',
    ]) },
    car: { icon: '🚗', title: 'Car care', body: li([
      '<b>Update km</b> often (or log fill-ups) — schedules are due by km or months, whichever comes first.',
      '<b>🔧 Maintenance</b>: tap a part for its schedule, where it is, the right specs, and to log a service or check.',
      '<b>🗺 Map</b>: see every part on your van, colored by status.',
      '<b>⛽ Fuel</b>: full-tank fill-ups give real km/L.',
      '<b>🧾 Records</b>: repairs with receipts and warranties.',
    ]) },
    maint: { icon: '🔧', title: 'Maintenance schedules', body: li([
      'Each part is due by <b>km or months, whichever comes first</b>. The bar shows wear.',
      'Tap a part → <b>Log service</b> (date, km, cost, receipt, warranty) resets it.',
      'Quick checks (oil dipstick, coolant, brake fluid, tire PSI) use <b>Log check</b>.',
      'A <b>PMS</b> also resets Change oil and Oil filter — untick them if they weren\'t done.',
      'Overdue / due-soon parts send reminders at 9 AM.',
    ]) },
    map: { icon: '🗺', title: 'Parts map', body: li([
      'Top view of your van, see-through, front at the top. The engine sits <b>under the front seats</b>.',
      'Colors: 🔴 overdue · 🟠 due soon · 🟢 OK · 🔵 records only · grey not tracked.',
      'Tap any part for where it is, its schedule, records and specs.',
      'Every schedule, record and new repair also shows its part highlighted.',
    ]) },
    specs: { icon: '📘', title: 'Parts & fluids guide', body: li([
      'The right oil, filter, plugs, belts, fluids and tires for a Suzuki APV 1.6.',
      '<b>✔ fits APV</b> = matches parts-maker fitment / Suzuki data. <b>⚠ confirm</b> = typical — check the label, the old part or ask the shop.',
      '<b>📋 Copy for mechanic</b> → paste into Messenger or Viber.',
      'High-mileage tips appear once your van passes 150,000 km.',
    ]) },
    fuel: { icon: '⛽', title: 'Fuel efficiency', body: li([
      'Fill to <b>full</b> each time and log km, liters and price.',
      'km/L is measured tank to tank, so your <b>first full tank</b> is the starting point (shown as "Start").',
      'Partial top-ups are added into the next full tank.',
      'The leaderboard lists every fill-up; tap one to edit or delete.',
    ]) },
    records: { icon: '🧾', title: 'Repairs, receipts & warranties', body: li([
      'Log a repair with one receipt total or price per item, plus photos/PDFs of the receipt.',
      'Pick a warranty per item and for labor — Upkeep tells you when it\'s about to end.',
      '<b>Resets these schedules</b>: tick everything that was done in that visit.',
    ]) },
  };

  // ---------- What's new (newest first; bump v for each release worth telling) ----------
  const WHATS_NEW = [
    { v: 3, items: [
      ['🫘', 'Kidney-safe water pace', 'Never more than your safe ml per hour; missed glasses roll off instead of being squeezed in.', 'kidney'],
      ['🕘', 'Logged glasses late?', 'Tap them in, then "Spread since…" puts them back where they belong.', 'late'],
      ['ⓘ', 'Help everywhere', 'Tap the little ⓘ next to any section to learn how it works.', null],
    ] },
    { v: 2, items: [
      ['📱', 'Widget countdowns', 'Big timers to your next glass and stand-up; Start / Pause only.', 'widget'],
      ['🔕', 'Silent & Do Not Disturb respected', 'No more sounds without a notification; DND always wins.', 'silent'],
      ['📳', 'Vibration patterns', 'Water · · — (×3) · stand-up · · / · · / · · —', 'silent'],
    ] },
    { v: 1, items: [
      ['🗺', 'Parts map', 'See where every part sits on your APV, colored by status.', 'map'],
      ['📘', 'Parts & fluids guide', 'The right oil, plugs, belts and fluids — copy it for your mechanic.', 'specs'],
      ['⛽', 'Every fill-up in the fuel table', 'Including your first full tank.', 'fuel'],
    ] },
  ];
  const LATEST = WHATS_NEW[0].v;

  // ---------- First-run tour ----------
  const TOUR = [
    ['👋', 'Welcome to Upkeep', 'Water, stand-ups and car care — use all three or just one. Switch them in <b>Settings → Features</b>.'],
    ['💧', 'Water', 'Tap the blue <b>+ ml</b> button when you drink. Upkeep spaces the rest until an hour before bed — at a kidney-safe pace.'],
    ['🧍', 'Stand-ups', 'Tap <b>Start</b> when you begin working. You\'ll be reminded to stand; <b>Pause</b> on breaks, <b>Done working</b> at the end.'],
    ['🔔', 'Notifications & widget', 'Answer reminders right from the notification. Add the <b>Upkeep widget</b> for one-tap logging and countdowns.'],
    ['🚗', 'Car care', 'Add your car, keep km updated, and Upkeep tells you what\'s due — with a parts map and the right specs.'],
    ['ⓘ', 'Help is always here', 'Tap the <b>ⓘ</b> next to any section, or <b>Settings → Help & what\'s new</b>.'],
  ];

  let ctx = { get: () => ({}), set: async () => {} };
  function show(html, mount) {
    $('sheetBody').innerHTML = html; $('sheet').classList.add('show');
    if (mount) mount($('sheetBody'));
  }
  const close = () => $('sheet').classList.remove('show');

  function open(key) {
    const h = HELP[key]; if (!h) return;
    show(`<div class="sheet-icon">${h.icon}</div><h2>${h.title}</h2><div class="help-body">${h.body}</div>
      <div class="sheet-btns"><button class="btn primary" id="hpOk">Got it</button><button class="btn ghost" id="hpAll">All help topics</button></div>`, () => {
      $('hpOk').onclick = close; $('hpAll').onclick = index;
    });
  }
  function index() {
    show(`<div class="sheet-icon">❓</div><h2>Help</h2>
      <div class="help-index">${Object.entries(HELP).map(([k, h]) => `<button class="chip" data-help="${k}">${h.icon} ${h.title}</button>`).join('')}</div>
      <div class="sheet-btns"><button class="btn ghost" id="hpTour">Replay the welcome tour</button><button class="btn ghost" id="hpNew">What's new</button><button class="btn ghost" id="hpClose">Close</button></div>`, () => {
      $('hpTour').onclick = () => tour(0); $('hpNew').onclick = () => whatsNew(0, true); $('hpClose').onclick = close;
    });
  }
  function tour(i = 0) {
    const [ic, t, b] = TOUR[i]; const last = i === TOUR.length - 1;
    show(`<div class="sheet-icon">${ic}</div><h2>${t}</h2><p class="help-body">${b}</p>
      <div class="dots">${TOUR.map((_, k) => `<i class="${k === i ? 'on' : ''}"></i>`).join('')}</div>
      <div class="sheet-btns"><button class="btn primary" id="tNext">${last ? 'Let\'s go' : 'Next'}</button>${last ? '' : '<button class="btn ghost" id="tSkip">Skip</button>'}</div>`, () => {
      const done = async () => { close(); await ctx.set({ seenTour: true, seenNews: LATEST }); };
      $('tNext').onclick = () => (last ? done() : tour(i + 1));
      if ($('tSkip')) $('tSkip').onclick = done;
    });
  }
  function whatsNew(since, all) {
    const rel = WHATS_NEW.filter((r) => all || r.v > since);
    if (!rel.length) return;
    show(`<div class="sheet-icon">✨</div><h2>What's new in Upkeep</h2>
      <ul class="news">${rel.flatMap((r) => r.items).map(([ic, t, d, k]) => `<li ${k ? `data-help="${k}"` : ''}><span class="news-ic">${ic}</span><span><b>${t}</b><br><span class="muted small">${d}</span>${k ? ' <span class="news-more">How it works ›</span>' : ''}</span></li>`).join('')}</ul>
      <div class="sheet-btns"><button class="btn primary" id="nwOk">Nice</button></div>`, () => {
      $('nwOk').onclick = async () => { close(); await ctx.set({ seenNews: LATEST }); };
    });
  }

  /** Call once after data loads. get() → {seenTour, seenNews, hasData}; set(patch) saves. */
  function init(c) {
    ctx = c;
    const s = ctx.get();
    if (!s.seenTour && !s.hasData) setTimeout(() => tour(0), 600);
    else if ((s.seenNews || 0) < LATEST) setTimeout(() => whatsNew(s.seenNews || 0), 600);
  }

  // one tap handler for every ⓘ / help link, wherever it is (also inside the car module)
  document.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('[data-help]'); if (!b) return;
    e.preventDefault(); e.stopPropagation(); open(b.dataset.help);
  }, true);

  const btn = (key) => `<button class="info" data-help="${key}" aria-label="How this works">i</button>`;
  return { open, index, tour, whatsNew, init, btn, HELP, LATEST };
})();
