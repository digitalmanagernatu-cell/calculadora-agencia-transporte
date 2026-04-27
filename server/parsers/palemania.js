const XLSX = require('xlsx');

// Maps (1-based Excel column index) → [palet_type, max_kg_per_palet, num_pales]
const PALEMANIA_COLUMNS = [
  [2,  'MQ',               75,   1],
  [3,  'Quarter',          150,  1],
  [4,  'Super Euro Light', 200,  1],
  [5,  'Super Euro Light', 200,  2],
  [6,  'Super Euro Light', 200,  3],
  [7,  'Half',             250,  1],
  [8,  'Extra Light',      300,  1],
  [9,  'Extra Light',      300,  2],
  [10, 'Extra Light',      300,  3],
  [11, 'Euro',             500,  1],
  [12, 'Euro',             500,  2],
  [13, 'Euro',             500,  3],
  [14, 'Euro',             500,  4],
  [15, 'Euro',             500,  5],
  [16, 'Full',             1000, 1],
  [17, 'Full',             1000, 2],
  [18, 'Full',             1000, 3],
  [19, 'Full',             1000, 4],
  [20, 'Full',             1000, 5],
];

function normalizeZone(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') {
    return Number.isInteger(raw) ? String(raw) : raw.toFixed(1);
  }
  return String(raw).trim();
}

function parse(filePath) {
  const wb = XLSX.readFile(filePath);
  const sheetName = wb.SheetNames.find(n => /2026/i.test(n)) || wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

  const rates = [];
  const zoneMappings = [];

  // Filas 2–16 (Excel 1-based) → 0-based indices 1–15 → price rows
  for (let i = 1; i <= 15; i++) {
    const row = rows[i];
    if (!row) continue;
    const zone = normalizeZone(row[0]);
    if (zone === null) continue;

    for (const [colIdx, paletType, maxKg, numPales] of PALEMANIA_COLUMNS) {
      const val = row[colIdx - 1]; // 1-based → 0-based
      if (val === null || val === undefined) continue;
      const price = parseFloat(val);
      if (isNaN(price) || price <= 0) continue;
      rates.push({ zone, palet_type: paletType, max_kg_per_palet: maxKg, num_pales: numPales, price_per_palet: price });
    }
  }

  // Filas 19–39 (Excel 1-based) → 0-based indices 18–38 → zone→destination mappings
  for (let i = 18; i <= 38; i++) {
    const row = rows[i];
    if (!row) continue;
    const zone = normalizeZone(row[6]); // col G (0-based index 6)
    const dest = row[7];                 // col H (0-based index 7)
    if (zone === null || !dest) continue;
    zoneMappings.push({ zone, destination: String(dest).trim() });
  }

  return { rates, zoneMappings };
}

module.exports = { parse };
