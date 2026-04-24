const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
const { db } = require('../db');

const router = express.Router();

// Multer storage
const uploadsDir = path.resolve(process.env.UPLOADS_PATH || './uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: uploadsDir,
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname);
  },
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (file.originalname.endsWith('.xlsx')) cb(null, true);
    else cb(new Error('Solo se permiten archivos .xlsx'));
  },
});

// Parser registry keyed by normalized agency name + scope
function getParser(agencyName, scope) {
  const name = agencyName.toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (name === 'REDUR' && scope === 'nacional') return require('../parsers/redur_nacional');
  if (name === 'REDUR' && scope === 'internacional') return require('../parsers/redur_internacional');
  if (name === 'REDUR' && scope === 'ambas') return null; // handled specially
  if (name === 'TRANSAHER') return require('../parsers/transaher');
  if (name === 'NACEX') return require('../parsers/nacex');
  if (name.includes('PALEMA')) return require('../parsers/palemani');
  return require('../parsers/generic');
}

// GET /api/tariffs?agency_id=&scope=
router.get('/', (req, res) => {
  const { agency_id, scope } = req.query;
  if (!agency_id || !scope) {
    return res.status(400).json({ error: 'Se requieren agency_id y scope' });
  }

  const rates = db.prepare(
    'SELECT * FROM tariff_rates WHERE agency_id = ? AND scope = ? ORDER BY zone ASC, weight_max_kg ASC'
  ).all(agency_id, scope);

  const zoneMappings = db.prepare(
    'SELECT * FROM zone_mappings WHERE agency_id = ? AND scope = ? ORDER BY zone ASC, destination ASC'
  ).all(agency_id, scope);

  const lastFile = db.prepare(
    'SELECT uploaded_at, filename FROM tariff_files WHERE agency_id = ? AND (scope = ? OR scope = \'ambas\') ORDER BY uploaded_at DESC LIMIT 1'
  ).get(agency_id, scope);

  res.json({ rates, zoneMappings, lastUpdated: lastFile?.uploaded_at || null });
});

// GET /api/tariffs/export?agency_id=&scope=
router.get('/export', (req, res) => {
  const { agency_id, scope } = req.query;
  if (!agency_id || !scope) {
    return res.status(400).json({ error: 'Se requieren agency_id y scope' });
  }

  const agency = db.prepare('SELECT * FROM agencies WHERE id = ?').get(agency_id);
  if (!agency) return res.status(404).json({ error: 'Agencia no encontrada' });

  const rates = db.prepare(
    'SELECT zone, weight_max_kg, price, extra_per_kg FROM tariff_rates WHERE agency_id = ? AND scope = ? ORDER BY zone ASC, weight_max_kg ASC'
  ).all(agency_id, scope);

  const wb = XLSX.utils.book_new();
  const wsData = [['Zona', 'Peso máx (kg)', 'Precio (€)', 'Extra por kg (€)']];
  for (const r of rates) {
    wsData.push([r.zone, r.weight_max_kg, r.price, r.extra_per_kg ?? '']);
  }
  const ws = XLSX.utils.aoa_to_sheet(wsData);
  XLSX.utils.book_append_sheet(wb, ws, 'Tarifas');

  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const filename = `tarifas_${agency.name}_${scope}.xlsx`;
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buffer);
});

// POST /api/tariffs/upload
router.post('/upload', upload.single('file'), (req, res) => {
  const adminPassword = req.headers['x-admin-password'];
  if (adminPassword !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Contraseña incorrecta' });
  }

  const { agency_id, new_agency_name, scope } = req.body;
  if (!scope || !req.file) {
    return res.status(400).json({ error: 'Faltan campos requeridos (scope, file)' });
  }
  if (!agency_id && !new_agency_name) {
    return res.status(400).json({ error: 'Se requiere agency_id o new_agency_name' });
  }

  let agencyId = agency_id ? parseInt(agency_id) : null;
  let agencyName;

  try {
    if (!agencyId && new_agency_name) {
      // Create new agency
      const normalized = new_agency_name.toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
      const displayName = new_agency_name.trim().charAt(0).toUpperCase() + new_agency_name.trim().slice(1).toLowerCase();
      const result = db.prepare('INSERT INTO agencies (name, display_name) VALUES (?, ?)').run(normalized, displayName);
      agencyId = result.lastInsertRowid;
      agencyName = normalized;
    } else {
      const agency = db.prepare('SELECT * FROM agencies WHERE id = ?').get(agencyId);
      if (!agency) return res.status(404).json({ error: 'Agencia no encontrada' });
      agencyName = agency.name;
    }

    // Determine scopes to process
    const scopesToProcess = scope === 'ambas' ? ['nacional', 'internacional'] : [scope];
    let totalRecords = 0;
    let warning = null;

    const doImport = db.transaction(() => {
      for (const currentScope of scopesToProcess) {
        // Delete existing data for this agency+scope
        db.prepare('DELETE FROM tariff_rates WHERE agency_id = ? AND scope = ?').run(agencyId, currentScope);
        db.prepare('DELETE FROM zone_mappings WHERE agency_id = ? AND scope = ?').run(agencyId, currentScope);
        db.prepare('DELETE FROM tariff_files WHERE agency_id = ? AND scope = ?').run(agencyId, currentScope);

        // Get parser
        let parser;
        if (scope === 'ambas') {
          parser = getParser(agencyName, 'ambas') || require('../parsers/transaher');
        } else {
          parser = getParser(agencyName, currentScope);
        }

        let parsed;
        if (scope === 'ambas' && currentScope === 'nacional') {
          // For ambas, parse once and split by scope
          parsed = parser.parse(req.file.path);
        } else if (scope === 'ambas' && currentScope === 'internacional') {
          // Already parsed above, reuse
          parsed = parser.parse(req.file.path);
        } else {
          parsed = parser.parse(req.file.path);
        }

        if (parsed.warning) warning = parsed.warning;

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
          totalRecords++;
        }
        for (const m of filteredMappings) {
          insertMapping.run(agencyId, m.scope, m.zone, m.destination);
        }
        insertFile.run(agencyId, currentScope, req.file.filename);
      }
    });

    doImport();

    res.json({
      success: true,
      recordsInserted: totalRecords,
      warning: warning || undefined,
    });
  } catch (err) {
    console.error('[upload error]', err);
    res.status(500).json({ error: 'Error al procesar el archivo: ' + err.message });
  }
});

module.exports = router;
