const XLSX = require('xlsx');

// Transaher: sheet "2026"
// Layout: WEIGHT_COL=3, zone prices in cols 4-12
// Nacional zones 1-9: header at row idx 23, data rows 24-43 (10–500 kg)
//   Row KILOS=1000 → extra_per_kg; row KILOS=mas → second rate (ignored)
// Special/intl zones 11-19: header at row idx 54, data rows 55-81 (10–1000 kg)
//   Row KILOS=2000+ → extra_per_kg

const WEIGHT_COL = 3;

// Province name → national zone (ZONA 1-9)
const ZONE_PROVINCE_MAPPINGS = {
  'ZONA 1':  ['MURCIA'],
  'ZONA 2':  ['ALICANTE'],
  'ZONA 3':  ['ALBACETE', 'ALMERIA', 'VALENCIA'],
  'ZONA 4':  ['CASTELLON', 'GRANADA', 'JAEN'],
  'ZONA 5':  ['BARCELONA', 'CORDOBA', 'MADRID', 'MALAGA', 'SEVILLA', 'TARRAGONA', 'TOLEDO', 'ZARAGOZA'],
  'ZONA 6':  ['AVILA', 'CIUDAD REAL', 'CUENCA', 'GUADALAJARA', 'PAMPLONA', 'VALLADOLID'],
  'ZONA 7':  ['BADAJOZ', 'CACERES', 'CADIZ', 'GERONA', 'HUELVA', 'SEGOVIA'],
  'ZONA 8':  ['BURGOS', 'HUESCA', 'LEON', 'LERIDA', 'LOGROÑO', 'PALENCIA', 'SALAMANCA', 'TERUEL', 'ZAMORA'],
  'ZONA 9':  ['BILBAO', 'LA CORUÑA', 'LUGO', 'ORENSE', 'OVIEDO', 'PONTEVEDRA', 'S.SEBASTIAN', 'SANTANDER', 'SORIA', 'VITORIA'],
};

// Country/territory → international zone (ZONA 11-19)
const ZONE_INTL_MAPPINGS = {
  'ZONA 11': ['Portugal Peninsular'],
  'ZONA 12': ['Portugal Islas'],
  'ZONA 13': ['Palma de Mallorca'],
  'ZONA 14': ['Ibiza', 'Menorca'],
  'ZONA 15': ['Resto Islas Baleares'],
  'ZONA 16': ['Las Palmas', 'Tenerife'],
  'ZONA 17': ['Resto Islas Canarias'],
  'ZONA 18': ['Ceuta', 'Melilla'],
  'ZONA 19': ['Andorra'],
};

// CP prefix → special national zone (accessible by Spanish/Portuguese postal code)
function buildSpecialNacZoneMappings() {
  const mappings = [];

  // ZONA 11: all Portuguese CP 2-digit prefixes
  const ptRanges = [[10, 21], [22, 24], [25, 29], [30, 38], [40, 49], [50, 64], [70, 89]];
  for (const [from, to] of ptRanges) {
    for (let i = from; i <= to; i++) {
      mappings.push({ scope: 'nacional', zone: 'ZONA 11', destination: 'PT' + String(i).padStart(2, '0') });
    }
  }

  // ZONA 13: Baleares (07xxx) — default to Palma de Mallorca
  mappings.push({ scope: 'nacional', zone: 'ZONA 13', destination: '07' });

  // ZONA 16: Canarias (35=Las Palmas, 38=Tenerife)
  mappings.push({ scope: 'nacional', zone: 'ZONA 16', destination: '35' });
  mappings.push({ scope: 'nacional', zone: 'ZONA 16', destination: '38' });

  // ZONA 18: Ceuta (51xxx), Melilla (52xxx)
  mappings.push({ scope: 'nacional', zone: 'ZONA 18', destination: '51' });
  mappings.push({ scope: 'nacional', zone: 'ZONA 18', destination: '52' });

  return mappings;
}

