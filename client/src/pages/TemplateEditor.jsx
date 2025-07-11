import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { createEditor, Transforms, Editor as SlateEditor, Text } from 'slate'
import { Slate, Editable, withReact } from 'slate-react'
import { withHistory } from 'slate-history'
import { templateApi, editionApi } from '../utils/api'

function TemplateEditor() {
  const { editionId } = useParams()
  const navigate = useNavigate()
  const [edition, setEdition] = useState(null)
  const [templates, setTemplates] = useState({})
  const [variables, setVariables] = useState([])
  const [activeLanguage, setActiveLanguage] = useState('english')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [previewMode, setPreviewMode] = useState(false)
  const [previewContent, setPreviewContent] = useState(null)
  const [showRawHtml, setShowRawHtml] = useState(false)
  const editorRef = useRef(null)
  
  const [formData, setFormData] = useState({
    subject: '',
    html_content: ''
  })
  
  // Slate.js editor setup
  const editor = useMemo(() => withHistory(withReact(createEditor())), [])
  const [slateValue, setSlateValue] = useState([
    {
      type: 'paragraph',
      children: [{ text: '' }],
    },
  ])
  const [slateInitialized, setSlateInitialized] = useState(false)

  useEffect(() => {
    fetchData()
  }, [editionId])

  useEffect(() => {
    if (templates[activeLanguage]) {
      const content = templates[activeLanguage].html_content || ''
      setFormData({
        subject: templates[activeLanguage].subject || '',
        html_content: content
      })
      // Convert HTML to Slate value if needed
      if (content) {
        try {
          const newSlateValue = [{
            type: 'paragraph',
            children: [{ text: content.replace(/<[^>]*>/g, '') }] // Strip HTML for now
          }]
          setSlateValue(newSlateValue)
        } catch (error) {
          console.error('Error setting slate value:', error)
          setSlateValue([{
            type: 'paragraph',
            children: [{ text: '' }],
          }])
        }
      } else {
        setSlateValue([{
          type: 'paragraph',
          children: [{ text: '' }],
        }])
      }
    } else {
      setFormData({ subject: '', html_content: '' })
      setSlateValue([{
        type: 'paragraph',
        children: [{ text: '' }],
      }])
    }
    setSlateInitialized(true)
  }, [activeLanguage, templates])

  // Convert Slate value to HTML
  const slateToHtml = (nodes) => {
    return nodes.map(node => {
      if (Text.isText(node)) {
        let text = node.text
        if (node.bold) text = `<strong>${text}</strong>`
        if (node.italic) text = `<em>${text}</em>`
        if (node.underline) text = `<u>${text}</u>`
        if (node.variable) {
          text = `<span style="background-color: #e6f3ff; color: #005a87; font-weight: bold; padding: 2px 4px; border-radius: 3px; border: 1px solid #007cba;">${text}</span>`
        }
        return text
      } else {
        const children = slateToHtml(node.children)
        switch (node.type) {
          case 'paragraph':
            return `<p>${children}</p>`
          case 'heading':
            return `<h${node.level || 2}>${children}</h${node.level || 2}>`
          default:
            return children
        }
      }
    }).join('')
  }

  const fetchData = async () => {
    try {
      setLoading(true)
      
      // Fetch edition info
      const editionResponse = await editionApi.getById(editionId)
      setEdition(editionResponse.data)
      
      // Fetch templates for this edition
      const templatesResponse = await templateApi.getByEdition(editionId)
      const templatesMap = {}
      templatesResponse.data.forEach(template => {
        templatesMap[template.language] = template
      })
      setTemplates(templatesMap)
      
      // Fetch available variables
      const variablesResponse = await templateApi.getVariables()
      setVariables(variablesResponse.data)
      
    } catch (error) {
      console.error('Error fetching data:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async () => {
    try {
      setSaving(true)
      await templateApi.createOrUpdate(editionId, activeLanguage, formData)
      await fetchData() // Refresh templates
      alert('Template saved successfully!')
    } catch (error) {
      console.error('Error saving template:', error)
      alert('Failed to save template')
    } finally {
      setSaving(false)
    }
  }

  const handlePreview = async () => {
    try {
      const response = await templateApi.preview(editionId, activeLanguage)
      setPreviewContent(response.data)
      setPreviewMode(true)
    } catch (error) {
      console.error('Error generating preview:', error)
      alert('Failed to generate preview')
    }
  }

  const insertVariable = useCallback((variableName) => {
    const placeholder = `{{${variableName}}}`
    if (showRawHtml) {
      // For raw HTML mode
      const textarea = editorRef.current
      if (textarea) {
        const start = textarea.selectionStart
        const end = textarea.selectionEnd
        const text = formData.html_content
        const newText = text.substring(0, start) + placeholder + text.substring(end)
        
        setFormData({ ...formData, html_content: newText })
        
        setTimeout(() => {
          textarea.focus()
          textarea.setSelectionRange(start + placeholder.length, start + placeholder.length)
        }, 0)
      }
    } else {
      // For Slate WYSIWYG mode
      Transforms.insertText(editor, placeholder, {
        variable: true
      })
    }
  }, [showRawHtml, formData, editor])

  const handleSlateChange = useCallback((value) => {
    const html = slateToHtml(value)
    setFormData(prev => ({ ...prev, html_content: html }))
  }, [])

  // Slate formatting functions
  const toggleFormat = useCallback((format) => {
    const isActive = SlateEditor.marks(editor)?.[format]
    if (isActive) {
      SlateEditor.removeMark(editor, format)
    } else {
      SlateEditor.addMark(editor, format, true)
    }
  }, [editor])

  // Render function for Slate elements
  const renderElement = useCallback((props) => {
    switch (props.element.type) {
      case 'heading':
        const level = props.element.level || 2
        const Heading = `h${level}`
        return <Heading {...props.attributes}>{props.children}</Heading>
      default:
        return <p {...props.attributes}>{props.children}</p>
    }
  }, [])

  // Render function for Slate leaves (text formatting)
  const renderLeaf = useCallback((props) => {
    let { attributes, children, leaf } = props
    
    if (leaf.bold) {
      children = <strong>{children}</strong>
    }
    if (leaf.italic) {
      children = <em>{children}</em>
    }
    if (leaf.underline) {
      children = <u>{children}</u>
    }
    if (leaf.variable) {
      children = (
        <span
          style={{
            backgroundColor: '#e6f3ff',
            color: '#005a87',
            fontWeight: 'bold',
            padding: '2px 4px',
            borderRadius: '3px',
            border: '1px solid #007cba'
          }}
        >
          {children}
        </span>
      )
    }
    
    return <span {...attributes}>{children}</span>
  }, [])

  if (loading) {
    return <div className="text-center py-8">Loading template editor...</div>
  }

  if (!edition) {
    return <div className="text-center py-8">Edition not found</div>
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Email Templates</h1>
          <p className="text-gray-600">{edition.name} ({edition.year})</p>
        </div>
        <button
          onClick={() => navigate(`/editions/${editionId}`)}
          className="text-blue-600 hover:text-blue-800"
        >
          ← Back to Edition
        </button>
      </div>

      {/* Language Tabs */}
      <div className="bg-white shadow rounded-lg mb-6">
        <div className="border-b border-gray-200">
          <nav className="-mb-px flex">
            <button
              onClick={() => setActiveLanguage('english')}
              className={`py-4 px-6 text-sm font-medium border-b-2 ${
                activeLanguage === 'english'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              English Template
              {templates.english && <span className="ml-2 text-green-600">✓</span>}
            </button>
            <button
              onClick={() => setActiveLanguage('czech')}
              className={`py-4 px-6 text-sm font-medium border-b-2 ${
                activeLanguage === 'czech'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              Czech Template
              {templates.czech && <span className="ml-2 text-green-600">✓</span>}
            </button>
          </nav>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Main Editor */}
        <div className="lg:col-span-3">
          <div className="bg-white shadow rounded-lg p-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-medium">
                {activeLanguage === 'english' ? 'English' : 'Czech'} Template
              </h2>
              <div className="space-x-2">
                <button
                  onClick={() => setShowRawHtml(!showRawHtml)}
                  className={`px-4 py-2 rounded-md ${showRawHtml ? 'bg-blue-600 text-white hover:bg-blue-700' : 'bg-orange-600 text-white hover:bg-orange-700'}`}
                >
                  {showRawHtml ? 'WYSIWYG Editor' : 'Raw HTML'}
                </button>
                <button
                  onClick={handlePreview}
                  className="bg-gray-600 text-white px-4 py-2 rounded-md hover:bg-gray-700"
                >
                  Preview
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 disabled:opacity-50"
                >
                  {saving ? 'Saving...' : 'Save Template'}
                </button>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Email Subject
                </label>
                <input
                  type="text"
                  value={formData.subject}
                  onChange={(e) => setFormData({ ...formData, subject: e.target.value })}
                  className="w-full border border-gray-300 rounded-md px-3 py-2"
                  placeholder="Enter email subject..."
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Email Content
                </label>
                {showRawHtml ? (
                  <textarea
                    value={formData.html_content}
                    onChange={(e) => setFormData({ ...formData, html_content: e.target.value })}
                    className="w-full h-96 border border-gray-300 rounded-md px-3 py-2 font-mono text-sm"
                    placeholder="Enter HTML content..."
                  />
                ) : (
                  <div className="border border-gray-300 rounded-md">
                    <div className="bg-gray-50 px-3 py-2 border-b border-gray-300">
                      <div className="flex flex-wrap gap-2 mb-2">
                        <span className="text-sm text-gray-600 font-medium">Formatting:</span>
                        <button
                          type="button"
                          onClick={() => toggleFormat('bold')}
                          className="text-xs bg-gray-200 hover:bg-gray-300 px-2 py-1 rounded font-bold"
                        >
                          B
                        </button>
                        <button
                          type="button"
                          onClick={() => toggleFormat('italic')}
                          className="text-xs bg-gray-200 hover:bg-gray-300 px-2 py-1 rounded italic"
                        >
                          I
                        </button>
                        <button
                          type="button"
                          onClick={() => toggleFormat('underline')}
                          className="text-xs bg-gray-200 hover:bg-gray-300 px-2 py-1 rounded underline"
                        >
                          U
                        </button>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <span className="text-sm text-gray-600 font-medium">Variables:</span>
                        <button
                          type="button"
                          onClick={() => insertVariable('guest_name')}
                          className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded hover:bg-blue-200"
                        >
                          {'{{guest_name}}'}
                        </button>
                        <button
                          type="button"
                          onClick={() => insertVariable('edition_name')}
                          className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded hover:bg-blue-200"
                        >
                          {'{{edition_name}}'}
                        </button>
                        <button
                          type="button"
                          onClick={() => insertVariable('category')}
                          className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded hover:bg-blue-200"
                        >
                          {'{{category}}'}
                        </button>
                        <button
                          type="button"
                          onClick={() => insertVariable('confirmation_url')}
                          className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded hover:bg-blue-200"
                        >
                          {'{{confirmation_url}}'}
                        </button>
                      </div>
                    </div>
                    <div className="min-h-96 p-4" style={{ fontFamily: 'Arial, sans-serif' }}>
                      {slateInitialized && slateValue && Array.isArray(slateValue) && slateValue.length > 0 ? (
                        <Slate 
                          editor={editor} 
                          initialValue={slateValue}
                          onChange={handleSlateChange}
                        >
                          <Editable
                            renderElement={renderElement}
                            renderLeaf={renderLeaf}
                            placeholder="Create your email template here..."
                            style={{
                              minHeight: '300px',
                              lineHeight: '1.6',
                              color: '#333',
                              outline: 'none'
                            }}
                          />
                        </Slate>
                      ) : (
                        <div className="min-h-96 flex items-center justify-center text-gray-500">
                          Loading editor...
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {templates[activeLanguage] && (
              <div className="mt-4 text-sm text-gray-500">
                Last updated: {new Date(templates[activeLanguage].updated_at).toLocaleString()}
              </div>
            )}
          </div>
        </div>

        {/* Sidebar */}
        <div className="lg:col-span-1">
          <div className="bg-white shadow rounded-lg p-6">
            <h3 className="text-lg font-medium mb-4 flex items-center">
              <span className="mr-2">🏷️</span>
              Available Variables
            </h3>
            <div className="space-y-3">
              {variables.map((variable) => (
                <div key={variable.name} className="border border-gray-200 hover:border-blue-300 rounded-lg p-3 transition-colors">
                  <button
                    onClick={() => insertVariable(variable.name)}
                    className="w-full text-left group"
                  >
                    <div className="flex items-center justify-between">
                      <div className="font-mono text-sm text-blue-600 bg-blue-50 px-2 py-1 rounded group-hover:bg-blue-100">
                        {`{{${variable.name}}}`}
                      </div>
                      <span className="text-blue-600 opacity-0 group-hover:opacity-100 transition-opacity">
                        ➕
                      </span>
                    </div>
                    <div className="text-xs text-gray-600 mt-2">
                      {variable.description}
                    </div>
                    <div className="text-xs text-gray-500 mt-1 italic">
                      Example: {variable.example}
                    </div>
                  </button>
                </div>
              ))}
            </div>

            <div className="mt-6 p-4 bg-gradient-to-r from-blue-50 to-purple-50 rounded-lg border border-blue-200">
              <h4 className="text-sm font-medium text-blue-900 mb-2 flex items-center">
                <span className="mr-1">💡</span> Tips:
              </h4>
              <ul className="text-xs text-blue-800 space-y-1">
                <li>• Click variables to insert them into the editor</li>
                <li>• Slate.js editor provides modern rich text editing</li>
                <li>• Toggle to "Raw HTML" for advanced HTML editing</li>
                <li>• Use preview to see how emails will look</li>
                <li>• Variables are replaced when sending emails</li>
              </ul>
            </div>

            {!showRawHtml && (
              <div className="mt-4 p-3 bg-green-50 rounded-lg border border-green-200">
                <div className="text-xs text-green-800">
                  <strong>Slate.js Mode:</strong> Modern rich text editor with live formatting. Variables appear with blue highlighting. Use toolbar buttons for formatting.
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Preview Modal */}
      {previewMode && previewContent && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg max-w-4xl max-h-screen overflow-auto m-4">
            <div className="p-6 border-b">
              <div className="flex justify-between items-center">
                <div>
                  <h3 className="text-lg font-medium">Template Preview</h3>
                  <p className="text-sm text-gray-600">Subject: {previewContent.subject}</p>
                </div>
                <button
                  onClick={() => setPreviewMode(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  ✕
                </button>
              </div>
            </div>
            <div className="p-6">
              <div 
                className="border rounded-lg p-4"
                dangerouslySetInnerHTML={{ __html: previewContent.html_content }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default TemplateEditor