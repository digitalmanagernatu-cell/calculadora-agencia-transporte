const express = require('express');
const { db } = require('../db');

const router = express.Router();

// Spanish CP 2-digit prefix → province name (used for Transaher zone lookup)
const CP_PREFIX_TO_PROVINCE = {
  '01': 'VITORIA',        // Álava
  '02': 'ALBACETE',
  '03': 'ALICANTE',
  '04': 'ALMERIA',
  '05': 'AVILA',
  '06': 'BADAJOZ',
  '07': 'PALMA DE MALLORCA', // Baleares
  '08': 'BARCELONA',
  '09': 'BURGOS',
  '10': 'CACERES',
  '11': 'CADIZ',
  '12': 'CASTELLON',
  '13': 'CIUDAD REAL',
  '14': 'CORDOBA',
  '15': 'LA CORUÑA',
  '16': 'CUENCA',
  '17': 'GERONA',
  '18': 'GRANADA',
  '19': 'GUADALAJARA',
  '20': 'S.SEBASTIAN',    // Guipúzcoa
  '21': 'HUELVA',
  '22': 'HUESCA',
  '23': 'JAEN',
  '24': 'LEON',
  '25': 'LERIDA',
  '26': 'LOGROÑO',        // La Rioja
  '27': 'LUGO',
  '28': 'MADRID',
  '29': 'MÁLAGA',
  '30': 'MURCIA',
  '31': 'PAMPLONA',       // Navarra
  '32': 'ORENSE',
  '33': 'OVIEDO',         // Asturias
  '34': 'PALENCIA',
  '35': 'LAS PALMAS',     // Gran Canaria
  '36': 'PONTEVEDRA',
  '37': 'SALAMANCA',
  '38': 'TENERIFE',       // Santa Cruz de Tenerife
  '39': 'SANTANDER',      // Cantabria
  '40': 'SEGOVIA',
  '41': 'SEVILLA',
  '42': 'SORIA',
  '43': 'TARRAGONA',
  '44': 'TERUEL',
  '45': 'TOLEDO',
  '46': 'VALENCIA',
  '47': 'VALLADOLID',
  '48': 'BILBAO',         // Vizcaya
  '49': 'ZAMORA',
  '50': 'ZARAGOZA',
  '51': 'CEUTA',
  '52': 'MELILLA',
};

// Normalize for comparison
function normalize(str) {
  return String(str).toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}

// Resolve zone for an agency given destination info
function resolveZone(agencyId, agencyName, scope, postalCode, country) {
  if (scope === 'nacional') {
    if (!postalCode) return null;

    const prefix = String(postalCode).padStart(5, '0').substring(0, 2);

    // For NACEX: no zone_mappings, always use 'Nacional Peninsular+Andorra'
    // (unless it's a Canarias or special CP that Nacex doesn't cover via this route)
    if (normalize(agencyName) === 'NACEX') {
      // Canarias CPs (35, 38) → Nacex doesn't cover them in this dataset
      if (['35', '38'].includes(prefix)) return null;
      return 'Nacional Peninsular+Andorra';
    }

    // Lookup by CP prefix in zone_mappings
    const mapping = db.prepare(
      'SELECT zone FROM zone_mappings WHERE agency_id = ? AND scope = ? AND destination = ?'
    ).get(agencyId, 'nacional', prefix);

    if (mapping) return mapping.zone;

    // Fallback for Transaher: match by province name
    if (normalize(agencyName) === 'TRANSAHER') {
      const province = CP_PREFIX_TO_PROVINCE[prefix];
      if (!province) return null;
      const provMapping = db.prepare(
        'SELECT zone FROM zone_mappings WHERE agency_id = ? AND scope = ? AND UPPER(destination) = ?'
      ).get(agencyId, 'nacional', normalize(province));
      return provMapping?.zone || null;
    }

    return null;
  }

  if (scope === 'internacional') {
    if (!country) return null;

    // Nacex has no international tariff
    if (normalize(agencyName) === 'NACEX') return null;

    // Match country against zone_mappings destinations
    const normalizedCountry = normalize(country);
    const mappings = db.prepare(
      'SELECT zone, destination FROM zone_mappings WHERE agency_id = ? AND scope = ?'
    ).all(agencyId, 'internacional');

    for (const m of mappings) {
      if (normalize(m.destination) === normalizedCountry) {
        return m.zone;
      }
    }

    // Fuzzy fallback: contains
    for (const m of mappings) {
      if (normalize(m.destination).includes(normalizedCountry) || normalizedCountry.includes(normalize(m.destination))) {
        return m.zone;
      }
    }

    return null;
  }

  return null;
}

