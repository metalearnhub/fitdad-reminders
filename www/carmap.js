/* Upkeep — Car map: an original top-down "x-ray" drawing of a Suzuki APV (2007–2018 body).
 * Not a factory diagram — positions are approximate, for finding your way around the van.
 * Front of the van is at the top; left-hand drive (driver on the left), as sold in the Philippines.
 * The APV is a semi cab-over: the 1.6 L G16A engine sits UNDER the front seats, rear-wheel drive.
 */
window.UpkeepCarMap = (function () {
  'use strict';
  const W = 240, H = 480;
  // t: r = rect, c = circle, p = path (b = bbox), l = line
  const R = (x, y, w, h, rx = 2) => ({ t: 'r', x, y, w, h, rx });
  const C = (cx, cy, r) => ({ t: 'c', cx, cy, r });
  const P = (d, b) => ({ t: 'p', d, b });
  const L = (x1, y1, x2, y2, sw = 3) => ({ t: 'l', x1, y1, x2, y2, sw });

  // Draw order matters: big/back parts first, small parts on top (they win the tap).
  const ZONES = [
    { id: 'body', name: 'Body & paint', icon: '🚘', where: 'Outer body panels, doors and bumpers.', s: [] },
    { id: 'glass', name: 'Windshield', icon: '🪟', where: 'Front windshield. Your LTO sticker goes on the upper corner.', s: [P('M52 98 L188 98 L196 126 L44 126 Z', [44, 98, 152, 28])] },
    { id: 'mirrors', name: 'Side mirrors', icon: '🪞', where: 'On the front doors.', s: [R(22, 104, 12, 8, 3), R(206, 104, 12, 8, 3)] },
    { id: 'exhaust', name: 'Exhaust & muffler', icon: '💨', where: 'Under the floor on the driver side — from the engine back to the tailpipe at the rear.', s: [P('M80 172 L68 180 L66 332 M66 370 L62 466', [58, 170, 24, 296]), R(54, 332, 26, 40, 8)], stroke: true },
    { id: 'driveline', name: 'Propeller shaft & rear differential', icon: '⚙️', where: 'Down the middle under the floor; the differential sits on the rear axle (rear-wheel drive).', s: [R(117, 240, 6, 136, 2), R(40, 382, 160, 5, 2), C(120, 384, 11)] },
    { id: 'fueltank', name: 'Fuel tank', icon: '⛽', where: 'Under the middle floor, passenger side. Fuel lid on the side of the body.', s: [R(140, 262, 52, 64, 8)] },
    { id: 'fuelfilter', name: 'Fuel filter / pump', icon: '⛽', where: 'At the fuel tank / along the fuel line under the floor.', s: [R(146, 250, 14, 9, 3)] },
    { id: 'spare', name: 'Spare tire', icon: '🛞', where: 'Under the rear, behind the axle — lowered with the jack handle.', s: [C(120, 436, 17)] },
    { id: 'suspension', name: 'Shocks, struts & leaf springs', icon: '🔩', where: 'Front: struts above the front wheels. Rear: leaf springs and shock absorbers at the rear wheels.', s: [R(42, 134, 7, 20, 2), R(191, 134, 7, 20, 2), R(42, 346, 6, 76, 3), R(192, 346, 6, 76, 3)] },
    { id: 'tires', name: 'Tires & wheels', icon: '🛞', where: 'Four corners. Front wheels sit right under the front doors.', s: [R(22, 120, 18, 50, 5), R(200, 120, 18, 50, 5), R(22, 360, 18, 50, 5), R(200, 360, 18, 50, 5)] },
    { id: 'brakes_f', name: 'Front brakes (disc & pads)', icon: '🛑', where: 'Inside the front wheels — disc rotors and brake pads.', s: [C(31, 145, 7), C(209, 145, 7)] },
    { id: 'brakes_r', name: 'Rear brakes (drum & shoes)', icon: '🛑', where: 'Inside the rear wheels — drums with brake shoes.', s: [C(31, 385, 7), C(209, 385, 7)] },
    { id: 'steering', name: 'Steering', icon: '🎛️', where: 'Steering rack across the front axle; tie rods go to the front wheels.', s: [R(42, 166, 156, 4, 2), C(80, 132, 9)], ring: true },
    { id: 'condenser', name: 'Aircon condenser', icon: '❄️', where: 'Very front, behind the grille — in front of the radiator.', s: [R(64, 24, 112, 5, 2)] },
    { id: 'radiator', name: 'Radiator', icon: '🌡️', where: 'Front, behind the grille and condenser. Hoses run back to the engine.', s: [R(68, 31, 104, 13, 2)] },
    { id: 'battery', name: 'Battery', icon: '🔋', where: 'Under the front hood. Check terminals for white/green crust.', s: [R(46, 50, 32, 20, 3)] },
    { id: 'psfluid', name: 'Power steering fluid', icon: '🎛️', where: 'Small reservoir under the front hood.', s: [R(100, 58, 14, 12, 3)] },
    { id: 'coolant', name: 'Coolant reserve tank', icon: '🌡️', where: 'Under the front hood — white tank with FULL / LOW marks. Check when the engine is cold.', s: [R(176, 50, 16, 20, 4)] },
    { id: 'washer', name: 'Washer fluid tank', icon: '🧴', where: 'Under the front hood, passenger side.', s: [R(158, 76, 16, 14, 3)] },
    { id: 'brakefluid', name: 'Brake fluid reservoir', icon: '💧', where: 'Under the front hood, driver side — on the brake master cylinder. MIN / MAX on the side.', s: [R(52, 78, 16, 13, 3)] },
    { id: 'headlights', name: 'Headlights & signals', icon: '💡', where: 'Front corners.', s: [R(38, 19, 28, 9, 4), R(174, 19, 28, 9, 4)] },
    { id: 'taillights', name: 'Tail & brake lights', icon: '🔴', where: 'Rear corners.', s: [R(38, 448, 14, 13, 3), R(188, 448, 14, 13, 3)] },
    { id: 'papers', name: 'Plates, LTO sticker & papers', icon: '📄', where: 'Front and rear plates; LTO sticker on the windshield. Keep OR/CR and CTPL in the glovebox.', s: [R(100, 10, 40, 7, 2), R(100, 463, 40, 7, 2), R(174, 102, 9, 9, 2)] },
    { id: 'wipers', name: 'Wiper blades', icon: '🌧️', where: 'At the bottom of the windshield.', s: [L(66, 123, 112, 109), L(128, 123, 174, 109)] },
    { id: 'evaporator', name: 'Aircon evaporator & blower', icon: '❄️', where: 'Behind the dashboard, in the middle.', s: [R(92, 114, 56, 10, 3)] },
    { id: 'cabinfilter', name: 'Cabin / aircon filter', icon: '🌬️', where: 'Behind the glovebox, passenger side.', s: [R(154, 115, 24, 9, 3)] },
    { id: 'engine', name: 'Engine (1.6 L, G16A)', icon: '⚙️', where: 'Under the FRONT SEATS. Lift the seats to reach it — the APV has no engine under the hood.', s: [R(82, 138, 76, 66, 9)], under: true },
    { id: 'transmission', name: 'Transmission & clutch', icon: '⚙️', where: 'Right behind the engine, under the floor.', s: [R(104, 206, 32, 34, 7)] },
    { id: 'belt', name: 'Drive / fan belt', icon: '➰', where: 'Front end of the engine, under the front seats.', s: [P('M94 141 Q120 132 146 141 Q120 150 94 141 Z', [94, 136, 52, 10])], stroke: true },
    { id: 'alternator', name: 'Alternator & starter', icon: '🔌', where: 'On the engine, driven by the belt; starter on the side near the transmission.', s: [C(96, 150, 5)] },
    { id: 'compressor', name: 'Aircon compressor', icon: '❄️', where: 'On the engine, driven by the belt.', s: [C(146, 150, 6)] },
    { id: 'timing', name: 'Timing belt', icon: '⏱️', where: 'Front end of the engine, behind a cover.', s: [R(84, 144, 6, 22, 2)] },
    { id: 'sparkplugs', name: 'Spark plugs', icon: '⚡', where: 'Top of the engine — 4 plugs in a row, reached by lifting the seats.', s: [C(102, 168, 3.6), C(114, 168, 3.6), C(126, 168, 3.6), C(138, 168, 3.6)] },
    { id: 'throttle', name: 'Throttle body & intake', icon: '🧽', where: 'On the intake side of the engine, under the seats.', s: [R(100, 184, 16, 10, 3)] },
    { id: 'airfilter', name: 'Air filter box', icon: '💨', where: 'Next to the engine under the seats — clips open, no tools.', s: [R(122, 182, 26, 15, 3)] },
    { id: 'oilfilter', name: 'Oil filter', icon: '🧴', where: 'Side of the engine, changed from underneath.', s: [C(88, 196, 5)] },
    { id: 'o2', name: 'Oxygen (O2) sensor', icon: '🔬', where: 'Screwed into the exhaust pipe just behind the engine.', s: [C(70, 182, 4.5)] },
    { id: 'dipstick', name: 'Oil dipstick & oil cap', icon: '🛢️', where: 'Lift the FRONT PASSENGER seat — yellow-handled dipstick. Check level with the engine off on flat ground.', s: [C(150, 170, 4.5)] },
  ];
  const BY = Object.fromEntries(ZONES.map((z) => [z.id, z]));

  // Name → parts. Every matching rule adds its zones.
  const RULES = [
    [/pms|preventive/i, ['engine', 'dipstick', 'oilfilter', 'airfilter']],
    [/change oil|oil change|engine oil(?! level)|oil drain/i, ['engine', 'dipstick']],
    [/oil level|dipstick/i, ['dipstick']],
    [/oil filter/i, ['oilfilter']],
    [/\bair filter|intake filter/i, ['airfilter']],
    [/spark|ignition coil|plug wire/i, ['sparkplugs']],
    [/\bo2\b|oxygen/i, ['o2']],
    [/fuel filter|fuel pump/i, ['fuelfilter']],
    [/fuel tank|fuel line|gas tank/i, ['fueltank']],
    [/throttle|injector|intake/i, ['throttle']],
    [/fan belt|drive belt|drive \/ fan|alternator belt|serpentine|\bv-?belt/i, ['belt']],
    [/timing/i, ['timing']],
    [/transmission|gear oil|clutch|gearbox|\batf\b/i, ['transmission']],
    [/differential|propeller|prop shaft|u-joint|cross joint|drive ?shaft/i, ['driveline']],
    [/spare/i, ['spare']],
    [/valve stem/i, ['tires']],
    [/expansion valve/i, ['evaporator']],
    [/receiver|drier|dryer/i, ['condenser']],
    [/tire|tyre|wheel(?! cylinder)|rim\b|rotation|align|balanc|\bpsi\b/i, ['tires']],
    [/brake pad|disc|rotor|caliper/i, ['brakes_f']],
    [/brake shoe|drum|wheel cylinder/i, ['brakes_r']],
    [/brake fluid|master cylinder|brake booster/i, ['brakefluid']],
    [/brake(?! fluid| pad| shoe| light| lamp)/i, ['brakes_f', 'brakes_r'], true],
    [/coolant (level|check|top)|reserve tank|overflow/i, ['coolant']],
    [/coolant(?! (level|check|top))|radiator|thermostat|water pump|radiator hose/i, ['radiator', 'coolant']],
    [/battery|terminal/i, ['battery']],
    [/alternator|starter/i, ['alternator']],
    [/fuse|wiring|relay/i, ['battery']],
    [/headlight|head lamp|signal light|fog/i, ['headlights']],
    [/tail ?light|brake light|stop lamp|plate light/i, ['taillights']],
    [/^(lights?|bulbs?)$|^light bulb/i, ['headlights', 'taillights']],
    [/cabin|aircon filter|a\/?c filter/i, ['cabinfilter']],
    [/compressor|magnetic clutch/i, ['compressor']],
    [/condenser/i, ['condenser']],
    [/evaporator|blower|pull-?down/i, ['evaporator']],
    [/freon|refrigerant|recharge/i, ['compressor', 'condenser', 'evaporator']],
    [/air ?con|a\/c\b|\bac\b|aircon/i, ['compressor', 'condenser', 'evaporator'], true],
    [/shock|strut|leaf|spring|suspension|bushing|ball joint|stabilizer|link/i, ['suspension']],
    [/power steering|steering fluid/i, ['psfluid', 'steering']],
    [/steering|tie rod|rack end|rack/i, ['steering']],
    [/wiper/i, ['wipers']],
    [/washer/i, ['washer', 'wipers']],
    [/windshield|glass|window/i, ['glass']],
    [/mirror/i, ['mirrors']],
    [/paint|^body|body ?work|body repair|dent|door|bumper|fender|rust/i, ['body']],
    [/lto|registration|insurance|ctpl|emission|plate/i, ['papers']],
    [/exhaust|muffler|tail ?pipe|catalytic/i, ['exhaust']],
    [/engine(?! oil)|motor|gasket|valve|tune.?up|engine mount|overhaul/i, ['engine'], true],
  ];
  function zonesFor(...names) {
    const out = [];
    names.flat().filter(Boolean).forEach((n) => {
      // strong rules first; "weak" (generic) rules only when nothing specific matched this name
      const hit = [];
      RULES.forEach(([re, zs, weak]) => { if (!weak && re.test(String(n))) hit.push(...zs); });
      if (!hit.length) RULES.forEach(([re, zs, weak]) => { if (weak && re.test(String(n))) hit.push(...zs); });
      hit.forEach((z) => { if (!out.includes(z)) out.push(z); });
    });
    return out;
  }

  const bbox = (s) => s.t === 'r' ? [s.x, s.y, s.w, s.h] : s.t === 'c' ? [s.cx - s.r, s.cy - s.r, 2 * s.r, 2 * s.r]
    : s.t === 'l' ? [Math.min(s.x1, s.x2), Math.min(s.y1, s.y2), Math.abs(s.x2 - s.x1), Math.abs(s.y2 - s.y1)] : s.b;
  function shapeSVG(s, extra = '') {
    if (s.t === 'r') return `<rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" rx="${s.rx}" ${extra}/>`;
    if (s.t === 'c') return `<circle cx="${s.cx}" cy="${s.cy}" r="${s.r}" ${extra}/>`;
    if (s.t === 'l') return `<line x1="${s.x1}" y1="${s.y1}" x2="${s.x2}" y2="${s.y2}" stroke-width="${s.sw}" stroke-linecap="round" ${extra}/>`;
    return `<path d="${s.d}" ${extra}/>`;
  }
  const BODY = 'M64 18 Q120 8 176 18 Q202 22 204 52 L206 440 Q206 462 186 464 L54 464 Q34 462 34 440 L36 52 Q38 22 64 18 Z';

  /**
   * opts.status: { zoneId: 'overdue' | 'soon' | 'ok' | 'rec' } — colors parts by state
   * opts.focus:  [zoneId] — highlights just these (others dimmed) and zooms to them
   * opts.labels: show a few orientation labels
   */
  function svg(opts = {}) {
    const status = opts.status || {}, focus = opts.focus || null;
    let vb = [0, 0, W, H];
    if (focus && focus.length && opts.zoom !== false) {
      const bs = focus.flatMap((id) => (BY[id] ? BY[id].s.map(bbox) : []));
      if (bs.length) {
        let x0 = Math.min(...bs.map((b) => b[0])), y0 = Math.min(...bs.map((b) => b[1]));
        let x1 = Math.max(...bs.map((b) => b[0] + b[2])), y1 = Math.max(...bs.map((b) => b[1] + b[3]));
        // keep the view at the map's shape, at least ~half the van wide so you still see where you are
        let w = Math.max(x1 - x0 + 60, 150), h = Math.max(y1 - y0 + 60, w * 0.9);
        w = Math.max(w, h / 0.9); if (w > W) { w = W; } if (h > H) h = H;
        let cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
        let vx = Math.min(Math.max(cx - w / 2, -10), W + 10 - w), vy = Math.min(Math.max(cy - h / 2, 0), H - h);
        vb = [Math.round(vx), Math.round(vy), Math.round(w), Math.round(h)];
      }
    }
    const isLit = (id) => focus && focus.includes(id);
    const zone = (z) => {
      if (!z.s.length) return '';
      const st = status[z.id] || '';
      const cls = ['z', z.stroke ? 'zs' : '', z.under ? 'zu' : '', z.ring ? 'zr' : '', st ? 'z-' + st : '', isLit(z.id) ? 'lit' : ''].filter(Boolean).join(' ');
      return `<g class="${cls}" data-z="${z.id}"><title>${z.name}</title>${z.s.map((s) => shapeSVG(s)).join('')}</g>`;
    };
    const ctx = `
      <path class="m-body ${status.body ? 'z-' + status.body : ''} ${isLit('body') ? 'lit' : ''}" data-z="body" d="${BODY}"/>
      <path class="m-hood" d="M40 94 L200 94"/>
      <rect class="m-seat" x="52" y="138" width="56" height="58" rx="10"/>
      <rect class="m-seat" x="132" y="138" width="56" height="58" rx="10"/>
      <rect class="m-seat" x="52" y="244" width="136" height="40" rx="10"/>
      <rect class="m-seat" x="52" y="306" width="136" height="38" rx="10"/>
      <path class="m-hood" d="M36 214 L204 214 M36 296 L204 296"/>`;
    const labels = opts.labels ? `
      <text class="m-lbl" x="120" y="88">FRONT HOOD</text>
      <text class="m-lbl" x="80" y="226">driver</text><text class="m-lbl" x="160" y="226">passenger</text>
      <text class="m-lbl" x="96" y="258">2nd row</text><text class="m-lbl" x="96" y="320">3rd row</text>
` : '';
    return `<svg class="carmap ${focus ? 'focus' : ''}" viewBox="${vb.join(' ')}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Suzuki APV parts map">
      ${ctx}${ZONES.filter((z) => z.id !== 'body').map(zone).join('')}${labels}</svg>`;
  }

  return { ZONES, zone: (id) => BY[id], zonesFor, svg };
})();
