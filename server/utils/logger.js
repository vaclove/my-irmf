const winston = require('winston');

// Create logger with structured format
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp({
      format: 'YYYY-MM-DD HH:mm:ss'
    }),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { 
    service: 'festival-guest-manager',
    environment: process.env.NODE_ENV || 'development'
  },
  transports: [
    // Console output
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    }),
    // File output for errors
    new winston.transports.File({
      filename: 'server.log',
      level: 'error',
      format: winston.format.json()
    }),
    // File output for all logs
    new winston.transports.File({
      filename: 'combined.log',
      format: winston.format.json()
    })
  ]
});

// Helper function to log API errors with context
const logError = (error, req, additionalContext = {}) => {
  const errorInfo = {
    error: {
      message: error.message,
      stack: error.stack,
      code: error.code,
      name: error.name
    },
    request: {
      method: req.method,
      url: req.originalUrl,
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      userId: req.user?.id,
      userEmail: req.user?.email
    },
    ...additionalContext
  };

  logger.error('API Error', errorInfo);
};

// Helper function to log API requests
const logRequest = (req, res, responseTime) => {
  const requestInfo = {
    request: {
      method: req.method,
      url: req.originalUrl,
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      userId: req.user?.id,
      userEmail: req.user?.email
    },
    response: {
      statusCode: res.statusCode,
      responseTime: `${responseTime}ms`
    }
  };

  if (res.statusCode >= 400) {
    logger.warn('API Request Failed', requestInfo);
  } else {
    logger.info('API Request', requestInfo);
  }
};

module.exports = {
  logger,
  logError,
  logRequest
};