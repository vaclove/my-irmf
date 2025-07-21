import { useState, useRef, useEffect } from 'react'
import { getLanguageOptions, formatLanguagesDisplay } from '../utils/languageCodes'

const LanguagePicker = ({ 
  value = '', 
  onChange, 
  placeholder = 'Select languages...', 
  className = '',
  multiple = false,
  label = 'Language'
}) => {
  const [isOpen, setIsOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const dropdownRef = useRef(null)
  const inputRef = useRef(null)

  const languageOptions = getLanguageOptions()
  
  // Parse selected languages
  const selectedCodes = value ? value.split(',').map(code => code.trim().toLowerCase()) : []
  
  // Filter languages based on search
  const filteredLanguages = languageOptions.filter(lang =>
    lang.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    lang.code.toLowerCase().includes(searchQuery.toLowerCase())
  )

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false)
        setSearchQuery('')
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen])

  const handleLanguageToggle = (languageCode) => {
    const lowerCode = languageCode.toLowerCase()
    
    if (!multiple) {
      // Single selection mode
      onChange(lowerCode)
      setIsOpen(false)
      setSearchQuery('')
      return
    }

    // Multiple selection mode
    let newSelected
    if (selectedCodes.includes(lowerCode)) {
      // Remove if already selected
      newSelected = selectedCodes.filter(code => code !== lowerCode)
    } else {
      // Add if not selected
      newSelected = [...selectedCodes, lowerCode]
    }
    
    onChange(newSelected.join(','))
  }

  const handleRemoveLanguage = (languageCode) => {
    if (!multiple) return
    
    const lowerCode = languageCode.toLowerCase()
    const newSelected = selectedCodes.filter(code => code !== lowerCode)
    onChange(newSelected.join(','))
  }

  const displayInfo = formatLanguagesDisplay(value)

  return (
    <div className={`relative ${className}`} ref={dropdownRef}>
      <div
        className="w-full border border-gray-300 rounded-md px-3 py-2 bg-white cursor-pointer focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-blue-500"
        onClick={() => setIsOpen(!isOpen)}
      >
        <div className="flex flex-wrap items-center gap-1 min-h-[20px]">
          {displayInfo.languages.length > 0 ? (
            displayInfo.languages.map((lang, index) => (
              <span
                key={lang.code}
                className="inline-flex items-center bg-blue-100 text-blue-800 text-xs font-medium px-2 py-1 rounded-full"
              >
                <span className="mr-1 font-mono text-xs">{lang.code}</span>
                {lang.name}
                {multiple && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      handleRemoveLanguage(lang.code)
                    }}
                    className="ml-1 text-blue-600 hover:text-blue-800"
                  >
                    ×
                  </button>
                )}
              </span>
            ))
          ) : (
            <span className="text-gray-500 text-sm">{placeholder}</span>
          )}
        </div>
      </div>

      {isOpen && (
        <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-hidden">
          <div className="p-2 border-b">
            <input
              ref={inputRef}
              type="text"
              placeholder="Search languages..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
              autoFocus
            />
          </div>
          
          <div className="max-h-48 overflow-y-auto">
            {filteredLanguages.length > 0 ? (
              filteredLanguages.map((lang) => {
                const isSelected = selectedCodes.includes(lang.code.toLowerCase())
                
                return (
                  <button
                    key={lang.code}
                    type="button"
                    className={`w-full px-3 py-2 text-left hover:bg-gray-100 focus:bg-gray-100 focus:outline-none text-sm ${
                      isSelected ? 'bg-blue-50 text-blue-700' : 'text-gray-900'
                    }`}
                    onClick={() => handleLanguageToggle(lang.code)}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                        <span className="font-mono text-xs text-gray-500 w-8">
                          {lang.code.toUpperCase()}
                        </span>
                        <span>{lang.name}</span>
                      </div>
                      {isSelected && (
                        <span className="text-blue-600 text-xs">✓</span>
                      )}
                    </div>
                  </button>
                )
              })
            ) : (
              <div className="px-3 py-2 text-sm text-gray-500">
                No languages found
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default LanguagePicker