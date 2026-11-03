/* Upkeep — Car care module (BETA)
 * Cars, maintenance items due by kilometers and/or months (whichever comes first),
 * odometer log, service history with cost, and due/overdue reminders.
 * Plugged into app.js through a small api object; data lives in the same storage under `car`.
 */
window.UpkeepCar = function (api) {
  'use strict';
  const { $, toast, fmtTime, pad } = api;
  const DAY = 86400000;
  const ID_BASE = 20000; // notification ids 20000–20999

  // Common Philippine PMS-style intervals (edit freely per car)
  const TEMPLATES = [
    { name: 'Change oil', km: 5000, months: 6, icon: '🛢️' },
    { name: 'Oil filter', km: 5000, months: 6, icon: '🧴' },
    { name: 'PMS (preventive maintenance)', km: 10000, months: 6, icon: '🔧' },
    { name: 'Tire rotation', km: 10000, months: 6, icon: '🛞' },
    { name: 'Brake check', km: 10000, months: 12, icon: '🛑' },
    { name: 'Air filter', km: 20000, months: 12, icon: '💨' },
    { name: 'Aircon cleaning', km: 0, months: 12, icon: '❄️' },
    { name: 'Battery check', km: 0, months: 6, icon: '🔋' },
    { name: 'Wiper blades', km: 0, months: 12, icon: '🌧️' },
    { name: 'Coolant flush', km: 40000, months: 24, icon: '🌡️' },
    { name: 'Spark plugs', km: 40000, months: 24, icon: '⚡' },
    { name: 'Transmission fluid', km: 40000, months: 24, icon: '⚙️' },
    { name: 'LTO registration', km: 0, months: 12, icon: '📄' },
    { name: 'Insurance renewal', km: 0, months: 12, icon: '🛡️' },
  ];
  const STARTER = ['Change oil', 'PMS (preventive maintenance)', 'Tire rotation', 'Air filter', 'Battery check', 'LTO registration', 'Insurance renewal'];

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const fmtDate = (t) => new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
  const fmtKm = (n) => Math.round(n).toLocaleString() + ' km';
  const peso = (n) => '₱' + Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 });
  const isoDay = (t) => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const addMonths = (t, m) => { const d = new Date(t); d.setMonth(d.getMonth() + m); return d.getTime(); };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function data() {
    const root = api.root();
    if (!root.car) root.car = { cars: [], items: [], history: [], selected: null };
    return root.car;
  }
  const car = () => { const d = data(); return d.cars.find((c) => c.id === d.selected) || d.cars[0] || null; };
  const itemsOf = (c) => data().items.filter((i) => i.carId === c.id);

  // ---------- Odometer ----------
  function currentKm(c) { return c.odo.reduce((m, o) => Math.max(m, o.km), 0); }
  // average km/day from the odometer log (needs ≥2 readings ≥3 days apart)
  function kmPerDay(c) {
    if (c.odo.length < 2) return null;
    const a = c.odo[0], b = c.odo[c.odo.length - 1];
    const days = (b.t - a.t) / DAY;
    if (days < 3 || b.km <= a.km) return null;
    return (b.km - a.km) / days;
  }
  function addOdo(c, km, t = Date.now()) {
    km = Math.round(Number(km));
    if (!(km >= 0)) return false;
    if (c.odo.length && km < currentKm(c)) { toast(`That's lower than the last reading (${fmtKm(currentKm(c))})`); return false; }
    c.odo.push({ t, km });
    c.odo.sort((a, b) => a.t - b.t);
    return true;
  }

  // ---------- Due logic: whichever comes first, km or months ----------
  function dueInfo(item, c) {
    const now = Date.now();
    const km = currentKm(c);
    const rate = kmPerDay(c);
    const out = { dueAt: null, dueKm: null, kmLeft: null, daysLeft: null, byKmEstimate: null, status: 'ok' };
    if (item.months) out.dueAt = addMonths(item.lastDate, item.months);
    if (item.km) {
      out.dueKm = (item.lastKm || 0) + item.km;
      out.kmLeft = out.dueKm - km;
      if (rate) out.byKmEstimate = now + (out.kmLeft / rate) * DAY;
    }
    const candidates = [out.dueAt, out.byKmEstimate].filter((x) => x != null);
    out.effectiveAt = candidates.length ? Math.min(...candidates) : null;
    if (out.effectiveAt != null) out.daysLeft = Math.ceil((out.effectiveAt - now) / DAY);
    const soonDays = item.remindDays || 7;
    if ((out.kmLeft != null && out.kmLeft <= 0) || (out.dueAt != null && out.dueAt <= now)) out.status = 'overdue';
    else if ((out.kmLeft != null && out.kmLeft <= 500) || (out.daysLeft != null && out.daysLeft <= soonDays)) out.status = 'soon';
    return out;
  }
  function dueText(info) {
    const parts = [];
    if (info.status === 'overdue') {
      if (info.kmLeft != null && info.kmLeft <= 0) parts.push(`${fmtKm(-info.kmLeft)} overdue`);
      if (info.dueAt != null && info.dueAt <= Date.now()) parts.push(`since ${fmtDate(info.dueAt)}`);
      return 'Overdue · ' + parts.join(' · ');
    }
    if (info.daysLeft != null) parts.push(info.daysLeft <= 0 ? 'today' : `in ${info.daysLeft} day${info.daysLeft === 1 ? '' : 's'}`);
    if (info.kmLeft != null) parts.push(`${fmtKm(info.kmLeft)} left`);
    return 'Due ' + parts.join(' · ');
  }

  // ---------- Notifications ----------
  function buildNotifications(now, CH) {
    const out = [];
    let n = 0;
    data().cars.forEach((c) => {
      itemsOf(c).forEach((item) => {
        const info = dueInfo(item, c);
        if (info.effectiveAt == null && info.status !== 'overdue') return;
        const at9 = (t) => { const d = new Date(t); d.setHours(9, 0, 0, 0); return d.getTime(); };
        const extra = { kind: 'car', itemId: item.id };
        const what = `${item.icon || '🔧'} ${item.name}`;
        const kmNote = info.dueKm ? ` (at ${fmtKm(info.dueKm)})` : '';
        if (info.status === 'overdue') {
          // overdue: nag every 3 days at 9 AM, next 4 times
          let t = at9(now); if (t <= now) t += DAY;
          for (let k = 0; k < 4; k++, t += 3 * DAY) {
            out.push({ id: ID_BASE + n++, title: `Overdue: ${what}`, body: `${c.name} — ${dueText(info)}. Tap Done once serviced.`, channelId: CH, actionTypeId: 'CAR', extra, at: t });
          }
          return;
        }
        const heads = at9(info.effectiveAt - (item.remindDays || 7) * DAY);
        if (heads > now) out.push({ id: ID_BASE + n++, title: `Coming up: ${what}`, body: `${c.name} — due ${fmtDate(info.effectiveAt)}${kmNote}.`, channelId: CH, actionTypeId: 'CAR', extra, at: heads });
        const due = at9(info.effectiveAt);
        if (due > now) out.push({ id: ID_BASE + n++, title: `Due today: ${what}`, body: `${c.name}${kmNote}. Tap Done after servicing to log it.`, channelId: CH, actionTypeId: 'CAR', extra, at: due });
      });
      // odometer nudge: weekly (Sunday 10 AM) if no reading for 7+ days and km-based items exist
      if (itemsOf(c).some((i) => i.km)) {
        const last = c.odo.length ? c.odo[c.odo.length - 1].t : 0;
        let t = new Date(); t.setHours(10, 0, 0, 0); t.setDate(t.getDate() + ((7 - t.getDay()) % 7)); t = t.getTime();
        if (t <= now) t += 7 * DAY;
        if (t - last >= 7 * DAY) out.push({ id: ID_BASE + 900 + data().cars.indexOf(c), title: `🚗 Update ${c.name}'s odometer`, body: 'Log the current km so Upkeep can predict your next service.', channelId: CH, actionTypeId: 'CARODO', extra: { kind: 'carodo', carId: c.id }, at: t });
      }
    });
    return out.slice(0, 200);
  }

  // ---------- Actions (from notifications / sheet) ----------
  function markDone(itemId, { date, km, cost, notes }) {
    const d = data();
    const item = d.items.find((i) => i.id === itemId); if (!item) return;
    const c = d.cars.find((x) => x.id === item.carId);
    const t = date ? new Date(date + 'T12:00:00').getTime() : Date.now();
    km = km === '' || km == null ? currentKm(c) : Math.round(Number(km));
    if (km > currentKm(c)) addOdo(c, km, isoDay(t) === isoDay(Date.now()) ? Date.now() : Math.min(t, Date.now()));
    item.lastDate = t; item.lastKm = km;
    d.history.push({ id: uid(), carId: c.id, itemId, name: item.name, icon: item.icon, t, km, cost: Number(cost) || 0, notes: notes || '' });
    toast(`${item.name} logged ✓`);
  }

  // ---------- UI ----------
  let sheetOpen = null;
  function sheet(html, onMount) {
    const body = $('sheetBody');
    body.innerHTML = html;
    $('sheet').classList.add('show');
    sheetOpen = true;
    if (onMount) onMount(body);
  }
  function closeSheet() { $('sheet').classList.remove('show'); sheetOpen = null; }
  async function commit(msg) { await api.save(); render(); await api.reschedule(); if (msg) toast(msg); }

  let view = 'maint', period = 'month', lbSort = 'eff';
  function render() {
    const el = $('carRoot'); if (!el) return;
    const d = data(); const c = car();
    if (!c) {
      el.innerHTML = `
        <div class="card">
          <span class="pill beta">Beta</span>
          <h2 style="margin-top:10px">Car care 🚗</h2>
          <p class="muted">Track oil changes, PMS, tires, LTO registration and insurance — by kilometers or months, whichever comes first.</p>
          <button class="btn primary full" id="carAdd">Add your car</button>
        </div>`;
      $('carAdd').onclick = () => carForm();
      return;
    }
    const rate = kmPerDay(c);
    const its = itemsOf(c).map((i) => ({ i, info: dueInfo(i, c) }))
      .sort((a, b) => ({ overdue: 0, soon: 1, ok: 2 }[a.info.status] - { overdue: 0, soon: 1, ok: 2 }[b.info.status]) || ((a.info.effectiveAt || 9e15) - (b.info.effectiveAt || 9e15)));
    const yr = new Date().getFullYear();
    const spent = d.history.filter((h) => h.carId === c.id && new Date(h.t).getFullYear() === yr).reduce((s, h) => s + h.cost, 0);
    const counts = { overdue: its.filter((x) => x.info.status === 'overdue').length, soon: its.filter((x) => x.info.status === 'soon').length };
    el.innerHTML = `
      ${d.cars.length > 1 ? `<div class="chips">${d.cars.map((x) => `<button class="chip ${x.id === c.id ? 'on' : ''}" data-car="${x.id}">${esc(x.name)}</button>`).join('')}</div>` : ''}
      <div class="card">
        <div class="status-row"><span class="pill beta">Beta</span><button class="linkbtn" id="carEdit" style="margin:0">Edit car</button></div>
        <h1 style="margin-bottom:2px">${esc(c.name)}</h1>
        <p class="muted" style="margin-top:0">${esc(c.plate || '')}</p>
        <div class="kpis">
          <div class="kpi"><div class="kv">${fmtKm(currentKm(c))}</div><div class="kl">odometer · ${c.odo.length ? 'updated ' + fmtDate(c.odo[c.odo.length - 1].t) : 'not set'}</div></div>
          <div class="kpi"><div class="kv">${rate ? Math.round(rate) + ' km' : '—'}</div><div class="kl">avg per day${rate ? '' : ' (log km twice, 3+ days apart)'}</div></div>
          <div class="kpi"><div class="kv ${counts.overdue ? 'miss' : ''}">${counts.overdue}</div><div class="kl">overdue · ${counts.soon} due soon</div></div>
          <div class="kpi"><div class="kv">${peso(spent)}</div><div class="kl">spent in ${yr}</div></div>
        </div>
        <div class="btn-row" style="margin-top:4px">
          <button class="btn ghost" id="carOdo">Update km</button>
          <button class="btn water" id="carFuelAdd" style="flex:1">⛽ Log fill-up</button>
        </div>
      </div>
      <div class="seg seg-wide">
        <button class="chip ${view === 'maint' ? 'on' : ''}" data-view="maint">🔧 Maintenance</button>
        <button class="chip ${view === 'fuel' ? 'on' : ''}" data-view="fuel">⛽ Fuel</button>
      </div>
      ${view === 'fuel' ? fuelHTML(c) : `
      <div class="card">
        <div class="water-head"><h2>Maintenance</h2><button class="linkbtn" id="carAddItem" style="margin:0">+ Add item</button></div>
        <ul class="carlist">
          ${its.length ? its.map(({ i, info }) => `
            <li class="caritem ${info.status}" data-item="${i.id}">
              <span class="ci-icon">${i.icon || '🔧'}</span>
              <span class="ci-main"><b>${esc(i.name)}</b><span class="muted small">${dueText(info)}</span></span>
              <span class="ci-dot"></span>
            </li>`).join('') : '<li class="muted">No items yet. Add one, or start with the recommended schedule.</li>'}
        </ul>
        ${its.length ? '' : '<button class="btn ghost full" id="carStarter" style="margin-top:10px">Add recommended schedule</button>'}
      </div>
      <div class="card">
        <h2>Service history</h2>
        <ul class="timeline">
          ${d.history.filter((h) => h.carId === c.id).sort((a, b) => b.t - a.t).slice(0, 30).map((h) => `
            <li><span>${h.icon || '🔧'} ${esc(h.name)}<br><span class="muted small">${fmtKm(h.km)}${h.notes ? ' · ' + esc(h.notes) : ''}</span></span>
            <span class="muted" style="text-align:right">${fmtDate(h.t)}${h.cost ? '<br>' + peso(h.cost) : ''}</span></li>`).join('') || '<li class="muted">Nothing logged yet.</li>'}
        </ul>
      </div>`}
      <button class="btn ghost full" id="carAddAnother">+ Add another car</button>`;

    el.querySelectorAll('[data-car]').forEach((b) => { b.onclick = async () => { d.selected = b.dataset.car; await api.save(); render(); }; });
    el.querySelectorAll('[data-item]').forEach((li) => { li.onclick = () => itemSheet(li.dataset.item); });
    $('carEdit').onclick = () => carForm(c);
    $('carOdo').onclick = () => odoSheet(c);
    if ($('carAddItem')) $('carAddItem').onclick = () => templateSheet(c);
    $('carFuelAdd').onclick = () => fuelForm(c);
    el.querySelectorAll('[data-view]').forEach((b) => { b.onclick = () => { view = b.dataset.view; render(); }; });
    el.querySelectorAll('[data-period]').forEach((b) => { b.onclick = () => { period = b.dataset.period; render(); }; });
    el.querySelectorAll('[data-sort]').forEach((b) => { b.onclick = () => { lbSort = b.dataset.sort; render(); }; });
    el.querySelectorAll('[data-fill]').forEach((r) => { r.onclick = () => fuelForm(c, r.dataset.fill); });
    $('carAddAnother').onclick = () => carForm();
    if ($('carStarter')) $('carStarter').onclick = () => addStarter(c);
  }

  function carForm(c) {
    const isNew = !c;
    sheet(`
      <div class="sheet-icon">🚗</div><h2>${isNew ? 'Add your car' : 'Edit car'}</h2>
      <div class="form">
        <label>Name<input id="cfName" placeholder="e.g. Toyota Vios 2019" value="${esc(c ? c.name : '')}" /></label>
        <label>Plate number<input id="cfPlate" placeholder="e.g. ABC 1234" value="${esc(c ? c.plate : '')}" /></label>
        ${isNew ? '<label>Current odometer (km)<input id="cfKm" type="number" inputmode="numeric" placeholder="e.g. 45200" /></label>' : ''}
      </div>
      <div class="sheet-btns">
        <button class="btn primary" id="cfSave">${isNew ? 'Add car' : 'Save'}</button>
        ${isNew ? '' : '<button class="btn danger" id="cfDelete">Delete car</button>'}
        <button class="btn ghost" id="cfCancel">Cancel</button>
      </div>`, () => {
      $('cfCancel').onclick = closeSheet;
      $('cfSave').onclick = async () => {
        const name = $('cfName').value.trim();
        if (!name) { toast('Add a name for the car'); return; }
        const d = data();
        if (isNew) {
          const nc = { id: uid(), name, plate: $('cfPlate').value.trim(), odo: [] };
          const km = $('cfKm').value; if (km !== '') addOdo(nc, km);
          d.cars.push(nc); d.selected = nc.id;
          closeSheet(); await commit('Car added');
          if (!itemsOf(nc).length) addStarter(nc);
        } else {
          c.name = name; c.plate = $('cfPlate').value.trim();
          closeSheet(); await commit('Saved');
        }
      };
      if ($('cfDelete')) $('cfDelete').onclick = async () => {
        if (!confirm(`Delete ${c.name} and all its maintenance items and history?`)) return;
        const d = data();
        d.cars = d.cars.filter((x) => x.id !== c.id);
        d.items = d.items.filter((x) => x.carId !== c.id);
        d.history = d.history.filter((x) => x.carId !== c.id);
        d.selected = d.cars[0] ? d.cars[0].id : null;
        closeSheet(); await commit('Car deleted');
      };
    });
  }

  function odoSheet(c) {
    sheet(`
      <div class="sheet-icon">🧮</div><h2>Update odometer</h2>
      <p class="muted">Last: ${c.odo.length ? fmtKm(currentKm(c)) + ' on ' + fmtDate(c.odo[c.odo.length - 1].t) : 'none yet'}</p>
      <div class="form"><label>Current km<input id="odoKm" type="number" inputmode="numeric" value="${c.odo.length ? currentKm(c) : ''}" /></label></div>
      <div class="sheet-btns"><button class="btn primary" id="odoSave">Save</button><button class="btn ghost" id="odoCancel">Cancel</button></div>`, () => {
      $('odoCancel').onclick = closeSheet;
      $('odoSave').onclick = async () => { if (addOdo(c, $('odoKm').value)) { closeSheet(); await commit('Odometer updated'); } };
      setTimeout(() => $('odoKm').select(), 50);
    });
  }

  function addStarter(c) {
    sheet(`
      <div class="sheet-icon">📋</div><h2>Add recommended schedule?</h2>
      <p class="muted">${STARTER.join(', ')}. Each starts from today and your current km — edit any item if it was done earlier.</p>
      <div class="sheet-btns"><button class="btn primary" id="stYes">Add them</button><button class="btn ghost" id="stNo">I'll add my own</button></div>`, () => {
      $('stNo').onclick = closeSheet;
      $('stYes').onclick = async () => {
        STARTER.forEach((name) => {
          const t = TEMPLATES.find((x) => x.name === name);
          data().items.push({ id: uid(), carId: c.id, name: t.name, icon: t.icon, km: t.km, months: t.months, lastDate: Date.now(), lastKm: currentKm(c), remindDays: 7 });
        });
        closeSheet(); await commit('Schedule added — tap an item to adjust it');
      };
    });
  }

  function templateSheet(c) {
    sheet(`
      <div class="sheet-icon">➕</div><h2>Add maintenance item</h2>
      <div class="chips center-chips">${TEMPLATES.map((t, i) => `<button class="chip" data-tpl="${i}">${t.icon} ${esc(t.name)}</button>`).join('')}
        <button class="chip" data-tpl="custom">✏️ Custom…</button></div>
      <div class="sheet-btns"><button class="btn ghost" id="tplCancel">Cancel</button></div>`, (body) => {
      $('tplCancel').onclick = closeSheet;
      body.querySelectorAll('[data-tpl]').forEach((b) => {
        b.onclick = () => {
          const t = b.dataset.tpl === 'custom' ? { name: '', km: 0, months: 6, icon: '🔧' } : TEMPLATES[Number(b.dataset.tpl)];
          itemForm(c, null, t);
        };
      });
    });
  }

  function itemForm(c, item, tpl) {
    const it = item || { name: tpl.name, icon: tpl.icon, km: tpl.km, months: tpl.months, lastDate: Date.now(), lastKm: currentKm(c), remindDays: 7 };
    sheet(`
      <div class="sheet-icon">${it.icon || '🔧'}</div><h2>${item ? 'Edit item' : 'New item'}</h2>
      <div class="form">
        <label>Name<input id="ifName" value="${esc(it.name)}" placeholder="e.g. Change oil" /></label>
        <div class="row2">
          <label>Every (km)<input id="ifKm" type="number" inputmode="numeric" value="${it.km || ''}" placeholder="—" /></label>
          <label>Every (months)<input id="ifMonths" type="number" inputmode="numeric" value="${it.months || ''}" placeholder="—" /></label>
        </div>
        <p class="muted small" style="margin:0">Fill one or both — it's due at whichever comes first.</p>
        <div class="row2">
          <label>Last done<input id="ifDate" type="date" value="${isoDay(it.lastDate)}" /></label>
          <label>At km<input id="ifLastKm" type="number" inputmode="numeric" value="${it.lastKm || ''}" /></label>
        </div>
        <label>Remind me (days before)<input id="ifRemind" type="number" inputmode="numeric" value="${it.remindDays || 7}" /></label>
      </div>
      <div class="sheet-btns">
        <button class="btn primary" id="ifSave">Save</button>
        ${item ? '<button class="btn danger" id="ifDelete">Delete item</button>' : ''}
        <button class="btn ghost" id="ifCancel">Cancel</button>
      </div>`, () => {
      $('ifCancel').onclick = closeSheet;
      $('ifSave').onclick = async () => {
        const name = $('ifName').value.trim();
        const km = Math.max(0, Number($('ifKm').value) || 0), months = Math.max(0, Number($('ifMonths').value) || 0);
        if (!name) { toast('Give the item a name'); return; }
        if (!km && !months) { toast('Set km, months, or both'); return; }
        const upd = {
          name, km, months,
          lastDate: $('ifDate').value ? new Date($('ifDate').value + 'T12:00:00').getTime() : Date.now(),
          lastKm: Number($('ifLastKm').value) || 0,
          remindDays: Math.max(0, Number($('ifRemind').value) || 7),
        };
        if (item) Object.assign(item, upd);
        else data().items.push({ id: uid(), carId: c.id, icon: it.icon, ...upd });
        closeSheet(); await commit(item ? 'Saved' : 'Item added');
      };
      if ($('ifDelete')) $('ifDelete').onclick = async () => {
        if (!confirm(`Delete "${item.name}"? Its past service history stays.`)) return;
        data().items = data().items.filter((x) => x.id !== item.id);
        closeSheet(); await commit('Item deleted');
      };
    });
  }

  function itemSheet(itemId) {
    const d = data(); const item = d.items.find((i) => i.id === itemId); if (!item) return;
    const c = d.cars.find((x) => x.id === item.carId); const info = dueInfo(item, c);
    const hist = d.history.filter((h) => h.itemId === item.id).sort((a, b) => b.t - a.t).slice(0, 5);
    sheet(`
      <div class="sheet-icon">${item.icon || '🔧'}</div><h2>${esc(item.name)}</h2>
      <p class="muted">${dueText(info)}</p>
      <p class="small">Every ${[item.km ? fmtKm(item.km) : '', item.months ? item.months + ' months' : ''].filter(Boolean).join(' or ')} · last done ${fmtDate(item.lastDate)}${item.lastKm ? ' at ' + fmtKm(item.lastKm) : ''}</p>
      <div class="form">
        <div class="row2">
          <label>Done on<input id="mdDate" type="date" value="${isoDay(Date.now())}" /></label>
          <label>At km<input id="mdKm" type="number" inputmode="numeric" value="${currentKm(c) || ''}" /></label>
        </div>
        <div class="row2">
          <label>Cost (₱)<input id="mdCost" type="number" inputmode="decimal" placeholder="0" /></label>
          <label>Notes<input id="mdNotes" placeholder="shop, brand…" /></label>
        </div>
      </div>
      <div class="sheet-btns">
        <button class="btn stand" id="mdDone">Mark done ✓</button>
        <button class="btn ghost" id="mdEdit">Edit schedule</button>
        <button class="btn ghost" id="mdClose">Close</button>
      </div>
      ${hist.length ? `<ul class="timeline small" style="text-align:left;margin-top:12px">${hist.map((h) => `<li><span>${fmtDate(h.t)} · ${fmtKm(h.km)}</span><span class="muted">${h.cost ? peso(h.cost) : ''}</span></li>`).join('')}</ul>` : ''}`, () => {
      $('mdClose').onclick = closeSheet;
      $('mdEdit').onclick = () => itemForm(c, item);
      $('mdDone').onclick = async () => {
        markDone(item.id, { date: $('mdDate').value, km: $('mdKm').value, cost: $('mdCost').value, notes: $('mdNotes').value.trim() });
        closeSheet(); await commit();
      };
    });
  }


  // ================= FUEL (full-tank method) =================
  // Each fill: { id, t, km, liters, total, price (₱/L), full, station }
  // Efficiency is measured between two FULL fills: km driven ÷ liters added since the previous full tank.
  const fills = (c) => (c.fuel = c.fuel || []).slice().sort((a, b) => a.km - b.km || a.t - b.t);
  function segments(c) {
    const f = fills(c), out = [];
    let lastFull = null, liters = 0, cost = 0;
    f.forEach((x) => {
      if (lastFull) { liters += x.liters || 0; cost += x.total || 0; }
      if (x.full) {
        if (lastFull && liters > 0 && x.km > lastFull.km) {
          const dist = x.km - lastFull.km;
          out.push({ fill: x, from: lastFull, t: x.t, dist, liters, cost, eff: dist / liters, l100: liters / dist * 100, perKm: cost / dist, price: x.price || (x.total && x.liters ? x.total / x.liters : 0) });
        }
        lastFull = x; liters = 0; cost = 0;
      }
    });
    return out;
  }
  function periodRange(p, offset = 0) {
    const n = new Date();
    if (p === 'all') return [0, Infinity];
    if (p === 'month') return [new Date(n.getFullYear(), n.getMonth() - offset, 1).getTime(), new Date(n.getFullYear(), n.getMonth() - offset + 1, 1).getTime()];
    if (p === 'quarter') { const q = Math.floor(n.getMonth() / 3) - offset; return [new Date(n.getFullYear(), q * 3, 1).getTime(), new Date(n.getFullYear(), q * 3 + 3, 1).getTime()]; }
    return [new Date(n.getFullYear() - offset, 0, 1).getTime(), new Date(n.getFullYear() - offset + 1, 0, 1).getTime()];
  }
  const PERIOD_LABEL = { month: 'This month', quarter: 'This quarter', year: 'This year', all: 'All time' };
  const PREV_LABEL = { month: 'last month', quarter: 'last quarter', year: 'last year' };
  function stats(c, p, offset = 0) {
    const [a, b] = periodRange(p, offset);
    const segs = segments(c).filter((s) => s.t >= a && s.t < b);
    const fl = fills(c).filter((x) => x.t >= a && x.t < b && x.liters > 0);
    const dist = segs.reduce((s, x) => s + x.dist, 0), lit = segs.reduce((s, x) => s + x.liters, 0), segCost = segs.reduce((s, x) => s + x.cost, 0);
    const spend = fl.reduce((s, x) => s + (x.total || 0), 0), liters = fl.reduce((s, x) => s + x.liters, 0);
    return { segs, fills: fl, eff: lit ? dist / lit : null, perKm: dist ? segCost / dist : null, dist, spend, liters, price: liters ? spend / liters : null };
  }
  const f1 = (n) => (n == null ? '—' : n.toFixed(1));
  const f2 = (n) => (n == null ? '—' : n.toFixed(2));
  function deltaTag(cur, prev, betterHigh, unit, dec = 1) {
    if (cur == null || prev == null || !prev) return '';
    const pct = (cur - prev) / prev * 100;
    if (Math.abs(pct) < 0.5) return `<span class="delta">＝ same as ${'$'}{x}</span>`;
    const good = betterHigh ? pct > 0 : pct < 0;
    return `<span class="delta ${good ? 'up' : 'down'}">${pct > 0 ? '▲' : '▼'} ${Math.abs(pct).toFixed(1)}%</span>`;
  }
  function miniBars(vals, labels, color, avg, fmt) {
    if (!vals.length) return '<p class="muted small">Not enough data yet.</p>';
    const W = 320, H = 140, pb = 18, pt = 16, max = Math.max(...vals, avg || 0) * 1.05, min = 0;
    const bw = W / vals.length;
    let svg = `<svg viewBox="0 0 ${W} ${H}" class="chart">`;
    if (avg) { const y = pt + (H - pb - pt) * (1 - (avg - min) / (max - min)); svg += `<line x1="0" x2="${W}" y1="${y}" y2="${y}" class="goal-line"/>`; }
    vals.forEach((v, i) => {
      const h = (H - pb - pt) * ((v - min) / (max - min)), x = i * bw + bw * 0.18;
      svg += `<rect x="${x}" y="${H - pb - h}" width="${bw * 0.64}" height="${Math.max(h, 1)}" rx="3" fill="${color}"/>`;
      if (vals.length <= 12) svg += `<text x="${x + bw * 0.32}" y="${H - pb - h - 4}" class="bar-val">${fmt(v)}</text>`;
      svg += `<text x="${x + bw * 0.32}" y="${H - 4}" class="bar-lbl">${labels[i]}</text>`;
    });
    return svg + '</svg>';
  }

  function insights(c) {
    const segs = segments(c);
    const out = [];
    if (segs.length < 2) {
      out.push({ t: 'info', m: segs.length ? 'One more full-tank fill-up and trends will appear here.' : 'Fill up to FULL, log it, then log every fill-up after. Efficiency is calculated from one full tank to the next.' });
      return out;
    }
    const all = segs.reduce((s, x) => s + x.dist, 0) / segs.reduce((s, x) => s + x.liters, 0);
    const recent = segs.slice(-2);
    const rEff = recent.reduce((s, x) => s + x.dist, 0) / recent.reduce((s, x) => s + x.liters, 0);
    const best = segs.reduce((a, b) => (b.eff > a.eff ? b : a));
    const diff = (rEff - all) / all * 100;
    if (diff <= -8) {
      out.push({ t: 'bad', m: `Efficiency is down <b>${Math.abs(diff).toFixed(0)}%</b> lately (${f1(rEff)} vs your usual ${f1(all)} km/L).` });
      const its = itemsOf(c).map((i) => ({ i, info: dueInfo(i, c) }));
      const flag = (re) => its.find((x) => re.test(x.i.name));
      const check = [];
      check.push('🛞 <b>Tire pressure</b> — under-inflated tires are the #1 cause. Check when cold, match the sticker on the driver door.');
      [[/air filter/i, '💨 <b>Air filter</b>'], [/oil/i, '🛢️ <b>Engine oil</b>'], [/spark/i, '⚡ <b>Spark plugs</b>'], [/tire rotation/i, '🔄 <b>Tire rotation / alignment</b>'], [/brake/i, '🛑 <b>Brakes</b> (a dragging caliper burns fuel)'], [/PMS/i, '🔧 <b>PMS</b>']].forEach(([re, label]) => {
        const x = flag(re);
        if (x && x.info.status !== 'ok') check.push(`${label} — <span class="${x.info.status === 'overdue' ? 'miss' : ''}">${dueText(x.info)}</span>`);
      });
      if (!flag(/air filter/i)) check.push('💨 <b>Air filter</b> — a clogged filter cuts mileage; not in your schedule yet.');
      check.push('🚦 Driving pattern — heavy traffic, long idling, more aircon or extra load all lower km/L.');
      out.push({ t: 'list', m: check });
    } else if (diff >= 5) {
      out.push({ t: 'good', m: `Efficiency is up <b>${diff.toFixed(0)}%</b> lately (${f1(rEff)} vs ${f1(all)} km/L). Keep it up.` });
    } else {
      out.push({ t: 'info', m: `Steady at about <b>${f1(rEff)} km/L</b> (your average is ${f1(all)}).` });
    }
    out.push({ t: 'info', m: `Best tank: <b>${f1(best.eff)} km/L</b> on ${fmtDate(best.t)} (${fmtKm(best.dist)}).` });
    const priced = fills(c).filter((x) => x.price);
    if (priced.length >= 3) {
      const last = priced[priced.length - 1].price, prev = priced.slice(-4, -1).reduce((s, x) => s + x.price, 0) / Math.min(3, priced.length - 1);
      const pd = (last - prev) / prev * 100;
      if (Math.abs(pd) >= 2) out.push({ t: pd > 0 ? 'bad' : 'good', m: `Fuel price ${pd > 0 ? 'up' : 'down'} <b>${Math.abs(pd).toFixed(1)}%</b>: ₱${f2(last)}/L vs ₱${f2(prev)}/L recently.` });
    }
    // tire-pressure habit reminder if not tracked
    if (!itemsOf(c).some((i) => /tire pressure/i.test(i.name))) out.push({ t: 'tip', m: 'Tip: add a "Tire pressure check" item every 1 month in Maintenance — the cheapest way to protect km/L.' });
    return out;
  }

  function fuelHTML(c) {
    const cur = stats(c, period), prev = period === 'all' ? null : stats(c, period, 1);
    const segsAll = segments(c);
    const last = segsAll[segsAll.length - 1];
    const recent = segsAll.slice(-12);
    const lb = cur.segs.slice().sort((a, b) => (lbSort === 'eff' ? b.eff - a.eff : b.t - a.t));
    const medal = (i) => (lbSort === 'eff' ? ['🥇', '🥈', '🥉'][i] || i + 1 : '');
    const pv = PREV_LABEL[period];
    // monthly breakdown (last 12 months with data)
    const months = {};
    segsAll.forEach((s) => { const k = new Date(s.t).toISOString().slice(0, 7); (months[k] = months[k] || { dist: 0, lit: 0 }); months[k].dist += s.dist; months[k].lit += s.liters; });
    fills(c).forEach((f) => { if (!f.liters) return; const k = new Date(f.t).toISOString().slice(0, 7); (months[k] = months[k] || { dist: 0, lit: 0 }); months[k].spend = (months[k].spend || 0) + (f.total || 0); months[k].fl = (months[k].fl || 0) + f.liters; });
    const mk = Object.keys(months).sort().slice(-12).reverse();
    const ins = insights(c);
    return `
      <div class="card">
        <div class="water-head"><h2>Fuel efficiency</h2><span class="muted small">${last ? 'last tank ' + f1(last.eff) + ' km/L' : ''}</span></div>
        <div class="chips">${['month', 'quarter', 'year', 'all'].map((p) => `<button class="chip ${p === period ? 'on' : ''}" data-period="${p}">${PERIOD_LABEL[p]}</button>`).join('')}</div>
        <div class="kpis">
          <div class="kpi"><div class="kv water-c">${f1(cur.eff)}<small> km/L</small></div><div class="kl">avg efficiency${cur.eff ? ' · ' + f1(100 / cur.eff) + ' L/100km' : ''}</div>${pv ? deltaTag(cur.eff, prev.eff, true).replace('${x}', pv) : ''}</div>
          <div class="kpi"><div class="kv">₱${f2(cur.perKm)}</div><div class="kl">cost per km</div>${pv ? deltaTag(cur.perKm, prev.perKm, false).replace('${x}', pv) : ''}</div>
          <div class="kpi"><div class="kv">₱${f2(cur.price)}</div><div class="kl">avg price per liter</div>${pv ? deltaTag(cur.price, prev.price, false).replace('${x}', pv) : ''}</div>
          <div class="kpi"><div class="kv">${peso(cur.spend)}</div><div class="kl">${f1(cur.liters)} L · ${cur.fills.length} fill-up${cur.fills.length === 1 ? '' : 's'}</div>${pv ? deltaTag(cur.spend, prev.spend, false).replace('${x}', pv) : ''}</div>
        </div>
        ${pv && prev.eff ? `<p class="muted small">vs ${pv}: ${f1(prev.eff)} km/L · ₱${f2(prev.price)}/L · ${peso(prev.spend)}</p>` : ''}
      </div>

      <div class="card">
        <h2>Insights & advice</h2>
        <ul class="insights">${ins.map((x) => x.t === 'list' ? `<li class="ins-list"><b>Check these:</b><ul>${x.m.map((m) => `<li>${m}</li>`).join('')}</ul></li>` : `<li class="ins-${x.t}">${x.m}</li>`).join('')}</ul>
      </div>

      <div class="card">
        <h2>Last ${recent.length || ''} tanks</h2>
        <h3>km per liter — dashed line = your average</h3>
        ${miniBars(recent.map((s) => s.eff), recent.map((s) => new Date(s.t).toLocaleDateString([], { month: 'numeric', day: 'numeric' })), 'var(--water)', segsAll.length ? segsAll.reduce((a, s) => a + s.dist, 0) / segsAll.reduce((a, s) => a + s.liters, 0) : 0, (v) => v.toFixed(1))}
        <h3>Price per liter (₱)</h3>
        ${(() => { const pf = fills(c).filter((x) => x.price).slice(-12); return miniBars(pf.map((x) => x.price), pf.map((x) => new Date(x.t).toLocaleDateString([], { month: 'numeric', day: 'numeric' })), 'var(--amber)', 0, (v) => v.toFixed(0)); })()}
      </div>

      <div class="card">
        <div class="water-head"><h2>Leaderboard</h2><span class="muted small">${PERIOD_LABEL[period]}</span></div>
        <div class="seg" style="margin:6px 0 8px">
          <button class="chip ${lbSort === 'eff' ? 'on' : ''}" data-sort="eff">Best km/L</button>
          <button class="chip ${lbSort === 'date' ? 'on' : ''}" data-sort="date">Latest</button>
        </div>
        ${lb.length ? `<div class="tablewrap"><table class="lb">
          <thead><tr><th>#</th><th>Date</th><th>km</th><th>L</th><th>km/L</th><th>₱/L</th><th>₱/km</th></tr></thead>
          <tbody>${lb.map((s, i) => `<tr data-fill="${s.fill.id}"><td>${medal(i)}</td><td>${new Date(s.t).toLocaleDateString([], { month: 'short', day: 'numeric' })}</td><td>${Math.round(s.dist)}</td><td>${f1(s.liters)}</td><td class="${s.eff >= (cur.eff || 0) ? 'good' : 'bad'}"><b>${f1(s.eff)}</b></td><td>${f2(s.price)}</td><td>${f2(s.perKm)}</td></tr>`).join('')}</tbody>
        </table></div>` : '<p class="muted small">No complete tanks in this period yet.</p>'}
      </div>

      <div class="card">
        <h2>By month</h2>
        ${mk.length ? `<div class="tablewrap"><table class="lb">
          <thead><tr><th>Month</th><th>km/L</th><th>₱/L</th><th>Liters</th><th>Spent</th></tr></thead>
          <tbody>${mk.map((k) => { const m = months[k]; return `<tr><td>${new Date(k + '-01T00:00').toLocaleDateString([], { month: 'short', year: '2-digit' })}</td><td><b>${m.lit ? f1(m.dist / m.lit) : '—'}</b></td><td>${m.fl ? f2(m.spend / m.fl) : '—'}</td><td>${m.fl ? f1(m.fl) : '—'}</td><td>${m.spend ? peso(m.spend) : '—'}</td></tr>`; }).join('')}</tbody>
        </table></div>` : '<p class="muted small">Nothing yet.</p>'}
      </div>

      <div class="card">
        <h2>All fill-ups</h2>
        <ul class="timeline">${fills(c).slice().reverse().slice(0, 40).map((f) => `
          <li data-fill="${f.id}"><span>${f.full ? '⛽' : '◐'} ${fmtKm(f.km)}${f.station ? ' · ' + esc(f.station) : ''}<br><span class="muted small">${f.liters ? f1(f.liters) + ' L' : 'starting point'}${f.price ? ' · ₱' + f2(f.price) + '/L' : ''}${f.full ? '' : ' · partial'}</span></span>
          <span class="muted" style="text-align:right">${fmtDate(f.t)}${f.total ? '<br>' + peso(f.total) : ''}</span></li>`).join('') || '<li class="muted">No fill-ups yet.</li>'}</ul>
      </div>`;
  }

  function fuelForm(c, fillId) {
    const f = fillId ? (c.fuel || []).find((x) => x.id === fillId) : null;
    const first = !f && !(c.fuel || []).length;
    const lastKm = currentKm(c);
    sheet(`
      <div class="sheet-icon">⛽</div><h2>${f ? 'Edit fill-up' : first ? 'Starting point' : 'Log fill-up'}</h2>
      ${first ? '<p class="muted small">Fill your tank to FULL, then enter the odometer. Liters and price are optional for this first entry — efficiency starts from your next full tank.</p>' : ''}
      <div class="form">
        <div class="row2">
          <label>Date<input id="fuDate" type="date" value="${isoDay(f ? f.t : Date.now())}" /></label>
          <label>Odometer (km)<input id="fuKm" type="number" inputmode="numeric" value="${f ? f.km : ''}" placeholder="${lastKm ? 'last ' + lastKm : ''}" /></label>
        </div>
        <div class="row2">
          <label>Liters<input id="fuL" type="number" inputmode="decimal" step="0.01" value="${f && f.liters ? f.liters : ''}" /></label>
          <label>Price per liter (₱)<input id="fuP" type="number" inputmode="decimal" step="0.01" value="${f && f.price ? f2(f.price) : ''}" /></label>
        </div>
        <div class="row2">
          <label>Total paid (₱)<input id="fuT" type="number" inputmode="decimal" step="0.01" value="${f && f.total ? f.total : ''}" /></label>
          <label>Station<input id="fuS" placeholder="e.g. Shell Aguinaldo" value="${esc(f ? f.station : '')}" /></label>
        </div>
        <label class="check"><input id="fuFull" type="checkbox" ${!f || f.full ? 'checked' : ''} /> Filled to full tank</label>
        <p class="muted small" id="fuHint" style="margin:0">Enter any two of liters, price, total — the third fills in.</p>
      </div>
      <div class="sheet-btns">
        <button class="btn water" id="fuSave">${f ? 'Save' : 'Log it'}</button>
        ${f ? '<button class="btn danger" id="fuDel">Delete</button>' : ''}
        <button class="btn ghost" id="fuCancel">Cancel</button>
      </div>`, () => {
      const L = $('fuL'), P = $('fuP'), T = $('fuT');
      let lastEdited = [];
      const touch = (id) => { lastEdited = [id, ...lastEdited.filter((x) => x !== id)].slice(0, 2); autofill(); };
      function autofill() {
        const l = parseFloat(L.value), p = parseFloat(P.value), t = parseFloat(T.value);
        const keep = new Set(lastEdited);
        if (keep.has('L') && keep.has('P') && l && p) T.value = (l * p).toFixed(2);
        else if (keep.has('L') && keep.has('T') && l && t) P.value = (t / l).toFixed(2);
        else if (keep.has('P') && keep.has('T') && p && t) L.value = (t / p).toFixed(2);
      }
      L.oninput = () => touch('L'); P.oninput = () => touch('P'); T.oninput = () => touch('T');
      $('fuCancel').onclick = closeSheet;
      $('fuSave').onclick = async () => {
        const km = Math.round(Number($('fuKm').value));
        if (!(km > 0)) { toast('Enter the odometer reading'); return; }
        const liters = parseFloat(L.value) || 0, total = parseFloat(T.value) || 0;
        const price = parseFloat(P.value) || (liters && total ? total / liters : 0);
        if (!first && !f && !liters) { toast('Enter the liters you added'); return; }
        const others = (c.fuel || []).filter((x) => !f || x.id !== f.id);
        const prevMax = others.reduce((m, x) => Math.max(m, x.km), 0);
        if (!f && others.length && km <= prevMax) { toast(`Odometer must be higher than your last fill-up (${fmtKm(prevMax)})`); return; }
        const t = $('fuDate').value === isoDay(Date.now()) ? Date.now() : new Date($('fuDate').value + 'T12:00:00').getTime();
        const rec = { t, km, liters, price, total: total || (liters && price ? +(liters * price).toFixed(2) : 0), full: $('fuFull').checked, station: $('fuS').value.trim() };
        c.fuel = c.fuel || [];
        if (f) Object.assign(f, rec); else c.fuel.push({ id: uid(), ...rec });
        if (km > currentKm(c)) addOdo(c, km, Math.min(t, Date.now()));
        closeSheet(); view = 'fuel';
        const segs = segments(c), seg = segs[segs.length - 1];
        await commit(!f && seg && seg.fill.km === km ? `${f1(seg.eff)} km/L this tank · ₱${f2(seg.perKm)}/km` : f ? 'Saved' : first ? 'Starting point saved — log your next full tank' : 'Fill-up logged');
      };
      if ($('fuDel')) $('fuDel').onclick = async () => {
        if (!confirm('Delete this fill-up?')) return;
        c.fuel = c.fuel.filter((x) => x.id !== f.id);
        closeSheet(); await commit('Deleted');
      };
    });
  }

  // Notification action entry point (from app.js)
  function handleAction(actionId, extra) {
    api.showTab('car');
    if (extra.kind === 'carodo') { const c = data().cars.find((x) => x.id === extra.carId); if (c) odoSheet(c); return; }
    if (extra.kind === 'car') {
      if (actionId === 'snooze') return 'snooze';
      itemSheet(extra.itemId); // tap or "Done" → open the item so you can log km and cost
    }
  }

  function summary() {
    const c = car(); if (!c) return null;
    const its = itemsOf(c).map((i) => dueInfo(i, c));
    return { overdue: its.filter((x) => x.status === 'overdue').length, soon: its.filter((x) => x.status === 'soon').length };
  }

  return { render, buildNotifications, handleAction, summary, data, isSheetOpen: () => !!sheetOpen };
};
