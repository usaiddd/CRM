const express = require('express');
const router = express.Router();
const db = require('../db');

// Diagnostic route
router.get('/health-check', (req, res) => res.json({ status: 'companies router ok' }));

// GET /api/companies - list companies
router.get('/', async (req, res) => {
  try {
    const result = await db.query('SELECT company_id, legal_name, brand, website, company_type, status FROM company ORDER BY company_id DESC LIMIT 100');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

// GET /api/companies/search
router.get('/search', async (req, res) => {
  const { q = '', exclude = null } = req.query;
  try {
    let sql = 'SELECT company_id as id, legal_name as name FROM company WHERE legal_name ILIKE $1';
    const values = [`%${q}%`];
    
    if (exclude) {
      sql += ' AND company_id != $2';
      values.push(parseInt(exclude, 10));
    }
    
    sql += ' ORDER BY legal_name LIMIT 20';
    
    const result = await db.query(sql, values);
    res.json(result.rows);
  } catch (err) {
    console.error('Search error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// GET /api/companies/:id/dependencies
router.get('/:id/dependencies', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid company ID' });
  
  try {
    const employees = await db.query('SELECT employee_id as id, COALESCE(first_name, \'\') || \' \' || COALESCE(last_name, \'\') as name, \'Employee\' as type FROM employee WHERE company_id = $1', [id]);
    const contacts = await db.query('SELECT contact_id as id, COALESCE(first_name, \'\') || \' \' || COALESCE(last_name, \'\') as name, \'Contact\' as type FROM contact WHERE company_id = $1', [id]);
    const tasks = await db.query('SELECT task_id as id, description as name, \'Task\' as type FROM task WHERE company_id = $1', [id]);
    const clientEngagements = await db.query('SELECT engagement_id as id, engagement_status as name, \'Engagement\' as type FROM client_engagement WHERE client_company_id = $1 OR internal_company_id = $1', [id]);
    
    res.json([...employees.rows, ...contacts.rows, ...tasks.rows, ...clientEngagements.rows]);
  } catch (err) {
    console.error('Dependency check error:', err);
    res.status(500).json({ error: 'Database error: ' + err.message });
  }
});

// POST /api/companies
router.post('/', async (req, res) => {
  const client = await db.pool.connect();
  try {
    const {
      legal_name, brand, scale, industry_id, category_id, website, linkedin_url, company_type, status,
      address, contact
    } = req.body;

    if (!legal_name) return res.status(400).json({ error: 'legal_name is required' });

    await client.query('BEGIN');
    const insertCompany = await client.query(
      `INSERT INTO company (legal_name, brand, scale, industry_id, category_id, website, linkedin_url, company_type, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [legal_name, brand || null, scale || null, industry_id || null, category_id || null, website || null, linkedin_url || null, company_type || null, status || 'setting up context']
    );
    const company = insertCompany.rows[0];

    if (address) {
      const insertAddress = await client.query(
        `INSERT INTO address (address_line1, address_line2, city, state, country, pincode)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING address_id`,
        [address.address_line1 || null, address.address_line2 || null, address.city || null, address.state || null, address.country || null, address.pincode || null]
      );
      const addressId = insertAddress.rows[0].address_id;
      await client.query('INSERT INTO company_address (company_id, address_id, address_type) VALUES ($1,$2,$3)', [company.company_id, addressId, address.address_type || 'billing']);
    }

    if (contact) {
      await client.query(
        `INSERT INTO company_contact (company_id, isd_code, area_code, phone_primary, phone_secondary, fax, email_primary, email_secondary)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [company.company_id, contact.isd_code || null, contact.area_code || null, contact.phone_primary || null, contact.phone_secondary || null, contact.fax || null, contact.email_primary || null, contact.email_secondary || null]
      );
    }

    await client.query('COMMIT');
    res.status(201).json(company);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Database error' });
  } finally {
    client.release();
  }
});

// POST /api/companies/:id/delete (with re-assignment)
router.post('/:id/delete', async (req, res) => {
  const targetId = parseInt(req.params.id, 10);
  const { assignments } = req.body;
  const client = await db.pool.connect();

  try {
    // Prevent deletion of 'Export Support' companies
    const companyCheck = await db.query('SELECT legal_name FROM company WHERE company_id = $1', [targetId]);
    if (companyCheck.rows.length > 0) {
      const name = companyCheck.rows[0].legal_name;
      if (name.toLowerCase().includes('export support')) {
        return res.status(403).json({ error: 'System Protected: Companies under "Export Support" cannot be deleted.' });
      }
    }

    await client.query('BEGIN');

    if (assignments && assignments.length > 0) {
      const groups = assignments.reduce((acc, curr) => {
        if (!acc[curr.reassignId]) acc[curr.reassignId] = { Employee: [], Contact: [], Task: [], Engagement: [] };
        if (acc[curr.reassignId][curr.recordType]) {
          acc[curr.reassignId][curr.recordType].push(curr.recordId);
        }
        return acc;
      }, {});

      for (const [reassignId, types] of Object.entries(groups)) {
        const rid = parseInt(reassignId, 10);
        if (types.Employee.length > 0) await client.query('UPDATE employee SET company_id = $1 WHERE employee_id = ANY($2)', [rid, types.Employee]);
        if (types.Contact.length > 0) await client.query('UPDATE contact SET company_id = $1 WHERE contact_id = ANY($2)', [rid, types.Contact]);
        if (types.Task.length > 0) await client.query('UPDATE task SET company_id = $1 WHERE task_id = ANY($2)', [rid, types.Task]);
        if (types.Engagement.length > 0) {
          await client.query('UPDATE client_engagement SET client_company_id = $1 WHERE client_company_id = $2 AND engagement_id = ANY($3)', [rid, targetId, types.Engagement]);
          await client.query('UPDATE client_engagement SET internal_company_id = $1 WHERE internal_company_id = $2 AND engagement_id = ANY($3)', [rid, targetId, types.Engagement]);
        }
      }
    }

    // Delete company profile, engagement, address, contact mappings
    await client.query('DELETE FROM client_profile WHERE company_id = $1', [targetId]);
    await client.query('DELETE FROM client_engagement WHERE client_company_id = $1 OR internal_company_id = $1', [targetId]);
    await client.query('DELETE FROM company_contact WHERE company_id = $1', [targetId]);
    
    const addressIds = await client.query('DELETE FROM company_address WHERE company_id = $1 RETURNING address_id', [targetId]);
    if (addressIds.rows.length > 0) {
        await client.query('DELETE FROM address WHERE address_id = ANY($1)', [addressIds.rows.map(r => r.address_id)]);
    }

    // Finally delete the company
    await client.query('DELETE FROM company WHERE company_id = $1', [targetId]);

    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Database error', details: err.message });
  } finally {
    client.release();
  }
});

// PUT /api/companies/:id/full-update - Update company with address and contact info
router.put('/:id/full-update', async (req, res) => {
  const companyId = parseInt(req.params.id, 10);
  const client = await db.pool.connect();
  
  try {
    const {
      legal_name, status, website, industry_id, category_id,
      address_line1, address_line2, city, state, country, pincode,
      phone_primary, email_primary
    } = req.body;

    
    await client.query('BEGIN');

    // 1. Update company table
    const companyUpdates = [];
    const companyValues = [];
    let companyIdx = 1;
    
    if (legal_name !== undefined && legal_name !== null) {
      companyUpdates.push(`legal_name = $${companyIdx++}`);
      companyValues.push(legal_name);
    }
    if (status !== undefined && status !== null) {
      companyUpdates.push(`status = $${companyIdx++}`);
      companyValues.push(status);
    }
    if (website !== undefined && website !== null) {
      companyUpdates.push(`website = $${companyIdx++}`);
      companyValues.push(website);
    }
    if (industry_id !== undefined) {
      companyUpdates.push(`industry_id = $${companyIdx++}`);
      companyValues.push(industry_id || null);
    }
    if (category_id !== undefined) {
      companyUpdates.push(`category_id = $${companyIdx++}`);
      companyValues.push(category_id || null);
    }
    
    if (companyUpdates.length > 0) {
      companyValues.push(companyId);
      const companySql = `UPDATE company SET ${companyUpdates.join(', ')} WHERE company_id = $${companyIdx}`;
      await client.query(companySql, companyValues);
    }

    // 2. Update company_contact if phone or email provided
    if ((phone_primary !== undefined && phone_primary !== null) || (email_primary !== undefined && email_primary !== null)) {
      const checkContact = await client.query('SELECT company_id FROM company_contact WHERE company_id = $1', [companyId]);
      
      if (checkContact.rows.length > 0) {
        // Update existing
        const contactUpdates = [];
        const contactValues = [];
        let contactIdx = 1;
        
        if (phone_primary !== undefined && phone_primary !== null) {
          contactUpdates.push(`phone_primary = $${contactIdx++}`);
          contactValues.push(phone_primary);
        }
        if (email_primary !== undefined && email_primary !== null) {
          contactUpdates.push(`email_primary = $${contactIdx++}`);
          contactValues.push(email_primary);
        }
        
        if (contactUpdates.length > 0) {
          contactValues.push(companyId);
          const contactSql = `UPDATE company_contact SET ${contactUpdates.join(', ')} WHERE company_id = $${contactIdx}`;
          await client.query(contactSql, contactValues);
        }
      } else {
        // Create new
        await client.query(
          `INSERT INTO company_contact (company_id, phone_primary, email_primary) VALUES ($1, $2, $3)`,
          [companyId, phone_primary || null, email_primary || null]
        );
      }
    }

    // 3. Update address if any address field provided
    if ((address_line1 !== undefined && address_line1 !== null) || 
        (address_line2 !== undefined && address_line2 !== null) || 
        (city !== undefined && city !== null) || 
        (state !== undefined && state !== null) || 
        (country !== undefined && country !== null) || 
        (pincode !== undefined && pincode !== null)) {
      
      // Get existing address_id if any
      const addressLink = await client.query('SELECT address_id FROM company_address WHERE company_id = $1', [companyId]);
      
      if (addressLink.rows.length > 0) {
        // Update existing address
        const addressId = addressLink.rows[0].address_id;
        const addressUpdates = [];
        const addressValues = [];
        let addressIdx = 1;
        
        if (address_line1 !== undefined && address_line1 !== null) {
          addressUpdates.push(`address_line1 = $${addressIdx++}`);
          addressValues.push(address_line1);
        }
        if (address_line2 !== undefined && address_line2 !== null) {
          addressUpdates.push(`address_line2 = $${addressIdx++}`);
          addressValues.push(address_line2);
        }
        if (city !== undefined && city !== null) {
          addressUpdates.push(`city = $${addressIdx++}`);
          addressValues.push(city);
        }
        if (state !== undefined && state !== null) {
          addressUpdates.push(`state = $${addressIdx++}`);
          addressValues.push(state);
        }
        if (country !== undefined && country !== null) {
          addressUpdates.push(`country = $${addressIdx++}`);
          addressValues.push(country);
        }
        if (pincode !== undefined && pincode !== null) {
          addressUpdates.push(`pincode = $${addressIdx++}`);
          addressValues.push(pincode);
        }
        
        if (addressUpdates.length > 0) {
          addressValues.push(addressId);
          const addressSql = `UPDATE address SET ${addressUpdates.join(', ')} WHERE address_id = $${addressIdx}`;
          await client.query(addressSql, addressValues);
        }
      } else {
        // Create new address and link it
        const newAddress = await client.query(
          `INSERT INTO address (address_line1, address_line2, city, state, country, pincode) 
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING address_id`,
          [address_line1 || null, address_line2 || null, city || null, state || null, country || null, pincode || null]
        );
        const newAddressId = newAddress.rows[0].address_id;
        await client.query(
          'INSERT INTO company_address (company_id, address_id, address_type) VALUES ($1, $2, $3)',
          [companyId, newAddressId, 'billing']
        );
      }
    }

    await client.query('COMMIT');
    res.json({ success: true, message: 'Company details updated successfully' });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Database error: ' + err.message });
  } finally {
    client.release();
  }
});

// PUT /api/companies/:id
router.put('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const fields = ['legal_name','brand','scale','industry_id','category_id','website','linkedin_url','company_type','status'];
  const updates = [];
  const values = [];
  let idx = 1;
  for (const f of fields) {
    if (req.body[f] !== undefined) {
      updates.push(`${f} = $${idx}`);
      values.push(req.body[f]);
      idx++;
    }
  }
  if (!updates.length) return res.status(400).json({ error: 'No fields to update' });
  values.push(id);
  const sql = `UPDATE company SET ${updates.join(', ')} WHERE company_id = $${idx} RETURNING *`;
  try {
    const result = await db.query(sql, values);
    if (!result.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

// DELETE /api/companies/:id (optional)
router.delete('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    await db.query('DELETE FROM company WHERE company_id = $1', [id]);
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

// GET /api/companies/:id  -- MUST BE AT THE BOTTOM --
router.get('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const result = await db.query(
      `SELECT DISTINCT ON (c.company_id)
        c.company_id, c.legal_name, c.brand, c.scale, c.industry_id, c.category_id, 
        c.website, c.linkedin_url, c.company_type, c.status, c.created_at,
        cc.isd_code, cc.area_code, cc.phone_primary, cc.phone_secondary, cc.fax, cc.email_primary, cc.email_secondary,
        a.address_line1, a.address_line2, a.city, a.state, a.country, a.pincode
       FROM company c
       LEFT JOIN company_contact cc ON c.company_id = cc.company_id
       LEFT JOIN company_address ca ON c.company_id = ca.company_id
       LEFT JOIN address a ON ca.address_id = a.address_id
       WHERE c.company_id = $1
       ORDER BY c.company_id`, [id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

module.exports = router;