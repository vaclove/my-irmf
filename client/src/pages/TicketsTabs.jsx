import React, { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import Presale from './Presale'
import Scanner from './Scanner'
import BoxOffice from './BoxOffice'
import Accreditations from './Accreditations'
import Dashboard from './Dashboard'

const TABS = [
  { key: 'box-office', path: '/tickets', label: '🎟️ Box office' },
  { key: 'accreditations', path: '/tickets/accreditations', label: '🪪 Accreditations' },
  { key: 'scan', path: '/tickets/scan', label: '📷 Scan' },
  { key: 'presale', path: '/tickets/presale', label: '📊 Presale' },
  { key: 'dashboard', path: '/tickets/dashboard', label: '📈 Dashboard' }
]

const TicketsTabs = () => {
  const location = useLocation()
  const navigate = useNavigate()
  const [scanning, setScanning] = useState(false)
  const activeTab = TABS.find(tab => tab.path === location.pathname)?.key || 'box-office'
  // Both routes share this instance, so scanning may be left over from the Scan tab
  const hideTabs = scanning && activeTab === 'scan'

  return (
    <div className="space-y-6">
      {/* Tab Navigation, hidden while the scanner camera runs */}
      {!hideTabs && (
        <div className="border-b border-gray-200 overflow-x-auto">
          <nav className="-mb-px flex space-x-8 whitespace-nowrap">
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
        {activeTab === 'box-office' && <BoxOffice />}
        {activeTab === 'accreditations' && <Accreditations />}
        {activeTab === 'scan' && <Scanner onScanningChange={setScanning} />}
        {activeTab === 'presale' && <Presale />}
        {activeTab === 'dashboard' && <Dashboard />}
      </div>
    </div>
  )
}

export default TicketsTabs
