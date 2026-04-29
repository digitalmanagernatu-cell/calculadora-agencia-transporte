const XLSX = require('xlsx');

// Dynamic parser: auto-detects header row and zone columns instead of
// relying on hardcoded row indices that break when the file layout changes.

// Canonical zone names keyed by normalized header text patterns
const ZONE_NAME_MAP = [
  { pattern: /^zona\s*p(rovincial)?$/i,  zone: 'Zona P' },
  { pattern: /^zona?\s*1$/i,             zone: 'Zona 1' },
  { pattern: /^zona?\s*2$/i,             zone: 'Zona 2' },
  { pattern: /^zona?\s*3$/i,             zone: 'Zona 3' },
  { pattern: /^zona?\s*4$/i,             zone: 'Zona 4' },
  { pattern: /^zona?\s*5$/i,             zone: 'Zona 5' },
  { pattern: /^zona?\s*6$/i,             zone: 'Zona 6' },
  { pattern: /^b\s*2$/i,                 zone: 'B2'     },
  { pattern: /^pt\s*3$/i,                zone: 'PT3'    },
  { pattern: /^pt\s*4$/i,                zone: 'PT4'    },
  { pattern: /^r\s*1$/i,                 zone: 'R1'     },
  { pattern: /^a[eé]r[eo]/i,             zone: 'AEREO'  },
  { pattern: /^mar/i,                    zone: 'MAR'    },
];

function normalizeHeader(val) {
  return String(val ?? '')
    .trim()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

function matchZoneName(val) {
  const s = normalizeHeader(val);
  if (!s) return null;
  for (const { pattern, zone } of ZONE_NAME_MAP) {
    if (pattern.test(s)) return zone;
  }
  return null;
}

// Find the header row: first row with >= 3 recognisable zone-name cells
function findHeaderRow(rows) {
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    let hits = 0;
    for (const cell of row) {
      if (matchZoneName(cell)) hits++;
    }
    if (hits >= 3) return i;
  }
  return -1;
}

// Hardcoded zone → CP 2-digit prefixes
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

  const pt3Prefixes = [];
  for (let i = 10; i <= 21; i++) pt3Prefixes.push('PT' + String(i).padStart(2, '0'));
  for (let i = 25; i <= 29; i++) pt3Prefixes.push('PT' + String(i).padStart(2, '0'));
  for (let i = 40; i <= 49; i++) pt3Prefixes.push('PT' + String(i).padStart(2, '0'));
  mappings['PT3'] = pt3Prefixes;

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
  const sheetName =
    wb.SheetNames.find(n => /NATUAROMA|2026|REDUR|NACIONAL/i.test(n)) ||
    wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

  const headerIdx = findHeaderRow(rows);
  if (headerIdx === -1) {
    return {
      rates: [],
      zoneMappings: buildZoneMappings(),
      warning: 'No se encontró la cabecera de zonas en el archivo Redur nacional.',
    };
  }

  // Map column index → canonical zone name
  const headerRow = rows[headerIdx];
  const zoneCols = [];
  for (let c = 0; c < headerRow.length; c++) {
    const zone = matchZoneName(headerRow[c]);
    if (zone) zoneCols.push({ col: c, zone });
  }

  // Weight column: the last non-zone, non-empty column to the left of the first zone col
  const firstZoneCol = zoneCols.length > 0 ? zoneCols[0].col : 1;
  let weightCol = firstZoneCol - 1;
  // Walk left to find a column with numeric-looking data in data rows
  for (let c = firstZoneCol - 1; c >= 0; c--) {
    const sample = rows[headerIdx + 1]?.[c];
    if (sample !== null && sample !== undefined && !isNaN(parseFloat(sample))) {
      weightCol = c;
      break;
    }
  }

  const extraPerKg = {};
  const ratesByZone = {};
  zoneCols.forEach(({ zone }) => { ratesByZone[zone] = []; });

  let passedExtraRow = false;

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];

    // Blank row: if we already found the end-of-table marker, stop here
    const isBlankRow = !row || row.every(c => c === null || c === undefined || String(c ?? '').trim() === '');
    if (isBlankRow) {
      if (passedExtraRow) break;
      continue;
    }

    // Another zone-header row means a new section has started — stop
    let zoneHits = 0;
    for (const cell of row) {
      if (matchZoneName(cell)) zoneHits++;
    }
    if (zoneHits >= 3) break;

    const rawWeight = row[weightCol];
    if (rawWeight === null || rawWeight === undefined) continue;

    const weightStr = String(rawWeight).trim().toLowerCase();
    if (!weightStr) continue;

    const isExtraRow =
      weightStr.includes('>') ||
      weightStr.includes('más') ||
      weightStr.includes('mas de');

    if (isExtraRow) {
      for (const { col, zone } of zoneCols) {
        const price = parseFloat(row[col]);
        if (!isNaN(price) && price > 0) extraPerKg[zone] = price;
      }
      passedExtraRow = true;
      continue;
    }

    const weight = parseFloat(String(rawWeight).replace(',', '.'));
    if (isNaN(weight) || weight <= 0) continue;

    for (const { col, zone } of zoneCols) {
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

  const rates = [];
  for (const { zone } of zoneCols) {
    const zoneRates = ratesByZone[zone];
    if (zoneRates.length > 0 && extraPerKg[zone] !== undefined) {
      zoneRates[zoneRates.length - 1].extra_per_kg = extraPerKg[zone];
    }
    rates.push(...zoneRates);
  }

  if (rates.length === 0) {
    return {
      rates: [],
      zoneMappings: buildZoneMappings(),
      warning: 'No se encontraron tarifas en el archivo. Verifica que las columnas de zona tienen los encabezados correctos.',
    };
  }

  return { rates, zoneMappings: buildZoneMappings() };
}

module.exports = { parse };
