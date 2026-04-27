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

// Parse a price value that may be a JS number or a European-format text string ("17,85", "1.234,56")
function parsePrice(val) {
  if (val === null || val === undefined) return NaN;
  if (typeof val === 'number') return val;
  // European format: remove thousands dots, replace decimal comma with dot
  const s = String(val).trim().replace(/\./g, '').replace(',', '.');
  return parseFloat(s);
}

// Normalize zone value to canonical string ("0","1",...,"7","7.1",...,"13")
function normalizeZone(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') {
    return Number.isInteger(raw) ? String(raw) : raw.toFixed(1);
  }
  // Handle European decimal: "7,1" → "7.1"
  const s = String(raw).trim().replace(',', '.');
  return s === '' ? null : s;
}

function parse(filePath) {
  const wb = XLSX.readFile(filePath);

  // Prefer a sheet whose name contains "2026" or "tarif"; else first sheet
  const sheetName =
    wb.SheetNames.find(n => /2026/i.test(n)) ||
    wb.SheetNames.find(n => /tarif/i.test(n)) ||
    wb.SheetNames[0];

  console.log(`[palemania] Hoja: "${sheetName}" | Todas las hojas: [${wb.SheetNames.join(', ')}]`);

  const ws = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

  console.log(`[palemania] Total filas leídas de la hoja: ${rows.length}`);
  if (rows[0]) {
    console.log(`[palemania] Fila 1 (cabecera esperada): ${JSON.stringify(rows[0].slice(0, 5))}`);
  }

  // --- Locate header row ---
  // The header is the first row (within the first 10) where col A contains "zona" (case-insensitive)
  let headerIdx = -1;
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const cell = rows[i]?.[0];
    if (cell !== null && cell !== undefined && /^zona/i.test(String(cell).trim())) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx === -1) {
    console.warn('[palemania] No se encontró cabecera "Zona" en col A (primeras 10 filas) — usando fila 0');
    headerIdx = 0;
  }
  console.log(`[palemania] Cabecera en fila Excel ${headerIdx + 1} (índice 0-based: ${headerIdx})`);

  const rates = [];
  const zoneMappings = [];

  // --- Price rows: headerIdx+1 … headerIdx+15 (one row per zone, up to 15 zones) ---
  const priceStart = headerIdx + 1;
  const priceEnd   = headerIdx + 15; // inclusive

  for (let i = priceStart; i <= priceEnd && i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;

    const zone = normalizeZone(row[0]);
    if (zone === null) {
      console.log(`[palemania] Fila Excel ${i + 1}: zona vacía, omitida`);
      continue;
    }

    let rowCount = 0;
    for (const [colIdx, paletType, maxKg, numPales] of PALEMANIA_COLUMNS) {
      const rawVal = row[colIdx - 1]; // 1-based colIdx → 0-based array index
      const price = parsePrice(rawVal);
      if (isNaN(price) || price <= 0) continue;
      rates.push({ zone, palet_type: paletType, max_kg_per_palet: maxKg, num_pales: numPales, price_per_palet: price });
      rowCount++;
    }
    console.log(`[palemania] Fila Excel ${i + 1} → zona "${zone}": ${rowCount} precios leídos`);
  }

  // --- Zone→destination mappings ---
  // The zone mapping table sits BELOW the price rows.
  // From the Excel screenshot the Zona column is at col F (0-based index 5)
  // and the Destino column is at col G (0-based index 6).
  // We also try col G/H (indices 6/7) as a fallback for files that match the original spec.
  // We scan from priceEnd+1 to end of sheet, accepting any row where the zone cell
  // holds a valid zone number (0-13 or 7.1) and the destination cell is non-empty text.
  const ZONE_RE = /^\d+([.,]\d+)?$/;

  const mappingSectionStart = priceEnd + 1;
  for (let i = mappingSectionStart; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;

    // Try col F (idx 5) / col G (idx 6) first (matches the actual Excel layout seen in screenshot)
    // then fall back to col G (idx 6) / col H (idx 7) as per original spec
    let zoneRaw = null;
    let dest = null;

    if (row[5] !== null && row[5] !== undefined && row[6] !== null && row[6] !== undefined) {
      zoneRaw = row[5];
      dest    = row[6];
    } else if (row[6] !== null && row[6] !== undefined && row[7] !== null && row[7] !== undefined) {
      zoneRaw = row[6];
      dest    = row[7];
    }

    if (zoneRaw === null || !dest) continue;

    const zone = normalizeZone(zoneRaw);
    if (zone === null) continue;
    if (!ZONE_RE.test(zone.replace(',', '.'))) continue; // must look like a zone number

    zoneMappings.push({ zone: zone.replace(',', '.'), destination: String(dest).trim() });
  }

  console.log(`[palemania] Resultado final: ${rates.length} tarifas, ${zoneMappings.length} mapeos de zona`);

  if (rates.length === 0) {
    const sample = rows
      .slice(0, 5)
      .map((r, i) => `  fila ${i + 1}: ${JSON.stringify((r || []).slice(0, 6))}`)
      .join('\n');
    const msg = `No se encontraron tarifas. Cabecera detectada en fila ${headerIdx + 1}. ` +
      `Primeras filas del Excel:\n${sample}`;
    console.warn(`[palemania] ⚠️  ${msg}`);
    return { rates: [], zoneMappings, warning: msg };
  }

  return { rates, zoneMappings };
}

module.exports = { parse };
