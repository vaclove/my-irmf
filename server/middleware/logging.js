const { logError, logRequest } = require('../utils/logger');

// Middleware to log all requests
const requestLogger = (req, res, next) => {
  const startTime = Date.now();
  
  // Override res.end to capture response time and log
  const originalEnd = res.end;
  res.end = function(...args) {
    const responseTime = Date.now() - startTime;
    logRequest(req, res, responseTime);
    originalEnd.apply(this, args);
  };
  
  next();
};

// Global error handler middleware
const errorLogger = (err, req, res, next) => {
  // Log the error with context
  logError(err, req, {
    timestamp: new Date().toISOString(),
    body: req.body,
    params: req.params,
    query: req.query
  });

  // Send error response to client
  const statusCode = err.statusCode || err.status || 500;
  const message = err.message || 'Internal Server Error';
  
  res.status(statusCode).json({
    error: message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
};

module.exports = {
  requestLogger,
  errorLogger
};