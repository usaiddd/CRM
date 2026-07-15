require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const session = require('express-session');
const db = require('./db');

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
    secret: process.env.SESSION_SECRET || 'supersecret',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false } // Set to true if using HTTPS, but false is fine for now
}));

// Serve static files (CSS, JS, frontend assets) from the root directory
app.use(express.static(path.join(__dirname)));

// Middleware to protect agent portal routes
function requireAgentLogin(req, res, next) {
  if (req.session && req.session.agent) {
    return next();
  }
  res.redirect('/templates/agent_login.html');
}

// ==========================================
// 🔐 AGENT ROUTER
// ==========================================
const agentRouter = express.Router();

agentRouter.post('/login', async (req, res) => {
  const { user_login, password } = req.body;
  if (!user_login || !password) {
    return res.status(400).json({ success: false, message: 'Missing credentials' });
  }
  try {
    const userResult = await db.query(
      'SELECT user_login, id_admin FROM emp_login WHERE user_login = $1',
      [user_login]
    );
    if (userResult.rows.length === 0) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }
    const user = userResult.rows[0];
    const storedPasswordResult = await db.query(
      'SELECT password FROM emp_login WHERE user_login = $1',
      [user_login]
    );
    const storedHash = storedPasswordResult.rows[0].password;
    const matchResult = await db.query(
      'SELECT $1::text = crypt($2::text, $1::text) as matches',
      [storedHash, password]
    );
    if (!matchResult.rows[0].matches) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }
    const isAdmin = user.id_admin === true;
    req.session.agent = user.user_login;
    req.session.isAdmin = isAdmin;
    res.json({ success: true, isAdmin: isAdmin });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

agentRouter.post('/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

agentRouter.get('/me', async (req, res) => {
  if (!req.session.agent) {
    return res.status(401).json({ success: false, message: 'Not logged in' });
  }
  try {
    const result = await db.query(
      `SELECT e.*, 
              d.name as department_name, 
              dsg.name as designation_name,
              ec.mobile_primary, ec.email_primary, ec.current_address,
              el.id_admin 
       FROM employee e
       JOIN emplog m ON e.employee_id = m.emp_id
       JOIN emp_login el ON m.user_login = el.user_login
       LEFT JOIN department d ON e.department_id = d.department_id
       LEFT JOIN designation dsg ON e.designation_id = dsg.designation_id
       LEFT JOIN employee_contact ec ON e.employee_id = ec.employee_id
       WHERE el.user_login = $1`,
      [req.session.agent]
    );
    if (result.rows.length === 0) {
      return res.json({ 
        success: true, 
        user: { 
          first_name: req.session.agent, 
          last_name: '', 
          id_admin: req.session.isAdmin,
          status: 'Active'
        } 
      });
    }
    res.json({ success: true, user: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ==========================================
// 🏢 COMPANIES ROUTER
// ==========================================
const companiesRouter = express.Router();

companiesRouter.get('/health-check', (req, res) => res.json({ status: 'companies router ok' }));

companiesRouter.get('/', async (req, res) => {
  try {
    const result = await db.query('SELECT company_id, legal_name, brand, website, company_type, status FROM company ORDER BY company_id DESC LIMIT 100');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

companiesRouter.get('/search', async (req, res) => {
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

companiesRouter.get('/:id/dependencies', async (req, res) => {
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

companiesRouter.post('/', async (req, res) => {
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

companiesRouter.post('/:id/delete', async (req, res) => {
  const targetId = parseInt(req.params.id, 10);
  const { assignments } = req.body;
  const client = await db.pool.connect();
  try {
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
    await client.query('DELETE FROM client_profile WHERE company_id = $1', [targetId]);
    await client.query('DELETE FROM client_engagement WHERE client_company_id = $1 OR internal_company_id = $1', [targetId]);
    await client.query('DELETE FROM company_contact WHERE company_id = $1', [targetId]);
    const addressIds = await client.query('DELETE FROM company_address WHERE company_id = $1 RETURNING address_id', [targetId]);
    if (addressIds.rows.length > 0) {
        await client.query('DELETE FROM address WHERE address_id = ANY($1)', [addressIds.rows.map(r => r.address_id)]);
    }
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

companiesRouter.put('/:id/full-update', async (req, res) => {
  const companyId = parseInt(req.params.id, 10);
  const client = await db.pool.connect();
  try {
    const {
      legal_name, status, website, industry_id, category_id,
      address_line1, address_line2, city, state, country, pincode,
      phone_primary, email_primary
    } = req.body;
    await client.query('BEGIN');
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
    if ((phone_primary !== undefined && phone_primary !== null) || (email_primary !== undefined && email_primary !== null)) {
      const checkContact = await client.query('SELECT company_id FROM company_contact WHERE company_id = $1', [companyId]);
      if (checkContact.rows.length > 0) {
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
        await client.query(
          `INSERT INTO company_contact (company_id, phone_primary, email_primary) VALUES ($1, $2, $3)`,
          [companyId, phone_primary || null, email_primary || null]
        );
      }
    }
    if ((address_line1 !== undefined && address_line1 !== null) || 
        (address_line2 !== undefined && address_line2 !== null) || 
        (city !== undefined && city !== null) || 
        (state !== undefined && state !== null) || 
        (country !== undefined && country !== null) || 
        (pincode !== undefined && pincode !== null)) {
      const addressLink = await client.query('SELECT address_id FROM company_address WHERE company_id = $1', [companyId]);
      if (addressLink.rows.length > 0) {
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

companiesRouter.put('/:id', async (req, res) => {
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

companiesRouter.delete('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    await db.query('DELETE FROM company WHERE company_id = $1', [id]);
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

companiesRouter.get('/:id', async (req, res) => {
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

// ==========================================
// 👤 CONTACTS ROUTER
// ==========================================
const contactsRouter = express.Router();

contactsRouter.get('/', async (req, res) => {
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

contactsRouter.get('/company/:companyId', async (req, res) => {
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

contactsRouter.get('/:id', async (req, res) => {
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

contactsRouter.post('/', async (req, res) => {
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

contactsRouter.put('/:id', async (req, res) => {
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
      await client.query(
        `INSERT INTO contact_contact (contact_id, mobile_primary, mobile_secondary, direct_number, extension, email_primary, email_secondary)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (contact_id) DO UPDATE SET mobile_primary = EXCLUDED.mobile_primary, mobile_secondary = EXCLUDED.mobile_secondary, direct_number = EXCLUDED.direct_number, extension = EXCLUDED.extension, email_primary = EXCLUDED.email_primary, email_secondary = EXCLUDED.email_secondary`,
        [id, contact_contact.mobile_primary || null, contact_contact.mobile_secondary || null, contact_contact.direct_number || null, contact_contact.extension || null, contact_contact.email_primary || null, contact_contact.email_secondary || null]
      );
    }
    if (contact_details) {
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

contactsRouter.get('/:id/system-info', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const result = await db.query('SELECT * FROM contact_details WHERE contact_id = $1', [id]);
    if (!result.rows.length) return res.json({});
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

contactsRouter.delete('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    await db.query('DELETE FROM contact_contact WHERE contact_id = $1', [id]);
    await db.query('DELETE FROM contact WHERE contact_id = $1', [id]);
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

contactsRouter.get('/:id/records', async (req, res) => {
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

contactsRouter.post('/records', async (req, res) => {
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

// ==========================================
// 📝 TASKS ROUTER
// ==========================================
const tasksRouter = express.Router();

tasksRouter.get('/', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT t.*, ts.status_name, 
             c.legal_name as company_name,
             con.first_name, con.last_name,
             e1.first_name as creator_first, e1.last_name as creator_last,
             e2.first_name as assignee_first, e2.last_name as assignee_last
      FROM task t 
      LEFT JOIN task_status ts ON t.status_id = ts.status_id 
      LEFT JOIN company c ON t.company_id = c.company_id
      LEFT JOIN contact con ON t.contact_id = con.contact_id
      LEFT JOIN employee e1 ON t.created_by = e1.employee_id
      LEFT JOIN employee e2 ON t.assigned_to = e2.employee_id
      ORDER BY t.task_id DESC 
      LIMIT 200
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

tasksRouter.post('/', async (req, res) => {
  const { company_id, contact_id, created_by, assigned_to, due_date, estimated_completion, actual_completion, action_date, action_taken, status_id, description } = req.body;
  try {
    const result = await db.query(
      `INSERT INTO task (company_id, contact_id, created_by, assigned_to, due_date, estimated_completion, actual_completion, action_date, action_taken, status_id, description)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [company_id || null, contact_id || null, created_by || null, assigned_to || null, due_date || null, estimated_completion || null, actual_completion || null, action_date || null, action_taken || null, status_id || null, description || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

tasksRouter.put('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const fields = ['company_id','contact_id','created_by','due_date','estimated_completion','actual_completion','action_date','action_taken','status_id','description'];
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
  const sql = `UPDATE task SET ${updates.join(', ')} WHERE task_id = $${idx} RETURNING *`;
  try {
    const result = await db.query(sql, values);
    if (!result.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

// ==========================================
// 🏷️ METADATA ROUTER
// ==========================================
const metadataRouter = express.Router();

metadataRouter.get('/industries', async (req, res) => {
  try {
    const result = await db.query('SELECT industry_id, industry_name FROM industry ORDER BY industry_name');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

metadataRouter.get('/industries/recent', async (req, res) => {
  try {
    const result = await db.query('SELECT industry_id, industry_name FROM industry ORDER BY industry_id DESC LIMIT 10');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

metadataRouter.get('/categories', async (req, res) => {
  try {
    const result = await db.query('SELECT category_id, category_name FROM category ORDER BY category_name');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

metadataRouter.get('/categories/recent', async (req, res) => {
  try {
    const result = await db.query('SELECT category_id, category_name FROM category ORDER BY category_id DESC LIMIT 10');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

metadataRouter.post('/industries', async (req, res) => {
  const { industry_name } = req.body;
  if (!industry_name) return res.status(400).json({ error: 'industry_name required' });
  try {
    const result = await db.query('INSERT INTO industry (industry_name) VALUES ($1) RETURNING *', [industry_name]);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

metadataRouter.post('/categories', async (req, res) => {
  const { category_name } = req.body;
  if (!category_name) return res.status(400).json({ error: 'category_name required' });
  try {
    const result = await db.query('INSERT INTO category (category_name) VALUES ($1) RETURNING *', [category_name]);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

metadataRouter.get('/departments', async (req, res) => {
  try {
    const result = await db.query('SELECT department_id, name FROM department ORDER BY name');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

metadataRouter.get('/departments/recent', async (req, res) => {
  try {
    const result = await db.query('SELECT department_id, name FROM department ORDER BY department_id DESC LIMIT 10');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

metadataRouter.post('/departments', async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  try {
    const result = await db.query('INSERT INTO department (name) VALUES ($1) RETURNING *', [name]);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

metadataRouter.get('/designations', async (req, res) => {
  try {
    const result = await db.query('SELECT designation_id, name FROM designation ORDER BY name');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

metadataRouter.get('/designations/recent', async (req, res) => {
  try {
    const result = await db.query('SELECT designation_id, name FROM designation ORDER BY designation_id DESC LIMIT 10');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

metadataRouter.post('/designations', async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  try {
    const result = await db.query('INSERT INTO designation (name) VALUES ($1) RETURNING *', [name]);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

metadataRouter.get('/hsn', async (req, res) => {
  try {
    const result = await db.query('SELECT hsn_id, hsn_code, description FROM hsn WHERE active = TRUE ORDER BY hsn_code');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

metadataRouter.get('/sales_stages', async (req, res) => {
  try {
    const result = await db.query('SELECT sales_stage_id, stage_name FROM sales_stage ORDER BY sequence');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

metadataRouter.get('/:type/search', async (req, res) => {
  const { type } = req.params;
  const { q = '' } = req.query;
  let query = '';
  let params = [`%${q}%`];
  if (type === 'industries') {
    query = 'SELECT industry_id as id, industry_name as name FROM industry WHERE industry_name ILIKE $1 AND industry_name NOT ILIKE \'Default %\'';
  } else if (type === 'categories') {
    query = 'SELECT category_id as id, category_name as name FROM category WHERE category_name ILIKE $1 AND category_name NOT ILIKE \'Default %\'';
  } else if (type === 'departments') {
    query = 'SELECT department_id as id, name FROM department WHERE name ILIKE $1 AND name NOT ILIKE \'Default %\'';
  } else if (type === 'designations') {
    query = 'SELECT designation_id as id, name FROM designation WHERE name ILIKE $1 AND name NOT ILIKE \'Default %\'';
  } else {
    return res.status(400).json({ error: 'Invalid utility type' });
  }
  try {
    const result = await db.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

metadataRouter.get('/:type/:id/dependencies', async (req, res) => {
  const { type, id } = req.params;
  const targetId = parseInt(id, 10);
  let dependencies = [];
  try {
    if (type === 'industries') {
      const companies = await db.query('SELECT company_id as id, legal_name as name, \'Company\' as type FROM company WHERE industry_id = $1', [targetId]);
      const products = await db.query('SELECT p.product_id as id, p.product_name as name, \'Product\' as type FROM product p JOIN product_industry pi ON p.product_id = pi.product_id WHERE pi.industry_id = $1', [targetId]);
      dependencies = [...companies.rows, ...products.rows];
    } else if (type === 'categories') {
      const companies = await db.query('SELECT company_id as id, legal_name as name, \'Company\' as type FROM company WHERE category_id = $1', [targetId]);
      dependencies = companies.rows;
    } else if (type === 'departments') {
      const employees = await db.query('SELECT employee_id as id, first_name || \' \' || last_name as name, \'Employee\' as type FROM employee WHERE department_id = $1', [targetId]);
      dependencies = employees.rows;
    } else if (type === 'designations') {
      const employees = await db.query('SELECT employee_id as id, first_name || \' \' || last_name as name, \'Employee\' as type FROM employee WHERE designation_id = $1', [targetId]);
      dependencies = employees.rows;
    }
    res.json(dependencies);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

metadataRouter.post('/:type/:id/delete', async (req, res) => {
  const { type, id } = req.params;
  const { assignments } = req.body;
  const targetId = parseInt(id, 10);
  try {
    await db.query('BEGIN');
    if (assignments && assignments.length > 0) {
      const groups = assignments.reduce((acc, curr) => {
        if (!acc[curr.reassignId]) acc[curr.reassignId] = { Company: [], Employee: [], Product: [] };
        const rType = curr.recordType || (type === 'industries' || type === 'categories' ? 'Company' : 'Employee');
        if (acc[curr.reassignId][rType]) {
          acc[curr.reassignId][rType].push(curr.recordId);
        }
        return acc;
      }, {});
      for (const [reassignId, types] of Object.entries(groups)) {
        if (type === 'industries') {
          if (types.Company.length > 0) {
            await db.query('UPDATE company SET industry_id = $1 WHERE company_id = ANY($2)', [reassignId, types.Company]);
          }
          if (types.Product.length > 0) {
            for (const pid of types.Product) {
              await db.query('INSERT INTO product_industry (product_id, industry_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [pid, reassignId]);
            }
            await db.query('DELETE FROM product_industry WHERE industry_id = $1 AND product_id = ANY($2)', [targetId, types.Product]);
          }
        } else if (type === 'categories') {
          if (types.Company.length > 0) await db.query('UPDATE company SET category_id = $1 WHERE company_id = ANY($2)', [reassignId, types.Company]);
        } else if (type === 'departments') {
          if (types.Employee.length > 0) await db.query('UPDATE employee SET department_id = $1 WHERE employee_id = ANY($2)', [reassignId, types.Employee]);
        } else if (type === 'designations') {
          if (types.Employee.length > 0) await db.query('UPDATE employee SET designation_id = $1 WHERE employee_id = ANY($2)', [reassignId, types.Employee]);
        }
      }
    }
    if (type === 'industries') {
      await db.query('DELETE FROM product_industry WHERE industry_id = $1', [targetId]);
      await db.query('DELETE FROM industry WHERE industry_id = $1', [targetId]);
    } else if (type === 'categories') {
      await db.query('DELETE FROM category WHERE category_id = $1', [targetId]);
    } else if (type === 'departments') {
      await db.query('DELETE FROM department WHERE department_id = $1', [targetId]);
    } else if (type === 'designations') {
      await db.query('DELETE FROM designation WHERE designation_id = $1', [targetId]);
    }
    await db.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await db.query('ROLLBACK');
    console.error('Deletion error:', err);
    res.status(500).json({ error: 'Database error during deletion', details: err.message });
  }
});

// ==========================================
// 📦 PRODUCTS ROUTER
// ==========================================
const productsRouter = express.Router();

productsRouter.get('/', async (req, res) => {
  try {
    const search = req.query.search;
    let result;
    if (search) {
      result = await db.query(
        `SELECT p.*, h.hsn_code, h.description as hsn_description
         FROM product p
         LEFT JOIN hsn h ON p.hsn_id = h.hsn_id
         WHERE p.product_name ILIKE $1
         ORDER BY p.product_id DESC
         LIMIT 200`, [`%${search}%`]
      );
    } else {
      result = await db.query(
        `SELECT p.*, h.hsn_code, h.description as hsn_description
         FROM product p
         LEFT JOIN hsn h ON p.hsn_id = h.hsn_id
         ORDER BY p.product_id DESC
         LIMIT 200`
      );
    }
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

productsRouter.get('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const productRes = await db.query(
      `SELECT p.*, h.hsn_code, h.description as hsn_description FROM product p LEFT JOIN hsn h ON p.hsn_id=h.hsn_id WHERE p.product_id=$1`,
      [id]
    );
    if (!productRes.rows.length) return res.status(404).json({ error: 'Not found' });
    const industriesRes = await db.query('SELECT industry_id FROM product_industry WHERE product_id=$1', [id]);
    const product = productRes.rows[0];
    product.industry_ids = industriesRes.rows.map(r => r.industry_id);
    res.json(product);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

productsRouter.post('/', async (req, res) => {
  const { product_name, hsn_id, hsn_code, hsn_description, industry_ids } = req.body;
  if (!product_name) return res.status(400).json({ error: 'product_name required' });
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    let finalHsnId = null;
    if (hsn_code) {
      const up = await client.query(
        `INSERT INTO hsn (hsn_code, description, active) VALUES ($1,$2,TRUE)
         ON CONFLICT (hsn_code) DO UPDATE SET description = COALESCE(EXCLUDED.description, hsn.description)
         RETURNING hsn_id`,
        [hsn_code, hsn_description || null]
      );
      finalHsnId = up.rows[0].hsn_id;
    } else if (hsn_id) {
      const h = await client.query('SELECT hsn_id FROM hsn WHERE hsn_id=$1 AND active=TRUE', [hsn_id]);
      if (!h.rowCount) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Invalid hsn_id' });
      }
      finalHsnId = hsn_id;
    }
    if (Array.isArray(industry_ids) && industry_ids.length) {
      const ind = await client.query('SELECT industry_id FROM industry WHERE industry_id = ANY($1::int[])', [industry_ids]);
      if (ind.rowCount !== industry_ids.length) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'One or more industry_ids are invalid' });
      }
    }
    const insertRes = await client.query(
      `INSERT INTO product (product_name, hsn_id, active) VALUES ($1,$2,$3) RETURNING *`,
      [product_name, finalHsnId, true]
    );
    const product = insertRes.rows[0];
    if (Array.isArray(industry_ids) && industry_ids.length) {
      const insertVals = industry_ids.map((id, idx) => `($1, $${idx + 2})`).join(',');
      const params = [product.product_id, ...industry_ids];
      await client.query(`INSERT INTO product_industry (product_id, industry_id) VALUES ${insertVals}`, params);
    }
    await client.query('COMMIT');
    res.status(201).json(product);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Database error' });
  } finally {
    client.release();
  }
});

productsRouter.put('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { product_name, hsn_id, hsn_code, hsn_description, active, industry_ids } = req.body;
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    let finalHsnId = null;
    if (hsn_code) {
      const up = await client.query(
        `INSERT INTO hsn (hsn_code, description, active) VALUES ($1,$2,TRUE)
         ON CONFLICT (hsn_code) DO UPDATE SET description = COALESCE(EXCLUDED.description, hsn.description)
         RETURNING hsn_id`,
        [hsn_code, hsn_description || null]
      );
      finalHsnId = up.rows[0].hsn_id;
    } else if (hsn_id) {
      const h = await client.query('SELECT hsn_id FROM hsn WHERE hsn_id=$1 AND active=TRUE', [hsn_id]);
      if (!h.rowCount) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Invalid hsn_id' });
      }
      finalHsnId = hsn_id;
    }
    if (Array.isArray(industry_ids) && industry_ids.length) {
      const ind = await client.query('SELECT industry_id FROM industry WHERE industry_id = ANY($1::int[])', [industry_ids]);
      if (ind.rowCount !== industry_ids.length) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'One or more industry_ids are invalid' });
      }
    }
    const updateRes = await client.query(
      `UPDATE product SET product_name=$1, hsn_id=$2, active=$3 WHERE product_id=$4 RETURNING *`,
      [product_name || null, finalHsnId || null, active !== undefined ? active : true, id]
    );
    if (!updateRes.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Not found' });
    }
    if (Array.isArray(industry_ids)) {
      await client.query('DELETE FROM product_industry WHERE product_id=$1', [id]);
      if (industry_ids.length) {
        const insertVals = industry_ids.map((_, idx) => `($1, $${idx + 2})`).join(',');
        const params = [id, ...industry_ids];
        await client.query(`INSERT INTO product_industry (product_id, industry_id) VALUES ${insertVals}`, params);
      }
    }
    await client.query('COMMIT');
    res.json(updateRes.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Database error' });
  } finally {
    client.release();
  }
});

productsRouter.delete('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    await db.query('DELETE FROM product_industry WHERE product_id = $1', [id]);
    await db.query('DELETE FROM product WHERE product_id = $1', [id]);
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

// ==========================================
// 👷 EMPLOYEES ROUTER
// ==========================================
const employeesRouter = express.Router();

employeesRouter.post('/', async (req, res) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const {
      first_name,
      middle_name,
      last_name,
      aadhaar_number,
      date_of_birth,
      blood_group,
      company_id,
      department_id,
      designation_id,
      date_of_joining,
      date_of_resigning,
      last_working_date,
      status,
      mobile_primary,
      mobile_secondary,
      email_primary,
      email_secondary,
      home_phone,
      current_address,
      permanent_address,
      user_login,
      password,
      id_admin
    } = req.body;
    const nullIfEmpty = (val) => (val === '' || val === null || val === undefined) ? null : val;
    if (!first_name?.trim() || !last_name?.trim() || !mobile_primary?.trim() || !email_primary?.trim() || !user_login?.trim() || !password?.trim()) {
      await client.query('ROLLBACK');
      return res.status(400).json({ 
        error: 'Missing required fields: first_name, last_name, mobile_primary, email_primary, user_login, password' 
      });
    }
    const loginResult = await client.query(
      'INSERT INTO emp_login (user_login, password, id_admin) VALUES ($1, $2, $3) RETURNING *',
      [user_login.trim(), password.trim(), id_admin === 'true' || id_admin === true]
    );
    const employeeResult = await client.query(
      `INSERT INTO employee (company_id, first_name, middle_name, last_name, aadhaar_number, 
       date_of_birth, blood_group, date_of_joining, date_of_resigning, last_working_date, 
       department_id, designation_id, status) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING employee_id`,
      [
        nullIfEmpty(company_id),
        first_name.trim(),
        nullIfEmpty(middle_name),
        last_name.trim(),
        nullIfEmpty(aadhaar_number),
        nullIfEmpty(date_of_birth),
        nullIfEmpty(blood_group),
        nullIfEmpty(date_of_joining),
        nullIfEmpty(date_of_resigning),
        nullIfEmpty(last_working_date),
        nullIfEmpty(department_id),
        nullIfEmpty(designation_id),
        status || 'active'
      ]
    );
    const employee_id = employeeResult.rows[0].employee_id;
    await client.query(
      `INSERT INTO employee_contact (employee_id, mobile_primary, mobile_secondary, 
       email_primary, email_secondary, home_phone, current_address, permanent_address) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        employee_id,
        mobile_primary.trim(),
        nullIfEmpty(mobile_secondary),
        email_primary.trim(),
        nullIfEmpty(email_secondary),
        nullIfEmpty(home_phone),
        nullIfEmpty(current_address),
        nullIfEmpty(permanent_address)
      ]
    );
    await client.query(
      'INSERT INTO emplog (user_login, emp_id) VALUES ($1, $2)',
      [user_login.trim(), employee_id]
    );
    await client.query('COMMIT');
    res.status(201).json({
      success: true,
      message: 'Employee created successfully',
      employee_id: employee_id,
      user_login: user_login,
      employee_name: `${first_name} ${last_name}`
    });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') {
      return res.status(400).json({ 
        error: 'Duplicate entry: This username or aadhaar number already exists' 
      });
    }
    if (err.code === '23503') {
      return res.status(400).json({ 
        error: 'Invalid reference: Company, Department, or Designation not found' 
      });
    }
    res.status(500).json({ error: 'Database error: ' + err.message });
  } finally {
    client.release();
  }
});

employeesRouter.get('/:id', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT e.*, ec.* FROM employee e 
       LEFT JOIN employee_contact ec ON e.employee_id = ec.employee_id 
       WHERE e.employee_id = $1`,
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Employee not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

employeesRouter.get('/', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT e.employee_id, e.first_name, e.last_name, e.company_id, 
              d.name as department_name, dsg.name as designation_name, 
              e.status, e.created_at
       FROM employee e
       LEFT JOIN department d ON e.department_id = d.department_id
       LEFT JOIN designation dsg ON e.designation_id = dsg.designation_id
       ORDER BY e.employee_id DESC`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

// ==========================================
// 🤝 CLIENT ENGAGEMENT ROUTER
// ==========================================
const clientEngagementRouter = express.Router();

clientEngagementRouter.get('/company/:companyId', async (req, res) => {
  const companyId = parseInt(req.params.companyId, 10);
  try {
    const result = await db.query(
      `SELECT 
        ce.engagement_id, ce.client_company_id, ce.internal_company_id, 
        ce.lead_owner_id, ce.engagement_status, ce.sales_stage_id, 
        TO_CHAR(ce.onboard_date, 'YYYY-MM-DD') as onboard_date,
        ce.source_type, ce.source_name, ce.created_at, ce.remarks,
        ss.stage_name,
        e.first_name, e.last_name,
        sp.status as pipeline_status,
        c.scale as size_category
       FROM client_engagement ce
       LEFT JOIN sales_stage ss ON ce.sales_stage_id = ss.sales_stage_id
       LEFT JOIN employee e ON ce.lead_owner_id = e.employee_id
       LEFT JOIN sales_pipeline sp ON ce.engagement_id = sp.engagement_id
       LEFT JOIN company c ON ce.client_company_id = c.company_id
       WHERE ce.client_company_id = $1
       LIMIT 1`, [companyId]
    );
    const row = result.rows.length ? result.rows[0] : null;
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

clientEngagementRouter.put('/:engagementId', async (req, res) => {
  const engagementId = parseInt(req.params.engagementId, 10);
  const { client_company_id, sales_stage_id, lead_owner_id, engagement_status, source_type, source_name, onboard_date, remarks } = req.body;
  try {
    const updates = [];
    const values = [];
    let idx = 1;
    if (client_company_id !== undefined) {
      updates.push(`client_company_id = $${idx++}`);
      if (client_company_id === '' || client_company_id === null) {
        values.push(null);
      } else {
        const val = typeof client_company_id === 'string' ? parseInt(client_company_id, 10) : client_company_id;
        values.push(isNaN(val) ? null : val);
      }
    }
    if (sales_stage_id !== undefined) {
      updates.push(`sales_stage_id = $${idx++}`);
      if (sales_stage_id === '' || sales_stage_id === null) {
        values.push(null);
      } else {
        const val = typeof sales_stage_id === 'string' ? parseInt(sales_stage_id, 10) : sales_stage_id;
        values.push(isNaN(val) ? null : val);
      }
    }
    if (lead_owner_id !== undefined) {
      updates.push(`lead_owner_id = $${idx++}`);
      if (lead_owner_id === '' || lead_owner_id === null) {
        values.push(null);
      } else {
        const val = typeof lead_owner_id === 'string' ? parseInt(lead_owner_id, 10) : lead_owner_id;
        values.push(isNaN(val) ? null : val);
      }
    }
    if (engagement_status !== undefined) {
      updates.push(`engagement_status = $${idx++}`);
      values.push(engagement_status || null);
    }
    if (source_type !== undefined) {
      updates.push(`source_type = $${idx++}`);
      values.push(source_type || null);
    }
    if (source_name !== undefined) {
      updates.push(`source_name = $${idx++}`);
      values.push(source_name || null);
    }
    if (onboard_date !== undefined) {
      updates.push(`onboard_date = $${idx++}`);
      values.push(onboard_date || null);
    }
    if (remarks !== undefined) {
      updates.push(`remarks = $${idx++}`);
      values.push(remarks || null);
    }
    if (!updates.length) {
      return res.status(400).json({ error: 'No fields to update' });
    }
    values.push(engagementId);
    const sql = `UPDATE client_engagement SET ${updates.join(', ')} WHERE engagement_id = $${idx} RETURNING *`;
    const result = await db.query(sql, values);
    if (!result.rows.length) return res.status(404).json({ error: 'Engagement not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

clientEngagementRouter.post('/', async (req, res) => {
  const { client_company_id, internal_company_id, lead_owner_id, sales_stage_id, engagement_status, source_type, source_name, onboard_date, remarks } = req.body;
  if (!client_company_id) {
    return res.status(400).json({ error: 'client_company_id is required' });
  }
  try {
    const result = await db.query(
      `INSERT INTO client_engagement (client_company_id, internal_company_id, lead_owner_id, sales_stage_id, engagement_status, source_type, source_name, onboard_date, remarks)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [client_company_id, internal_company_id || null, lead_owner_id || null, sales_stage_id || null, engagement_status || null, source_type || null, source_name || null, onboard_date || null, remarks || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

// ==========================================
// 📈 SALES PIPELINE ROUTER
// ==========================================
const salesPipelineRouter = express.Router();

salesPipelineRouter.get('/engagement/:engagementId', async (req, res) => {
  const engagementId = parseInt(req.params.engagementId, 10);
  try {
    const result = await db.query(
      `SELECT 
        pipeline_id, engagement_id, sales_stage_id, TO_CHAR(demo_booking_date, 'YYYY-MM-DD') as demo_booking_date, 
        TO_CHAR(demo_scheduled_date, 'YYYY-MM-DD') as demo_scheduled_date, status, updated_at, TO_CHAR(demo_held_date, 'YYYY-MM-DD') as demo_held_date
       FROM sales_pipeline
       WHERE engagement_id = $1
       ORDER BY updated_at DESC
       LIMIT 1`, [engagementId]
    );
    res.json(result.rows.length ? result.rows[0] : null);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

salesPipelineRouter.put('/engagement/:engagementId', async (req, res) => {
  const engagementId = parseInt(req.params.engagementId, 10);
  const { demo_booking_date, demo_scheduled_date, demo_held_date, status } = req.body;
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const checkRes = await client.query(
      'SELECT pipeline_id FROM sales_pipeline WHERE engagement_id = $1',
      [engagementId]
    );
    let result;
    if (checkRes.rows.length > 0) {
      const updates = [];
      const values = [];
      let idx = 1;
      if (demo_booking_date !== undefined) {
        updates.push(`demo_booking_date = $${idx++}`);
        values.push(demo_booking_date || null);
      }
      if (demo_scheduled_date !== undefined) {
        updates.push(`demo_scheduled_date = $${idx++}`);
        values.push(demo_scheduled_date || null);
      }
      if (demo_held_date !== undefined) {
        updates.push(`demo_held_date = $${idx++}`);
        values.push(demo_held_date || null);
      }
      if (status !== undefined) {
        updates.push(`status = $${idx++}`);
        values.push(status || null);
      }
      updates.push(`updated_at = NOW()`);
      if (updates.length > 1) {
        values.push(checkRes.rows[0].pipeline_id);
        const updateSql = `UPDATE sales_pipeline SET ${updates.join(', ')} WHERE pipeline_id = $${idx} RETURNING *`;
        result = await client.query(updateSql, values);
      } else {
        result = checkRes;
      }
    } else {
      const engRes = await client.query(
        'SELECT sales_stage_id FROM client_engagement WHERE engagement_id = $1',
        [engagementId]
      );
      if (!engRes.rows.length) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Engagement not found' });
      }
      const salesStageId = engRes.rows[0].sales_stage_id;
      result = await client.query(
        `INSERT INTO sales_pipeline (engagement_id, sales_stage_id, demo_booking_date, demo_scheduled_date, demo_held_date, status, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())
         RETURNING *`,
        [engagementId, salesStageId || null, demo_booking_date || null, demo_scheduled_date || null, demo_held_date || null, status || 'pending']
      );
    }
    await client.query('COMMIT');
    res.json(result.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Database error' });
  } finally {
    client.release();
  }
});

salesPipelineRouter.delete('/:pipelineId', async (req, res) => {
  const pipelineId = parseInt(req.params.pipelineId, 10);
  try {
    await db.query('DELETE FROM sales_pipeline WHERE pipeline_id = $1', [pipelineId]);
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

// ==========================================
// 📄 CLIENT PROFILE ROUTER
// ==========================================
const clientProfileRouter = express.Router();

clientProfileRouter.get('/company/:companyId', async (req, res) => {
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

clientProfileRouter.put('/company/:companyId', async (req, res) => {
  const companyId = parseInt(req.params.companyId, 10);
  const { onboard_date, primary_market, export_readiness_level, notes } = req.body;
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const checkRes = await client.query(
      'SELECT company_id FROM client_profile WHERE company_id = $1',
      [companyId]
    );
    let result;
    if (checkRes.rows.length > 0) {
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
        result = checkRes;
      }
    } else {
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

clientProfileRouter.post('/', async (req, res) => {
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

// ==========================================
// 🔗 ROUTE REGISTRATIONS
// ==========================================
app.use('/api/companies', companiesRouter);
app.use('/api/contacts', contactsRouter);
app.use('/api/tasks', tasksRouter);
app.use('/api/metadata', metadataRouter);
app.use('/api/products', productsRouter);
app.use('/api/employees', employeesRouter);
app.use('/api/client_engagement', clientEngagementRouter);
app.use('/api/sales_pipeline', salesPipelineRouter);
app.use('/api/client_profile', clientProfileRouter);
app.use('/api/agent-login', agentRouter);

// Simple health check
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// Protect agent portal pages
const agentPages = [
    'agent.html',
    'company_records.html',
    'contact_person_records.html',
    'add_contact_person.html',
    'tasks.html',
    'products.html',
    'contact_records.html'
];
agentPages.forEach(page => {
    app.get(`/templates/${page}`, requireAgentLogin, (req, res) => {
        res.sendFile(path.join(__dirname, 'templates', page));
    });
});

// Root route for homepage
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'templates', 'home.html'));
});

app.listen(port, () => console.log(`Server listening on port ${port}`));