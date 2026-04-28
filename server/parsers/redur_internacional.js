const XLSX = require('xlsx');

// Sheet: TARIFA 2026
// Column A (idx 0) = weight in kg (KILOS)
// Zone price columns B-T (idx 1-19) — 19 country groups

// Map column index (0-based) to zone/country group name
const COL_TO_ZONE = {
  1:  'Francia y Mónaco',
  2:  'Alemania',
  3:  'Italia Zona 1',
  4:  'Italia Zona 2',
  5:  'Bélgica, Holanda y Luxemburgo',
  6:  'Gran Bretaña',
  7:  'Northern Ireland & Republic of Ireland',
  8:  'Austria',
  9:  'Suiza y Liechtenstein',
  10: 'Polonia',
  11: 'Hungría y Eslovaquia',
  12: 'República Checa',
  13: 'Dinamarca',
  14: 'Croacia',
  15: 'Bosnia Herzegovina y Serbia',
  16: 'Montenegro',
  17: 'Latvia y Lituania',
  18: 'Finlandia y Estonia',
  19: 'Suecia',
};

// Country name(s) → zone (for zone_mappings destination matching)
const COUNTRY_ZONE_MAPPINGS = [
  { zone: 'Francia y Mónaco',                         countries: ['Francia', 'Mónaco', 'Monaco'] },
  { zone: 'Alemania',                                  countries: ['Alemania'] },
  { zone: 'Italia Zona 1',                             countries: ['Italia Zona 1'] },
  { zone: 'Italia Zona 2',                             countries: ['Italia Zona 2'] },
  { zone: 'Bélgica, Holanda y Luxemburgo',             countries: ['Bélgica', 'Belgica', 'Holanda', 'Países Bajos', 'Luxemburgo'] },
  { zone: 'Gran Bretaña',                              countries: ['Gran Bretaña', 'Reino Unido', 'Gran Bretana', 'Inglaterra'] },
  { zone: 'Northern Ireland & Republic of Ireland',    countries: ['Irlanda', 'Irlanda del Norte'] },
  { zone: 'Austria',                                   countries: ['Austria'] },
  { zone: 'Suiza y Liechtenstein',                     countries: ['Suiza', 'Liechtenstein'] },
  { zone: 'Polonia',                                   countries: ['Polonia'] },
  { zone: 'Hungría y Eslovaquia',                      countries: ['Hungría', 'Hungria', 'Eslovaquia'] },
  { zone: 'República Checa',                           countries: ['República Checa', 'Republica Checa', 'Chequia'] },
  { zone: 'Dinamarca',                                 countries: ['Dinamarca'] },
  { zone: 'Croacia',                                   countries: ['Croacia'] },
  { zone: 'Bosnia Herzegovina y Serbia',               countries: ['Bosnia', 'Herzegovina', 'Bosnia Herzegovina', 'Serbia'] },
  { zone: 'Montenegro',                                countries: ['Montenegro'] },
  { zone: 'Latvia y Lituania',                         countries: ['Latvia', 'Letonia', 'Lituania'] },
  { zone: 'Finlandia y Estonia',                       countries: ['Finlandia', 'Estonia'] },
  { zone: 'Suecia',                                    countries: ['Suecia'] },
];

function buildZoneMappings() {
  const result = [];
  for (const { zone, countries } of COUNTRY_ZONE_MAPPINGS) {
    for (const country of countries) {
      result.push({ scope: 'internacional', zone, destination: country });
    }
  }
  return result;
}

function parse(filePath) {
  const wb = XLSX.readFile(filePath);
  const sheetName = wb.SheetNames.find(n => /TARIFA|2026/i.test(n)) || wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

  // Locate header row: first row (within first 10) where col A matches "kilo" or "kg"
  let headerIdx = 2; // fallback: original assumption of Excel row 3
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const cell = String(rows[i]?.[0] ?? '').trim();
    if (/^kilo|^kg$/i.test(cell)) {
      headerIdx = i;
      break;
    }
  }

  const colIndices = Object.keys(COL_TO_ZONE).map(Number);
  const extraPerKg = {};
  const ratesByZone = {};
  colIndices.forEach(c => { ratesByZone[COL_TO_ZONE[c]] = []; });

  // Read data rows from headerIdx+1 to end of sheet (up to 70 rows)
  for (let i = headerIdx + 1; i < Math.min(rows.length, headerIdx + 70); i++) {
    const row = rows[i];
    if (!row) continue;

    const rawWeight = row[0]; // col A = KILOS
    if (rawWeight === null || rawWeight === undefined) continue;

    const weightStr = String(rawWeight).trim().toLowerCase();

    // Detect "extra per kg" row (e.g. "> 500", "Más de 500")
    const isExtraRow =
      weightStr.includes('más') ||
      weightStr.includes('mas de') ||
      weightStr.includes('>');

    if (isExtraRow) {
      for (const c of colIndices) {
        const price = parseFloat(row[c]);
        if (!isNaN(price) && price > 0) extraPerKg[COL_TO_ZONE[c]] = price;
      }
      continue;
    }

    const weight = parseFloat(rawWeight);
    if (isNaN(weight) || weight <= 0) continue;

    for (const c of colIndices) {
      const price = parseFloat(row[c]);
      if (!isNaN(price) && price > 0) {
        ratesByZone[COL_TO_ZONE[c]].push({
          scope: 'internacional',
          zone: COL_TO_ZONE[c],
          weight_max_kg: weight,
          price,
          extra_per_kg: null,
        });
      }
    }
  }

  // Flatten and attach extra_per_kg to last tier of each zone
  const rates = [];
  for (const c of colIndices) {
    const zone = COL_TO_ZONE[c];
    const zoneRates = ratesByZone[zone];
    if (zoneRates.length > 0 && extraPerKg[zone] !== undefined) {
      zoneRates[zoneRates.length - 1].extra_per_kg = extraPerKg[zone];
    }
    rates.push(...zoneRates);
  }

  return { rates, zoneMappings: buildZoneMappings() };
}

module.exports = { parse };
