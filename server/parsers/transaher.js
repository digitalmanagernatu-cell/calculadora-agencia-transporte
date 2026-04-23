const XLSX = require('xlsx');

// Transaher: sheet "2025"
// Nacional zones 1-8: header idx 29 (Excel row 30), data idx 30-69 (Excel rows 31-70)
// Special/intl zones 9-16: header idx 75 (Excel row 76), data idx 76-103 (Excel rows 77-104)
// Note: in both sections col 0 = weight/kilos, zone prices start at col 1

const NACIONAL_HEADER_IDX = 29;
const NACIONAL_DATA_END_IDX = 69;

const INTL_HEADER_IDX = 75;
const INTL_DATA_END_IDX = 103;

// Province name → national zone (ZONA 1-4)
const ZONE_PROVINCE_MAPPINGS = {
  'ZONA 1': ['ALICANTE', 'MURCIA'],
  'ZONA 2': ['ALBACETE', 'ALMERIA', 'BARCELONA', 'CASTELLON', 'CIUDAD REAL', 'GRANADA', 'GUADALAJARA', 'JAEN', 'MADRID', 'TOLEDO', 'VALENCIA', 'ZARAGOZA'],
  'ZONA 3': ['AVILA', 'BADAJOZ', 'BILBAO', 'BURGOS', 'CACERES', 'CADIZ', 'CORDOBA', 'CUENCA', 'GERONA', 'HUELVA', 'HUESCA', 'LERIDA', 'MÁLAGA', 'PALENCIA', 'PAMPLONA', 'SEGOVIA', 'SEVILLA', 'SORIA', 'TARRAGONA', 'TERUEL', 'VALLADOLID', 'ZAMORA'],
  'ZONA 4': ['LA CORUÑA', 'LEON', 'LOGROÑO', 'LUGO', 'ORENSE', 'OVIEDO', 'PONTEVEDRA', 'S.SEBASTIAN', 'SALAMANCA', 'SANTANDER', 'VITORIA'],
};

// Country/territory name → international/special zone (ZONA 9-16)
const ZONE_INTL_MAPPINGS = {
  'ZONA 9':  ['Portugal Peninsular'],
  'ZONA 10': ['Palma de Mallorca', 'Mahón', 'Menorca'],
  'ZONA 11': ['Ibiza'],
  'ZONA 12': ['Formentera'],
  'ZONA 13': ['Las Palmas', 'Tenerife'],
  'ZONA 14': ['Canarias Islas Menores'],
  'ZONA 15': ['Ceuta', 'Melilla'],
  'ZONA 16': ['Andorra'],
};

// CP prefix → special national zone (zones 9-15, accessible by Spanish/Portuguese postal code)
// ZONA 9  → Portuguese 4-digit CPs (stored with PT-prefix marker)
// ZONA 10 → Baleares (07xxx)
// ZONA 13 → Canarias (35xxx, 38xxx)
// ZONA 15 → Ceuta (51xxx), Melilla (52xxx)
function buildSpecialNacZoneMappings() {
  const mappings = [];

  // ZONA 9: all Portuguese CP 2-digit prefixes (PT10–PT89 range)
  const ptRanges = [
    [10, 21], [22, 24], [25, 29], [30, 38], [40, 49], [50, 64], [70, 89],
  ];
  for (const [from, to] of ptRanges) {
    for (let i = from; i <= to; i++) {
      mappings.push({ scope: 'nacional', zone: 'ZONA 9', destination: 'PT' + String(i).padStart(2, '0') });
    }
  }

  // ZONA 10: Baleares (07xxx) — default zone for all Balearic CPs
  mappings.push({ scope: 'nacional', zone: 'ZONA 10', destination: '07' });

  // ZONA 13: Canarias (35xxx = Gran Canaria, 38xxx = Tenerife)
  mappings.push({ scope: 'nacional', zone: 'ZONA 13', destination: '35' });
  mappings.push({ scope: 'nacional', zone: 'ZONA 13', destination: '38' });

  // ZONA 15: Ceuta (51xxx), Melilla (52xxx)
  mappings.push({ scope: 'nacional', zone: 'ZONA 15', destination: '51' });
  mappings.push({ scope: 'nacional', zone: 'ZONA 15', destination: '52' });

  return mappings;
}

function parseSection(rows, headerIdx, dataEndIdx, scope) {
  const headerRow = rows[headerIdx];
  if (!headerRow) return { rates: [] };

  // Detect zone columns from header row (any cell containing 'ZONA')
  const zoneCols = [];
  for (let c = 1; c < headerRow.length; c++) {
    const val = headerRow[c];
    if (val !== null && val !== '' && String(val).toUpperCase().includes('ZONA')) {
      zoneCols.push({ col: c, zone: String(val).trim().toUpperCase() });
    }
  }

  if (zoneCols.length === 0) return { rates: [] };

  const extraPerKg = {};
  const ratesByZone = {};
  zoneCols.forEach(({ zone }) => { ratesByZone[zone] = []; });

  for (let i = headerIdx + 1; i <= dataEndIdx && i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;

    const rawWeight = row[0];
    if (rawWeight === null || rawWeight === undefined) continue;

    const weightStr = String(rawWeight).toLowerCase().trim();

    // Extra_per_kg rows: 'más', '2000', '3000', '99999'
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

  // Nacional: ZONA 1-8 (only ZONA 1-4 have prices in this tariff)
  const { rates: nacRates } = parseSection(rows, NACIONAL_HEADER_IDX, NACIONAL_DATA_END_IDX, 'nacional');

  // Special/international: ZONA 9-16
  const { rates: intlRates } = parseSection(rows, INTL_HEADER_IDX, INTL_DATA_END_IDX, 'internacional');

  // ZONA 9-15 are Spanish territory or adjacent (Portugal, Baleares, Canarias, Ceuta, Melilla)
  // Store them also as 'nacional' so they're accessible by Spanish/Portuguese postal code
  const specialNacRates = intlRates
    .filter(r => r.zone !== 'ZONA 16')
    .map(r => ({ ...r, scope: 'nacional' }));

  // Zone mappings for nacional: provinces (ZONA 1-4) + CP prefixes (ZONA 9-15)
  const nacZoneMappings = [];
  for (const [zone, provinces] of Object.entries(ZONE_PROVINCE_MAPPINGS)) {
    for (const province of provinces) {
      nacZoneMappings.push({ scope: 'nacional', zone, destination: province });
    }
  }
  nacZoneMappings.push(...buildSpecialNacZoneMappings());

  // Zone mappings for internacional: country/territory names (ZONA 9-16)
  const intlZoneMappings = [];
  for (const [zone, destinations] of Object.entries(ZONE_INTL_MAPPINGS)) {
    for (const dest of destinations) {
      intlZoneMappings.push({ scope: 'internacional', zone, destination: dest });
    }
  }

  return {
    rates: [...nacRates, ...intlRates, ...specialNacRates],
    zoneMappings: [...nacZoneMappings, ...intlZoneMappings],
  };
}

module.exports = { parse };
