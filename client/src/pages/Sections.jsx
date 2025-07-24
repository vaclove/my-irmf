import { useState, useEffect, useCallback } from 'react'
import { useToast } from '../contexts/ToastContext'
import { useEdition } from '../contexts/EditionContext'
import Modal from '../components/Modal'
import { api } from '../utils/api'

function Sections() {
  const { success, error: showError } = useToast()
  const { selectedEdition } = useEdition()
  const [sections, setSections] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingSection, setEditingSection] = useState(null)
  const [formData, setFormData] = useState({
    key: '',
    name_cs: '',
    name_en: '',
    color_code: '#3B82F6',
    sort_order: 0
  })

  const resetForm = useCallback(() => {
    setFormData({
      key: '',
      name_cs: '',
      name_en: '',
      color_code: '#3B82F6',
      sort_order: 0
    })
    setEditingSection(null)
    setShowForm(false)
  }, [])

  const fetchSections = useCallback(async () => {
    if (!selectedEdition?.id) return
    
    try {
      setLoading(true)
      const response = await api.sections.getByEdition(selectedEdition.id)
      setSections(response.data)
    } catch (error) {
      console.error('Error fetching sections:', error)
      showError('Failed to load sections')
    } finally {
      setLoading(false)
    }
  }, [selectedEdition?.id, showError])

  useEffect(() => {
    fetchSections()
  }, [fetchSections])

  const handleSubmit = async (e) => {
    e.preventDefault()
    
    if (!formData.name_cs || !formData.name_en || !formData.color_code) {
      showError('Please fill in all required fields')
      return
    }

    try {
      const payload = {
        ...formData,
        edition_id: selectedEdition.id
      }

      if (editingSection) {
        await api.sections.update(editingSection.id, payload)
        success(`Section "${formData.name_cs}" updated successfully!`)
      } else {
        await api.sections.create(payload)
        success(`Section "${formData.name_cs}" created successfully!`)
      }
      
      resetForm()
      fetchSections()
    } catch (error) {
      console.error('Error saving section:', error)
      const errorMsg = error.response?.data?.error || 'Failed to save section'
      showError(errorMsg)
    }
  }

  const handleEdit = (section) => {
    setFormData({
      key: section.key,
      name_cs: section.name_cs,
      name_en: section.name_en,
      color_code: section.color_code,
      sort_order: section.sort_order
    })
    setEditingSection(section)
    setShowForm(true)
  }

  const handleDelete = async (section) => {
    if (!confirm(`Are you sure you want to delete the section "${section.name_cs}"? This action cannot be undone.`)) {
      return
    }

    try {
      await api.sections.delete(section.id)
      success(`Section "${section.name_cs}" deleted successfully!`)
      fetchSections()
    } catch (error) {
      console.error('Error deleting section:', error)
      const errorMsg = error.response?.data?.error || 'Failed to delete section'
      showError(errorMsg)
    }
  }

  const handleReorder = async (dragIndex, hoverIndex) => {
    const draggedSection = sections[dragIndex]
    const newSections = [...sections]
    newSections.splice(dragIndex, 1)
    newSections.splice(hoverIndex, 0, draggedSection)
    
    // Update sort orders
    const reorderedSections = newSections.map((section, index) => ({
      id: section.id,
      sort_order: index
    }))

    try {
      await api.sections.reorder(selectedEdition.id, { sections: reorderedSections })
      setSections(newSections)
      success('Sections reordered successfully!')
    } catch (error) {
      console.error('Error reordering sections:', error)
      showError('Failed to reorder sections')
      // Refresh to get current order
      fetchSections()
    }
  }

  if (!selectedEdition) {
    return (
      <div className="text-center py-12">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">No Edition Selected</h2>
        <p className="text-gray-600">Please select an edition to manage sections.</p>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="text-center py-12">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
        <p className="mt-4 text-gray-600">Loading sections...</p>
      </div>
    )
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Movie Sections</h1>
          <p className="text-sm text-gray-500 mt-1">
            Manage movie sections for {selectedEdition.name}
          </p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
        >
          <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
          </svg>
          Add Section
        </button>
      </div>

      {sections.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-lg shadow-sm border">
          <div className="text-4xl mb-4">🎬</div>
          <h3 className="text-lg font-medium text-gray-900 mb-2">No sections configured</h3>
          <p className="text-gray-500 mb-6">
            Get started by creating your first movie section with custom colors.
          </p>
          <button
            onClick={() => setShowForm(true)}
            className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
          >
            Create First Section
          </button>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow-sm border overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Color & Name
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Key
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  English Name
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Order
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {sections.map((section, index) => (
                <tr key={section.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      <div 
                        className="w-6 h-6 rounded-md mr-3 border border-gray-200"
                        style={{ backgroundColor: section.color_code }}
                        title={section.color_code}
                      ></div>
                      <div>
                        <div className="text-sm font-medium text-gray-900">
                          {section.name_cs}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
                      {section.key}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {section.name_en}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {section.sort_order}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <button
                      onClick={() => handleEdit(section)}
                      className="text-blue-600 hover:text-blue-900 mr-4"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(section)}
                      className="text-red-600 hover:text-red-900"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add/Edit Modal */}
      <Modal
        isOpen={showForm}
        onClose={resetForm}
        title={editingSection ? 'Edit Section' : 'Add New Section'}
      >
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="key" className="block text-sm font-medium text-gray-700 mb-1">
                Key *
              </label>
              <input
                type="text"
                id="key"
                value={formData.key}
                onChange={(e) => setFormData({ ...formData, key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') })}
                placeholder="feature, documentary, short..."
                className="block w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                required
                disabled={editingSection} // Don't allow editing key for existing sections
              />
              <p className="text-xs text-gray-500 mt-1">
                Internal identifier (lowercase, no spaces)
              </p>
            </div>
            
            <div>
              <label htmlFor="sort_order" className="block text-sm font-medium text-gray-700 mb-1">
                Sort Order
              </label>
              <input
                type="number"
                id="sort_order"
                value={formData.sort_order}
                onChange={(e) => setFormData({ ...formData, sort_order: parseInt(e.target.value) || 0 })}
                className="block w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                min="0"
              />
            </div>
          </div>

          <div>
            <label htmlFor="name_cs" className="block text-sm font-medium text-gray-700 mb-1">
              Czech Name *
            </label>
            <input
              type="text"
              id="name_cs"
              value={formData.name_cs}
              onChange={(e) => setFormData({ ...formData, name_cs: e.target.value })}
              placeholder="Celovečerní filmy"
              className="block w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              required
            />
          </div>

          <div>
            <label htmlFor="name_en" className="block text-sm font-medium text-gray-700 mb-1">
              English Name *
            </label>
            <input
              type="text"
              id="name_en"
              value={formData.name_en}
              onChange={(e) => setFormData({ ...formData, name_en: e.target.value })}
              placeholder="Feature Films"
              className="block w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              required
            />
          </div>

          <div>
            <label htmlFor="color_code" className="block text-sm font-medium text-gray-700 mb-1">
              Color Code *
            </label>
            <div className="flex items-center space-x-3">
              <input
                type="color"
                id="color_code"
                value={formData.color_code}
                onChange={(e) => setFormData({ ...formData, color_code: e.target.value })}
                className="h-10 w-20 border border-gray-300 rounded-md cursor-pointer"
              />
              <input
                type="text"
                value={formData.color_code}
                onChange={(e) => {
                  const value = e.target.value
                  if (/^#[0-9A-Fa-f]{0,6}$/.test(value)) {
                    setFormData({ ...formData, color_code: value })
                  }
                }}
                placeholder="#3B82F6"
                className="flex-1 border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                pattern="#[0-9A-Fa-f]{6}"
                required
              />
            </div>
            <p className="text-xs text-gray-500 mt-1">
              Hex color code (e.g., #3B82F6)
            </p>
          </div>

          <div className="flex justify-end space-x-3 pt-4">
            <button
              type="button"
              onClick={resetForm}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
            >
              {editingSection ? 'Update' : 'Create'} Section
            </button>
          </div>
        </form>
      </Modal>
    </div>
  )
}

export default Sections