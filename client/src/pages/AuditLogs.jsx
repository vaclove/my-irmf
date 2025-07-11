import { useState, useEffect } from 'react'
import { auditApi } from '../utils/api'
import JsonViewer from '../components/JsonViewer'

function AuditLogs() {
  const [logs, setLogs] = useState([])
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [activeTab, setActiveTab] = useState('logs')
  const [expandedRows, setExpandedRows] = useState(new Set())
  
  // Filters
  const [filters, setFilters] = useState({
    page: 1,
    limit: 50,
    user_email: '',
    action: '',
    resource: '',
    resource_id: '',
    start_date: '',
    end_date: '',
    success: '',
    user_ip: ''
  })
  
  // Pagination
  const [pagination, setPagination] = useState({
    page: 1,
    totalPages: 1,
    totalCount: 0,
    hasNextPage: false,
    hasPrevPage: false
  })

  useEffect(() => {
    if (activeTab === 'logs') {
      fetchLogs()
    } else if (activeTab === 'stats') {
      fetchStats()
    }
  }, [filters, activeTab])

  const fetchLogs = async () => {
    try {
      setLoading(true)
      setError(null)
      
      // Remove empty filter values
      const cleanFilters = Object.fromEntries(
        Object.entries(filters).filter(([_, value]) => value !== '')
      )
      
      const response = await auditApi.getLogs(cleanFilters)
      setLogs(response.data.logs)
      setPagination(response.data.pagination)
    } catch (err) {
      if (err.response?.status === 403) {
        setError('Access denied. Admin privileges required.')
      } else {
        setError(err.response?.data?.error || 'Failed to fetch audit logs')
      }
    } finally {
      setLoading(false)
    }
  }

  const fetchStats = async () => {
    try {
      setLoading(true)
      setError(null)
      const response = await auditApi.getStats({ days: 30 })
      setStats(response.data)
    } catch (err) {
      if (err.response?.status === 403) {
        setError('Access denied. Admin privileges required.')
      } else {
        setError(err.response?.data?.error || 'Failed to fetch audit statistics')
      }
    } finally {
      setLoading(false)
    }
  }

  const handleFilterChange = (field, value) => {
    setFilters(prev => ({
      ...prev,
      [field]: value,
      page: 1 // Reset to first page when filtering
    }))
  }

  const handlePageChange = (newPage) => {
    setFilters(prev => ({
      ...prev,
      page: newPage
    }))
  }

  const clearFilters = () => {
    setFilters({
      page: 1,
      limit: 50,
      user_email: '',
      action: '',
      resource: '',
      resource_id: '',
      start_date: '',
      end_date: '',
      success: '',
      user_ip: ''
    })
  }

  const exportToCsv = async () => {
    try {
      // Remove pagination params for export
      const exportFilters = { ...filters }
      delete exportFilters.page
      delete exportFilters.limit
      
      const cleanFilters = Object.fromEntries(
        Object.entries(exportFilters).filter(([_, value]) => value !== '')
      )
      
      const response = await auditApi.exportCsv(cleanFilters)
      
      // Create download link
      const blob = new Blob([response.data], { type: 'text/csv' })
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      
      const timestamp = new Date().toISOString().split('T')[0]
      link.download = `audit_logs_${timestamp}.csv`
      
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      window.URL.revokeObjectURL(url)
    } catch (err) {
      setError('Failed to export audit logs')
    }
  }

  const formatTimestamp = (timestamp) => {
    return new Date(timestamp).toLocaleString()
  }

  const toggleRowExpansion = (logId) => {
    const newExpandedRows = new Set(expandedRows)
    if (newExpandedRows.has(logId)) {
      newExpandedRows.delete(logId)
    } else {
      newExpandedRows.add(logId)
    }
    setExpandedRows(newExpandedRows)
  }

  const hasDataToShow = (log) => {
    return (log.old_data && Object.keys(log.old_data).length > 0) || 
           (log.new_data && Object.keys(log.new_data).length > 0)
  }

  const getActionBadge = (action, success) => {
    const colors = {
      CREATE: success ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800',
      READ: success ? 'bg-blue-100 text-blue-800' : 'bg-red-100 text-red-800',
      UPDATE: success ? 'bg-yellow-100 text-yellow-800' : 'bg-red-100 text-red-800',
      DELETE: success ? 'bg-red-100 text-red-900' : 'bg-red-100 text-red-800',
      LOGIN: success ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800',
      LOGOUT: success ? 'bg-gray-100 text-gray-800' : 'bg-red-100 text-red-800',
      AUTH_FAIL: 'bg-red-100 text-red-800',
      EXPORT: success ? 'bg-purple-100 text-purple-800' : 'bg-red-100 text-red-800'
    }
    
    return (
      <span className={`px-2 py-1 rounded text-xs font-medium ${colors[action] || 'bg-gray-100 text-gray-800'}`}>
        {action}
      </span>
    )
  }

  const getResourceBadge = (resource) => {
    const colors = {
      guests: 'bg-blue-100 text-blue-800',
      editions: 'bg-green-100 text-green-800',
      tags: 'bg-purple-100 text-purple-800',
      invitations: 'bg-yellow-100 text-yellow-800',
      authentication: 'bg-red-100 text-red-800',
      audit_logs: 'bg-gray-100 text-gray-800'
    }
    
    return (
      <span className={`px-2 py-1 rounded text-xs font-medium ${colors[resource] || 'bg-gray-100 text-gray-800'}`}>
        {resource}
      </span>
    )
  }

  if (error) {
    return (
      <div className="text-center py-8">
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
          {error}
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Audit Logs</h1>
        <p className="text-gray-600">System activity monitoring and audit trail</p>
      </div>

      {/* Tab Navigation */}
      <div className="border-b border-gray-200 mb-6">
        <nav className="-mb-px flex space-x-8">
          <button
            onClick={() => setActiveTab('logs')}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'logs'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Audit Logs
          </button>
          <button
            onClick={() => setActiveTab('stats')}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'stats'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Statistics
          </button>
        </nav>
      </div>

      {activeTab === 'logs' && (
        <>
          {/* Filters */}
          <div className="bg-white shadow rounded-lg p-4 mb-6">
            <h3 className="text-sm font-medium text-gray-700 mb-3">Filters</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">User Email</label>
                <input
                  type="text"
                  value={filters.user_email}
                  onChange={(e) => handleFilterChange('user_email', e.target.value)}
                  placeholder="Filter by email..."
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Action</label>
                <select
                  value={filters.action}
                  onChange={(e) => handleFilterChange('action', e.target.value)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                >
                  <option value="">All Actions</option>
                  <option value="CREATE">Create</option>
                  <option value="READ">Read</option>
                  <option value="UPDATE">Update</option>
                  <option value="DELETE">Delete</option>
                  <option value="LOGIN">Login</option>
                  <option value="LOGOUT">Logout</option>
                  <option value="AUTH_FAIL">Auth Failure</option>
                  <option value="EXPORT">Export</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Resource</label>
                <select
                  value={filters.resource}
                  onChange={(e) => handleFilterChange('resource', e.target.value)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                >
                  <option value="">All Resources</option>
                  <option value="guests">Guests</option>
                  <option value="editions">Editions</option>
                  <option value="tags">Tags</option>
                  <option value="invitations">Invitations</option>
                  <option value="authentication">Authentication</option>
                  <option value="audit_logs">Audit Logs</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Success</label>
                <select
                  value={filters.success}
                  onChange={(e) => handleFilterChange('success', e.target.value)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                >
                  <option value="">All</option>
                  <option value="true">Success</option>
                  <option value="false">Failure</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Start Date</label>
                <input
                  type="date"
                  value={filters.start_date}
                  onChange={(e) => handleFilterChange('start_date', e.target.value)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">End Date</label>
                <input
                  type="date"
                  value={filters.end_date}
                  onChange={(e) => handleFilterChange('end_date', e.target.value)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">IP Address</label>
                <input
                  type="text"
                  value={filters.user_ip}
                  onChange={(e) => handleFilterChange('user_ip', e.target.value)}
                  placeholder="Filter by IP..."
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                />
              </div>
              <div className="flex items-end space-x-2">
                <button
                  onClick={clearFilters}
                  className="bg-gray-200 text-gray-700 px-3 py-2 rounded-md hover:bg-gray-300 text-sm"
                >
                  Clear
                </button>
                <button
                  onClick={exportToCsv}
                  className="bg-blue-600 text-white px-3 py-2 rounded-md hover:bg-blue-700 text-sm"
                >
                  Export CSV
                </button>
              </div>
            </div>
          </div>

          {/* Results count and pagination info */}
          {!loading && (
            <div className="flex justify-between items-center mb-4">
              <div className="text-sm text-gray-600">
                Showing {((pagination.page - 1) * filters.limit) + 1} to {Math.min(pagination.page * filters.limit, pagination.totalCount)} of {pagination.totalCount} entries
              </div>
              <div className="text-sm text-gray-600">
                Page {pagination.page} of {pagination.totalPages}
              </div>
            </div>
          )}

          {/* Audit Logs Table */}
          <div className="bg-white shadow rounded-lg overflow-hidden">
            {loading ? (
              <div className="text-center py-8">Loading audit logs...</div>
            ) : logs.length === 0 ? (
              <div className="text-center py-8">No audit logs found</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase w-4"></th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Timestamp</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">User</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">IP</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Action</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Resource</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Resource ID</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Success</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {logs.map((log) => (
                      <>
                        <tr key={log.id} className="hover:bg-gray-50">
                          <td className="px-6 py-4 whitespace-nowrap">
                            {hasDataToShow(log) && (
                              <button
                                onClick={() => toggleRowExpansion(log.id)}
                                className="text-gray-400 hover:text-gray-600 focus:outline-none"
                              >
                                <span className={`transform transition-transform ${
                                  expandedRows.has(log.id) ? 'rotate-90' : ''
                                }`}>
                                  ▶
                                </span>
                              </button>
                            )}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                            {formatTimestamp(log.timestamp)}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                            {log.user_email || 'Anonymous'}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                            {log.user_ip || 'Unknown'}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            {getActionBadge(log.action, log.success)}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            {getResourceBadge(log.resource)}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 max-w-xs truncate">
                            {log.resource_id || '-'}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className={`px-2 py-1 rounded text-xs font-medium ${
                              log.success 
                                ? 'bg-green-100 text-green-800' 
                                : 'bg-red-100 text-red-800'
                            }`}>
                              {log.success ? 'Success' : 'Failure'}
                            </span>
                          </td>
                        </tr>
                        {expandedRows.has(log.id) && hasDataToShow(log) && (
                          <tr key={`${log.id}-expanded`} className="bg-gray-50">
                            <td></td>
                            <td colSpan="7" className="px-6 py-4">
                              <div className="space-y-4">
                                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                  {log.old_data && Object.keys(log.old_data).length > 0 && (
                                    <div>
                                      <JsonViewer 
                                        data={log.old_data} 
                                        label="Previous Data"
                                        className="mb-2"
                                      />
                                    </div>
                                  )}
                                  {log.new_data && Object.keys(log.new_data).length > 0 && (
                                    <div>
                                      <JsonViewer 
                                        data={log.new_data} 
                                        label="New Data"
                                        className="mb-2"
                                      />
                                    </div>
                                  )}
                                </div>
                                {log.metadata && Object.keys(log.metadata).length > 0 && (
                                  <div className="border-t pt-4">
                                    <JsonViewer 
                                      data={log.metadata} 
                                      label="Metadata"
                                      className="mb-2"
                                    />
                                  </div>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Pagination */}
          {!loading && logs.length > 0 && (
            <div className="flex justify-between items-center mt-6">
              <button
                onClick={() => handlePageChange(pagination.page - 1)}
                disabled={!pagination.hasPrevPage}
                className="bg-white border border-gray-300 text-gray-700 px-4 py-2 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Previous
              </button>
              <span className="text-sm text-gray-600">
                Page {pagination.page} of {pagination.totalPages}
              </span>
              <button
                onClick={() => handlePageChange(pagination.page + 1)}
                disabled={!pagination.hasNextPage}
                className="bg-white border border-gray-300 text-gray-700 px-4 py-2 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Next
              </button>
            </div>
          )}
        </>
      )}

      {activeTab === 'stats' && (
        <div className="space-y-6">
          {loading ? (
            <div className="text-center py-8">Loading statistics...</div>
          ) : stats ? (
            <>
              {/* Action Stats */}
              <div className="bg-white shadow rounded-lg p-6">
                <h3 className="text-lg font-medium text-gray-900 mb-4">Action Statistics (Last 30 Days)</h3>
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Action</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Resource</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Total</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Success</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Failures</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Unique Users</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {stats.actionStats.map((stat, index) => (
                        <tr key={index}>
                          <td className="px-6 py-4 whitespace-nowrap">
                            {getActionBadge(stat.action, true)}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            {getResourceBadge(stat.resource)}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{stat.count}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-green-600">{stat.success_count}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-red-600">{stat.failure_count}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{stat.unique_users}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Top Users */}
              <div className="bg-white shadow rounded-lg p-6">
                <h3 className="text-lg font-medium text-gray-900 mb-4">Most Active Users (Last 30 Days)</h3>
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">User Email</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Failures</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Last Activity</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {stats.topUsers.map((user, index) => (
                        <tr key={index}>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{user.user_email}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{user.action_count}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-red-600">{user.failure_count}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                            {formatTimestamp(user.last_activity)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          ) : (
            <div className="text-center py-8">No statistics available</div>
          )}
        </div>
      )}
    </div>
  )
}

export default AuditLogs