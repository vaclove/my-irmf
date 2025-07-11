import { useState } from 'react'

function JsonViewer({ data, label, className = "" }) {
  const [isExpanded, setIsExpanded] = useState(false)

  if (!data || (typeof data === 'object' && Object.keys(data).length === 0)) {
    return (
      <span className="text-gray-400 text-xs italic">
        {label === 'old_data' ? 'No previous data' : 'No data'}
      </span>
    )
  }

  const formatJsonValue = (value, key = '', depth = 0) => {
    const indent = '  '.repeat(depth)
    
    if (value === null) {
      return <span className="text-gray-500">null</span>
    }
    
    if (typeof value === 'boolean') {
      return <span className="text-blue-600">{value.toString()}</span>
    }
    
    if (typeof value === 'number') {
      return <span className="text-purple-600">{value}</span>
    }
    
    if (typeof value === 'string') {
      // Truncate very long strings
      const truncated = value.length > 100 ? value.substring(0, 100) + '...' : value
      return <span className="text-green-600">"{truncated}"</span>
    }
    
    if (Array.isArray(value)) {
      if (value.length === 0) {
        return <span className="text-gray-500">[]</span>
      }
      
      return (
        <div>
          <span className="text-gray-700">[</span>
          {value.map((item, index) => (
            <div key={index} className="ml-4">
              {formatJsonValue(item, '', depth + 1)}
              {index < value.length - 1 && <span className="text-gray-700">,</span>}
            </div>
          ))}
          <span className="text-gray-700">]</span>
        </div>
      )
    }
    
    if (typeof value === 'object') {
      const entries = Object.entries(value)
      if (entries.length === 0) {
        return <span className="text-gray-500">{'{}'}</span>
      }
      
      return (
        <div>
          <span className="text-gray-700">{'{'}</span>
          {entries.map(([objKey, objValue], index) => (
            <div key={objKey} className="ml-4">
              <span className="text-blue-800 font-medium">"{objKey}"</span>
              <span className="text-gray-700">: </span>
              {formatJsonValue(objValue, objKey, depth + 1)}
              {index < entries.length - 1 && <span className="text-gray-700">,</span>}
            </div>
          ))}
          <span className="text-gray-700">{'}'}</span>
        </div>
      )
    }
    
    return <span>{String(value)}</span>
  }

  const getPreviewText = () => {
    if (typeof data === 'string') {
      try {
        const parsed = JSON.parse(data)
        return getObjectPreview(parsed)
      } catch {
        return data.substring(0, 50) + (data.length > 50 ? '...' : '')
      }
    }
    return getObjectPreview(data)
  }

  const getObjectPreview = (obj) => {
    if (!obj || typeof obj !== 'object') return String(obj || '')
    
    const keys = Object.keys(obj)
    if (keys.length === 0) return '{}'
    
    // Show first few meaningful fields
    const meaningfulKeys = keys.filter(key => 
      !['id', 'created_at', 'updated_at'].includes(key) && 
      obj[key] !== null && 
      obj[key] !== undefined
    ).slice(0, 3)
    
    if (meaningfulKeys.length === 0) {
      return `{${keys.slice(0, 2).join(', ')}${keys.length > 2 ? '...' : ''}}`
    }
    
    return meaningfulKeys.map(key => {
      const value = obj[key]
      if (typeof value === 'string') {
        return `${key}: "${value.substring(0, 20)}${value.length > 20 ? '...' : ''}"`
      }
      return `${key}: ${value}`
    }).join(', ') + (keys.length > meaningfulKeys.length ? '...' : '')
  }

  const parseData = () => {
    if (typeof data === 'string') {
      try {
        return JSON.parse(data)
      } catch {
        return data
      }
    }
    return data
  }

  return (
    <div className={`${className}`}>
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center space-x-1 text-xs text-blue-600 hover:text-blue-800 focus:outline-none"
      >
        <span className={`transform transition-transform ${isExpanded ? 'rotate-90' : ''}`}>
          ▶
        </span>
        <span className="font-medium">{label}:</span>
        {!isExpanded && (
          <span className="text-gray-600 max-w-xs truncate">
            {getPreviewText()}
          </span>
        )}
      </button>
      
      {isExpanded && (
        <div className="mt-2 p-3 bg-gray-50 rounded border text-xs font-mono max-h-64 overflow-y-auto">
          {formatJsonValue(parseData())}
        </div>
      )}
    </div>
  )
}

export default JsonViewer