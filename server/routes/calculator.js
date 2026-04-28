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

// Origin: Murcia (prefix '30')
// Nacex Provincial = same province; Regional = adjacent provinces
const NACEX_ORIGIN_PREFIX = '30';
const NACEX_REGIONAL_PREFIXES = new Set([
  '02', // Albacete
  '03', // Alicante
  '04', // Almería
  '18', // Granada
  '23', // Jaén
  '46', // Valencia
]);

// Normalize for comparison
function normalize(str) {
  return String(str).toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}

// Resolve zone for an agency given destination info
function resolveZone(agencyId, agencyName, scope, postalCode, country) {
  if (scope === 'nacional') {
    if (!postalCode) return null;

    // Spanish CPs: 5 digits. Portuguese CPs: 4 digits.
    const cpStr = String(postalCode).replace(/\D/g, '');
    const isPortuguese = cpStr.length === 4;
    const prefix = cpStr.substring(0, 2);

    // For NACEX: zone depends on proximity to origin (Murcia)
    if (normalize(agencyName) === 'NACEX') {
      if (!isPortuguese && ['35', '38'].includes(prefix)) return null; // Canarias: no cubierto
      if (prefix === NACEX_ORIGIN_PREFIX) return 'Provincial';
      if (!isPortuguese && NACEX_REGIONAL_PREFIXES.has(prefix)) return 'Regional';
      return 'Nacional Peninsular+Andorra';
    }

    // Portuguese CPs: look up with "PT" prefix to avoid collision with Spanish CP prefixes
    if (isPortuguese) {
      const ptDest = 'PT' + prefix;
      const ptMapping = db.prepare(
        'SELECT zone FROM zone_mappings WHERE agency_id = ? AND scope = ? AND destination = ?'
      ).get(agencyId, 'nacional', ptDest);
      return ptMapping?.zone || null;
    }

    // Spanish CP: lookup by 2-digit prefix in zone_mappings
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

// Like resolveZone but returns ALL matching zones (handles multi-zone countries like "Italia Zona 1"/"Italia Zona 2")
function resolveAllZones(agencyId, agencyName, scope, postalCode, country) {
  if (scope !== 'internacional') {
    const z = resolveZone(agencyId, agencyName, scope, postalCode, country);
    return z ? [z] : [];
  }
  if (!country) return [];
  if (normalize(agencyName) === 'NACEX') return [];

  const normalizedCountry = normalize(country);
  const mappings = db.prepare(
    'SELECT zone, destination FROM zone_mappings WHERE agency_id = ? AND scope = ?'
  ).all(agencyId, 'internacional');

  const zones = [];

  for (const m of mappings) {
    const normDest = normalize(m.destination);
    // Strip trailing " ZONA N" or " ZONA N.N" for comparison
    const normDestBase = normDest.replace(/\s+ZONA\s+\d+([.,]\d+)?$/, '').trim();
    if (normDest === normalizedCountry || normDestBase === normalizedCountry) {
      if (!zones.includes(m.zone)) zones.push(m.zone);
    }
  }

  // Fuzzy fallback: prefix/contains (catches cases where stored name is a substring)
  if (zones.length === 0) {
    for (const m of mappings) {
      const normDest = normalize(m.destination);
      if (normDest.includes(normalizedCountry) || normalizedCountry.includes(normDest)) {
        if (!zones.includes(m.zone)) zones.push(m.zone);
      }
    }
  }

  return zones;
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

// Resolve postal code → Palemanía zone
function cpToZonePalemania(cp) {
  const cpStr = String(cp).replace(/\D/g, '');
  const prefix = parseInt(cpStr.substring(0, 2), 10);
  const cpNum = parseInt(cpStr, 10);

  // Canarias Islas Menores (zona 11) — must come before zona 10
  if ((cpNum >= 35500 && cpNum <= 35660) || (cpNum >= 38700 && cpNum <= 38917)) return '11';
  // Canarias principales (zona 10)
  if ((cpNum >= 35001 && cpNum <= 35489) || (cpNum >= 38001 && cpNum <= 38690)) return '10';
  // Baleares (zona 9) — excluir CP 07860 y 07870-07872
  if (prefix === 7 && cpNum !== 7860 && !(cpNum >= 7870 && cpNum <= 7872)) return '9';

  const zoneMap = {
    30: '0',
    3: '1', 12: '1', 46: '1',
    2: '2', 4: '2', 14: '2', 18: '2', 23: '2',
    11: '3', 13: '3', 16: '3', 19: '3', 21: '3',
    28: '3', 29: '3', 41: '3', 42: '3', 45: '3',
    5: '4', 9: '4', 26: '4', 40: '4', 47: '4', 50: '4',
    1: '5', 6: '5', 39: '5', 20: '5', 22: '5',
    24: '5', 25: '5', 31: '5', 34: '5', 37: '5',
    43: '5', 44: '5', 48: '5', 49: '5',
    33: '6', 8: '6', 10: '6',
    15: '7', 17: '7', 27: '7', 32: '7', 36: '7',
  };

  return zoneMap[prefix] || null;
}

// Find the cheapest palet combination that covers weight_kg for the given Palemanía zone.
// Returns:
//   { noRates: true }   — no rows exist in palemania_rates for this zone (file not loaded)
//   null                — rows exist but weight exceeds all available capacities
//   { palet_type, ... } — best matching combination
function calcPalemania(weightKg, zone) {
  const rows = db.prepare(`
    SELECT palet_type, max_kg_per_palet, num_pales, price_per_palet
    FROM palemania_rates
    WHERE agency_id = (SELECT id FROM agencies WHERE name = 'PALEMANIA')
    AND zone = ?
  `).all(zone);

  if (rows.length === 0) return { noRates: true };

  let best = null;

  for (const row of rows) {
    const capacity = row.max_kg_per_palet * row.num_pales;
    if (capacity >= weightKg) {
      const total_price = row.price_per_palet * row.num_pales;
      if (!best || total_price < best.total_price) {
        best = {
          palet_type: row.palet_type,
          num_pales: row.num_pales,
          max_kg_per_palet: row.max_kg_per_palet,
          price_per_palet: row.price_per_palet,
          total_price: Math.round(total_price * 100) / 100,
          capacity_kg: capacity,
        };
      }
    }
  }

  return best;
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
    return res.status(400).json({ error: 'Se requiere código postal para envíos peninsulares' });
  }
  if (destination_type === 'internacional' && !country) {
    return res.status(400).json({ error: 'Se requiere país para envíos internacionales' });
  }

  const weightKg = parseFloat(weight_kg);
  const agencies = db.prepare('SELECT * FROM agencies WHERE active = 1').all();

  const results = [];
  const notCovered = [];

  for (const agency of agencies) {
    // Palemanía uses palet-based pricing — handled separately
    if (normalize(agency.name) === 'PALEMANIA') {
      // No international coverage except Portugal (zones 8, 12, 13)
      if (destination_type === 'internacional') {
        const normCountry = normalize(country || '');
        let intlZone = null;
        if (normCountry === 'PORTUGAL') intlZone = '8';
        else if (normCountry === 'MADEIRA') intlZone = '12';
        else if (normCountry === 'AZORES' || normCountry === 'SAO MIGUEL' || normCountry === 'SÃO MIGUEL') intlZone = '13';

        if (!intlZone) {
          notCovered.push({ agency: agency.display_name, reason: 'Palemanía: solo cubre nacional, Portugal, Baleares y Canarias' });
          continue;
        }
        const result = calcPalemania(weightKg, intlZone);
        if (result?.noRates) {
          notCovered.push({ agency: agency.display_name, reason: 'Sin tarifas cargadas — subir palemania_2026.xlsx en Gestión de tarifas' });
          continue;
        }
        if (!result) {
          notCovered.push({ agency: agency.display_name, reason: `Peso ${weightKg} kg supera la capacidad máxima disponible` });
          continue;
        }
        results.push({
          agency_name: agency.display_name,
          zone: `Zona ${intlZone}`,
          weight_billed_kg: weightKg,
          price: result.total_price,
          scope: destination_type,
          notes: `${result.num_pales} palet${result.num_pales > 1 ? 's' : ''} ${result.palet_type} (máx. ${result.max_kg_per_palet} kg/pale)`,
          zone_note: '',
        });
        continue;
      }

      // Nacional
      const cpStr = String(postal_code).replace(/\D/g, '');
      const isPortuguese = cpStr.length === 4;
      let zone;
      if (isPortuguese) {
        zone = '8'; // Portugal peninsular
      } else {
        zone = cpToZonePalemania(cpStr);
      }

      if (!zone) {
        notCovered.push({ agency: agency.display_name, reason: 'Destino no cubierto por Palemanía' });
        continue;
      }

      const result = calcPalemania(weightKg, zone);
      if (result?.noRates) {
        notCovered.push({ agency: agency.display_name, reason: 'Sin tarifas cargadas — subir palemania_2026.xlsx en Gestión de tarifas' });
        continue;
      }
      if (!result) {
        notCovered.push({ agency: agency.display_name, reason: `Peso ${weightKg} kg supera la capacidad máxima disponible` });
        continue;
      }

      results.push({
        agency_name: agency.display_name,
        zone: `Zona ${zone}`,
        weight_billed_kg: weightKg,
        price: result.total_price,
        scope: destination_type,
        notes: `${result.num_pales} palet${result.num_pales > 1 ? 's' : ''} ${result.palet_type} (máx. ${result.max_kg_per_palet} kg/pale)`,
        zone_note: zone === '7' ? '⚠️ Confirmar con Palemanía si aplica zona 7.1 (+18%)' : '',
      });
      continue;
    }

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

    // Resolve zone(s) — may return multiple for multi-zone countries (e.g. Italia Zona 1 + Zona 2)
    const zones = resolveAllZones(agency.id, agency.name, destination_type, postal_code, country);
    if (!zones.length) {
      notCovered.push({ agency: agency.display_name, reason: 'Zona no encontrada para este destino' });
      continue;
    }

    let addedForAgency = false;
    for (const zone of zones) {
      const tiers = db.prepare(
        'SELECT * FROM tariff_rates WHERE agency_id = ? AND scope = ? AND zone = ? ORDER BY weight_max_kg ASC'
      ).all(agency.id, destination_type, zone);

      if (!tiers.length) continue;

      const price = calculatePrice(weightKg, tiers);
      if (price === null) continue;

      results.push({
        agency_name: agency.display_name,
        zone,
        weight_billed_kg: weightKg,
        price,
        scope: destination_type,
        notes: '',
      });
      addedForAgency = true;
    }

    if (!addedForAgency) {
      notCovered.push({ agency: agency.display_name, reason: 'Sin datos de tarifa para la zona' });
    }
  }

  results.sort((a, b) => a.price - b.price);

  // Build destination_resolved string
  let destinationResolved = '';
  if (destination_type === 'nacional' && postal_code) {
    const cpStr = String(postal_code).replace(/\D/g, '');
    if (cpStr.length === 4) {
      destinationResolved = `Portugal (${cpStr})`;
    } else {
      const prefix = cpStr.padStart(5, '0').substring(0, 2);
      const province = CP_PREFIX_TO_PROVINCE[prefix] || prefix;
      destinationResolved = `${province} (${prefix}xxx)`;
    }
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

  // Strip trailing " Zona N" suffixes and deduplicate so multi-zone countries (e.g. "Italia Zona 1",
  // "Italia Zona 2") appear as a single entry ("Italia") in the picker.
  const seen = new Set();
  const countries = [];
  for (const r of rows) {
    const name = r.destination.replace(/\s+Zona\s+\d+([.,]\d+)?\s*$/i, '').trim();
    if (!seen.has(name)) {
      seen.add(name);
      countries.push(name);
    }
  }
  countries.sort((a, b) => a.localeCompare(b, 'es'));
  res.json(countries);
});

module.exports = router;
