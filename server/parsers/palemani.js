const XLSX = require('xlsx');

// Palemanía: zones in column A (rows), service types in columns B+
// Zones 0-10 → nacional scope (resolved via CP prefix)
// Zones 11-13 → internacional only

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

const PT_RANGES = [
  [10, 21], [22, 24], [25, 29], [30, 38], [40, 49], [50, 64], [70, 89],
];

const INTL_ZONE_DESTINATIONS = {
  'ZONA 11': ['Canarias Islas Menores'],
  'ZONA 12': ['Madeira'],
  'ZONA 13': ['Azores', 'São Miguel'],
};

function buildZoneMappings() {
  const mappings = [];

  for (const [zone, prefixes] of Object.entries(CP_ZONE_MAPPINGS)) {
    for (const prefix of prefixes) {
      mappings.push({ scope: 'nacional', zone, destination: prefix });
    }
  }

  for (const [from, to] of PT_RANGES) {
    for (let i = from; i <= to; i++) {
      mappings.push({ scope: 'nacional', zone: 'ZONA 8', destination: 'PT' + String(i).padStart(2, '0') });
    }
  }

  for (const [zone, destinations] of Object.entries(INTL_ZONE_DESTINATIONS)) {
    for (const dest of destinations) {
      mappings.push({ scope: 'internacional', zone, destination: dest });
    }
  }

  return mappings;
}


// Find the header row: first row where column A is "Zona" or similar label
function findHeaderRow(rows) {
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const row = rows[i];
    if (!row) continue;
    const first = String(row[0] ?? '').trim().toLowerCase();
    if (first.startsWith('zon')) return i;
  }
  return -1;
}

function parse(filePath) {
  const wb = XLSX.readFile(filePath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

  const headerIdx = findHeaderRow(rows);
  const dataStart = headerIdx >= 0 ? headerIdx + 1 : 0;

  // Build price columns from header row (all non-empty cols after A)
  const headerRow = headerIdx >= 0 ? rows[headerIdx] : null;
  const priceCols = [];

  if (headerRow) {
    // Collect unique column names (some may repeat, dedupe by sequential index)
    const nameCounts = {};
    for (let c = 1; c < headerRow.length; c++) {
      const raw = headerRow[c];
      if (raw === null || raw === undefined || String(raw).trim() === '') continue;
      const name = String(raw).trim();
      nameCounts[name] = (nameCounts[name] || 0) + 1;
      const uniqueName = nameCounts[name] > 1 ? `${name} ${nameCounts[name]}` : name;
      priceCols.push({ col: c, name: uniqueName });
    }
  }

  // Assign weight_max_kg as sequential integers (1, 2, 3...) by column order.
  // Palemanía prices by service type, not weight; we use ordinal position so
  // the calculator can sort tiers and select the appropriate one.
  priceCols.forEach((pc, i) => { pc.weight_max_kg = i + 1; });

  const rates = [];

  for (let i = dataStart; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;

    const rawZone = row[0];
    if (rawZone === null || rawZone === undefined || String(rawZone).trim() === '') continue;

    const zoneStr = String(rawZone).trim();
    const zoneNum = parseFloat(zoneStr);
    if (isNaN(zoneNum) || zoneNum < 0 || zoneNum > 13) continue;

    // Normalise zone name: "7.1" stays as-is, integers drop decimal
    const zoneName = 'ZONA ' + (Number.isInteger(zoneNum) ? String(Math.round(zoneNum)) : zoneStr);
    const scope = Math.floor(zoneNum) <= 10 ? 'nacional' : 'internacional';

    for (const { col, weight_max_kg } of priceCols) {
      const raw = row[col];
      if (raw === null || raw === undefined) continue;
      const price = parseFloat(String(raw).replace(',', '.'));
      if (isNaN(price) || price <= 0) continue;

      rates.push({ scope, zone: zoneName, weight_max_kg, price, extra_per_kg: null });
    }
  }

  if (rates.length === 0) {
    return {
      rates: [],
      zoneMappings: buildZoneMappings(),
      warning: 'No se encontraron tarifas en el archivo. Verifica que la columna A contiene las zonas (0-13) y las columnas siguientes los precios.',
    };
  }

  return { rates, zoneMappings: buildZoneMappings() };
}

module.exports = { parse };
