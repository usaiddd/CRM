// Middleware to protect agent portal routes
function requireAgentLogin(req, res, next) {
  if (req.session && req.session.agent) {
    return next();
  }
  // If not logged in, redirect to login page
  res.redirect('/templates/agent_login.html');
}

module.exports = requireAgentLogin;
