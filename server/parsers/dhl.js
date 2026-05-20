// DHL — tarifa nacional hardcodeada 2026
// Origen: Las Torres de Cotillas (Murcia, CP 30xxx)
//
// Zonas:
//   Provincial : CP prefix 30 (Murcia)
//   Peninsular : resto de España peninsular (01-52 excl. 07, 30, 35, 38)
//   Baleares   : CP prefix 07
//   Portugal   : CPs de 4 dígitos (PT + 2 primeros dígitos)
//
// Para pesos > 1000 kg: precio_1000kg + (peso - 1000) × extra_por_kg
// La fila "€ adicional por cada 100 kg" se divide entre 100 para obtener el valor por kg.

const ZONES = ['Provincial', 'Peninsular', 'Baleares', 'Portugal'];

const TIERS = [
  { weight_max_kg:    3, Provincial:   3.92, Peninsular:   3.97, Baleares:   6.42, Portugal:   5.33 },
  { weight_max_kg:    5, Provincial:   4.13, Peninsular:   4.24, Baleares:   6.85, Portugal:   5.69 },
  { weight_max_kg:   10, Provincial:   4.37, Peninsular:   6.10, Baleares:   9.87, Portugal:   8.21 },
  { weight_max_kg:   15, Provincial:   4.56, Peninsular:   7.44, Baleares:  12.04, Portugal:  10.01 },
  { weight_max_kg:   20, Provincial:   4.75, Peninsular:   8.78, Baleares:  14.20, Portugal:  11.80 },
  { weight_max_kg:   25, Provincial:   5.32, Peninsular:  10.08, Baleares:  16.31, Portugal:  13.55 },
  { weight_max_kg:   30, Provincial:   5.88, Peninsular:  11.38, Baleares:  18.41, Portugal:  15.29 },
  { weight_max_kg:   40, Provincial:   7.02, Peninsular:  13.84, Baleares:  22.38, Portugal:  18.60 },
  { weight_max_kg:   50, Provincial:   8.01, Peninsular:  15.82, Baleares:  25.61, Portugal:  21.29 },
  { weight_max_kg:   60, Provincial:   9.17, Peninsular:  17.85, Baleares:  28.86, Portugal:  23.99 },
  { weight_max_kg:   70, Provincial:  10.21, Peninsular:  19.86, Baleares:  32.12, Portugal:  26.72 },
  { weight_max_kg:   80, Provincial:  11.61, Peninsular:  30.39, Baleares:  49.17, Portugal:  40.88 },
  { weight_max_kg:   90, Provincial:  16.09, Peninsular:  33.07, Baleares:  53.48, Portugal:  44.48 },
  { weight_max_kg:  100, Provincial:  17.49, Peninsular:  36.00, Baleares:  58.23, Portugal:  48.42 },
  { weight_max_kg:  125, Provincial:  19.76, Peninsular:  40.93, Baleares:  66.24, Portugal:  55.06 },
  { weight_max_kg:  150, Provincial:  23.09, Peninsular:  47.68, Baleares:  77.12, Portugal:  64.09 },
  { weight_max_kg:  175, Provincial:  27.03, Peninsular:  55.76, Baleares:  90.18, Portugal:  74.96 },
  { weight_max_kg:  200, Provincial:  30.26, Peninsular:  62.38, Baleares: 100.91, Portugal:  83.90 },
  { weight_max_kg:  250, Provincial:  34.39, Peninsular:  71.06, Baleares: 114.89, Portugal:  95.51 },
  { weight_max_kg:  300, Provincial:  38.74, Peninsular:  80.27, Baleares: 129.81, Portugal: 107.92 },
  { weight_max_kg:  400, Provincial:  57.63, Peninsular: 120.83, Baleares: 195.40, Portugal: 162.46 },
  { weight_max_kg:  500, Provincial:  68.46, Peninsular: 144.59, Baleares: 233.82, Portugal: 194.41 },
  { weight_max_kg:  600, Provincial:  78.88, Peninsular: 178.41, Baleares: 288.48, Portugal: 239.83 },
  { weight_max_kg:  700, Provincial:  89.00, Peninsular: 202.96, Baleares: 328.21, Portugal: 272.91 },
  { weight_max_kg:  800, Provincial:  98.71, Peninsular: 227.85, Baleares: 368.46, Portugal: 306.33 },
  { weight_max_kg:  900, Provincial: 109.13, Peninsular: 253.06, Baleares: 409.26, Portugal: 340.25 },
  { weight_max_kg: 1000, Provincial: 120.71, Peninsular: 281.83, Baleares: 455.78, Portugal: 378.92,
    extra: { Provincial: 0.2186, Peninsular: 0.4044, Baleares: 0.6489, Portugal: 0.4168 } },
];

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
  const mappings = [];

  // Provincial: Murcia (CP prefix 30)
  mappings.push({ scope: 'nacional', zone: 'Provincial', destination: '30' });

  // Baleares: CP prefix 07
  mappings.push({ scope: 'nacional', zone: 'Baleares', destination: '07' });

  // Peninsular: 01-52 excl. 07 (Baleares), 30 (Provincial), 35 y 38 (Canarias, no cubierto)
  for (let i = 1; i <= 52; i++) {
    if (i === 7)  continue; // Baleares
    if (i === 30) continue; // Provincial
    if (i === 35 || i === 38) continue; // Canarias
    mappings.push({ scope: 'nacional', zone: 'Peninsular', destination: String(i).padStart(2, '0') });
  }

  // Portugal: CPs de 4 dígitos → prefijo de 2 dígitos (10-99)
  for (let i = 10; i <= 99; i++) {
    mappings.push({ scope: 'nacional', zone: 'Portugal', destination: 'PT' + String(i) });
  }

  return mappings;
}

function parse() {
  return { rates: buildRates(), zoneMappings: buildZoneMappings() };
}

module.exports = { parse };
