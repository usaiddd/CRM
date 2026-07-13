const express = require('express');
const router = express.Router();
const db = require('../db');

// For session management
const session = require('express-session');

// Login route
router.post('/login', async (req, res) => {
  const { user_login, password } = req.body;
  if (!user_login || !password) {
    return res.status(400).json({ success: false, message: 'Missing credentials' });
  }
  try {
    // Fetch user data
    const userResult = await db.query(
      'SELECT user_login, id_admin FROM emp_login WHERE user_login = $1',
      [user_login]
    );
    
    if (userResult.rows.length === 0) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }
    
    const user = userResult.rows[0];
    
    // Verify password
    const storedPasswordResult = await db.query(
      'SELECT password FROM emp_login WHERE user_login = $1',
      [user_login]
    );
    
    const storedHash = storedPasswordResult.rows[0].password;
    
    // Test if password matches using crypt
    const matchResult = await db.query(
      'SELECT $1::text = crypt($2::text, $1::text) as matches',
      [storedHash, password]
    );
    
    if (!matchResult.rows[0].matches) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }
    
    const isAdmin = user.id_admin === true;
    
    // Set session
    req.session.agent = user.user_login;
    req.session.isAdmin = isAdmin;
    
    res.json({ success: true, isAdmin: isAdmin });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Logout route
router.post('/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// Get current user info
router.get('/me', async (req, res) => {
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

module.exports = router;
