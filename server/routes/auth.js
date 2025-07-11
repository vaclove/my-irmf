const express = require('express');
const passport = require('passport');
const { logError } = require('../utils/logger');
const { logAuthEvent } = require('../utils/auditLogger');
const router = express.Router();

// Google OAuth routes
router.get('/google',
  passport.authenticate('google', { 
    scope: ['profile', 'email'],
    hd: 'irmf.cz' // Restrict to irmf.cz domain
  })
);

router.get('/google/callback',
  passport.authenticate('google', { failureRedirect: '/login?error=access_denied' }),
  async (req, res) => {
    try {
      // Log successful authentication
      await logAuthEvent(req, 'LOGIN', true, {
        provider: 'google',
        domain: req.user?.email?.split('@')[1] || 'unknown'
      });
      
      // Successful authentication, redirect to frontend
      res.redirect(process.env.CLIENT_URL || 'http://localhost:5173');
    } catch (error) {
      logError(error, req, { operation: 'auth_callback_audit' });
      // Still redirect even if audit logging fails
      res.redirect(process.env.CLIENT_URL || 'http://localhost:5173');
    }
  }
);

// Get current user
router.get('/user', (req, res) => {
  if (req.isAuthenticated()) {
    res.json({
      user: req.user,
      authenticated: true
    });
  } else {
    res.json({
      user: null,
      authenticated: false
    });
  }
});

// Logout
router.post('/logout', async (req, res) => {
  const userEmail = req.user?.email;
  
  req.logout(async (err) => {
    if (err) {
      // Log failed logout attempt
      await logAuthEvent(req, 'LOGOUT', false, { error: err.message });
      logError(err, req, { operation: 'logout' });
      return res.status(500).json({ error: 'Logout failed' });
    }
    
    try {
      // Log successful logout
      await logAuthEvent(req, 'LOGOUT', true, { email: userEmail });
    } catch (auditError) {
      // Don't fail logout if audit logging fails
      logError(auditError, req, { operation: 'logout_audit' });
    }
    
    res.json({ message: 'Logged out successfully' });
  });
});

module.exports = router;