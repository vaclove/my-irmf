const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;

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
  if (req.isAuthenticated()) {
    return next();
  }
  res.status(401).json({ error: 'Authentication required' });
};

const requireIrmfDomain = (req, res, next) => {
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