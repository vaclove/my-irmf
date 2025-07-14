import { useState } from 'react'
import { tagApi } from '../utils/api'

const TagDeleteButton = ({ tag, onDeleteSuccess }) => {
  const [isChecking, setIsChecking] = useState(false)
  const [deletionStatus, setDeletionStatus] = useState(null)
  const [showConfirmDialog, setShowConfirmDialog] = useState(false)
  const [showRestrictionsDialog, setShowRestrictionsDialog] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)

  const handleDeleteClick = async (e) => {
    e.stopPropagation() // Prevent triggering the parent's onClick
    setIsChecking(true)
    try {
      const response = await tagApi.checkDeletionStatus(tag.id)
      setDeletionStatus(response.data)
      
      if (response.data.can_delete) {
        setShowConfirmDialog(true)
      } else {
        // Show restrictions dialog instead of alert
        setShowRestrictionsDialog(true)
      }
    } catch (error) {
      console.error('Error checking tag deletion status:', error)
      alert('Failed to check if tag can be deleted')
    } finally {
      setIsChecking(false)
    }
  }

  const confirmDelete = async () => {
    setIsDeleting(true)
    try {
      await tagApi.delete(tag.id)
      setShowConfirmDialog(false)
      onDeleteSuccess(tag.id)
    } catch (error) {
      console.error('Error deleting tag:', error)
      const errorData = error.response?.data
      
      if (errorData?.type === 'YEAR_TAG_WITH_INVITATIONS') {
        alert(`Cannot delete year tag: ${errorData.error}`)
      } else if (errorData?.type === 'TAG_ASSIGNED_TO_GUESTS') {
        alert(`Cannot delete tag: ${errorData.error}`)
      } else {
        alert(`Delete failed: ${errorData?.error || error.message || 'Unknown error'}`)
      }
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <>
      <button 
        onClick={handleDeleteClick}
        disabled={isChecking}
        className="text-red-600 hover:text-red-800 text-sm ml-2 disabled:opacity-50"
        title="Delete tag"
      >
        {isChecking ? '...' : '×'}
      </button>

      {showConfirmDialog && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-lg max-w-md w-full mx-4">
            <h3 className="text-lg font-medium mb-4">Confirm Delete</h3>
            <p className="text-gray-600 mb-6">
              Are you sure you want to delete the tag <strong>"{tag.name}"</strong>?
              {deletionStatus?.is_year_tag && (
                <span className="block mt-2 text-amber-600">
                  ⚠️ This is a year tag for an edition.
                </span>
              )}
            </p>
            
            <div className="flex gap-3 justify-end">
              <button 
                onClick={() => setShowConfirmDialog(false)} 
                className="px-4 py-2 text-gray-700 bg-gray-200 rounded hover:bg-gray-300"
                disabled={isDeleting}
              >
                Cancel
              </button>
              <button 
                onClick={confirmDelete} 
                className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
                disabled={isDeleting}
              >
                {isDeleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showRestrictionsDialog && deletionStatus && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-lg max-w-md w-full mx-4">
            <h3 className="text-lg font-medium mb-4">Cannot Delete Tag</h3>
            <p className="text-gray-600 mb-4">
              The tag <strong>"{tag.name}"</strong> cannot be deleted for the following reason(s):
            </p>
            
            <div className="mb-6 space-y-3">
              {deletionStatus.restrictions.map((restriction, index) => (
                <div key={index} className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded">
                  <span className="text-lg">
                    {restriction.type === 'YEAR_TAG_WITH_INVITATIONS' ? '🚫' : '👥'}
                  </span>
                  <div className="flex-1">
                    <p className="text-sm text-red-800">
                      {restriction.message}
                    </p>
                    {restriction.type === 'YEAR_TAG_WITH_INVITATIONS' && restriction.edition && (
                      <p className="text-xs text-red-600 mt-1">
                        Edition: {restriction.edition.name} ({restriction.edition.year})
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
            
            <div className="flex justify-end">
              <button 
                onClick={() => setShowRestrictionsDialog(false)} 
                className="px-4 py-2 text-gray-700 bg-gray-200 rounded hover:bg-gray-300"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

export default TagDeleteButton