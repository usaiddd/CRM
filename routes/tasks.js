const express = require('express');
const router = express.Router();
const db = require('../db');

// GET /api/tasks
router.get('/', async (req, res) => {
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

// POST /api/tasks
router.post('/', async (req, res) => {
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

// PUT /api/tasks/:id
router.put('/:id', async (req, res) => {
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

module.exports = router;
