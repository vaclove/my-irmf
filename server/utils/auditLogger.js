const { pool } = require('../models/database');

/**
 * Audit Logger Utility
 * Provides functions to log all CRUD operations and authentication events
 */

// Get user information from request
const getUserInfo = (req) => {
  // Extract user email from session/auth
  const userEmail = req.user?.email || req.session?.user?.email || null;
  
  // Get IP address, handling various proxy scenarios
  const userIp = req.ip || 
                req.connection?.remoteAddress || 
                req.socket?.remoteAddress ||
                req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
                req.headers['x-real-ip'] ||
                'unknown';

  return { userEmail, userIp };
};

// Get request metadata
const getRequestMetadata = (req) => {
  return {
    userAgent: req.headers['user-agent'],
    referer: req.headers['referer'],
    method: req.method,
    url: req.originalUrl || req.url,
    timestamp: new Date().toISOString()
  };
};

/**
 * Log audit event to database
 */
const logAuditEvent = async ({
  req,
  action,
  resource,
  resourceId = null,
  oldData = null,
  newData = null,
  success = true,
  additionalMetadata = {}
}) => {
  try {
    const { userEmail, userIp } = getUserInfo(req);
    const metadata = {
      ...getRequestMetadata(req),
      ...additionalMetadata
    };

    const result = await pool.query(
      `SELECT log_audit_event($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        userEmail,
        userIp,
        action,
        resource,
        resourceId,
        oldData ? JSON.stringify(oldData) : null,
        newData ? JSON.stringify(newData) : null,
        JSON.stringify(metadata),
        success
      ]
    );

    return result.rows[0].log_audit_event;
  } catch (error) {
    // Don't let audit logging failures break the main operation
    console.error('Audit logging failed:', error);
    return null;
  }
};

/**
 * Middleware to automatically log CRUD operations
 */
const auditMiddleware = (resource) => {
  return async (req, res, next) => {
    // Store original res.json to intercept responses
    const originalJson = res.json;
    const originalSend = res.send;
    
    // Capture request body for CREATE/UPDATE operations
    const requestData = req.body;
    
    // Determine action based on HTTP method and route
    let action;
    switch (req.method) {
      case 'GET':
        action = 'READ';
        break;
      case 'POST':
        action = 'CREATE';
        break;
      case 'PUT':
      case 'PATCH':
        action = 'UPDATE';
        break;
      case 'DELETE':
        action = 'DELETE';
        break;
      default:
        action = req.method;
    }

    // Override res.json to capture response data
    res.json = function(body) {
      const statusCode = res.statusCode;
      const success = statusCode >= 200 && statusCode < 400;
      
      // Extract resource ID from various sources
      let resourceId = req.params.id || req.params.guest_id || req.params.edition_id || req.params.tag_id;
      
      // For successful CREATE operations, try to get ID from response
      if (action === 'CREATE' && success && body && body.id) {
        resourceId = body.id;
      }

      // Log the audit event
      setImmediate(async () => {
        try {
          await logAuditEvent({
            req,
            action,
            resource,
            resourceId,
            oldData: action === 'UPDATE' || action === 'DELETE' ? req.originalData : null,
            newData: action === 'CREATE' || action === 'UPDATE' ? (body || requestData) : null,
            success,
            additionalMetadata: {
              statusCode,
              responseSize: JSON.stringify(body || {}).length
            }
          });
        } catch (auditError) {
          console.error('Audit logging error:', auditError);
        }
      });

      return originalJson.call(this, body);
    };

    // Override res.send to capture non-JSON responses
    res.send = function(body) {
      const statusCode = res.statusCode;
      const success = statusCode >= 200 && statusCode < 400;
      
      let resourceId = req.params.id || req.params.guest_id || req.params.edition_id || req.params.tag_id;

      // Log the audit event for non-JSON responses
      setImmediate(async () => {
        try {
          await logAuditEvent({
            req,
            action,
            resource,
            resourceId,
            oldData: action === 'UPDATE' || action === 'DELETE' ? req.originalData : null,
            newData: action === 'CREATE' || action === 'UPDATE' ? requestData : null,
            success,
            additionalMetadata: {
              statusCode,
              responseType: 'text',
              responseSize: (body || '').toString().length
            }
          });
        } catch (auditError) {
          console.error('Audit logging error:', auditError);
        }
      });

      return originalSend.call(this, body);
    };

    next();
  };
};

/**
 * Middleware to capture original data for UPDATE/DELETE operations
 */
const captureOriginalData = (resource, idParam = 'id') => {
  return async (req, res, next) => {
    if (req.method === 'PUT' || req.method === 'PATCH' || req.method === 'DELETE') {
      try {
        const resourceId = req.params[idParam];
        if (resourceId) {
          // Fetch original data based on resource type
          let query;
          let params = [resourceId];
          
          switch (resource) {
            case 'guests':
              query = 'SELECT * FROM guests WHERE id = $1';
              break;
            case 'editions':
              query = 'SELECT * FROM editions WHERE id = $1';
              break;
            case 'tags':
              query = 'SELECT * FROM tags WHERE id = $1';
              break;
            case 'guest_tags':
              // For guest-tag associations, get both guest_id and tag_id
              query = 'SELECT * FROM guest_tags WHERE guest_id = $1 AND tag_id = $2';
              params = [req.params.guest_id, req.params.tag_id];
              break;
            case 'invitations':
              query = 'SELECT * FROM guest_invitations WHERE guest_id = $1 AND edition_id = $2';
              params = [req.params.guest_id, req.params.edition_id];
              break;
            default:
              // Generic fallback
              query = `SELECT * FROM ${resource} WHERE id = $1`;
          }
          
          const result = await pool.query(query, params);
          req.originalData = result.rows[0] || null;
        }
      } catch (error) {
        // Don't fail the main operation if we can't fetch original data
        console.error('Failed to capture original data:', error);
        req.originalData = null;
      }
    }
    next();
  };
};

/**
 * Log authentication events
 */
const logAuthEvent = async (req, action, success = true, additionalData = {}) => {
  return await logAuditEvent({
    req,
    action,
    resource: 'authentication',
    resourceId: req.user?.email || req.body?.email || 'unknown',
    newData: {
      email: req.user?.email || req.body?.email,
      provider: 'google',
      ...additionalData
    },
    success,
    additionalMetadata: {
      authMethod: 'oauth',
      provider: 'google'
    }
  });
};

/**
 * Check if user is admin (vaclav@irmf.cz)
 */
const isAdmin = (req) => {
  const userEmail = req.user?.email || req.session?.user?.email;
  return userEmail === 'vaclav@irmf.cz';
};

module.exports = {
  logAuditEvent,
  auditMiddleware,
  captureOriginalData,
  logAuthEvent,
  isAdmin,
  getUserInfo
};