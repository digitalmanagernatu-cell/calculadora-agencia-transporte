const XLSX = require('xlsx');

const SHEETS_CONFIG = [
  // Servicios nacionales peninsulares
  { name: 'Paq 24',           service: 'Paq 24',           scope: 'nacional' },
  { name: 'Paq Empresa 14',   service: 'Paq Empresa 14',   scope: 'nacional' },
  { name: 'Paq Ecommerce',    service: 'Paq Ecommerce',    scope: 'nacional' },
  { name: 'Entrega Plus',     service: 'Entrega Plus',     scope: 'nacional' },
  // Servicios nacionales de islas (zonas propias: Baleares, Canarias, Ceuta/Melilla)
  { name: 'Islas Express',       service: 'Islas Express',       scope: 'nacional' },
  { name: 'Islas Documentación', service: 'Islas Documentación', scope: 'nacional' },
  { name: 'Islas Menores',       service: 'Islas Menores',       scope: 'nacional' },
  // Servicios internacionales
  { name: 'Internacional Express',  service: 'Internacional Express',  scope: 'internacional' },
  { name: 'Internacional Estándar', service: 'Internacional Estándar', scope: 'internacional' },
];

function normalizeText(val) {
  return String(val ?? '').trim().normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

// Spanish numeric format: '.' = thousands separator, ',' = decimal separator
function parseSpanishNumber(val) {
  if (typeof val === 'number') return val;
  return parseFloat(String(val).trim().replace(/\./g, '').replace(',', '.'));
}

// Find header row between Excel rows 27–35 (0-indexed: 26–34).
// Identified by 'Provincial', 'Europa 1', or 'Zona 1' in column B (index 1).
function findHeaderRow(rows) {
  for (let i = 26; i <= Math.min(34, rows.length - 1); i++) {
    const row = rows[i];
    if (!row) continue;
    const col1 = normalizeText(row[1]);
    if (/provincial|europa\s*1|zona\s*1/.test(col1)) return i;
  }
  return -1;
}

function parseCorreosSheet(ws) {
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

  const headerIdx = findHeaderRow(rows);
  if (headerIdx === -1) {
    return { rates: [], warning: 'No se encontró la cabecera de zonas entre filas 27-35' };
  }

  // Zone columns: all non-empty cells in header row from column B (index 1) onward
  const headerRow = rows[headerIdx];
  const zoneCols = [];
  for (let c = 1; c < headerRow.length; c++) {
    const val = String(headerRow[c] ?? '').trim();
    if (val) zoneCols.push({ col: c, zone: val });
  }
  if (zoneCols.length === 0) {
    return { rates: [], warning: 'No se encontraron columnas de zona en la cabecera' };
  }

  const ratesByZone = {};
  const extraPerKg = {};
  for (const { zone } of zoneCols) ratesByZone[zone] = [];

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;

    const colARaw = row[0];
    if (colARaw === null || colARaw === undefined) continue;

    const colANum = typeof colARaw === 'number' ? colARaw : parseSpanishNumber(String(colARaw));
    const colAStr = String(colARaw).trim();

    // Sentinel row: numeric 9999 or text '9.999' / '9,999'
    const isExtraRow =
      colANum === 9999 ||
      colAStr === '9.999' ||
      colAStr === '9,999' ||
      /^9[.,]999/.test(colAStr);

    if (isExtraRow) {
      for (const { col, zone } of zoneCols) {
        const price = parseSpanishNumber(row[col]);
        if (!isNaN(price) && price > 0) extraPerKg[zone] = price;
      }
      break;
    }

    // Parse weight from 'Hasta X KG' or bare number
    let weight = null;
    const hastaMatch = colAStr.match(/hasta\s*([\d.,]+)\s*kg/i);
    if (hastaMatch) {
      weight = parseSpanishNumber(hastaMatch[1]);
    } else if (!isNaN(colANum) && colANum > 0 && colANum < 9000) {
      weight = colANum;
    }
    if (weight === null || isNaN(weight) || weight <= 0) continue;

    for (const { col, zone } of zoneCols) {
      const price = parseSpanishNumber(row[col]);
      if (!isNaN(price) && price > 0) {
        ratesByZone[zone].push({ zone, weight_max_kg: weight, price, extra_per_kg: null });
      }
    }
  }

  // Attach extra_per_kg to the last tier of each zone
  const rates = [];
  for (const { zone } of zoneCols) {
    const zoneRates = ratesByZone[zone];
    if (zoneRates.length === 0) continue;
    zoneRates.sort((a, b) => a.weight_max_kg - b.weight_max_kg);
    if (extraPerKg[zone] !== undefined) {
      zoneRates[zoneRates.length - 1].extra_per_kg = extraPerKg[zone];
    }
    rates.push(...zoneRates);
  }

  return { rates };
}

function parse(filePath) {
  const wb = XLSX.readFile(filePath);
  const allRates = [];
  const warnings = [];

  for (const { name: sheetName, service, scope } of SHEETS_CONFIG) {
    const actualName = wb.SheetNames.find(
      n => normalizeText(n) === normalizeText(sheetName)
    );
    if (!actualName) {
      warnings.push(`Hoja "${sheetName}" no encontrada`);
      continue;
    }

    const { rates, warning } = parseCorreosSheet(wb.Sheets[actualName]);
    if (warning) warnings.push(`[${sheetName}] ${warning}`);
    for (const r of rates) {
      allRates.push({ ...r, scope, service_name: service });
    }
  }

  return {
    rates: allRates,
    zoneMappings: [], // Zone resolution handled in calculator via cpToZoneCorreosExpress
    warning: warnings.length > 0 ? warnings.join('; ') : undefined,
  };
}

module.exports = { parse };
