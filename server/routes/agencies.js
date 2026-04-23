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

module.exports = router;
