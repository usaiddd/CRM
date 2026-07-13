const express = require('express');
const router = express.Router();
const db = require('../db');

// GET /api/products?search=...
router.get('/', async (req, res) => {
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

// GET /api/products/:id
router.get('/:id', async (req, res) => {
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

// POST /api/products
router.post('/', async (req, res) => {
  const { product_name, hsn_id, hsn_code, hsn_description, industry_ids } = req.body;
  if (!product_name) return res.status(400).json({ error: 'product_name required' });
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    // Determine or upsert HSN (prefer hsn_code if provided)
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

    // Validate industries if provided
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

// PUT /api/products/:id
router.put('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { product_name, hsn_id, hsn_code, hsn_description, active, industry_ids } = req.body;
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    // Determine or upsert HSN
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

    // Validate industries if provided
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

    // Replace industry associations
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

// DELETE /api/products/:id
router.delete('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    await db.query('DELETE FROM product_industry WHERE product_id = $1', [id]);
    await db.query('DELETE FROM product WHERE product_id = $1', [id]);
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

module.exports = router;
