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

    // Italy: resolve zone by CAP prefix (stored as IT##)
    if (normalize(country) === 'ITALIA') {
      if (!postalCode) return null;
      const capStr = String(postalCode).replace(/\D/g, '');
      const capPrefix = 'IT' + capStr.substring(0, 2).padStart(2, '0');
      const itMapping = db.prepare(
        'SELECT zone FROM zone_mappings WHERE agency_id = ? AND scope = ? AND destination = ?'
      ).get(agencyId, 'internacional', capPrefix);
      if (itMapping) return itMapping.zone;
      // Fallback for old DB data before re-upload: determine zone from CAP prefix numerically
      const capNum = parseInt(capStr.substring(0, 2), 10);
      if (!isNaN(capNum)) {
        const isZona1 = capNum >= 10 && capNum <= 59;
        const targetZone = isZona1 ? 'Italia Zona 1' : 'Italia Zona 2';
        const oldMapping = db.prepare(
          'SELECT zone FROM zone_mappings WHERE agency_id = ? AND scope = ? AND zone = ? LIMIT 1'
        ).get(agencyId, 'internacional', targetZone);
        return oldMapping?.zone || null;
      }
      return null;
    }

    // Match country against zone_mappings destinations (skip IT## entries)
    const normalizedCountry = normalize(country);
    const mappings = db.prepare(
      "SELECT zone, destination FROM zone_mappings WHERE agency_id = ? AND scope = ? AND destination NOT LIKE 'IT%'"
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

// Map French CP (5-digit) → special island pricing or regular zone
// Francia: Córcega (20) + departments with Atlantic/Mediterranean islands: 17, 22, 29, 50, 56, 83, 85
// Rate: 1.1527 €/kg, min 34.72 €
function cpToZoneFrance(cp) {
  const cpStr = String(cp).replace(/\D/g, '').padStart(5, '0');
  const prefix = parseInt(cpStr.substring(0, 2), 10);
  const ISLAND_PREFIXES = new Set([17, 20, 22, 29, 50, 56, 83, 85]);
  if (ISLAND_PREFIXES.has(prefix)) {
    return { special: true, rate_per_kg: 1.1527, min_price: 34.72, label: 'Córcega / Islas Francesas' };
  }
  return { zone: 'Francia y Mónaco' };
}

// Map German CP (5-digit) → special island pricing or regular zone
// Rate: 0.1695 €/kg, min 16.02 €
const GERMANY_ISLAND_CPS = new Set([
  25849, 25859,                                                    // Pellworm, Halligen
  25938, 25942, 25946,                                             // Föhr, Amrum
  ...Array.from({ length: 20 }, (_, i) => 25980 + i),             // Sylt: 25980-25999
  26465, 26474, 26486,                                             // Langeoog, Spiekeroog, Wangerooge
  26548, 26571, 26579, 26757,                                      // Norderney, Juist, Baltrum, Borkum
  27498,                                                           // Helgoland
]);
function cpToZoneGermany(cp) {
  const cpStr = String(cp).replace(/\D/g, '').padStart(5, '0');
  const cpNum = parseInt(cpStr, 10);
  if (GERMANY_ISLAND_CPS.has(cpNum)) {
    return { special: true, rate_per_kg: 0.1695, min_price: 16.02, label: 'Islas Alemania' };
  }
  return { zone: 'Alemania' };
}

// Map Italian CP (5-digit) to Redur zone or special fixed-price destination
// Returns: { zone: 'Italia Zona 1' | 'Italia Zona 2' }
//       or { special: true, price: number, label: string }
function cpToZoneItaly(cp) {
  const cpStr = String(cp).replace(/\D/g, '').padStart(5, '0');
  const cpNum = parseInt(cpStr, 10);
  const prefix = parseInt(cpStr.substring(0, 2), 10);

  // Special customs territories — fixed price regardless of weight
  if (cpNum === 22060) return { special: true, price: 94.46, label: 'Campione d\'Italia (22060)' };
  if (cpNum === 23030) return { special: true, price: 49.38, label: 'Livigno (23030)' };

  // Italian minor islands NOT already in Zona 2 — fixed price
  // Elba + Capraia (Livorno province, island CPs 57031–57039)
  if (cpNum >= 57031 && cpNum <= 57039) return { special: true, price: 21.36, label: 'Islas Menores — Elba/Archipiélago Toscano' };
  // Isola del Giglio (Grosseto province)
  if (cpNum === 58012) return { special: true, price: 21.36, label: 'Islas Menores — Isola del Giglio' };
  // Pontine Islands: Ponza (04027), Ventotene (04028)
  if (cpNum === 4027 || cpNum === 4028) return { special: true, price: 21.36, label: 'Islas Menores — Islas Pontinas' };

  // Zona 2: Sardinia (07–09), southern Italy (70–89), Sicily (90–98)
  const ZONA2 = new Set([
    7, 8, 9,                              // Sardinia: 07xxx, 08xxx, 09xxx
    70, 71, 72, 73, 74, 75, 76,           // Puglia + part of Basilicata
    80, 81, 82, 83, 84,                   // Campania
    85,                                   // Potenza / Basilicata
    86,                                   // Campobasso / Molise
    87, 88, 89,                           // Calabria
    90, 91, 92, 93, 94, 95, 96, 97, 98,  // Sicily
  ]);
  if (ZONA2.has(prefix)) return { zone: 'Italia Zona 2' };

  // Zona 1: north + centre (00–06 Lazio/Umbria; 10–67 north, Toscana, Marche, Abruzzo)
  return { zone: 'Italia Zona 1' };
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

// Correos Express: postal code → zone name
function cpToZoneCorreosExpress(cp) {
  const cpStr = String(cp).replace(/\D/g, '').padStart(5, '0');
  const prefix = parseInt(cpStr.substring(0, 2), 10);
  const cpNum = parseInt(cpStr, 10);

  if (prefix === 30) return 'Provincial';
  if ([2, 3, 4, 46].includes(prefix)) return 'Reg.';

  // Islas Menores Baleares — before general Baleares check
  if (cpNum === 7860 || (cpNum >= 7870 && cpNum <= 7872)) return 'Islas Menores Baleares';
  if (prefix === 7) return 'Baleares Interislas';

  // Canarias islas menores — before Tnf/Lpa check
  if ((cpNum >= 35500 && cpNum <= 35660) || (cpNum >= 38700 && cpNum <= 38917)) return 'Is. Menores Canarias';
  if ((cpNum >= 35001 && cpNum <= 35489) || (cpNum >= 38001 && cpNum <= 38690)) return 'Canarias - Tnf Y Lpa';

  if (prefix === 51 || prefix === 52) return 'Ceuta y Melilla';

  // Pen.+ (zonas remotas peninsulares)
  if ([5, 6, 9, 10, 21, 22, 24, 25, 27, 32, 33, 34, 36, 37, 39, 42, 47, 49].includes(prefix)) return 'Pen. +';

  return 'Pen.';
}

// Zones for Paq Empresa 14 that are NOT covered (only Pen./Pen.+/Reg./Provincial)
const PAQ_EMPRESA_EXCLUDED_ZONES = new Set([
  'Baleares Interislas', 'Islas Menores Baleares',
  'Canarias - Tnf Y Lpa', 'Is. Menores Canarias',
  'Ceuta y Melilla',
]);

// International zone maps — keys normalized (uppercase, no accents)
const CORREOS_INTL_EXPRESS = {
  // Europa 1
  'FRANCIA': 'Europa 1', 'ALEMANIA': 'Europa 1', 'PORTUGAL': 'Europa 1',
  'ITALIA': 'Europa 1', 'BELGICA': 'Europa 1', 'HOLANDA': 'Europa 1',
  'PAISES BAJOS': 'Europa 1', 'AUSTRIA': 'Europa 1', 'LUXEMBURGO': 'Europa 1',
  'MONACO': 'Europa 1',
  // Europa 2
  'REINO UNIDO': 'Europa 2', 'GRAN BRETANA': 'Europa 2', 'IRLANDA': 'Europa 2',
  'SUIZA': 'Europa 2', 'POLONIA': 'Europa 2', 'REPUBLICA CHECA': 'Europa 2',
  'HUNGRIA': 'Europa 2', 'DINAMARCA': 'Europa 2', 'SUECIA': 'Europa 2',
  'FINLANDIA': 'Europa 2', 'NORUEGA': 'Europa 2', 'ESLOVAQUIA': 'Europa 2',
  'ESLOVENIA': 'Europa 2', 'CROACIA': 'Europa 2', 'ESTONIA': 'Europa 2',
  'LETONIA': 'Europa 2', 'LITUANIA': 'Europa 2', 'RUMANIA': 'Europa 2',
  'BULGARIA': 'Europa 2', 'GRECIA': 'Europa 2', 'CHIPRE': 'Europa 2',
  'MALTA': 'Europa 2',
  // Europa 3
  'RUSIA': 'Europa 3', 'UCRANIA': 'Europa 3', 'TURQUIA': 'Europa 3',
  'SERBIA': 'Europa 3', 'ALBANIA': 'Europa 3', 'BOSNIA': 'Europa 3',
  'MOLDAVIA': 'Europa 3', 'ISLANDIA': 'Europa 3', 'LIECHTENSTEIN': 'Europa 3',
  'ANDORRA': 'Europa 3', 'BIELORRUSIA': 'Europa 3', 'MACEDONIA': 'Europa 3',
  // Norteamérica
  'EE.UU.': 'Norteamérica', 'ESTADOS UNIDOS': 'Norteamérica',
  'CANADA': 'Norteamérica', 'MEXICO': 'Norteamérica',
  // Sudamérica
  'BRASIL': 'Sudamérica', 'ARGENTINA': 'Sudamérica', 'CHILE': 'Sudamérica',
  'COLOMBIA': 'Sudamérica', 'PERU': 'Sudamérica', 'VENEZUELA': 'Sudamérica',
  'ECUADOR': 'Sudamérica', 'URUGUAY': 'Sudamérica', 'BOLIVIA': 'Sudamérica',
  'PARAGUAY': 'Sudamérica', 'PANAMA': 'Sudamérica', 'COSTA RICA': 'Sudamérica',
  'CUBA': 'Sudamérica', 'PUERTO RICO': 'Sudamérica',
  // Oriente 1
  'JAPON': 'Oriente 1', 'CHINA': 'Oriente 1', 'HONG KONG': 'Oriente 1',
  'TAIWAN': 'Oriente 1', 'COREA DEL SUR': 'Oriente 1',
  'AUSTRALIA': 'Oriente 1', 'NUEVA ZELANDA': 'Oriente 1',
  // Oriente 2
  'INDIA': 'Oriente 2', 'PAKISTAN': 'Oriente 2', 'INDONESIA': 'Oriente 2',
  'FILIPINAS': 'Oriente 2', 'TAILANDIA': 'Oriente 2', 'VIETNAM': 'Oriente 2',
  'MALASIA': 'Oriente 2', 'SINGAPUR': 'Oriente 2', 'BANGLADESH': 'Oriente 2',
  // África
  'MARRUECOS': 'África', 'ARGELIA': 'África', 'TUNEZ': 'África',
  'EGIPTO': 'África', 'SUDAFRICA': 'África', 'NIGERIA': 'África',
  'GHANA': 'África', 'KENIA': 'África', 'SENEGAL': 'África',
  'CAMERUN': 'África', 'ANGOLA': 'África', 'ETIOPIA': 'África',
  'TANZANIA': 'África', 'MOZAMBIQUE': 'África',
};

const CORREOS_INTL_ESTANDAR = {
  // Zona 1 (same geography as Express Europa 1)
  'FRANCIA': 'Zona 1', 'ALEMANIA': 'Zona 1', 'PORTUGAL': 'Zona 1',
  'ITALIA': 'Zona 1', 'BELGICA': 'Zona 1', 'HOLANDA': 'Zona 1',
  'PAISES BAJOS': 'Zona 1', 'AUSTRIA': 'Zona 1', 'LUXEMBURGO': 'Zona 1',
  'MONACO': 'Zona 1',
  // Zona 2 (same as Europa 2)
  'REINO UNIDO': 'Zona 2', 'GRAN BRETANA': 'Zona 2', 'IRLANDA': 'Zona 2',
  'SUIZA': 'Zona 2', 'POLONIA': 'Zona 2', 'REPUBLICA CHECA': 'Zona 2',
  'HUNGRIA': 'Zona 2', 'DINAMARCA': 'Zona 2', 'SUECIA': 'Zona 2',
  'FINLANDIA': 'Zona 2', 'NORUEGA': 'Zona 2', 'ESLOVAQUIA': 'Zona 2',
  'ESLOVENIA': 'Zona 2', 'CROACIA': 'Zona 2', 'ESTONIA': 'Zona 2',
  'LETONIA': 'Zona 2', 'LITUANIA': 'Zona 2', 'RUMANIA': 'Zona 2',
  'BULGARIA': 'Zona 2', 'GRECIA': 'Zona 2', 'CHIPRE': 'Zona 2',
  'MALTA': 'Zona 2',
  // Zona 3 (same as Europa 3)
  'RUSIA': 'Zona 3', 'UCRANIA': 'Zona 3', 'TURQUIA': 'Zona 3',
  'SERBIA': 'Zona 3', 'ALBANIA': 'Zona 3', 'BOSNIA': 'Zona 3',
  'MOLDAVIA': 'Zona 3', 'ISLANDIA': 'Zona 3', 'LIECHTENSTEIN': 'Zona 3',
  'ANDORRA': 'Zona 3', 'BIELORRUSIA': 'Zona 3', 'MACEDONIA': 'Zona 3',
  // Zona 4 (Americas)
  'EE.UU.': 'Zona 4', 'ESTADOS UNIDOS': 'Zona 4', 'CANADA': 'Zona 4',
  'MEXICO': 'Zona 4', 'BRASIL': 'Zona 4', 'ARGENTINA': 'Zona 4',
  'CHILE': 'Zona 4', 'COLOMBIA': 'Zona 4', 'PERU': 'Zona 4',
  'VENEZUELA': 'Zona 4', 'ECUADOR': 'Zona 4', 'URUGUAY': 'Zona 4',
  'BOLIVIA': 'Zona 4', 'PARAGUAY': 'Zona 4', 'PANAMA': 'Zona 4',
  'COSTA RICA': 'Zona 4', 'CUBA': 'Zona 4', 'PUERTO RICO': 'Zona 4',
  // Zona 5 (Asia Pacific)
  'JAPON': 'Zona 5', 'CHINA': 'Zona 5', 'HONG KONG': 'Zona 5',
  'TAIWAN': 'Zona 5', 'COREA DEL SUR': 'Zona 5',
  'AUSTRALIA': 'Zona 5', 'NUEVA ZELANDA': 'Zona 5',
  'INDIA': 'Zona 5', 'PAKISTAN': 'Zona 5', 'INDONESIA': 'Zona 5',
  'FILIPINAS': 'Zona 5', 'TAILANDIA': 'Zona 5', 'VIETNAM': 'Zona 5',
  'MALASIA': 'Zona 5', 'SINGAPUR': 'Zona 5', 'BANGLADESH': 'Zona 5',
  'MARRUECOS': 'Zona 5', 'ARGELIA': 'Zona 5', 'TUNEZ': 'Zona 5',
  'EGIPTO': 'Zona 5',
  // Zona 6 (Rest of Africa, Middle East)
  'SUDAFRICA': 'Zona 6', 'NIGERIA': 'Zona 6', 'GHANA': 'Zona 6',
  'KENIA': 'Zona 6', 'SENEGAL': 'Zona 6', 'CAMERUN': 'Zona 6',
  'ANGOLA': 'Zona 6', 'ETIOPIA': 'Zona 6', 'TANZANIA': 'Zona 6',
  'MOZAMBIQUE': 'Zona 6',
};

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
  const { weight_kg, destination_type, postal_code, country, italian_postal_code, destination_cp } = req.body;

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
  if (destination_type === 'internacional' && country && normalize(country) === 'ITALIA' && !italian_postal_code) {
    return res.status(400).json({ error: 'Se requiere código postal (CAP) para envíos a Italia' });
  }

  const weightKg = parseFloat(weight_kg);
  const agencies = db.prepare('SELECT * FROM agencies WHERE active = 1').all();

  // Pre-resolve Italian CP → zone or special fixed price (null if not applicable)
  const italyZoneResult = (
    destination_type === 'internacional' &&
    normalize(country || '') === 'ITALIA' &&
    italian_postal_code
  ) ? cpToZoneItaly(italian_postal_code) : null;

  // Pre-resolve special destinations for France / Germany / Netherlands (optional CP)
  let specialDestResult = null;
  if (destination_type === 'internacional' && destination_cp) {
    const normC = normalize(country || '');
    if (normC === 'FRANCIA' || normC === 'MONACO' || normC === 'MONACO') {
      const r = cpToZoneFrance(destination_cp);
      if (r.special) specialDestResult = r;
    } else if (normC === 'ALEMANIA') {
      const r = cpToZoneGermany(destination_cp);
      if (r.special) specialDestResult = r;
    } else if (normC === 'HOLANDA' || normC === 'PAISES BAJOS' || normC === 'BELGICA, HOLANDA Y LUXEMBURGO') {
      const cpNum = parseInt(String(destination_cp).replace(/\D/g, ''), 10);
      if (cpNum >= 6200 && cpNum <= 6499) {
        specialDestResult = { special: true, price: 16.02, label: 'Islas de Holanda (6200–6499)' };
      }
    }
  }

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

    // Correos Express: multi-service agency, zone resolved in code (not via zone_mappings)
    if (normalize(agency.name) === 'CORREOS EXPRESS') {
      // Portuguese CPs: Correos Express nacional doesn't cover Portugal
      if (destination_type === 'nacional') {
        const cpStr = String(postal_code).replace(/\D/g, '');
        if (cpStr.length === 4) {
          notCovered.push({ agency: agency.display_name, reason: 'Correos Express: Portugal no incluido en nacional' });
          continue;
        }

        const zone = cpToZoneCorreosExpress(cpStr);
        const services = db.prepare(
          "SELECT DISTINCT service_name FROM tariff_rates WHERE agency_id = ? AND scope = 'nacional' AND service_name IS NOT NULL"
        ).all(agency.id);

        if (!services.length) {
          notCovered.push({ agency: agency.display_name, reason: 'Sin tarifas cargadas — subir Correos_2026.xlsx' });
          continue;
        }

        let addedAny = false;
        for (const { service_name } of services) {
          if (service_name === 'Paq Empresa 14' && PAQ_EMPRESA_EXCLUDED_ZONES.has(zone)) continue;

          const tiers = db.prepare(
            'SELECT * FROM tariff_rates WHERE agency_id = ? AND scope = ? AND zone = ? AND service_name = ? ORDER BY weight_max_kg ASC'
          ).all(agency.id, 'nacional', zone, service_name);
          if (!tiers.length) continue;

          const price = calculatePrice(weightKg, tiers);
          if (price === null) continue;

          results.push({
            agency_name: `${agency.display_name} — ${service_name}`,
            zone,
            weight_billed_kg: weightKg,
            price,
            scope: destination_type,
            notes: '',
          });
          addedAny = true;
        }

        if (!addedAny) {
          notCovered.push({ agency: agency.display_name, reason: 'Destino no cubierto por Correos Express' });
        }

      } else {
        // Internacional
        const normCountry = normalize(country || '');
        const services = db.prepare(
          "SELECT DISTINCT service_name FROM tariff_rates WHERE agency_id = ? AND scope = 'internacional' AND service_name IS NOT NULL"
        ).all(agency.id);

        if (!services.length) {
          notCovered.push({ agency: agency.display_name, reason: 'Sin tarifas internacionales cargadas' });
          continue;
        }

        let addedAny = false;
        for (const { service_name } of services) {
          const zoneMap = service_name === 'Internacional Express' ? CORREOS_INTL_EXPRESS : CORREOS_INTL_ESTANDAR;
          const zone = zoneMap[normCountry] || null;
          if (!zone) continue;

          const tiers = db.prepare(
            'SELECT * FROM tariff_rates WHERE agency_id = ? AND scope = ? AND zone = ? AND service_name = ? ORDER BY weight_max_kg ASC'
          ).all(agency.id, 'internacional', zone, service_name);
          if (!tiers.length) continue;

          const price = calculatePrice(weightKg, tiers);
          if (price === null) continue;

          results.push({
            agency_name: `${agency.display_name} — ${service_name}`,
            zone,
            weight_billed_kg: weightKg,
            price,
            scope: destination_type,
            notes: '',
          });
          addedAny = true;
        }

        if (!addedAny) {
          notCovered.push({ agency: agency.display_name, reason: 'País no cubierto por Correos Express' });
        }
      }
      continue;
    }

    // Italy special territory (Campione, Livigno, Islas Menores): fixed price, no tariff lookup
    if (italyZoneResult?.special) {
      if (normalize(agency.name) === 'REDUR') {
        results.push({
          agency_name: agency.display_name,
          zone: italyZoneResult.label,
          weight_billed_kg: weightKg,
          price: italyZoneResult.price,
          scope: destination_type,
          notes: 'Precio fijo — destino especial Italia',
        });
      } else {
        notCovered.push({ agency: agency.display_name, reason: 'Destino especial Italia: no cubierto por esta agencia' });
      }
      continue;
    }

    // France/Germany/Netherlands special territory: per-kg or fixed price, only Redur
    if (specialDestResult?.special) {
      if (normalize(agency.name) === 'REDUR') {
        let price;
        if (specialDestResult.price !== undefined) {
          price = specialDestResult.price; // fixed
        } else {
          price = Math.round(Math.max(weightKg * specialDestResult.rate_per_kg, specialDestResult.min_price) * 100) / 100;
        }
        results.push({
          agency_name: agency.display_name,
          zone: specialDestResult.label,
          weight_billed_kg: weightKg,
          price,
          scope: destination_type,
          notes: specialDestResult.rate_per_kg
            ? `${specialDestResult.rate_per_kg} €/kg · mín. ${specialDestResult.min_price} €`
            : 'Precio fijo — destino especial',
        });
      } else {
        notCovered.push({ agency: agency.display_name, reason: 'Destino especial: no cubierto por esta agencia' });
      }
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

    // Resolve zone — use CP-resolved Italian zone if available, else multi-zone resolution
    const zones = italyZoneResult?.zone
      ? [italyZoneResult.zone]
      : resolveAllZones(agency.id, agency.name, destination_type, postal_code, country);
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
  } // end for agency

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
    if (normalize(country) === 'ITALIA' && italian_postal_code) {
      destinationResolved = `Italia (CP ${italian_postal_code})`;
    } else {
      destinationResolved = country;
    }
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
    if (/^IT\d{2}$/.test(r.destination)) continue; // skip IT## cap prefix entries
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
