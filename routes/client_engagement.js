const express = require('express');
const router = express.Router();
const db = require('../db');

// GET /api/client_engagement/company/:companyId - Get engagement by company
router.get('/company/:companyId', async (req, res) => {
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

// PUT /api/client_engagement/:engagementId - Update engagement
router.put('/:engagementId', async (req, res) => {
  const engagementId = parseInt(req.params.engagementId, 10);
  const { client_company_id, sales_stage_id, lead_owner_id, engagement_status, source_type, source_name, onboard_date, remarks } = req.body;
  
  try {
    const updates = [];
    const values = [];
    let idx = 1;
    
    // Handle client_company_id - allow null to clear the value
    if (client_company_id !== undefined) {
      updates.push(`client_company_id = $${idx++}`);
      if (client_company_id === '' || client_company_id === null) {
        values.push(null);
      } else {
        const val = typeof client_company_id === 'string' ? parseInt(client_company_id, 10) : client_company_id;
        values.push(isNaN(val) ? null : val);
      }
    }
    
    // Handle sales_stage_id - allow null to clear the value
    if (sales_stage_id !== undefined) {
      updates.push(`sales_stage_id = $${idx++}`);
      if (sales_stage_id === '' || sales_stage_id === null) {
        values.push(null);
      } else {
        const val = typeof sales_stage_id === 'string' ? parseInt(sales_stage_id, 10) : sales_stage_id;
        values.push(isNaN(val) ? null : val);
      }
    }
    
    // Handle lead_owner_id - allow null to clear the value
    if (lead_owner_id !== undefined) {
      updates.push(`lead_owner_id = $${idx++}`);
      if (lead_owner_id === '' || lead_owner_id === null) {
        values.push(null);
      } else {
        const val = typeof lead_owner_id === 'string' ? parseInt(lead_owner_id, 10) : lead_owner_id;
        values.push(isNaN(val) ? null : val);
      }
    }
    
    // Handle text/date fields
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

// POST /api/client_engagement - Create new engagement
router.post('/', async (req, res) => {
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

module.exports = router;
