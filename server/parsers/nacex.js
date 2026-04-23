const XLSX = require('xlsx');

// Nacex: sheet Hoja1, three service zones, national only, no zone mappings
// Excel rows are 1-based; array indices are 0-based (Excel row N = idx N-1)
const SERVICES = [
  { zone: 'Provincial',                   dataStart: 7,  dataEnd: 19 }, // Excel rows 8-20
  { zone: 'Regional',                     dataStart: 21, dataEnd: 33 }, // Excel rows 22-34
  { zone: 'Nacional Peninsular+Andorra',  dataStart: 35, dataEnd: 47 }, // Excel rows 36-48
];

// extra_per_kg for weights > 40 kg: fraction of 5-kg block = 3.68 / 5
const EXTRA_PER_KG = parseFloat((3.68 / 5).toFixed(6));
const PRICE_COL = 1; // column B (idx 1)

function parse(filePath) {
  const wb = XLSX.readFile(filePath);
  const sheetName = wb.SheetNames.find(n => n === 'Hoja1') || wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

  const rates = [];

  for (const service of SERVICES) {
    const serviceRates = [];

    for (let i = service.dataStart; i <= service.dataEnd && i < rows.length; i++) {
      const row = rows[i];
      if (!row) continue;

      const rawLabel = row[0]; // e.g. "BAG 2 kg", "PACK 0 a 2 kg", "PACK 2 a 5 kg"
      const rawPrice = row[PRICE_COL];

      if (rawLabel === null && rawPrice === null) continue;

      const price = parseFloat(rawPrice);
      if (isNaN(price) || price <= 0) continue;

      // Extract max weight from label: look for the last number in the label
      const label = String(rawLabel || '');
      const weightMatch = label.match(/(\d+)\s*kg/i);
      if (!weightMatch) continue;

      // For "PACK X a Y kg" use Y; for "BAG Y kg" use Y
      const aMatch = label.match(/(\d+)\s*a\s*(\d+)\s*kg/i);
      const weightMax = aMatch ? parseFloat(aMatch[2]) : parseFloat(weightMatch[1]);

      if (isNaN(weightMax)) continue;

      serviceRates.push({
        scope: 'nacional',
        zone: service.zone,
        weight_max_kg: weightMax,
        price,
        extra_per_kg: null,
      });
    }

    // Remove duplicate weight tiers, keeping first occurrence
    const seen = new Set();
    for (const r of serviceRates) {
      if (!seen.has(r.weight_max_kg)) {
        seen.add(r.weight_max_kg);
        rates.push(r);
      }
    }

    // Add extra_per_kg to the last tier of each service
    if (rates.length > 0) {
      const lastServiceRate = rates.filter(r => r.zone === service.zone).slice(-1)[0];
      if (lastServiceRate) {
        lastServiceRate.extra_per_kg = EXTRA_PER_KG;
      }
    }
  }

  return { rates, zoneMappings: [] };
}

module.exports = { parse };
