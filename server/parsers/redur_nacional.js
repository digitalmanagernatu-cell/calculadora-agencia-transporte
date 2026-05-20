const XLSX = require('xlsx');

// Sheet: NATUAROMA 2026
// Layout (col indices 0-based, col A=0 is empty):
//   B(1)=KILOS  C(2)=ZonaP  D(3)=Z1  E(4)=Z2  F(5)=Z3  G(6)=Z4  H(7)=Z5  I(8)=Z6
//   J(9)=B2  K(10)=PT3  L(11)=PT4  [M(12)=2nd KILOS]  N(13)=R1  O(14)=AEREO  P(15)=MAR
// Header row detected dynamically (looks for "KILOS" in WEIGHT_COL)

const WEIGHT_COL = 1; // column B

const ZONE_COLS = [
  { col: 2,  zone: 'Zona P' },
  { col: 3,  zone: 'Zona 1' },
  { col: 4,  zone: 'Zona 2' },
  { col: 5,  zone: 'Zona 3' },
  { col: 6,  zone: 'Zona 4' },
  { col: 7,  zone: 'Zona 5' },
  { col: 8,  zone: 'Zona 6' },
  { col: 9,  zone: 'B2' },
  { col: 10, zone: 'PT3' },
  { col: 11, zone: 'PT4' },
  { col: 13, zone: 'R1' },
  { col: 14, zone: 'AEREO' },
  { col: 15, zone: 'MAR' },
];

// Hardcoded zone → CP 2-digit prefixes
// PT3: Portugal Lisboa (10-21, 25-29), Porto (40-49)
// PT4: Resto Portugal (22-24, 30-38, 50-64, 70-89)
function buildZoneMappings() {
  const mappings = {
    'Zona P': ['30'],
    'Zona 1': ['02', '03'],
    'Zona 2': ['04', '46'],
    'Zona 3': ['12', '13', '16', '18', '23', '43', '44', '45'],
    'Zona 4': ['05', '08', '14', '19', '25', '28', '29', '40', '41', '42', '47', '50', '52'],
    'Zona 5': ['01', '06', '09', '10', '11', '17', '21', '22', '24', '26', '31', '34', '37', '49', '51'],
    'Zona 6': ['15', '20', '27', '32', '33', '36', '39', '48'],
    'B2':     ['07'],
  };

  // PT3: Lisboa 10-21, 25-29; Porto 40-49
  // Prefix stored as "PT" + 2-digit to avoid collision with Spanish CPs (e.g. PT10 ≠ 10)
  const pt3Prefixes = [];
  for (let i = 10; i <= 21; i++) pt3Prefixes.push('PT' + String(i).padStart(2, '0'));
  for (let i = 25; i <= 29; i++) pt3Prefixes.push('PT' + String(i).padStart(2, '0'));
  for (let i = 40; i <= 49; i++) pt3Prefixes.push('PT' + String(i).padStart(2, '0'));
  mappings['PT3'] = pt3Prefixes;

  // PT4: 22-24, 30-38, 50-64, 70-89
  const pt4Prefixes = [];
  for (let i = 22; i <= 24; i++) pt4Prefixes.push('PT' + String(i).padStart(2, '0'));
  for (let i = 30; i <= 38; i++) pt4Prefixes.push('PT' + String(i).padStart(2, '0'));
  for (let i = 50; i <= 64; i++) pt4Prefixes.push('PT' + String(i).padStart(2, '0'));
  for (let i = 70; i <= 89; i++) pt4Prefixes.push('PT' + String(i).padStart(2, '0'));
  mappings['PT4'] = pt4Prefixes;

  const zoneMappings = [];
  for (const [zone, prefixes] of Object.entries(mappings)) {
    for (const prefix of prefixes) {
      zoneMappings.push({ scope: 'nacional', zone, destination: prefix });
    }
  }
  return zoneMappings;
}

function parse(filePath) {
  const wb = XLSX.readFile(filePath);
  const sheetName = wb.SheetNames.find(n => n.includes('NATUAROMA') || n.includes('2026')) || wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

  // Locate header row dynamically: first row where WEIGHT_COL contains "KILOS"
  let headerIdx = -1;
  for (let i = 0; i < Math.min(rows.length, 150); i++) {
    const cell = String(rows[i]?.[WEIGHT_COL] ?? '').trim();
    if (/^kilo/i.test(cell)) { headerIdx = i; break; }
  }
  if (headerIdx === -1) {
    return { rates: [], zoneMappings: buildZoneMappings(), warning: 'No se encontró la cabecera KILOS en la hoja' };
  }

  const extraPerKg = {};
  const ratesByZone = {};
  ZONE_COLS.forEach(({ zone }) => { ratesByZone[zone] = []; });

  for (let i = headerIdx + 1; i < Math.min(rows.length, headerIdx + 80); i++) {
    const row = rows[i];
    if (!row) continue;

    const rawWeight = row[WEIGHT_COL];
    if (rawWeight === null || rawWeight === undefined) continue;

    const weightStr = String(rawWeight).trim();
    if (!weightStr) continue;

    // Detect extra_per_kg row: '>1000', '>X', 'más de'
    const isExtraRow =
      weightStr.includes('>') ||
      weightStr.toLowerCase().includes('más');

    if (isExtraRow) {
      for (const { col, zone } of ZONE_COLS) {
        const price = parseFloat(row[col]);
        if (!isNaN(price) && price > 0) extraPerKg[zone] = price;
      }
      continue;
    }

    const weight = parseFloat(rawWeight);
    if (isNaN(weight) || weight <= 0) continue;

    for (const { col, zone } of ZONE_COLS) {
      const price = parseFloat(row[col]);
      if (!isNaN(price) && price > 0) {
        ratesByZone[zone].push({
          scope: 'nacional',
          zone,
          weight_max_kg: weight,
          price,
          extra_per_kg: null,
        });
      }
    }
  }

  // Flatten and attach extra_per_kg to last tier of each zone
  const rates = [];
  for (const { zone } of ZONE_COLS) {
    const zoneRates = ratesByZone[zone];
    if (zoneRates.length > 0 && extraPerKg[zone] !== undefined) {
      zoneRates[zoneRates.length - 1].extra_per_kg = extraPerKg[zone];
    }
    rates.push(...zoneRates);
  }

  return { rates, zoneMappings: buildZoneMappings() };
}

module.exports = { parse };
