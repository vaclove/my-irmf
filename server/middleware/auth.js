const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const { logAuthEvent } = require('../utils/auditLogger');

const isLocalhost = (req) => {
  const host = req.get('host') || '';
  const ip = req.ip || req.connection.remoteAddress || '';
  
  return host.includes('localhost') || 
         host.includes('127.0.0.1') || 
         host.includes('::1') ||
         ip === '127.0.0.1' ||
         ip === '::1' ||
         ip === '::ffff:127.0.0.1';
};

const initializeAuth = () => {
  passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: "/auth/google/callback"
  },
  async (accessToken, refreshToken, profile, done) => {
    try {
      const email = profile.emails[0].value;
      
      // Check if user belongs to @irmf.cz domain
      if (!email.endsWith('@irmf.cz')) {
        // Log failed authentication attempt
        try {
          // Create a minimal req object for audit logging
          const req = {
            ip: 'unknown',
            headers: {},
            method: 'POST',
            originalUrl: '/auth/google/callback',
            body: { email }
          };
          await logAuthEvent(req, 'AUTH_FAIL', false, { 
            reason: 'invalid_domain',
            email,
            domain: email.split('@')[1]
          });
        } catch (auditError) {
          console.error('Failed to log auth failure:', auditError);
        }
        
        return done(null, false, { 
          message: 'Access restricted to @irmf.cz domain users only' 
        });
      }

      const user = {
        id: profile.id,
        name: profile.displayName,
        email: email,
        photo: profile.photos[0]?.value
      };

      return done(null, user);
    } catch (error) {
      // Log authentication error
      try {
        const req = {
          ip: 'unknown',
          headers: {},
          method: 'POST',
          originalUrl: '/auth/google/callback',
          body: { email: profile?.emails?.[0]?.value || 'unknown' }
        };
        await logAuthEvent(req, 'AUTH_FAIL', false, { 
          reason: 'oauth_error',
          error: error.message
        });
      } catch (auditError) {
        console.error('Failed to log auth error:', auditError);
      }
      
      return done(error, null);
    }
  }));

  passport.serializeUser((user, done) => {
    done(null, user);
  });

  passport.deserializeUser((user, done) => {
    done(null, user);
  });
};

const requireAuth = (req, res, next) => {
  // Check if localhost bypass is enabled
  if (process.env.BYPASS_AUTH_ON_LOCALHOST === 'true' && isLocalhost(req)) {
    return next();
  }
  
  if (req.isAuthenticated()) {
    return next();
  }
  res.status(401).json({ error: 'Authentication required' });
};

const requireIrmfDomain = (req, res, next) => {
  // Check if localhost bypass is enabled
  if (process.env.BYPASS_AUTH_ON_LOCALHOST === 'true' && isLocalhost(req)) {
    return next();
  }
  
  if (req.isAuthenticated() && req.user.email.endsWith('@irmf.cz')) {
    return next();
  }
  res.status(403).json({ error: 'Access restricted to @irmf.cz domain users' });
};

module.exports = {
  initializeAuth,
  requireAuth,
  requireIrmfDomain
};