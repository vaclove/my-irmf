const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const passport = require('passport');
const path = require('path');
require('dotenv').config();

const { initializeAuth, requireIrmfDomain } = require('./middleware/auth');
const { requestLogger, errorLogger } = require('./middleware/logging');
const { createTables, pool } = require('./models/database');
const guestRoutes = require('./routes/guests');
const editionRoutes = require('./routes/editions');
const invitationRoutes = require('./routes/invitations');
const authRoutes = require('./routes/auth');
const publicRoutes = require('./routes/public');
const templateRoutes = require('./routes/templates');
const tagRoutes = require('./routes/tags');
const auditRoutes = require('./routes/audit');

const app = express();
const PORT = process.env.PORT || 3001;

// Initialize authentication
initializeAuth();

app.use(helmet());
app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? process.env.APP_URL || 'https://my.irmf.cz'
    : (process.env.CLIENT_URL || 'http://localhost:5173'),
  credentials: true
}));
app.use(express.json());

// Request logging middleware
app.use(requestLogger);

// Session configuration with PostgreSQL store
app.use(session({
  store: new pgSession({
    pool: pool,
    tableName: 'session'
  }),
  secret: process.env.SESSION_SECRET || 'your-secret-key-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    // secure: process.env.NODE_ENV === 'production' && !process.env.APP_URL?.includes('localhost'),
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    sameSite: 'lax'
  }
}));

// Passport middleware
app.use(passport.initialize());
app.use(passport.session());

// Authentication routes (no auth required)
app.use('/auth', authRoutes);

// Public routes (no auth required) - must come before protected routes to avoid conflicts
app.use('/api', publicRoutes);

// Protected API routes (require @irmf.cz domain)
app.use('/api/guests', requireIrmfDomain, guestRoutes);
app.use('/api/editions', requireIrmfDomain, editionRoutes);
app.use('/api/invitations', requireIrmfDomain, invitationRoutes);
app.use('/api/templates', requireIrmfDomain, templateRoutes);
app.use('/api/tags', requireIrmfDomain, tagRoutes);
app.use('/api/audit', requireIrmfDomain, auditRoutes);

app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// In production, serve static files from React build
if (process.env.NODE_ENV === 'production') {
  // Serve static files from React build
  app.use(express.static(path.join(__dirname, '../client/dist')));
  
  // Handle React routing - return all non-API requests to React app
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../client/dist', 'index.html'));
  });
}

// Global error handling middleware (must be last)
app.use(errorLogger);

// Initialize database and start server
const startServer = async () => {
  try {
    console.log('Initializing database...');
    await createTables();
    console.log('Database initialized successfully');
    
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
      console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
      if (process.env.NODE_ENV === 'production') {
        console.log('Serving static files from client/dist');
      }
    });
  } catch (error) {
    console.error('Failed to initialize database:', error);
    process.exit(1);
  }
};

startServer();