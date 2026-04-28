const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const cors = require('cors');
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
const SEED_VERSION = 7;

// Initialize DB schema
initSchema();

// Seed PALEMANIA specifically: fires on every startup when the file is present but rates are missing.
// This lets the operator simply copy the xlsx to data/initial/ and restart, even after seed_version
// is already current.
async function seedPalemaniaIfNeeded() {
  const palFile = path.join(INITIAL_DATA_PATH, 'palemania_2026.xlsx');
  if (!fs.existsSync(palFile)) return;

  try {
    const palCount = db.prepare('SELECT COUNT(*) as c FROM palemania_rates').get().c;
    if (palCount > 0) return; // already loaded
  } catch (_) {
    return; // table may not exist yet; full seed will handle it
  }

  console.log('[seed] palemania_rates vacía pero archivo presente — cargando Palemanía...');
  try {
    db.prepare('INSERT OR IGNORE INTO agencies (name, display_name) VALUES (?, ?)').run('PALEMANIA', 'Palemanía');
    const agency = db.prepare("SELECT id FROM agencies WHERE name = 'PALEMANIA'").get();

    const parser = require('./parsers/palemania');
    const parsed = parser.parse(palFile);
    if (parsed.warning) console.warn('[seed] palemania:', parsed.warning);

    const doInsert = db.transaction(() => {
      db.prepare('DELETE FROM palemania_rates WHERE agency_id = ?').run(agency.id);
      db.prepare('DELETE FROM palemania_zone_mappings WHERE agency_id = ?').run(agency.id);
      db.prepare('DELETE FROM tariff_rates WHERE agency_id = ?').run(agency.id);
      db.prepare('DELETE FROM zone_mappings WHERE agency_id = ?').run(agency.id);
      db.prepare('DELETE FROM tariff_files WHERE agency_id = ?').run(agency.id);

      const insertRate = db.prepare(
        'INSERT INTO palemania_rates (agency_id, zone, palet_type, max_kg_per_palet, num_pales, price_per_palet) VALUES (?, ?, ?, ?, ?, ?)'
      );
      const insertMapping = db.prepare(
        'INSERT INTO palemania_zone_mappings (agency_id, zone, destination) VALUES (?, ?, ?)'
      );
      for (const r of parsed.rates) {
        insertRate.run(agency.id, r.zone, r.palet_type, r.max_kg_per_palet, r.num_pales, r.price_per_palet);
      }
      for (const m of parsed.zoneMappings) {
        insertMapping.run(agency.id, m.zone, m.destination);
      }
      db.prepare('INSERT INTO tariff_files (agency_id, scope, filename) VALUES (?, ?, ?)').run(agency.id, 'nacional', 'palemania_2026.xlsx');
    });

    doInsert();
    console.log(`[seed] Palemanía: ${parsed.rates.length} tarifas cargadas.`);
  } catch (err) {
    console.error('[seed] Error al cargar Palemanía:', err.message);
  }
}

// Seed initial data when DB is empty OR seed version has changed
async function seedInitialData() {
  const stored = db.prepare("SELECT value FROM meta WHERE key = 'seed_version'").get();
  const storedVersion = stored ? parseInt(stored.value, 10) : 0;
  const agencyCount = db.prepare('SELECT COUNT(*) as c FROM agencies').get().c;

  const needsFullSeed = agencyCount === 0 || storedVersion < SEED_VERSION;

  // PALEMANIA re-seed: runs independently whenever the file is present but rates are empty
  await seedPalemaniaIfNeeded();

  if (!needsFullSeed) return;

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
    { file: 'palemania_2026.xlsx',          agencyName: 'PALEMANIA', displayName: 'Palemanía', scope: 'nacional' },
  ];

  for (const seed of seedList) {
    // Always upsert the agency so it exists in the DB even if the file is missing
    db.prepare('INSERT OR IGNORE INTO agencies (name, display_name) VALUES (?, ?)').run(seed.agencyName, seed.displayName);

    const filePath = path.join(INITIAL_DATA_PATH, seed.file);
    if (!fs.existsSync(filePath)) {
      if (seed.agencyName === 'PALEMANIA') {
        console.warn(`[seed] ⚠️  PALEMANIA: archivo de tarifa no encontrado en ${filePath}`);
        console.warn(`[seed]    → Sin tarifas de Palemanía. Sube el archivo en Gestión de tarifas o cópialo a data/initial/.`);
      } else {
        console.warn(`[seed] Archivo no encontrado, omitiendo: ${filePath}`);
      }
      continue;
    }

    try {
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
      } else if (seed.agencyName === 'PALEMANIA') {
        parser = require('./parsers/palemania');
      } else {
        parser = require('./parsers/generic');
      }

      const parsed = parser.parse(filePath);
      if (parsed.warning) console.warn(`[seed] ${seed.file}: ${parsed.warning}`);

      if (seed.agencyName === 'PALEMANIA') {
        const doInsert = db.transaction(() => {
          db.prepare('DELETE FROM palemania_rates WHERE agency_id = ?').run(agencyId);
          db.prepare('DELETE FROM palemania_zone_mappings WHERE agency_id = ?').run(agencyId);
          db.prepare('DELETE FROM tariff_rates WHERE agency_id = ?').run(agencyId);
          db.prepare('DELETE FROM zone_mappings WHERE agency_id = ?').run(agencyId);
          db.prepare('DELETE FROM tariff_files WHERE agency_id = ?').run(agencyId);

          const insertRate = db.prepare(
            'INSERT INTO palemania_rates (agency_id, zone, palet_type, max_kg_per_palet, num_pales, price_per_palet) VALUES (?, ?, ?, ?, ?, ?)'
          );
          const insertMapping = db.prepare(
            'INSERT INTO palemania_zone_mappings (agency_id, zone, destination) VALUES (?, ?, ?)'
          );
          const insertFile = db.prepare(
            'INSERT INTO tariff_files (agency_id, scope, filename) VALUES (?, ?, ?)'
          );

          for (const r of parsed.rates) {
            insertRate.run(agencyId, r.zone, r.palet_type, r.max_kg_per_palet, r.num_pales, r.price_per_palet);
          }
          for (const m of parsed.zoneMappings) {
            insertMapping.run(agencyId, m.zone, m.destination);
          }
          insertFile.run(agencyId, 'nacional', seed.file);
        });
        doInsert();
      } else {
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
      }
      console.log(`[seed] OK: ${seed.file} (${seed.agencyName}, ${seed.scope})`);
    } catch (err) {
      console.error(`[seed] Error procesando ${seed.file}:`, err.message);
    }
  }

  db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('seed_version', ?)").run(String(SEED_VERSION));
  console.log(`[seed] Versión de datos actualizada a ${SEED_VERSION}`);

  // Post-seed diagnostic for PALEMANIA
  try {
    const palCount = db.prepare('SELECT COUNT(*) as c FROM palemania_rates').get().c;
    if (palCount === 0) {
      console.warn('[seed] ⚠️  palemania_rates está vacía. Para activar Palemanía:');
      console.warn('[seed]    1. Sube palemania_2026.xlsx desde la página Gestión de tarifas, O');
      console.warn('[seed]    2. Copia el archivo a data/initial/ y reinicia el servidor.');
    } else {
      console.log(`[seed] Palemanía: ${palCount} registros de tarifa cargados.`);
    }
  } catch (_) { /* tabla puede no existir todavía */ }
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
