// Correos Express — tarifa nacional hardcodeada 2026
// Origen: Las Torres de Cotillas (Murcia, CP 30xxx)
// Murcia es uniprovincial → Provincial = Regional → solo usamos Provincial y Peninsular
//
// Zonas:
//   Provincial : CP prefix 30 (Murcia)
//   Peninsular : resto de España peninsular + Baleares (01-52 excl. 30, 35, 38)
//   Canarias (35, 38) y Portugal: no cubiertos por esta tarifa
//
// Para pesos > 15 kg: precio_15kg + (peso - 15) × extra_por_kg

const TIERS = [
  { weight_max_kg:  1, Provincial: 3.24, Peninsular: 3.80 },
  { weight_max_kg:  2, Provincial: 3.40, Peninsular: 3.99 },
  { weight_max_kg:  3, Provincial: 3.60, Peninsular: 4.18 },
  { weight_max_kg:  4, Provincial: 3.77, Peninsular: 4.38 },
  { weight_max_kg:  5, Provincial: 3.90, Peninsular: 4.51 },
  { weight_max_kg: 10, Provincial: 5.09, Peninsular: 5.78 },
  { weight_max_kg: 15, Provincial: 6.18, Peninsular: 7.01, extra: { Provincial: 0.23, Peninsular: 0.31 } },
];

const ZONES = ['Provincial', 'Peninsular'];

function buildRates() {
  const rates = [];
  for (const tier of TIERS) {
    for (const zone of ZONES) {
      rates.push({
        scope: 'nacional',
        zone,
        weight_max_kg: tier.weight_max_kg,
        price: tier[zone],
        extra_per_kg: tier.extra ? tier.extra[zone] : null,
      });
    }
  }
  return rates;
}

function buildZoneMappings() {
  const mappings = [{ scope: 'nacional', zone: 'Provincial', destination: '30' }];
  for (let i = 1; i <= 52; i++) {
    if (i === 30) continue;   // Provincial
    if (i === 35 || i === 38) continue; // Canarias — no cubierto
    mappings.push({ scope: 'nacional', zone: 'Peninsular', destination: String(i).padStart(2, '0') });
  }
  return mappings;
}

function parse() {
  return { rates: buildRates(), zoneMappings: buildZoneMappings() };
}

module.exports = { parse };
