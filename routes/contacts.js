const express = require('express');
const router = express.Router();
const db = require('../db');

// GET /api/contacts - list
router.get('/', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT c.*, comp.legal_name as company_name, cc.mobile_primary, cc.mobile_secondary, cc.direct_number, cc.extension, cc.email_primary, cc.email_secondary,
              cd.first_contact, cd.last_contact, cd.f_contact_mode, cd.l_contact_mode
       FROM contact c
       LEFT JOIN company comp ON c.company_id = comp.company_id
       LEFT JOIN contact_contact cc ON c.contact_id = cc.contact_id
       LEFT JOIN contact_details cd ON c.contact_id = cd.contact_id
       ORDER BY c.contact_id DESC
       LIMIT 200`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

// GET /api/contacts/company/:companyId - Get all contacts for a specific company (must come before /:id)
router.get('/company/:companyId', async (req, res) => {
  const companyId = parseInt(req.params.companyId, 10);
  try {
    const result = await db.query(
      `SELECT c.*, cc.mobile_primary, cc.mobile_secondary, cc.direct_number, cc.extension, cc.email_primary, cc.email_secondary,
              cd.first_contact, cd.last_contact, cd.f_contact_mode, cd.l_contact_mode
       FROM contact c
       LEFT JOIN contact_contact cc ON c.contact_id = cc.contact_id
       LEFT JOIN contact_details cd ON c.contact_id = cd.contact_id
       WHERE c.company_id = $1
       ORDER BY c.contact_id DESC`, [companyId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

// GET /api/contacts/:id
router.get('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const result = await db.query(
      `SELECT c.*, cc.mobile_primary, cc.mobile_secondary, cc.direct_number, cc.extension, cc.email_primary, cc.email_secondary,
              cd.first_contact, cd.last_contact, cd.f_contact_mode, cd.l_contact_mode
       FROM contact c
       LEFT JOIN contact_contact cc ON c.contact_id = cc.contact_id
       LEFT JOIN contact_details cd ON c.contact_id = cd.contact_id
       WHERE c.contact_id = $1`, [id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

// POST /api/contacts
router.post('/', async (req, res) => {
  const client = await db.pool.connect();
  try {
    const {
      company_id, salutation, first_name, middle_name, last_name, designation, department,
      linkedin_url, notes, active, contact_contact, contact_details
    } = req.body;

    await client.query('BEGIN');
    const insertContact = await client.query(
      `INSERT INTO contact (company_id, salutation, first_name, middle_name, last_name, designation, department, linkedin_url, notes, active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [company_id || null, salutation || null, first_name || null, middle_name || null, last_name || null, designation || null, department || null, linkedin_url || null, notes || null, active !== undefined ? active : true]
    );
    const contact = insertContact.rows[0];

    if (contact_contact) {
      await client.query(
        `INSERT INTO contact_contact (contact_id, mobile_primary, mobile_secondary, direct_number, extension, email_primary, email_secondary)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [contact.contact_id, contact_contact.mobile_primary || null, contact_contact.mobile_secondary || null, contact_contact.direct_number || null, contact_contact.extension || null, contact_contact.email_primary || null, contact_contact.email_secondary || null]
      );
    }

    if (contact_details) {
      await client.query(
        `INSERT INTO contact_details (contact_id, first_contact, last_contact, f_contact_mode, l_contact_mode)
         VALUES ($1,$2,$3,$4,$5)`,
        [contact.contact_id, contact_details.first_contact || null, contact_details.last_contact || null, contact_details.f_contact_mode || null, contact_details.l_contact_mode || null]
      );
    }

    await client.query('COMMIT');
    res.status(201).json(contact);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Database error' });
  } finally {
    client.release();
  }
});

// PUT /api/contacts/:id
router.put('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const client = await db.pool.connect();
  try {
    const {
      company_id, salutation, first_name, middle_name, last_name, designation, department,
      linkedin_url, notes, active, contact_contact, contact_details
    } = req.body;

    await client.query('BEGIN');

    const updateResult = await client.query(
      `UPDATE contact SET company_id=$1, salutation=$2, first_name=$3, middle_name=$4, last_name=$5, designation=$6, department=$7, linkedin_url=$8, notes=$9, active=$10
       WHERE contact_id=$11 RETURNING *`,
      [company_id || null, salutation || null, first_name || null, middle_name || null, last_name || null, designation || null, department || null, linkedin_url || null, notes || null, active !== undefined ? active : true, id]
    );

    if (!updateResult.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Not found' });
    }

    if (contact_contact) {
      // Upsert into contact_contact
      await client.query(
        `INSERT INTO contact_contact (contact_id, mobile_primary, mobile_secondary, direct_number, extension, email_primary, email_secondary)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (contact_id) DO UPDATE SET mobile_primary = EXCLUDED.mobile_primary, mobile_secondary = EXCLUDED.mobile_secondary, direct_number = EXCLUDED.direct_number, extension = EXCLUDED.extension, email_primary = EXCLUDED.email_primary, email_secondary = EXCLUDED.email_secondary`,
        [id, contact_contact.mobile_primary || null, contact_contact.mobile_secondary || null, contact_contact.direct_number || null, contact_contact.extension || null, contact_contact.email_primary || null, contact_contact.email_secondary || null]
      );
    }

    if (contact_details) {
      // Upsert into contact_details
      await client.query(
        `INSERT INTO contact_details (contact_id, first_contact, last_contact, f_contact_mode, l_contact_mode)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (contact_id) DO UPDATE SET first_contact = EXCLUDED.first_contact, last_contact = EXCLUDED.last_contact, f_contact_mode = EXCLUDED.f_contact_mode, l_contact_mode = EXCLUDED.l_contact_mode`,
        [id, contact_details.first_contact || null, contact_details.last_contact || null, contact_details.f_contact_mode || null, contact_details.l_contact_mode || null]
      );
    }

    await client.query('COMMIT');
    res.json(updateResult.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Database error' });
  } finally {
    client.release();
  }
});

// GET /api/contacts/:id/system-info
router.get('/:id/system-info', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const result = await db.query('SELECT * FROM contact_details WHERE contact_id = $1', [id]);
    if (!result.rows.length) return res.json({});
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

// DELETE /api/contacts/:id
router.delete('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    await db.query('DELETE FROM contact_contact WHERE contact_id = $1', [id]);
    await db.query('DELETE FROM contact WHERE contact_id = $1', [id]);
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

// GET /api/contacts/:id/records - Get all contact records for a specific contact
router.get('/:id/records', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const result = await db.query(
      'SELECT * FROM contact_records WHERE contact_id = $1 ORDER BY record_number DESC',
      [id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

// POST /api/contacts/records - Add a new contact record
router.post('/records', async (req, res) => {
  try {
    const { contact_id, contact_info, contact_source } = req.body;
    const cid = parseInt(contact_id, 10);
    
    if (isNaN(cid)) {
      return res.status(400).json({ error: 'Invalid contact ID' });
    }

    const result = await db.query(
      'INSERT INTO contact_records (contact_id, contact_info, contact_source) VALUES ($1, $2, $3) RETURNING *',
      [cid, contact_info, contact_source]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

module.exports = router;