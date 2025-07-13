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
      console.log('🔄 Google OAuth callback successful:', {
        user: req.user,
        sessionID: req.sessionID,
        isAuthenticated: req.isAuthenticated(),
        session: req.session,
        cookieHeader: req.headers.cookie,
        host: req.headers.host,
        userAgent: req.headers['user-agent']
      });
      
      // Log successful authentication
      await logAuthEvent(req, 'LOGIN', true, {
        provider: 'google',
        domain: req.user?.email?.split('@')[1] || 'unknown'
      });
      
      const redirectUrl = process.env.CLIENT_URL || 'http://localhost:5173';
      console.log('🔀 Redirecting to:', redirectUrl);
      
      // Force session save before redirect
      req.session.save((err) => {
        if (err) {
          console.error('❌ Session save error:', err);
        } else {
          console.log('✅ Session saved successfully');
        }
        
        // Log response headers to see if cookie is being set
        console.log('📤 Response headers will include:', {
          setCookie: res.getHeaders()['set-cookie'],
          location: redirectUrl,
          sessionName: req.sessionID
        });
        
        // Successful authentication, redirect to frontend
        res.redirect(redirectUrl);
      });
    } catch (error) {
      console.error('❌ Error in OAuth callback:', error);
      logError(error, req, { operation: 'auth_callback_audit' });
      // Still redirect even if audit logging fails
      res.redirect(process.env.CLIENT_URL || 'http://localhost:5173');
    }
  }
);

// Get current user
router.get('/user', (req, res) => {
  console.log('🔍 /auth/user called:', {
    isAuthenticated: req.isAuthenticated(),
    sessionID: req.sessionID,
    session: req.session,
    user: req.user,
    headers: {
      cookie: req.headers.cookie,
      origin: req.headers.origin,
      referer: req.headers.referer
    }
  });
  
  if (req.isAuthenticated()) {
    console.log('✅ User is authenticated:', req.user.email);
    res.json({
      user: req.user,
      authenticated: true
    });
  } else {
    console.log('❌ User is NOT authenticated');
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