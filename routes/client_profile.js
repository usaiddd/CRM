const express = require('express');
const router = express.Router();
const db = require('../db');

// GET /api/client_profile/company/:companyId - Get client profile
router.get('/company/:companyId', async (req, res) => {
  const companyId = parseInt(req.params.companyId, 10);
  try {
    const result = await db.query(
      `SELECT 
        company_id, TO_CHAR(onboard_date, 'YYYY-MM-DD') as onboard_date, primary_market, export_readiness_level, notes
       FROM client_profile
       WHERE company_id = $1`, [companyId]
    );
    res.json(result.rows.length ? result.rows[0] : null);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

// PUT /api/client_profile/company/:companyId - Update or create client profile
router.put('/company/:companyId', async (req, res) => {
  const companyId = parseInt(req.params.companyId, 10);
  const { onboard_date, primary_market, export_readiness_level, notes } = req.body;
  
  const client = await db.pool.connect();
  
  try {
    await client.query('BEGIN');
    
    // Check if profile exists
    const checkRes = await client.query(
      'SELECT company_id FROM client_profile WHERE company_id = $1',
      [companyId]
    );
    
    let result;
    
    if (checkRes.rows.length > 0) {
      // Update existing profile
      const updates = [];
      const values = [];
      let idx = 1;
      
      if (onboard_date !== undefined) {
        updates.push(`onboard_date = $${idx++}`);
        values.push(onboard_date || null);
      }
      if (primary_market !== undefined) {
        updates.push(`primary_market = $${idx++}`);
        values.push(primary_market || null);
      }
      if (export_readiness_level !== undefined) {
        updates.push(`export_readiness_level = $${idx++}`);
        values.push(export_readiness_level || null);
      }
      if (notes !== undefined) {
        updates.push(`notes = $${idx++}`);
        values.push(notes || null);
      }
      
      if (updates.length > 0) {
        values.push(companyId);
        const updateSql = `UPDATE client_profile SET ${updates.join(', ')} WHERE company_id = $${idx} RETURNING *`;
        result = await client.query(updateSql, values);
      } else {
        // No fields to update, return existing record
        result = checkRes;
      }
    } else {
      // Create new profile
      result = await client.query(
        `INSERT INTO client_profile (company_id, onboard_date, primary_market, export_readiness_level, notes)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [companyId, onboard_date || null, primary_market || null, export_readiness_level || null, notes || null]
      );
    }
    
    await client.query('COMMIT');
    res.json(result.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Database error: ' + err.message });
  } finally {
    client.release();
  }
});

// POST /api/client_profile - Create new client profile
router.post('/', async (req, res) => {
  const { company_id, onboard_date, primary_market, export_readiness_level, notes } = req.body;
  
  try {
    const result = await db.query(
      `INSERT INTO client_profile (company_id, onboard_date, primary_market, export_readiness_level, notes)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [company_id, onboard_date || null, primary_market || null, export_readiness_level || null, notes || null]
    );
    
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Database error: ' + err.message });
  }
});

module.exports = router;
