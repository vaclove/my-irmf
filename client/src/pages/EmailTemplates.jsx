import { useState, useEffect } from 'react'
import { templateApi, editionApi } from '../utils/api'
import { useToast } from '../contexts/ToastContext'
import MDEditor from '@uiw/react-md-editor'
import '@uiw/react-md-editor/markdown-editor.css'
import '@uiw/react-markdown-preview/markdown.css'

function EmailTemplates() {
  const { success, error: showError } = useToast()
  const [editions, setEditions] = useState([])
  const [selectedEdition, setSelectedEdition] = useState(null)
  const [currentLanguage, setCurrentLanguage] = useState('english')
  const [templates, setTemplates] = useState({ english: null, czech: null })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  const [previewData, setPreviewData] = useState(null)
  const [compareMode, setCompareMode] = useState(false)
  const [editorMode, setEditorMode] = useState('edit') // 'edit', 'live', 'preview'

  // Form data for current language
  const [formData, setFormData] = useState({
    subject: '',
    content: '',
    accommodationContent: ''
  })
  
  // Track unsaved changes for both languages
  const [unsavedChanges, setUnsavedChanges] = useState({
    english: { subject: '', content: '', accommodationContent: '' },
    czech: { subject: '', content: '', accommodationContent: '' }
  })

  useEffect(() => {
    fetchEditions()
  }, [])

  // Handle Escape key for preview modal
  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === 'Escape' && showPreview) {
        setShowPreview(false)
      }
    }

    if (showPreview) {
      document.addEventListener('keydown', handleEscape)
    }

    return () => {
      document.removeEventListener('keydown', handleEscape)
    }
  }, [showPreview])

  useEffect(() => {
    if (selectedEdition) {
      fetchTemplates()
    }
  }, [selectedEdition])

  useEffect(() => {
    // Update form data when switching languages
    // Use unsaved changes if they exist, otherwise use template data
    const hasUnsavedChanges = unsavedChanges[currentLanguage].subject || unsavedChanges[currentLanguage].content
    
    if (hasUnsavedChanges) {
      setFormData({
        subject: unsavedChanges[currentLanguage].subject,
        content: unsavedChanges[currentLanguage].content,
        accommodationContent: unsavedChanges[currentLanguage].accommodationContent
      })
    } else if (templates[currentLanguage]) {
      const templateData = {
        subject: templates[currentLanguage].subject || '',
        content: templates[currentLanguage].markdown_content || templates[currentLanguage].body || '',
        accommodationContent: templates[currentLanguage].accommodation_content || ''
      }
      setFormData(templateData)
      // Initialize unsaved changes with template data
      setUnsavedChanges(prev => ({
        ...prev,
        [currentLanguage]: templateData
      }))
    } else {
      setFormData({ subject: '', content: '', accommodationContent: '' })
      setUnsavedChanges(prev => ({
        ...prev,
        [currentLanguage]: { subject: '', content: '', accommodationContent: '' }
      }))
    }
  }, [currentLanguage, templates])

  const fetchEditions = async () => {
    try {
      const response = await editionApi.getAll()
      setEditions(response.data)
      if (response.data.length > 0) {
        setSelectedEdition(response.data[0])
      }
    } catch (error) {
      console.error('Error fetching editions:', error)
    } finally {
      setLoading(false)
    }
  }

  const fetchTemplates = async () => {
    if (!selectedEdition) return
    
    try {
      setLoading(true)
      
      // Fetch both language templates
      const [englishResponse, czechResponse] = await Promise.allSettled([
        templateApi.getByLanguage(selectedEdition.id, 'english'),
        templateApi.getByLanguage(selectedEdition.id, 'czech')
      ])
      
      setTemplates({
        english: englishResponse.status === 'fulfilled' ? englishResponse.value.data : null,
        czech: czechResponse.status === 'fulfilled' ? czechResponse.value.data : null
      })
    } catch (error) {
      console.error('Error fetching templates:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async () => {
    if (!selectedEdition) return
    
    setSaving(true)
    try {
      await templateApi.createOrUpdate(selectedEdition.id, currentLanguage, {
        subject: formData.subject,
        markdown_content: formData.content,
        accommodation_content: formData.accommodationContent
      })
      
      // Refresh templates
      await fetchTemplates()
      
      // Clear unsaved changes for current language
      setUnsavedChanges(prev => ({
        ...prev,
        [currentLanguage]: { subject: '', content: '', accommodationContent: '' }
      }))
      
      success('Template saved successfully!')
    } catch (error) {
      console.error('Error saving template:', error)
      showError('Failed to save template: ' + (error.response?.data?.error || error.message))
    } finally {
      setSaving(false)
    }
  }

  const handlePreview = async () => {
    if (!selectedEdition || !formData.content) return
    
    try {
      // Generate preview using current form data instead of saved template
      const response = await templateApi.previewWithContent(selectedEdition.id, currentLanguage, {
        subject: formData.subject,
        markdown_content: formData.content,
        accommodation_content: formData.accommodationContent
      })
      setPreviewData(response.data)
      setShowPreview(true)
    } catch (error) {
      console.error('Error generating preview:', error)
      showError('Failed to generate preview: ' + (error.response?.data?.error || error.message))
    }
  }

  const handleLanguageSwitch = (language) => {
    setCurrentLanguage(language)
    setCompareMode(false)
  }

  const getLanguageLabel = (lang) => {
    return lang === 'english' ? 'English' : 'Čeština'
  }

  const getOtherLanguage = () => {
    return currentLanguage === 'english' ? 'czech' : 'english'
  }

  if (loading) {
    return <div className="text-center py-8">Loading templates...</div>
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-gray-900">Email Templates</h1>
        
        {/* Edition Selector */}
        <div className="flex items-center space-x-4">
          <label className="text-sm font-medium text-gray-700">Edition:</label>
          <select
            value={selectedEdition?.id || ''}
            onChange={(e) => {
              const edition = editions.find(ed => ed.id === e.target.value)
              setSelectedEdition(edition)
            }}
            className="border border-gray-300 rounded-md px-3 py-2"
          >
            {editions.map(edition => (
              <option key={edition.id} value={edition.id}>
                {edition.name} ({edition.year})
              </option>
            ))}
          </select>
        </div>
      </div>

      {selectedEdition && (
        <div className="bg-white shadow rounded-lg">
          {/* Language Navigation */}
          <div className="border-b border-gray-200 px-6 py-4">
            <div className="flex justify-between items-center">
              <div className="flex space-x-1">
                <button
                  onClick={() => handleLanguageSwitch('english')}
                  className={`px-4 py-2 rounded-md text-sm font-medium ${
                    currentLanguage === 'english' && !compareMode
                      ? 'bg-blue-600 text-white' 
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  English
                </button>
                <button
                  onClick={() => handleLanguageSwitch('czech')}
                  className={`px-4 py-2 rounded-md text-sm font-medium ${
                    currentLanguage === 'czech' && !compareMode
                      ? 'bg-blue-600 text-white' 
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  Čeština
                </button>
                <div className="border-l border-gray-300 ml-4 pl-4">
                  <button
                    onClick={() => setCompareMode(!compareMode)}
                    className={`px-4 py-2 rounded-md text-sm font-medium ${
                      compareMode
                        ? 'bg-green-600 text-white' 
                        : 'text-gray-600 hover:text-gray-900 border border-gray-300'
                    }`}
                  >
                    {compareMode ? 'Exit Compare' : 'Compare Languages'}
                  </button>
                </div>
              </div>
              
              <div className="flex space-x-3">
                <button
                  onClick={handlePreview}
                  disabled={!formData.content}
                  className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  Preview
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving || !formData.content}
                  className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                >
                  {saving ? 'Saving...' : 'Save Template'}
                </button>
              </div>
            </div>
          </div>

          {/* Editor Content */}
          <div className="p-6">
            {compareMode ? (
              /* Compare Mode - Side by Side */
              <div className="grid grid-cols-2 gap-6 compare-mode">
                <div>
                  <h3 className="text-lg font-medium mb-4">English Version</h3>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Subject</label>
                      <input
                        type="text"
                        value={unsavedChanges.english?.subject || templates.english?.subject || ''}
                        readOnly
                        className="w-full border border-gray-300 rounded-md px-3 py-2 bg-gray-50 text-gray-600"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Content</label>
                      <div className="border border-gray-300 rounded-md bg-gray-50">
                        <MDEditor
                          value={unsavedChanges.english?.content || templates.english?.markdown_content || templates.english?.body || ''}
                          preview="preview"
                          hideToolbar={true}
                          visibleDragBar={false}
                          data-color-mode="light"
                          height={400}
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Accommodation Info</label>
                      <textarea
                        value={unsavedChanges.english?.accommodationContent || templates.english?.accommodation_content || ''}
                        readOnly
                        className="w-full border border-gray-300 rounded-md px-3 py-2 bg-gray-50 text-gray-600"
                        rows={3}
                        placeholder="Auto-generated content"
                      />
                    </div>
                  </div>
                </div>
                
                <div>
                  <h3 className="text-lg font-medium mb-4">Czech Version</h3>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Subject</label>
                      <input
                        type="text"
                        value={unsavedChanges.czech?.subject || templates.czech?.subject || ''}
                        readOnly
                        className="w-full border border-gray-300 rounded-md px-3 py-2 bg-gray-50 text-gray-600"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Content</label>
                      <div className="border border-gray-300 rounded-md bg-gray-50">
                        <MDEditor
                          value={unsavedChanges.czech?.content || templates.czech?.markdown_content || templates.czech?.body || ''}
                          preview="preview"
                          hideToolbar={true}
                          visibleDragBar={false}
                          data-color-mode="light"
                          height={400}
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Accommodation Info</label>
                      <textarea
                        value={unsavedChanges.czech?.accommodationContent || templates.czech?.accommodation_content || ''}
                        readOnly
                        className="w-full border border-gray-300 rounded-md px-3 py-2 bg-gray-50 text-gray-600"
                        rows={3}
                        placeholder="Auto-generated content"
                      />
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              /* Edit Mode - Single Language */
              <div className="space-y-6">
                <div>
                  <div className="mb-4">
                    <h3 className="text-lg font-medium">
                      Editing: {getLanguageLabel(currentLanguage)} Template
                    </h3>
                  </div>
                  
                  {/* Subject Field */}
                  <div className="mb-6">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Email Subject
                    </label>
                    <input
                      type="text"
                      value={formData.subject}
                      onChange={(e) => {
                        const newFormData = { ...formData, subject: e.target.value }
                        setFormData(newFormData)
                        setUnsavedChanges(prev => ({
                          ...prev,
                          [currentLanguage]: newFormData
                        }))
                      }}
                      className="w-full border border-gray-300 rounded-md px-3 py-2"
                      placeholder="e.g., Invitation to {{edition_name}} - {{category}}"
                    />
                  </div>

                  {/* Content Field */}
                  <div>
                    <div className="mb-4">
                      <label className="block text-sm font-medium text-gray-700">
                        Email Content (Markdown)
                      </label>
                    </div>
                    <div className="border border-gray-300 rounded-md overflow-hidden">
                      <MDEditor
                        value={formData.content}
                        onChange={(val) => {
                          const newFormData = { ...formData, content: val || '' }
                          setFormData(newFormData)
                          setUnsavedChanges(prev => ({
                            ...prev,
                            [currentLanguage]: newFormData
                          }))
                        }}
                        preview={editorMode}
                        hideToolbar={false}
                        visibleDragBar={false}
                        textareaProps={{
                          placeholder: `Enter your email template content in Markdown...

Example:
{{greeting}},

We are delighted to invite you to **{{edition_name}}** as our honored {{category}}.

{{accommodation_info}}

Please [confirm your participation]({{confirmation_url}}).

Best regards,
Festival Team`,
                          style: {
                            fontSize: '14px',
                            fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Consolas, "Liberation Mono", Menlo, monospace',
                            lineHeight: '1.5',
                            minHeight: '400px'
                          }
                        }}
                        data-color-mode="light"
                        height={500}
                      />
                    </div>
                  </div>

                  {/* Accommodation Content Field */}
                  <div>
                    <div className="mb-4 mt-6">
                      <label className="block text-sm font-medium text-gray-700">
                        Accommodation Information
                      </label>
                      <p className="text-xs text-gray-500 mt-1">
                        Custom text that will replace the {'{{accommodation_info}}'} variable. Leave empty to use auto-generated content.
                      </p>
                    </div>
                    <textarea
                      value={formData.accommodationContent}
                      onChange={(e) => {
                        const newFormData = { ...formData, accommodationContent: e.target.value }
                        setFormData(newFormData)
                        setUnsavedChanges(prev => ({
                          ...prev,
                          [currentLanguage]: newFormData
                        }))
                      }}
                      className="w-full border border-gray-300 rounded-md px-3 py-2"
                      placeholder="🏨 Accommodation Included&#10;&#10;We have arranged accommodation for you for {{accommodation_nights_text}} during the festival.&#10;&#10;Details will be provided upon confirmation."
                      rows={4}
                    />
                  </div>
                </div>

                {/* Template Variables Help */}
                <div className="bg-blue-50 border border-blue-200 rounded-md p-4">
                  <h4 className="text-sm font-medium text-blue-900 mb-2">Available Template Variables:</h4>
                  <div className="grid grid-cols-2 gap-2 text-sm text-blue-800">
                    <code>{'{{greeting}}'}</code> <span className="text-blue-600">- Personalized greeting</span>
                    <code>{'{{guest_name}}'}</code> <span className="text-blue-600">- Full guest name</span>
                    <code>{'{{edition_name}}'}</code> <span className="text-blue-600">- Festival edition name</span>
                    <code>{'{{category}}'}</code> <span className="text-blue-600">- Guest category</span>
                    <code>{'{{confirmation_url}}'}</code> <span className="text-blue-600">- Confirmation link</span>
                    <code>{'{{accommodation_info}}'}</code> <span className="text-blue-600">- Accommodation details (conditional)</span>
                  </div>
                  <div className="mt-3 pt-3 border-t border-blue-200">
                    <h5 className="text-sm font-medium text-blue-900 mb-2">For Accommodation Content:</h5>
                    <div className="grid grid-cols-2 gap-2 text-sm text-blue-800">
                      <code>{'{{accommodation_nights_text}}'}</code> <span className="text-blue-600">- Language-aware: "2 nights" or "2 noci"</span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Preview Modal */}
      {showPreview && previewData && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[9999]" style={{ margin: 0, padding: 0, top: 0, left: 0, right: 0, bottom: 0 }}>
          <div className="bg-white rounded-lg max-w-4xl w-full mx-4 max-h-[90vh] overflow-hidden shadow-2xl">
            <div className="flex justify-between items-center p-6 border-b">
              <h3 className="text-lg font-medium">
                Email Preview - {getLanguageLabel(currentLanguage)}
              </h3>
              <button
                onClick={() => setShowPreview(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                ✕
              </button>
            </div>
            <div className="p-6 overflow-y-auto max-h-[calc(90vh-8rem)]">
              <div className="mb-4">
                <strong>Subject:</strong> {previewData.subject}
              </div>
              <div 
                className="border border-gray-300 rounded-md p-4 bg-white"
                dangerouslySetInnerHTML={{ __html: previewData.html_content }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default EmailTemplates