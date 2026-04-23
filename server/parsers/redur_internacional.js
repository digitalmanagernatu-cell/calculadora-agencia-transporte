const XLSX = require('xlsx');

// Sheet: TARIFA 2026
// Header row: Excel row 3 = idx 2
// Data rows: Excel rows 3-48 = idx 2-47
// Column B (idx 1) = weight; zone columns C-U (idx 2-20)

const HEADER_IDX = 2;   // Excel row 3
const DATA_END_IDX = 47; // Excel row 48
const WEIGHT_COL = 1;    // column B

// Map column index (0-based) to zone/country group name
// Columns 2-20 correspond to the 19 country groups
const COL_TO_ZONE = {
  2:  'Francia y Mónaco',
  3:  'Alemania',
  4:  'Italia Zona 1',
  5:  'Italia Zona 2',
  6:  'Bélgica, Holanda y Luxemburgo',
  7:  'Gran Bretaña',
  8:  'Northern Ireland & Republic of Ireland',
  9:  'Austria',
  10: 'Suiza y Liechtenstein',
  11: 'Polonia',
  12: 'Hungría y Eslovaquia',
  13: 'República Checa',
  14: 'Dinamarca',
  15: 'Croacia',
  16: 'Bosnia Herzegovina y Serbia',
  17: 'Montenegro',
  18: 'Latvia y Lituania',
  19: 'Finlandia y Estonia',
  20: 'Suecia',
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
  const sheetName = wb.SheetNames.find(n => n.includes('TARIFA') || n.includes('2026')) || wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

  const colIndices = Object.keys(COL_TO_ZONE).map(Number);
  const extraPerKg = {};
  const ratesByZone = {};
  colIndices.forEach(c => { ratesByZone[COL_TO_ZONE[c]] = []; });

  for (let i = HEADER_IDX + 1; i <= DATA_END_IDX && i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;

    const rawWeight = row[WEIGHT_COL];
    if (rawWeight === null || rawWeight === undefined) continue;

    const weightStr = String(rawWeight).trim().toLowerCase();

    // Detect extra_per_kg row
    const isExtraRow =
      weightStr.includes('más') ||
      weightStr.includes('mas de') ||
      weightStr.includes('>');

    if (isExtraRow) {
      for (const c of colIndices) {
        const zone = COL_TO_ZONE[c];
        const price = parseFloat(row[c]);
        if (!isNaN(price) && price > 0) {
          extraPerKg[zone] = price;
        }
      }
      continue;
    }

    const weight = parseFloat(rawWeight);
    if (isNaN(weight) || weight <= 0) continue;

    for (const c of colIndices) {
      const zone = COL_TO_ZONE[c];
      const price = parseFloat(row[c]);
      if (!isNaN(price) && price > 0) {
        ratesByZone[zone].push({
          scope: 'internacional',
          zone,
          weight_max_kg: weight,
          price,
          extra_per_kg: null,
        });
      }
    }
  }

  // Flatten and attach extra_per_kg
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
