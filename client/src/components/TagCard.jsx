import { useState, useEffect } from 'react'
import { tagApi } from '../utils/api'
import TagDeleteButton from './TagDeleteButton'

const TagCard = ({ tag, isSelected, onToggleSelect, onDeleteSuccess }) => {
  const [deletionStatus, setDeletionStatus] = useState(null)
  const [loadingStatus, setLoadingStatus] = useState(true)

  useEffect(() => {
    // Load deletion status for the tag
    const loadDeletionStatus = async () => {
      try {
        const response = await tagApi.checkDeletionStatus(tag.id)
        setDeletionStatus(response.data)
      } catch (error) {
        console.error('Error loading deletion status:', error)
        setDeletionStatus(null)
      } finally {
        setLoadingStatus(false)
      }
    }

    loadDeletionStatus()
  }, [tag.id])

  const getButtonClasses = () => {
    const baseClasses = 'px-3 py-1 rounded-full text-sm font-medium border-2 transition-colors flex items-center justify-between min-w-0'
    
    if (isSelected) {
      return `${baseClasses} border-blue-500 text-white`
    } else {
      return `${baseClasses} border-gray-300 text-gray-700 hover:border-gray-400`
    }
  }

  const getBackgroundColor = () => {
    if (isSelected) {
      return tag.color
    }
    return 'white'
  }

  const getBorderColor = () => {
    if (isSelected) {
      return tag.color
    }
    return undefined
  }

  return (
    <div className="relative">
      <div
        className={getButtonClasses()}
        style={{
          backgroundColor: getBackgroundColor(),
          borderColor: getBorderColor()
        }}
      >
        <span 
          className="truncate cursor-pointer flex-1"
          onClick={onToggleSelect}
        >
          {tag.name} ({tag.guest_count || 0})
        </span>
        
        {/* Delete button */}
        <TagDeleteButton 
          tag={tag} 
          onDeleteSuccess={onDeleteSuccess}
        />
      </div>


      {/* Year tag indicator */}
      {!loadingStatus && deletionStatus?.is_year_tag && (
        <div className="absolute -top-1 -left-1 w-3 h-3 bg-blue-500 rounded-full"
             title="This is a year tag linked to an edition">
        </div>
      )}

    </div>
  )
}

export default TagCard