// Calculate price for given weight and ordered tiers
function calculatePrice(weightKg, tiers) {
  if (!tiers || tiers.length === 0) return null;

  // Find smallest tier where weight_max_kg >= weightKg
  const applicable = tiers.find(t => t.weight_max_kg >= weightKg);

  if (applicable) {
    const applicableIdx = tiers.indexOf(applicable);
    const prevTier = applicableIdx > 0 ? tiers[applicableIdx - 1] : null;
    // Rule: no billing lower than previous tier
    const price = Math.max(applicable.price, prevTier ? prevTier.price : 0);
    return Math.round(price * 100) / 100;
  }

  // Weight exceeds all tiers — use extra_per_kg
  const lastTier = tiers[tiers.length - 1];
  if (lastTier.extra_per_kg === null || lastTier.extra_per_kg === undefined) {
    return null; // cannot calculate
  }

  const overage = weightKg - lastTier.weight_max_kg;
  const price = lastTier.price + lastTier.extra_per_kg * overage;
  return Math.round(price * 100) / 100;
}

// POST /api/calculator/quote
router.post('/quote', (req, res) => {
  const { weight_kg, destination_type, postal_code, country } = req.body;

  if (!weight_kg || isNaN(parseFloat(weight_kg)) || parseFloat(weight_kg) <= 0) {
    return res.status(400).json({ error: 'Peso inválido' });
  }
  if (!destination_type || !['nacional', 'internacional'].includes(destination_type)) {
    return res.status(400).json({ error: 'Tipo de destino inválido' });
  }
  if (destination_type === 'nacional' && !postal_code) {
    return res.status(400).json({ error: 'Se requiere código postal para envíos nacionales' });
  }
  if (destination_type === 'internacional' && !country) {
    return res.status(400).json({ error: 'Se requiere país para envíos internacionales' });
  }

  const weightKg = parseFloat(weight_kg);
  const agencies = db.prepare('SELECT * FROM agencies WHERE active = 1').all();

  const results = [];
  const notCovered = [];

  for (const agency of agencies) {
    // Check if agency has tariffs for this scope
    const hasTariff = db.prepare(
      'SELECT COUNT(*) as c FROM tariff_rates WHERE agency_id = ? AND scope = ?'
    ).get(agency.id, destination_type);

    if (!hasTariff.c) {
      if (destination_type === 'internacional' && normalize(agency.name) === 'NACEX') {
        notCovered.push({ agency: agency.display_name, reason: 'NACEX: sin tarifa internacional disponible' });
      } else {
        notCovered.push({ agency: agency.display_name, reason: 'Sin tarifa para este destino' });
      }
      continue;
    }

    // Resolve zone
    const zone = resolveZone(agency.id, agency.name, destination_type, postal_code, country);
    if (!zone) {
      notCovered.push({ agency: agency.display_name, reason: 'Zona no encontrada para este destino' });
      continue;
    }

    // Get ordered weight tiers
    const tiers = db.prepare(
      'SELECT * FROM tariff_rates WHERE agency_id = ? AND scope = ? AND zone = ? ORDER BY weight_max_kg ASC'
    ).all(agency.id, destination_type, zone);

    if (!tiers.length) {
      notCovered.push({ agency: agency.display_name, reason: 'Sin datos de tarifa para la zona' });
      continue;
    }

    const price = calculatePrice(weightKg, tiers);
    if (price === null) {
      notCovered.push({ agency: agency.display_name, reason: 'Peso supera el máximo disponible sin tarifa por kg adicional' });
      continue;
    }

    results.push({
      agency_name: agency.display_name,
      zone,
      weight_billed_kg: weightKg,
      price,
      scope: destination_type,
      notes: '',
    });
  }

  results.sort((a, b) => a.price - b.price);

  // Build destination_resolved string
  let destinationResolved = '';
  if (destination_type === 'nacional' && postal_code) {
    const prefix = String(postal_code).padStart(5, '0').substring(0, 2);
    const province = CP_PREFIX_TO_PROVINCE[prefix] || prefix;
    destinationResolved = `${province} (${prefix}xxx)`;
  } else if (destination_type === 'internacional' && country) {
    destinationResolved = country;
  }

  res.json({
    results,
    destination_resolved: destinationResolved,
    weight_input: weightKg,
    not_covered: notCovered,
  });
});

// GET /api/calculator/countries — list covered international countries
router.get('/countries', (req, res) => {
  const rows = db.prepare(
    "SELECT DISTINCT destination FROM zone_mappings WHERE scope = 'internacional' ORDER BY destination ASC"
  ).all();
  res.json(rows.map(r => r.destination));
});

module.exports = router;