// extraThreshold: weights >= this are treated as per-kg extra rows (not data tiers)
// maxRowIdx: stop before this row index (exclusive)
function parseSection(rows, headerIdx, scope, extraThreshold, maxRowIdx) {
  const headerRow = rows[headerIdx];
  if (!headerRow) return { rates: [] };

  // Zone cols: cols 4–12, header value is a zone number (1–9 or 11–19)
  const zoneCols = [];
  for (let c = WEIGHT_COL + 1; c <= WEIGHT_COL + 9 && c < headerRow.length; c++) {
    const val = headerRow[c];
    if (val === null || val === undefined || val === '') continue;
    const num = parseFloat(String(val).trim());
    if (!isNaN(num) && num > 0) {
      zoneCols.push({ col: c, zone: `ZONA ${num}` });
    }
  }

  if (zoneCols.length === 0) return { rates: [] };

  const extraPerKg = {};
  const ratesByZone = {};
  zoneCols.forEach(({ zone }) => { ratesByZone[zone] = []; });

  const rowLimit = maxRowIdx !== undefined ? Math.min(maxRowIdx, rows.length) : Math.min(rows.length, headerIdx + 70);
  for (let i = headerIdx + 1; i < rowLimit; i++) {
    const row = rows[i];
    if (!row) continue;

    const rawWeight = row[WEIGHT_COL];
    if (rawWeight === null || rawWeight === undefined) continue;

    const weightStr = String(rawWeight).toLowerCase().trim();
    if (!weightStr) continue;

    const numericWeight = parseFloat(rawWeight);
    const isExtraRow =
      weightStr.includes('más') ||
      weightStr.includes('mas') ||
      (!isNaN(numericWeight) && numericWeight >= extraThreshold);

    if (isExtraRow) {
      for (const { col, zone } of zoneCols) {
        if (extraPerKg[zone] !== undefined) continue; // keep first extra only
        const price = parseFloat(row[col]);
        if (!isNaN(price) && price > 0) extraPerKg[zone] = price;
      }
      continue;
    }

    if (isNaN(numericWeight) || numericWeight <= 0) continue;

    for (const { col, zone } of zoneCols) {
      const price = parseFloat(row[col]);
      if (!isNaN(price) && price > 0) {
        ratesByZone[zone].push({
          scope,
          zone,
          weight_max_kg: numericWeight,
          price,
          extra_per_kg: null,
        });
      }
    }
  }

  const rates = [];
  for (const { zone } of zoneCols) {
    const zoneRates = ratesByZone[zone];
    if (zoneRates.length > 0 && extraPerKg[zone] !== undefined) {
      zoneRates[zoneRates.length - 1].extra_per_kg = extraPerKg[zone];
    }
    rates.push(...zoneRates);
  }

  return { rates };
}

function parse(filePath) {
  const wb = XLSX.readFile(filePath);
  const sheetName = wb.SheetNames.find(n => n === '2026')
    || wb.SheetNames.find(n => n.includes('2026'))
    || wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

  // Locate both KILOS headers (national first, international second)
  const kilosIdxs = [];
  for (let i = 0; i < rows.length; i++) {
    const cell = String(rows[i]?.[WEIGHT_COL] ?? '').trim();
    if (/^kilo/i.test(cell)) kilosIdxs.push(i);
  }

  const nacHeaderIdx  = kilosIdxs[0] ?? -1;
  const intlHeaderIdx = kilosIdxs[1] ?? -1;

  const warning = [];
  if (nacHeaderIdx === -1) warning.push('Cabecera nacional no encontrada');
  if (intlHeaderIdx === -1) warning.push('Cabecera internacional no encontrada');

  // Nacional: weights 10–500, extra from row KILOS=1000; stop before intl section
  const nacStop = intlHeaderIdx !== -1 ? intlHeaderIdx : undefined;
  const { rates: nacRates } = nacHeaderIdx !== -1
    ? parseSection(rows, nacHeaderIdx, 'nacional', 1000, nacStop)
    : { rates: [] };

  // Internacional: weights 10–1000, extra from row KILOS=2000
  const { rates: intlRates } = intlHeaderIdx !== -1
    ? parseSection(rows, intlHeaderIdx, 'internacional', 2000)
    : { rates: [] };

  // Zones 11,13-18 are Spanish territory or adjacent: also store as 'nacional'
  // Zone 12 (Portugal Islas = Azores/Madeira) and 19 (Andorra) are international-only
  const specialNacZones = new Set(['ZONA 11', 'ZONA 13', 'ZONA 14', 'ZONA 15', 'ZONA 16', 'ZONA 17', 'ZONA 18']);
  const specialNacRates = intlRates
    .filter(r => specialNacZones.has(r.zone))
    .map(r => ({ ...r, scope: 'nacional' }));

  // Nacional zone mappings: provinces + CP prefixes
  const nacZoneMappings = [];
  for (const [zone, provinces] of Object.entries(ZONE_PROVINCE_MAPPINGS)) {
    for (const province of provinces) {
      nacZoneMappings.push({ scope: 'nacional', zone, destination: province });
    }
  }
  nacZoneMappings.push(...buildSpecialNacZoneMappings());

  // Internacional zone mappings
  const intlZoneMappings = [];
  for (const [zone, destinations] of Object.entries(ZONE_INTL_MAPPINGS)) {
    for (const dest of destinations) {
      intlZoneMappings.push({ scope: 'internacional', zone, destination: dest });
    }
  }

  return {
    rates: [...nacRates, ...intlRates, ...specialNacRates],
    zoneMappings: [...nacZoneMappings, ...intlZoneMappings],
    ...(warning.length > 0 ? { warning: warning.join('; ') } : {}),
  };
}

module.exports = { parse };
