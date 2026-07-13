const express = require('express');
const router = express.Router();
const db = require('../db');

// POST /api/employees - Create new employee with all related data
router.post('/', async (req, res) => {
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

    // Helper function to convert empty strings to null
    const nullIfEmpty = (val) => (val === '' || val === null || val === undefined) ? null : val;

    // Validate required fields
    if (!first_name?.trim() || !last_name?.trim() || !mobile_primary?.trim() || !email_primary?.trim() || !user_login?.trim() || !password?.trim()) {
      await client.query('ROLLBACK');
      return res.status(400).json({ 
        error: 'Missing required fields: first_name, last_name, mobile_primary, email_primary, user_login, password' 
      });
    }

    // 1. Create emp_login record first
    const loginResult = await client.query(
      'INSERT INTO emp_login (user_login, password, id_admin) VALUES ($1, $2, $3) RETURNING *',
      [user_login.trim(), password.trim(), id_admin === 'true' || id_admin === true]
    );

    // 2. Create employee record
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

    // 3. Create employee_contact record
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

    // 4. Create emplog record to map user_login to employee_id
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
    
    // Handle specific database errors
    if (err.code === '23505') { // Unique constraint violation
      return res.status(400).json({ 
        error: 'Duplicate entry: This username or aadhaar number already exists' 
      });
    }
    if (err.code === '23503') { // Foreign key violation
      return res.status(400).json({ 
        error: 'Invalid reference: Company, Department, or Designation not found' 
      });
    }
    
    res.status(500).json({ error: 'Database error: ' + err.message });
  } finally {
    client.release();
  }
});

// GET /api/employees/:id - Get employee details
router.get('/:id', async (req, res) => {
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

// GET /api/employees - List all employees
router.get('/', async (req, res) => {
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

module.exports = router;
