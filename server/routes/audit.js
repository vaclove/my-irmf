const express = require('express');
const { pool } = require('../models/database');
const { logError } = require('../utils/logger');
const { isAdmin, logAuditEvent } = require('../utils/auditLogger');
const router = express.Router();

/**
 * Middleware to check if user is admin (vaclav@irmf.cz)
 */
const requireAdmin = (req, res, next) => {
  if (!isAdmin(req)) {
    // Log unauthorized access attempt
    setImmediate(async () => {
      try {
        await logAuditEvent({
          req,
          action: 'READ',
          resource: 'audit_logs',
          success: false,
          additionalMetadata: {
            reason: 'access_denied',
            requiredRole: 'admin'
          }
        });
      } catch (error) {
        console.error('Failed to log unauthorized audit access:', error);
      }
    });
    
    return res.status(403).json({ 
      error: 'Access denied. Admin privileges required.' 
    });
  }
  next();
};

/**
 * Get audit logs with filtering and pagination
 */
router.get('/', requireAdmin, async (req, res) => {
  try {
    const {
      page = 1,
      limit = 50,
      user_email,
      action,
      resource,
      resource_id,
      start_date,
      end_date,
      success,
      user_ip
    } = req.query;

    // Build WHERE clause dynamically
    const conditions = [];
    const params = [];
    let paramCount = 0;

    if (user_email) {
      paramCount++;
      conditions.push(`user_email ILIKE $${paramCount}`);
      params.push(`%${user_email}%`);
    }

    if (action) {
      paramCount++;
      conditions.push(`action = $${paramCount}`);
      params.push(action);
    }

    if (resource) {
      paramCount++;
      conditions.push(`resource = $${paramCount}`);
      params.push(resource);
    }

    if (resource_id) {
      paramCount++;
      conditions.push(`resource_id = $${paramCount}`);
      params.push(resource_id);
    }

    if (start_date) {
      paramCount++;
      conditions.push(`timestamp >= $${paramCount}`);
      params.push(start_date);
    }

    if (end_date) {
      paramCount++;
      conditions.push(`timestamp <= $${paramCount}`);
      params.push(end_date);
    }

    if (success !== undefined) {
      paramCount++;
      conditions.push(`success = $${paramCount}`);
      params.push(success === 'true');
    }

    if (user_ip) {
      paramCount++;
      conditions.push(`user_ip = $${paramCount}`);
      params.push(user_ip);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Get total count
    const countQuery = `SELECT COUNT(*) FROM audit_logs ${whereClause}`;
    const countResult = await pool.query(countQuery, params);
    const totalCount = parseInt(countResult.rows[0].count);

    // Calculate pagination
    const offset = (page - 1) * limit;
    const totalPages = Math.ceil(totalCount / limit);

    // Get paginated results
    paramCount++;
    const limitParam = paramCount;
    paramCount++;
    const offsetParam = paramCount;
    
    const query = `
      SELECT 
        id,
        user_email,
        user_ip,
        action,
        resource,
        resource_id,
        old_data,
        new_data,
        metadata,
        timestamp,
        success
      FROM audit_logs 
      ${whereClause}
      ORDER BY timestamp DESC
      LIMIT $${limitParam} OFFSET $${offsetParam}
    `;

    const result = await pool.query(query, [...params, limit, offset]);

    // Log the audit log access
    await logAuditEvent({
      req,
      action: 'READ',
      resource: 'audit_logs',
      success: true,
      additionalMetadata: {
        filters: req.query,
        resultCount: result.rows.length,
        totalCount
      }
    });

    res.json({
      logs: result.rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        totalCount,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1
      },
      filters: req.query
    });

  } catch (error) {
    logError(error, req, { operation: 'get_audit_logs', filters: req.query });
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get audit log statistics
 */
router.get('/stats', requireAdmin, async (req, res) => {
  try {
    const { days = 30 } = req.query;

    const statsQuery = `
      SELECT 
        action,
        resource,
        COUNT(*) as count,
        COUNT(CASE WHEN success = true THEN 1 END) as success_count,
        COUNT(CASE WHEN success = false THEN 1 END) as failure_count,
        COUNT(DISTINCT user_email) as unique_users,
        COUNT(DISTINCT user_ip) as unique_ips
      FROM audit_logs 
      WHERE timestamp >= NOW() - INTERVAL '${parseInt(days)} days'
      GROUP BY action, resource
      ORDER BY count DESC
    `;

    const dailyStatsQuery = `
      SELECT 
        DATE(timestamp) as date,
        COUNT(*) as total_actions,
        COUNT(DISTINCT user_email) as unique_users,
        COUNT(CASE WHEN success = false THEN 1 END) as failures
      FROM audit_logs 
      WHERE timestamp >= NOW() - INTERVAL '${parseInt(days)} days'
      GROUP BY DATE(timestamp)
      ORDER BY date DESC
    `;

    const topUsersQuery = `
      SELECT 
        user_email,
        COUNT(*) as action_count,
        COUNT(CASE WHEN success = false THEN 1 END) as failure_count,
        MAX(timestamp) as last_activity
      FROM audit_logs 
      WHERE timestamp >= NOW() - INTERVAL '${parseInt(days)} days'
        AND user_email IS NOT NULL
      GROUP BY user_email
      ORDER BY action_count DESC
      LIMIT 10
    `;

    const [statsResult, dailyStatsResult, topUsersResult] = await Promise.all([
      pool.query(statsQuery),
      pool.query(dailyStatsQuery),
      pool.query(topUsersQuery)
    ]);

    // Log the stats access
    await logAuditEvent({
      req,
      action: 'READ',
      resource: 'audit_stats',
      success: true,
      additionalMetadata: {
        days: parseInt(days)
      }
    });

    res.json({
      period: `${days} days`,
      actionStats: statsResult.rows,
      dailyStats: dailyStatsResult.rows,
      topUsers: topUsersResult.rows
    });

  } catch (error) {
    logError(error, req, { operation: 'get_audit_stats', days: req.query.days });
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get audit log by ID
 */
router.get('/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      'SELECT * FROM audit_logs WHERE id = $1',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Audit log not found' });
    }

    // Log the specific audit log access
    await logAuditEvent({
      req,
      action: 'READ',
      resource: 'audit_log',
      resourceId: id,
      success: true
    });

    res.json(result.rows[0]);

  } catch (error) {
    logError(error, req, { operation: 'get_audit_log_by_id', auditLogId: req.params.id });
    res.status(500).json({ error: error.message });
  }
});

/**
 * Export audit logs (CSV format)
 */
router.get('/export/csv', requireAdmin, async (req, res) => {
  try {
    const {
      user_email,
      action,
      resource,
      start_date,
      end_date,
      success
    } = req.query;

    // Build WHERE clause (same as main query)
    const conditions = [];
    const params = [];
    let paramCount = 0;

    if (user_email) {
      paramCount++;
      conditions.push(`user_email ILIKE $${paramCount}`);
      params.push(`%${user_email}%`);
    }

    if (action) {
      paramCount++;
      conditions.push(`action = $${paramCount}`);
      params.push(action);
    }

    if (resource) {
      paramCount++;
      conditions.push(`resource = $${paramCount}`);
      params.push(resource);
    }

    if (start_date) {
      paramCount++;
      conditions.push(`timestamp >= $${paramCount}`);
      params.push(start_date);
    }

    if (end_date) {
      paramCount++;
      conditions.push(`timestamp <= $${paramCount}`);
      params.push(end_date);
    }

    if (success !== undefined) {
      paramCount++;
      conditions.push(`success = $${paramCount}`);
      params.push(success === 'true');
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Get all matching records (no pagination for export)
    const query = `
      SELECT 
        timestamp,
        user_email,
        user_ip,
        action,
        resource,
        resource_id,
        success,
        COALESCE(metadata->>'userAgent', '') as user_agent,
        COALESCE(metadata->>'method', '') as http_method,
        COALESCE(metadata->>'url', '') as url
      FROM audit_logs 
      ${whereClause}
      ORDER BY timestamp DESC
    `;

    const result = await pool.query(query, params);

    // Log the export action
    await logAuditEvent({
      req,
      action: 'EXPORT',
      resource: 'audit_logs',
      success: true,
      additionalMetadata: {
        format: 'csv',
        filters: req.query,
        exportedCount: result.rows.length
      }
    });

    // Generate CSV content
    const csvHeaders = [
      'Timestamp',
      'User Email',
      'IP Address', 
      'Action',
      'Resource',
      'Resource ID',
      'Success',
      'User Agent',
      'HTTP Method',
      'URL'
    ];

    const csvRows = result.rows.map(row => [
      row.timestamp?.toISOString() || '',
      row.user_email || '',
      row.user_ip || '',
      row.action || '',
      row.resource || '',
      row.resource_id || '',
      row.success ? 'true' : 'false',
      row.user_agent || '',
      row.http_method || '',
      row.url || ''
    ]);

    const csvContent = [
      csvHeaders.join(','),
      ...csvRows.map(row => row.map(field => `"${field.toString().replace(/"/g, '""')}"`).join(','))
    ].join('\n');

    // Set CSV headers
    const timestamp = new Date().toISOString().split('T')[0];
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="audit_logs_${timestamp}.csv"`);
    
    res.send(csvContent);

  } catch (error) {
    logError(error, req, { operation: 'export_audit_logs', filters: req.query });
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;