import React, { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import Presale from './Presale'
import Scanner from './Scanner'

const TABS = [
  { key: 'presale', path: '/tickets', label: '📊 Presale' },
  { key: 'scan', path: '/tickets/scan', label: '📷 Scan' }
]

const TicketsTabs = () => {
  const location = useLocation()
  const navigate = useNavigate()
  const [scanning, setScanning] = useState(false)
  const activeTab = location.pathname === '/tickets/scan' ? 'scan' : 'presale'
  // Both routes share this instance, so scanning may be left over from the Scan tab
  const hideTabs = scanning && activeTab === 'scan'

  return (
    <div className="space-y-6">
      {/* Tab Navigation, hidden while the scanner camera runs */}
      {!hideTabs && (
        <div className="border-b border-gray-200">
          <nav className="-mb-px flex space-x-8">
            {TABS.map(tab => (
              <button
                key={tab.key}
                onClick={() => navigate(tab.path)}
                className={`py-2 px-1 border-b-2 font-medium text-sm ${
                  activeTab === tab.key
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>
      )}

      {/* Tab Content */}
      <div>
        {activeTab === 'presale' && <Presale />}
        {activeTab === 'scan' && <Scanner onScanningChange={setScanning} />}
      </div>
    </div>
  )
}

export default TicketsTabs
