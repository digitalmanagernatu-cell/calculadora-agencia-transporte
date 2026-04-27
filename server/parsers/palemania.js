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
  const s = String(raw).trim();
  return s === '' ? null : s;
}

function isZoneHeader(val) {
  if (val === null || val === undefined) return false;
  return /^zona/i.test(String(val).trim());
}

function parse(filePath) {
  const wb = XLSX.readFile(filePath);

  // Prefer the sheet whose name contains "2026" or "tarif", else use first sheet
  const sheetName =
    wb.SheetNames.find(n => /2026/i.test(n)) ||
    wb.SheetNames.find(n => /tarif/i.test(n)) ||
    wb.SheetNames[0];

  console.log(`[palemania] Hoja seleccionada: "${sheetName}" (hojas disponibles: ${wb.SheetNames.join(', ')})`);

  const ws = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

  console.log(`[palemania] Total filas leídas: ${rows.length}`);

  // --- Locate header row ---
  // The header is the first row where col A is "Zona" (case-insensitive)
  // or, as fallback, the first row where col A is null/empty and col B is non-null text.
  let headerIdx = -1;
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const row = rows[i];
    if (!row) continue;
    if (isZoneHeader(row[0])) { headerIdx = i; break; }
  }

  // Fallback: if no "Zona" header found in col A, treat row 0 as header
  if (headerIdx === -1) {
    console.warn('[palemania] No se encontró cabecera "Zona" en col A — usando fila 0 como cabecera');
    headerIdx = 0;
  }

  console.log(`[palemania] Cabecera en fila Excel ${headerIdx + 1} (índice ${headerIdx})`);

  const rates = [];
  const zoneMappings = [];

  // --- Price rows: headerIdx+1 through headerIdx+15 (up to 15 zones) ---
  const priceStart = headerIdx + 1;
  const priceEnd   = headerIdx + 15;

  for (let i = priceStart; i <= priceEnd && i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    const zone = normalizeZone(row[0]);
    if (zone === null) continue;

    let rowHasPrice = false;
    for (const [colIdx, paletType, maxKg, numPales] of PALEMANIA_COLUMNS) {
      const val = row[colIdx - 1]; // 1-based col → 0-based array index
      if (val === null || val === undefined) continue;
      const price = parseFloat(val);
      if (isNaN(price) || price <= 0) continue;
      rates.push({ zone, palet_type: paletType, max_kg_per_palet: maxKg, num_pales: numPales, price_per_palet: price });
      rowHasPrice = true;
    }
    if (rowHasPrice) {
      console.log(`[palemania] Zona ${zone}: fila Excel ${i + 1} — precios cargados`);
    }
  }

  // --- Zone→destination mappings ---
  // Scan the whole sheet for rows where col G has a valid zone number and col H has text.
  // This is more robust than hardcoding rows 19–39.
  const mappingSectionStart = priceEnd + 1;
  for (let i = mappingSectionStart; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    const zoneRaw = row[6]; // col G (0-based index 6)
    const dest    = row[7]; // col H (0-based index 7)
    if (zoneRaw === null || zoneRaw === undefined || !dest) continue;
    const zone = normalizeZone(zoneRaw);
    if (zone === null) continue;
    // Only accept if zone looks like a number (0–13 or 7.1)
    if (!/^\d+(\.\d+)?$/.test(zone)) continue;
    zoneMappings.push({ zone, destination: String(dest).trim() });
  }

  console.log(`[palemania] Resultado: ${rates.length} tarifas, ${zoneMappings.length} mapeos de zona`);

  if (rates.length === 0) {
    const sample = rows.slice(0, 5).map((r, i) => `  fila ${i + 1}: ${JSON.stringify((r || []).slice(0, 5))}`).join('\n');
    console.warn(`[palemania] ⚠️  0 tarifas leídas. Primeras 5 filas del Excel:\n${sample}`);
    return {
      rates: [],
      zoneMappings,
      warning: `No se encontraron tarifas en el archivo. Comprueba que la hoja tiene la estructura esperada (cabecera en fila 1, zonas 0–13 en filas 2–16).`,
    };
  }

  return { rates, zoneMappings };
}

module.exports = { parse };
