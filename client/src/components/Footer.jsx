import { useState, useEffect } from 'react'

function Footer() {
  const [versions, setVersions] = useState({
    backend: 'unknown',
    frontend: 'unknown'
  })
  
  const [mailgunStats, setMailgunStats] = useState({
    configured: false,
    totalSent: 0,
    remaining: 100,
    dailyLimit: 100,
    percentageUsed: 0
  })

  useEffect(() => {
    // Fetch backend version from API
    fetch('/api/version')
      .then(res => res.json())
      .then(data => {
        setVersions(prev => ({ ...prev, backend: data.version }))
      })
      .catch(() => {
        setVersions(prev => ({ ...prev, backend: 'unknown' }))
      })
    
    // Fetch Mailgun stats
    fetch('/api/mailgun/stats')
      .then(res => res.json())
      .then(data => {
        setMailgunStats(data)
      })
      .catch(() => {
        setMailgunStats(prev => ({ ...prev, configured: false }))
      })
    
    // Get frontend version from build-time environment variable
    setVersions(prev => ({ ...prev, frontend: __APP_VERSION__ }))
  }, [])

  return (
    <footer className="bg-gray-100 border-t border-gray-200 mt-auto">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
        <div className="flex flex-col lg:flex-row justify-between items-center text-sm text-gray-600 space-y-2 lg:space-y-0">
          <div>
            © 2025 IRMF, z.s.
          </div>
          
          <div className="flex flex-col sm:flex-row items-center space-y-2 sm:space-y-0 sm:space-x-6">
            {mailgunStats.configured && (
              <div className="flex items-center space-x-2">
                <span>Mailgun:</span>
                <span className={`font-medium ${mailgunStats.percentageUsed > 80 ? 'text-red-600' : mailgunStats.percentageUsed > 60 ? 'text-yellow-600' : 'text-green-600'}`}>
                  {mailgunStats.totalSent}/{mailgunStats.dailyLimit || 100}
                </span>
              </div>
            )}
            
            <div className="flex space-x-4">
              <span>FE v{versions.frontend}</span>
              <span>BE v{versions.backend}</span>
            </div>
          </div>
        </div>
      </div>
    </footer>
  )
}

export default Footer