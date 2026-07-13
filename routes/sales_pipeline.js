const express = require('express');
const router = express.Router();
const db = require('../db');

// GET /api/sales_pipeline/engagement/:engagementId - Get pipeline for engagement
router.get('/engagement/:engagementId', async (req, res) => {
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

// PUT /api/sales_pipeline/engagement/:engagementId - Update or create pipeline dates
router.put('/engagement/:engagementId', async (req, res) => {
  const engagementId = parseInt(req.params.engagementId, 10);
  const { demo_booking_date, demo_scheduled_date, demo_held_date, status } = req.body;
  
  const client = await db.pool.connect();
  
  try {
    await client.query('BEGIN');
    
    // First check if pipeline exists for this engagement
    const checkRes = await client.query(
      'SELECT pipeline_id FROM sales_pipeline WHERE engagement_id = $1',
      [engagementId]
    );
    
    let result;
    
    if (checkRes.rows.length > 0) {
      // Update existing pipeline
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
      
      // Always update the updated_at timestamp
      updates.push(`updated_at = NOW()`);
      
      if (updates.length > 1) { // More than just the timestamp
        values.push(checkRes.rows[0].pipeline_id);
        const updateSql = `UPDATE sales_pipeline SET ${updates.join(', ')} WHERE pipeline_id = $${idx} RETURNING *`;
        result = await client.query(updateSql, values);
      } else {
        // No updates, return existing record
        result = checkRes;
      }
    } else {
      // Create new pipeline entry
      // We need to get the sales_stage_id from the engagement
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

// DELETE /api/sales_pipeline/:pipelineId - Delete pipeline
router.delete('/:pipelineId', async (req, res) => {
  const pipelineId = parseInt(req.params.pipelineId, 10);
  try {
    await db.query('DELETE FROM sales_pipeline WHERE pipeline_id = $1', [pipelineId]);
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

module.exports = router;
