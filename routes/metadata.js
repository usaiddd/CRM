const express = require('express');
const router = express.Router();
const db = require('../db');

// GET /api/metadata/industries
router.get('/industries', async (req, res) => {
  try {
    const result = await db.query('SELECT industry_id, industry_name FROM industry ORDER BY industry_name');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

// GET /api/metadata/industries/recent (top 10)
router.get('/industries/recent', async (req, res) => {
  try {
    const result = await db.query('SELECT industry_id, industry_name FROM industry ORDER BY industry_id DESC LIMIT 10');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

// GET /api/metadata/categories
router.get('/categories', async (req, res) => {
  try {
    const result = await db.query('SELECT category_id, category_name FROM category ORDER BY category_name');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

// GET /api/metadata/categories/recent (top 10)
router.get('/categories/recent', async (req, res) => {
  try {
    const result = await db.query('SELECT category_id, category_name FROM category ORDER BY category_id DESC LIMIT 10');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

// Optional: POST endpoints to add new items
router.post('/industries', async (req, res) => {
  const { industry_name } = req.body;
  if (!industry_name) return res.status(400).json({ error: 'industry_name required' });
  try {
    const result = await db.query('INSERT INTO industry (industry_name) VALUES ($1) RETURNING *', [industry_name]);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

router.post('/categories', async (req, res) => {
  const { category_name } = req.body;
  if (!category_name) return res.status(400).json({ error: 'category_name required' });
  try {
    const result = await db.query('INSERT INTO category (category_name) VALUES ($1) RETURNING *', [category_name]);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

// GET /api/metadata/departments
router.get('/departments', async (req, res) => {
  try {
    const result = await db.query('SELECT department_id, name FROM department ORDER BY name');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

// GET /api/metadata/departments/recent (top 10)
router.get('/departments/recent', async (req, res) => {
  try {
    const result = await db.query('SELECT department_id, name FROM department ORDER BY department_id DESC LIMIT 10');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

// POST /api/metadata/departments
router.post('/departments', async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  try {
    const result = await db.query('INSERT INTO department (name) VALUES ($1) RETURNING *', [name]);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

// GET /api/metadata/designations
router.get('/designations', async (req, res) => {
  try {
    const result = await db.query('SELECT designation_id, name FROM designation ORDER BY name');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

// GET /api/metadata/designations/recent (top 10)
router.get('/designations/recent', async (req, res) => {
  try {
    const result = await db.query('SELECT designation_id, name FROM designation ORDER BY designation_id DESC LIMIT 10');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

// POST /api/metadata/designations
router.post('/designations', async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  try {
    const result = await db.query('INSERT INTO designation (name) VALUES ($1) RETURNING *', [name]);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

// GET /api/metadata/hsn
router.get('/hsn', async (req, res) => {
  try {
    const result = await db.query('SELECT hsn_id, hsn_code, description FROM hsn WHERE active = TRUE ORDER BY hsn_code');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});


// GET /api/metadata/sales_stages
router.get('/sales_stages', async (req, res) => {
  try {
    const result = await db.query('SELECT sales_stage_id, stage_name FROM sales_stage ORDER BY sequence');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

// SEARCH Utilities
router.get('/:type/search', async (req, res) => {
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

// CHECK Dependencies
router.get('/:type/:id/dependencies', async (req, res) => {
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

// DELETE Utility with Re-assignment
router.post('/:type/:id/delete', async (req, res) => {
  const { type, id } = req.params;
  const { assignments } = req.body; // Array of { recordId: number, reassignId: number, recordType?: string }
  const targetId = parseInt(id, 10);

  try {
    await db.query('BEGIN');

    if (assignments && assignments.length > 0) {
      // Group by reassignId and recordType
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
            // Insert new mappings (ignoring if they already exist for this product)
            for (const pid of types.Product) {
              await db.query('INSERT INTO product_industry (product_id, industry_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [pid, reassignId]);
            }
            // Delete the old mappings
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

module.exports = router;