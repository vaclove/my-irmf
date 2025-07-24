import React, { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useEdition } from '../contexts/EditionContext'
import Programming from './Programming'
import Blocks from './Blocks'
import Venues from './Venues'

const ProgrammingTabs = () => {
  const { selectedEdition } = useEdition()
  const location = useLocation()
  const navigate = useNavigate()
  
  // Determine active tab based on current route
  const getActiveTab = () => {
    if (location.pathname === '/blocks') return 'blocks'
    if (location.pathname === '/venues') return 'venues'
    return 'programming'
  }
  
  const [activeTab, setActiveTab] = useState(getActiveTab())

  const handleTabChange = (tab) => {
    setActiveTab(tab)
    if (tab === 'blocks') {
      navigate('/blocks')
    } else if (tab === 'venues') {
      navigate('/venues')
    } else {
      navigate('/programming')
    }
  }

  if (!selectedEdition) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500">Please select an edition to access programming features.</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Tab Navigation */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex space-x-8">
          <button
            onClick={() => handleTabChange('programming')}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'programming'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            📅 Schedule
          </button>
          <button
            onClick={() => handleTabChange('blocks')}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'blocks'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            🎬 Movie Blocks
          </button>
          <button
            onClick={() => handleTabChange('venues')}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'venues'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            🏛️ Venues
          </button>
        </nav>
      </div>

      {/* Tab Content */}
      <div>
        {activeTab === 'programming' && <Programming />}
        {activeTab === 'blocks' && <Blocks />}
        {activeTab === 'venues' && <Venues />}
      </div>
    </div>
  )
}

export default ProgrammingTabs