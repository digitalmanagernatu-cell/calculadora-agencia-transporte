const express = require('express');
const { db } = require('../db');

const router = express.Router();

router.get('/', (req, res) => {
  const agencies = db.prepare('SELECT * FROM agencies ORDER BY display_name ASC').all();
  res.json(agencies);
});

router.get('/:id', (req, res) => {
  const agency = db.prepare('SELECT * FROM agencies WHERE id = ?').get(req.params.id);
  if (!agency) return res.status(404).json({ error: 'Agencia no encontrada' });
  res.json(agency);
});

router.delete('/:id', (req, res) => {
  const adminPassword = req.headers['x-admin-password'];
  if (adminPassword !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Contraseña incorrecta' });
  }

  const agency = db.prepare('SELECT * FROM agencies WHERE id = ?').get(req.params.id);
  if (!agency) return res.status(404).json({ error: 'Agencia no encontrada' });

  db.transaction(() => {
    db.prepare('DELETE FROM tariff_rates WHERE agency_id = ?').run(agency.id);
    db.prepare('DELETE FROM zone_mappings WHERE agency_id = ?').run(agency.id);
    db.prepare('DELETE FROM tariff_files WHERE agency_id = ?').run(agency.id);
    db.prepare('DELETE FROM agencies WHERE id = ?').run(agency.id);
  })();

  res.json({ success: true, deleted: agency.display_name });
});

module.exports = router;
