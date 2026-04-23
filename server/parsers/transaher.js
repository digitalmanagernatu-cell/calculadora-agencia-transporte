const XLSX = require('xlsx');

// Transaher: sheet "2025"
// Nacional zones 1-8: header idx 29 (Excel row 30), data idx 29-69 (Excel rows 30-70)
// Internacional/special zones 9-16: header idx 75 (Excel row 76), data idx 75-103 (Excel rows 76-104)

const NACIONAL_HEADER_IDX = 29;
const NACIONAL_DATA_END_IDX = 69;

const INTL_HEADER_IDX = 75;
const INTL_DATA_END_IDX = 103;

// Hardcoded from spec: province name → zone (nacional zones 1-4)
const ZONE_PROVINCE_MAPPINGS = {
  'ZONA 1': ['ALICANTE', 'MURCIA'],
  'ZONA 2': ['ALBACETE', 'ALMERIA', 'BARCELONA', 'CASTELLON', 'CIUDAD REAL', 'GRANADA', 'GUADALAJARA', 'JAEN', 'MADRID', 'TOLEDO', 'VALENCIA', 'ZARAGOZA'],
  'ZONA 3': ['AVILA', 'BADAJOZ', 'BILBAO', 'BURGOS', 'CACERES', 'CADIZ', 'CORDOBA', 'CUENCA', 'GERONA', 'HUELVA', 'HUESCA', 'LERIDA', 'MÁLAGA', 'PALENCIA', 'PAMPLONA', 'SEGOVIA', 'SEVILLA', 'SORIA', 'TARRAGONA', 'TERUEL', 'VALLADOLID', 'ZAMORA'],
  'ZONA 4': ['LA CORUÑA', 'LEON', 'LOGROÑO', 'LUGO', 'ORENSE', 'OVIEDO', 'PONTEVEDRA', 'S.SEBASTIAN', 'SALAMANCA', 'SANTANDER', 'VITORIA'],
};

// Hardcoded from spec: international/special zones 9-16
const ZONE_INTL_MAPPINGS = {
  'ZONA 9':  ['Portugal Peninsular'],
  'ZONA 10': ['Palma de Mallorca'],
  'ZONA 11': ['Ibiza', 'Mahón', 'Menorca'],
  'ZONA 12': ['Formentera'],
  'ZONA 13': ['Las Palmas', 'Tenerife'],
  'ZONA 14': ['Canarias Islas Menores'],
  'ZONA 15': ['Ceuta', 'Melilla'],
  'ZONA 16': ['Andorra'],
};

function parseSection(rows, headerIdx, dataEndIdx, scope) {
  const headerRow = rows[headerIdx];
  if (!headerRow) return { rates: [], zoneMappings: [] };

  // Detect zone column positions from header row
  const zoneCols = [];
  for (let c = 1; c < headerRow.length; c++) {
    const val = headerRow[c];
    if (val !== null && val !== '' && String(val).toUpperCase().includes('ZONA')) {
      zoneCols.push({ col: c, zone: String(val).trim().toUpperCase() });
    }
  }

  if (zoneCols.length === 0) return { rates: [], zoneMappings: [] };

  // Track extra_per_kg per zone
  const extraPerKg = {};
  const ratesByZone = {};
  zoneCols.forEach(({ zone }) => { ratesByZone[zone] = []; });

  for (let i = headerIdx + 1; i <= dataEndIdx && i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;

    const rawWeight = row[0];
    if (rawWeight === null || rawWeight === undefined) continue;

    const weightStr = String(rawWeight).toLowerCase().trim();

    // Detect extra_per_kg rows: 'más ', '2000', '3000', '99999'
    const isExtraRow =
      weightStr.includes('más') ||
      weightStr === '2000' ||
      weightStr === '3000' ||
      weightStr === '99999';

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

  // Flatten rates and attach extra_per_kg to last tier of each zone
  const rates = [];
  for (const { zone } of zoneCols) {
    const zoneRates = ratesByZone[zone];
    if (zoneRates.length > 0 && extraPerKg[zone]) {
      zoneRates[zoneRates.length - 1].extra_per_kg = extraPerKg[zone];
    }
    rates.push(...zoneRates);
  }

  return { rates };
}

function parse(filePath) {
  const wb = XLSX.readFile(filePath);
  const sheetName = wb.SheetNames.find(n => n === '2025') || wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

  // Parse nacional section (zones 1-8)
  const { rates: nacRates } = parseSection(rows, NACIONAL_HEADER_IDX, NACIONAL_DATA_END_IDX, 'nacional');

  // Parse internacional/special section (zones 9-16)
  const { rates: intlRates } = parseSection(rows, INTL_HEADER_IDX, INTL_DATA_END_IDX, 'internacional');

  // Build zone mappings for nacional (province names)
  const nacZoneMappings = [];
  for (const [zone, provinces] of Object.entries(ZONE_PROVINCE_MAPPINGS)) {
    for (const province of provinces) {
      nacZoneMappings.push({ scope: 'nacional', zone, destination: province });
    }
  }

  // Build zone mappings for internacional/special
  const intlZoneMappings = [];
  for (const [zone, destinations] of Object.entries(ZONE_INTL_MAPPINGS)) {
    for (const dest of destinations) {
      intlZoneMappings.push({ scope: 'internacional', zone, destination: dest });
    }
  }

  return {
    rates: [...nacRates, ...intlRates],
    zoneMappings: [...nacZoneMappings, ...intlZoneMappings],
  };
}

module.exports = { parse };
