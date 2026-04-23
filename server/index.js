require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const { db, initSchema } = require('./db');
const agenciesRouter = require('./routes/agencies');
const tariffsRouter = require('./routes/tariffs');
const calculatorRouter = require('./routes/calculator');

const PORT = process.env.PORT || 3001;
const UPLOADS_PATH = path.resolve(__dirname, process.env.UPLOADS_PATH || './uploads');
const INITIAL_DATA_PATH = path.resolve(__dirname, process.env.INITIAL_DATA_PATH || '../data/initial');

// Ensure uploads directory exists
if (!fs.existsSync(UPLOADS_PATH)) {
  fs.mkdirSync(UPLOADS_PATH, { recursive: true });
}

// Increment this when parsers or zone mappings change — forces a full reseed
const SEED_VERSION = 3;

// Initialize DB schema
initSchema();

// Seed initial data when DB is empty OR seed version has changed
async function seedInitialData() {
  const stored = db.prepare("SELECT value FROM meta WHERE key = 'seed_version'").get();
  const storedVersion = stored ? parseInt(stored.value, 10) : 0;
  const agencyCount = db.prepare('SELECT COUNT(*) as c FROM agencies').get().c;

  if (agencyCount > 0 && storedVersion >= SEED_VERSION) return;

  if (agencyCount === 0) {
    console.log('[seed] Base de datos vacía, importando tarifas iniciales...');
  } else {
    console.log(`[seed] Versión de datos desactualizada (${storedVersion} → ${SEED_VERSION}), re-importando...`);
  }

  const seedList = [
    { file: 'redur 2026.xlsx',               agencyName: 'REDUR',     displayName: 'Redur',    scope: 'nacional' },
    { file: 'redur internacional 2026.xlsx', agencyName: 'REDUR',     displayName: 'Redur',    scope: 'internacional' },
    { file: 'transaher 2026.xlsx',           agencyName: 'TRANSAHER', displayName: 'Transaher', scope: 'ambas' },
    { file: 'nacex 2026.xlsx',              agencyName: 'NACEX',     displayName: 'Nacex',    scope: 'nacional' },
  ];

  for (const seed of seedList) {
    const filePath = path.join(INITIAL_DATA_PATH, seed.file);
    if (!fs.existsSync(filePath)) {
      console.warn(`[seed] Archivo no encontrado, omitiendo: ${filePath}`);
      continue;
    }

    try {
      // Upsert agency (REDUR appears twice)
      db.prepare('INSERT OR IGNORE INTO agencies (name, display_name) VALUES (?, ?)').run(seed.agencyName, seed.displayName);
      const agency = db.prepare('SELECT id FROM agencies WHERE name = ?').get(seed.agencyName);
      const agencyId = agency.id;

      const scopesToProcess = seed.scope === 'ambas' ? ['nacional', 'internacional'] : [seed.scope];

      let parser;
      if (seed.agencyName === 'REDUR' && seed.scope === 'nacional') {
        parser = require('./parsers/redur_nacional');
      } else if (seed.agencyName === 'REDUR' && seed.scope === 'internacional') {
        parser = require('./parsers/redur_internacional');
      } else if (seed.agencyName === 'TRANSAHER') {
        parser = require('./parsers/transaher');
      } else if (seed.agencyName === 'NACEX') {
        parser = require('./parsers/nacex');
      } else {
        parser = require('./parsers/generic');
      }

      const parsed = parser.parse(filePath);
      if (parsed.warning) console.warn(`[seed] ${seed.file}: ${parsed.warning}`);

      const doInsert = db.transaction(() => {
        for (const currentScope of scopesToProcess) {
          db.prepare('DELETE FROM tariff_rates WHERE agency_id = ? AND scope = ?').run(agencyId, currentScope);
          db.prepare('DELETE FROM zone_mappings WHERE agency_id = ? AND scope = ?').run(agencyId, currentScope);
          db.prepare('DELETE FROM tariff_files WHERE agency_id = ? AND scope = ?').run(agencyId, currentScope);

          const filteredRates = parsed.rates.filter(r => r.scope === currentScope);
          const filteredMappings = parsed.zoneMappings.filter(m => m.scope === currentScope);

          const insertRate = db.prepare(
            'INSERT INTO tariff_rates (agency_id, scope, zone, weight_max_kg, price, extra_per_kg) VALUES (?, ?, ?, ?, ?, ?)'
          );
          const insertMapping = db.prepare(
            'INSERT INTO zone_mappings (agency_id, scope, zone, destination) VALUES (?, ?, ?, ?)'
          );
          const insertFile = db.prepare(
            'INSERT INTO tariff_files (agency_id, scope, filename) VALUES (?, ?, ?)'
          );

          for (const r of filteredRates) {
            insertRate.run(agencyId, r.scope, r.zone, r.weight_max_kg, r.price, r.extra_per_kg ?? null);
          }
          for (const m of filteredMappings) {
            insertMapping.run(agencyId, m.scope, m.zone, m.destination);
          }
          insertFile.run(agencyId, currentScope, seed.file);
        }
      });

      doInsert();
      console.log(`[seed] OK: ${seed.file} (${seed.agencyName}, ${seed.scope})`);
    } catch (err) {
      console.error(`[seed] Error procesando ${seed.file}:`, err.message);
    }
  }

  db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('seed_version', ?)").run(String(SEED_VERSION));
  console.log(`[seed] Versión de datos actualizada a ${SEED_VERSION}`);
}

seedInitialData().then(() => {
  const app = express();

  // En desarrollo: CORS para Vite dev server. En producción Express sirve el frontend directamente.
  if (process.env.NODE_ENV !== 'production') {
    app.use(cors({ origin: 'http://localhost:5173' }));
  }

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  app.use('/api/agencies', agenciesRouter);
  app.use('/api/tariffs', tariffsRouter);
  app.use('/api/calculator', calculatorRouter);

  app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

  // En producción, servir el frontend compilado de React
  if (process.env.NODE_ENV === 'production') {
    const clientDist = path.join(__dirname, '../client/dist');
    app.use(express.static(clientDist));
    app.get('*', (req, res) => {
      res.sendFile(path.join(clientDist, 'index.html'));
    });
  }

  app.listen(PORT, () => {
    console.log(`[server] Servidor escuchando en http://localhost:${PORT}`);
  });
}).catch(err => {
  console.error('[startup] Error fatal:', err);
  process.exit(1);
});
