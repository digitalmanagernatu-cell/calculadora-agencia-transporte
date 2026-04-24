const XLSX = require('xlsx');

// Palemanía: zones 0-13
// Zones 0-10 accessible via national postal code; zones 11-13 internacional only

// CP prefix → zone (nacional scope)
const CP_ZONE_MAPPINGS = {
  'ZONA 0':  ['30'],
  'ZONA 1':  ['03', '12', '46'],
  'ZONA 2':  ['02', '04', '14', '18', '23'],
  'ZONA 3':  ['11', '13', '16', '19', '21', '28', '29', '41', '42', '45'],
  'ZONA 4':  ['05', '09', '26', '40', '47', '50'],
  'ZONA 5':  ['01', '06', '20', '22', '24', '25', '31', '34', '37', '39', '43', '44', '48', '49'],
  'ZONA 6':  ['33', '08', '10'],
  'ZONA 7':  ['15', '17', '27', '32', '36'],
  'ZONA 9':  ['07'],
  'ZONA 10': ['35', '38'],
};

// Portuguese CP prefixes → ZONA 8 (Portugal Peninsular)
const PT_RANGES = [
  [10, 21], [22, 24], [25, 29], [30, 38], [40, 49], [50, 64], [70, 89],
];

// Internacional destinations for zones 11-13
const INTL_ZONE_DESTINATIONS = {
  'ZONA 11': ['Canarias Islas Menores'],
  'ZONA 12': ['Madeira'],
  'ZONA 13': ['Azores', 'São Miguel'],
};

function buildZoneMappings() {
  const mappings = [];

  // Nacional: Spanish CP prefixes
  for (const [zone, prefixes] of Object.entries(CP_ZONE_MAPPINGS)) {
    for (const prefix of prefixes) {
      mappings.push({ scope: 'nacional', zone, destination: prefix });
    }
  }

  // Nacional: Portuguese CP prefixes → ZONA 8
  for (const [from, to] of PT_RANGES) {
    for (let i = from; i <= to; i++) {
      mappings.push({ scope: 'nacional', zone: 'ZONA 8', destination: 'PT' + String(i).padStart(2, '0') });
    }
  }

  // Internacional: zones 11-13
  for (const [zone, destinations] of Object.entries(INTL_ZONE_DESTINATIONS)) {
    for (const dest of destinations) {
      mappings.push({ scope: 'internacional', zone, destination: dest });
    }
  }

  return mappings;
}

// Detect which column index corresponds to each zone (0-13)
// Header cells may be bare numbers (0, 1, ...) or strings like "Zona 0", "ZONA 1", "Z.0", etc.
function detectZoneColumns(headerRow) {
  const zoneCols = [];
  for (let c = 0; c < headerRow.length; c++) {
    const val = headerRow[c];
    if (val === null || val === undefined || val === '') continue;
    const s = String(val).trim();

    // Try to extract a zone number from the cell
    // Matches: "0", "1", "ZONA 0", "Zona 1", "Z.2", etc.
    let zoneNum = null;
    const bareNum = /^\s*(\d+)\s*$/.exec(s);
    const zoneLabel = /zona\s*\.?\s*(\d+)/i.exec(s);
    if (zoneLabel) {
      zoneNum = parseInt(zoneLabel[1], 10);
    } else if (bareNum) {
      zoneNum = parseInt(bareNum[1], 10);
    }

    if (zoneNum !== null && zoneNum >= 0 && zoneNum <= 13) {
      zoneCols.push({ col: c, zone: 'ZONA ' + zoneNum });
    }
  }
  return zoneCols;
}

// Find header row: first row that has ≥ 5 zone-like column matches
function findHeaderRow(rows) {
  for (let i = 0; i < Math.min(rows.length, 60); i++) {
    const row = rows[i];
    if (!row) continue;
    const cols = detectZoneColumns(row);
    if (cols.length >= 5) return i;
  }
  return -1;
}

function parse(filePath) {
  const wb = XLSX.readFile(filePath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

  const headerIdx = findHeaderRow(rows);
  if (headerIdx === -1) {
    return {
      rates: [],
      zoneMappings: buildZoneMappings(),
      warning: 'No se encontró la cabecera de zonas en el archivo. Se han cargado los mapeos de zonas pero no las tarifas.',
    };
  }

  const zoneCols = detectZoneColumns(rows[headerIdx]);
  const ratesByZone = {};
  const extraPerKg = {};
  zoneCols.forEach(({ zone }) => { ratesByZone[zone] = []; });

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;

    // Weight is typically in the first non-empty column before the zone columns
    const weightCol = zoneCols.length > 0 ? Math.max(0, zoneCols[0].col - 1) : 0;
    const rawWeight = row[weightCol];
    if (rawWeight === null || rawWeight === undefined) continue;

    const weightStr = String(rawWeight).toLowerCase().trim();
    if (!weightStr) continue;

    // Detect extra_per_kg rows: contain 'más', '>', or very large numbers (>1000)
    const isExtraRow =
      weightStr.includes('más') ||
      weightStr.includes('mas') ||
      weightStr.includes('>') ||
      (parseFloat(weightStr) > 1000 && !isNaN(parseFloat(weightStr)));

    if (isExtraRow) {
      for (const { col, zone } of zoneCols) {
        const price = parseFloat(row[col]);
        if (!isNaN(price) && price > 0 && !extraPerKg[zone]) {
          extraPerKg[zone] = price;
        }
      }
      continue;
    }

    const weight = parseFloat(rawWeight);
    if (isNaN(weight) || weight <= 0) continue;

    for (const { col, zone } of zoneCols) {
      const price = parseFloat(row[col]);
      if (!isNaN(price) && price > 0) {
        // Zones 0-10 are nacional; 11-13 are internacional
        const zoneNum = parseInt(zone.replace('ZONA ', ''), 10);
        const scope = zoneNum <= 10 ? 'nacional' : 'internacional';
        ratesByZone[zone].push({
          scope,
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
    if (zoneRates.length > 0 && extraPerKg[zone]) {
      zoneRates[zoneRates.length - 1].extra_per_kg = extraPerKg[zone];
    }
    rates.push(...zoneRates);
  }

  return {
    rates,
    zoneMappings: buildZoneMappings(),
  };
}

module.exports = { parse };
