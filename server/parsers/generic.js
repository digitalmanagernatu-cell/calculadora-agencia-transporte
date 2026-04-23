const XLSX = require('xlsx');

function parse(filePath) {
  const wb = XLSX.readFile(filePath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

  // Find first row with >= 3 non-null cells
  let headerIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    const nonNull = rows[i].filter(c => c !== null && c !== '');
    if (nonNull.length >= 3) {
      headerIdx = i;
      break;
    }
  }

  if (headerIdx === -1) {
    return {
      rates: [],
      zoneMappings: [],
      warning: 'No se pudo detectar la estructura del archivo. Revise el formato.',
    };
  }

  const headerRow = rows[headerIdx];
  // Column 0 = weight, rest = zones
  const zoneCols = [];
  for (let c = 1; c < headerRow.length; c++) {
    if (headerRow[c] !== null && headerRow[c] !== '') {
      zoneCols.push({ col: c, zone: `Zona ${zoneCols.length + 1}` });
    }
  }

  const rates = [];
  for (let r = headerIdx + 1; r < rows.length; r++) {
    const row = rows[r];
    const rawWeight = row[0];
    if (rawWeight === null || rawWeight === '') continue;
    const weight = parseFloat(rawWeight);
    if (isNaN(weight)) continue;

    for (const { col, zone } of zoneCols) {
      const price = parseFloat(row[col]);
      if (!isNaN(price) && price > 0) {
        rates.push({
          scope: 'nacional',
          zone,
          weight_max_kg: weight,
          price,
          extra_per_kg: null,
        });
      }
    }
  }

  return {
    rates,
    zoneMappings: [],
    warning: 'Archivo analizado con parser genérico. Revise los datos importados.',
  };
}

module.exports = { parse };
