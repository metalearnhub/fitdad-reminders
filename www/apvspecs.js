/* Upkeep — Suzuki APV (2005–2018, 1.6 L G16A SOHC, 5-speed manual, rear-wheel drive) parts & fluids guide.
 * Keyed by car-map part id, so every schedule / record / map tap shows the right spec.
 * ok: true  = matches parts-maker fitment listings / Suzuki G16 engine data
 * ok: false = typical for this van — confirm on the label, the old part, or with the shop before buying
 * hi: advice for a high-mileage van (200,000 km+)
 */
window.UpkeepApvSpecs = (function () {
  'use strict';
  const S = {
    engine: [
      { k: 'Engine', v: '1.6 L G16A, 4-cylinder, SOHC 16-valve, gasoline', ok: true },
      { k: 'Fuel', v: 'Unleaded gasoline, RON 91 or higher (regular unleaded is fine)', ok: false },
      { k: 'Engine oil', v: 'SAE 10W-30 or 5W-30 · API SL or newer (SN/SP also fine)', ok: true, hi: 'At high mileage, a 10W-40 or "high mileage" 10W-30 helps if it burns or leaks oil. Avoid thin 0W-20.' },
      { k: 'Oil amount', v: 'About 3.5–4.0 L with filter — pour 3.5 L, then top up to the F mark on the dipstick', ok: false },
      { k: 'Change interval', v: 'Every 5,000 km or 6 months (hot, stop-and-go use counts as severe)', ok: true },
    ],
    dipstick: [
      { k: 'Check', v: 'Engine off, on level ground, wait 5 min. Level between L and F', ok: true },
      { k: 'Top-up oil', v: 'Same oil as in the engine — SAE 10W-30 / 5W-30, API SL+', ok: true, hi: 'Needing more than ~1 L per 1,000 km means worn rings/valve seals or a leak — have it checked.' },
    ],
    oilfilter: [
      { k: 'Oil filter', v: 'Suzuki 16510-61A31 (or its equivalent from Sakura, Bosch, Denso, etc.)', ok: true },
      { k: 'Change', v: 'Every oil change', ok: true },
    ],
    sparkplugs: [
      { k: 'Spark plugs ×4', v: 'NGK BKR6E-11 (or BKR6EY-11) · Denso K20PR-U11', ok: true },
      { k: 'Gap', v: '1.0–1.1 mm', ok: true },
      { k: 'Longer-life option', v: 'NGK Iridium IX BKR6EIX-11 (same heat range)', ok: false },
      { k: 'Change', v: 'Nickel: every 20,000–40,000 km · Iridium: 60,000–100,000 km', ok: false, hi: 'Inspect the plug wires/coil too — old leads cause misfires and poor km/L.' },
    ],
    belt: [
      { k: 'Alternator belt', v: '4PK815 (4-rib V-ribbed, 815 mm)', ok: true },
      { k: 'Aircon belt', v: 'Separate belt — bring the old one to match the size', ok: false },
      { k: 'Change', v: 'When cracked, glazed or squealing; about every 40,000–50,000 km', ok: false, hi: 'Replace both belts together and check the tensioner/idler pulley bearing.' },
    ],
    timing: [
      { k: 'Timing belt', v: 'Belt-driven (not a chain). Ask for a timing belt kit for APV G16A — e.g. Gates kit ETK1015: belt + tensioner bearing + cam & crank oil seals', ok: true },
      { k: 'Change', v: 'About every 100,000 km or 5 years', ok: false, hi: 'No record of the last change? Replace it now with the tensioner and seals, and check the water pump while it\'s open. A snapped belt can wreck the engine.' },
    ],
    airfilter: [
      { k: 'Air filter', v: 'APV 1.6 panel element — bring the old one or give the shop "APV G16A 2012"', ok: false },
      { k: 'Change', v: 'Clean every 5,000 km, replace every 20,000 km (sooner on dusty roads)', ok: false },
    ],
    throttle: [
      { k: 'Cleaner', v: 'Throttle-body / carb cleaner spray safe for sensors. Don\'t spray the throttle sensor', ok: false },
      { k: 'Interval', v: 'About every 20,000 km or when idle gets rough', ok: false },
    ],
    o2: [
      { k: 'O2 sensor', v: 'Match the connector and part number on the old sensor (APV G16A, upstream)', ok: false, hi: 'High km/L loss and a check-engine light are the usual signs.' },
    ],
    fuelfilter: [
      { k: 'Fuel filter', v: 'In-line/at-tank filter for APV 1.6 EFI — bring the old part number', ok: false },
      { k: 'Change', v: 'About every 40,000 km', ok: false },
    ],
    fueltank: [
      { k: 'Fuel', v: 'Unleaded gasoline RON 91+', ok: false },
    ],
    radiator: [
      { k: 'Coolant', v: 'Suzuki Long Life Coolant, or any ethylene-glycol LLC mixed 50/50 with distilled water', ok: false, hi: 'Never plain tap water. At high mileage, check hoses, radiator cap and water pump for seepage.' },
      { k: 'Flush', v: 'About every 40,000 km or 2 years', ok: false },
    ],
    coolant: [
      { k: 'Reserve tank', v: 'Keep between LOW and FULL with the engine cold', ok: true },
      { k: 'Top-up', v: 'Same coolant type already in the system (don\'t mix colors/brands)', ok: false },
    ],
    brakefluid: [
      { k: 'Brake fluid', v: 'DOT 3 (DOT 4 can also be used) — check the spec printed on the reservoir cap', ok: false },
      { k: 'Change', v: 'Every 2 years or ~40,000 km', ok: false, hi: 'A dropping level usually means worn pads/shoes, not missing fluid — check the brakes before topping up.' },
    ],
    brakes_f: [
      { k: 'Front brakes', v: 'Disc brakes with pads — ask for "front brake pads APV 2005–2018"', ok: false },
      { k: 'Replace when', v: 'Pad material under ~3 mm, squealing, or rotors scored', ok: false },
    ],
    brakes_r: [
      { k: 'Rear brakes', v: 'Drum brakes with shoes — ask for "rear brake shoes APV"', ok: false },
      { k: 'Service', v: 'Clean and adjust each PMS; replace shoes when lining is thin', ok: false },
    ],
    tires: [
      { k: 'Tire size', v: 'Commercial "C" tires — check the size on your sidewall (GLX usually 185R14C 8PR)', ok: false },
      { k: 'Pressure', v: 'Use the label on the driver door pillar. Rear needs more when fully loaded', ok: false },
      { k: 'Replace', v: 'Tread under 1.6 mm, cracks, or 5+ years old (see the 4-digit date code, e.g. 2319 = week 23 of 2019)', ok: true },
    ],
    spare: [
      { k: 'Spare tire', v: 'Same size as the road tires. Check its pressure monthly too', ok: true },
    ],
    transmission: [
      { k: 'Gear oil (5-speed manual)', v: 'SAE 75W-90, API GL-4', ok: false, hi: 'Hard shifting at high km is often old oil or a worn clutch — change the oil first.' },
      { k: 'Change', v: 'About every 40,000 km', ok: false },
    ],
    driveline: [
      { k: 'Rear differential oil', v: 'SAE 80W-90 (or 75W-90), API GL-5 hypoid gear oil', ok: false },
      { k: 'Change', v: 'About every 40,000 km', ok: false },
    ],
    psfluid: [
      { k: 'Power steering fluid', v: 'ATF Dexron II/III type — confirm on the reservoir cap', ok: false },
    ],
    steering: [
      { k: 'Check', v: 'Tie-rod ends and rack boots each PMS; play in the wheel or clunks mean wear', ok: false },
    ],
    battery: [
      { k: 'Battery', v: 'Match the size and terminal side of the one fitted (commonly NS60 / 2SM class, 12 V)', ok: false, hi: 'Older than 2 years in PH heat? Have it load-tested before it strands you.' },
    ],
    alternator: [
      { k: 'Alternator belt', v: '4PK815', ok: true },
    ],
    headlights: [
      { k: 'Headlight bulb', v: 'H4 halogen 12 V 60/55 W (check the old bulb)', ok: false },
    ],
    cabinfilter: [
      { k: 'Cabin filter', v: 'APV aircon filter behind the glovebox — bring the old one if unsure', ok: false },
      { k: 'Change', v: 'Every 15,000 km or yearly', ok: false },
    ],
    compressor: [
      { k: 'Refrigerant', v: 'R-134a — amount is on the sticker under the hood', ok: false },
      { k: 'Compressor oil', v: 'PAG oil, as specified on the compressor label', ok: false },
    ],
    condenser: [
      { k: 'Refrigerant', v: 'R-134a', ok: false },
    ],
    evaporator: [
      { k: 'Cleaning', v: 'Evaporator (pull-down) cleaning about yearly, or when the AC smells', ok: false },
    ],
    suspension: [
      { k: 'Front', v: 'MacPherson struts', ok: false },
      { k: 'Rear', v: 'Leaf springs with shock absorbers', ok: false, hi: 'At high km, replace shocks in pairs and check leaf-spring bushings for clunks.' },
    ],
    wipers: [
      { k: 'Wiper blades', v: 'Measure the old blades (driver and passenger may differ)', ok: false },
    ],
    papers: [
      { k: 'Bring for LTO', v: 'OR/CR, CTPL insurance, emission test result', ok: true },
    ],
  };

  const has = (zones) => zones.some((z) => S[z]);
  const forZones = (zones) => zones.filter((z) => S[z]).map((z) => ({ zone: z, rows: S[z] }));
  const isApv = (name) => /\bapv\b/i.test(name || '');
  return { S, has, forZones, isApv };
})();
