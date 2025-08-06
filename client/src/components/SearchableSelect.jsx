import React, { useState, useRef, useEffect } from 'react'

function SearchableSelect({ 
  options = [], 
  value, 
  onChange, 
  placeholder = "Search and select...",
  displayField = "label",
  valueField = "value",
  className = "",
  disabled = false,
  required = false
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [highlightedIndex, setHighlightedIndex] = useState(-1)
  const dropdownRef = useRef(null)
  const inputRef = useRef(null)
  const listRef = useRef(null)

  // Filter options based on search term
  const filteredOptions = options.filter(option => {
    const displayValue = typeof option === 'string' ? option : option[displayField]
    return displayValue?.toLowerCase().includes(searchTerm.toLowerCase())
  })

  // Get display value for selected option
  const getDisplayValue = (val) => {
    if (!val) return ''
    const option = options.find(opt => {
      const optValue = typeof opt === 'string' ? opt : opt[valueField]
      return optValue === val
    })
    if (!option) return ''
    return typeof option === 'string' ? option : option[displayField]
  }

  const selectedDisplayValue = getDisplayValue(value)

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false)
        setSearchTerm('')
        setHighlightedIndex(-1)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  useEffect(() => {
    if (isOpen && filteredOptions.length > 0) {
      setHighlightedIndex(0)
    }
  }, [isOpen, searchTerm])

  const handleInputFocus = () => {
    setIsOpen(true)
    setSearchTerm('')
  }

  const handleInputChange = (e) => {
    setSearchTerm(e.target.value)
    setIsOpen(true)
    setHighlightedIndex(0)
  }

  const handleOptionSelect = (option) => {
    const optValue = typeof option === 'string' ? option : option[valueField]
    onChange(optValue)
    setIsOpen(false)
    setSearchTerm('')
    setHighlightedIndex(-1)
    inputRef.current?.blur()
  }

  const handleKeyDown = (e) => {
    if (!isOpen) {
      if (e.key === 'Enter' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        setIsOpen(true)
      }
      return
    }

    switch (e.key) {
      case 'Escape':
        setIsOpen(false)
        setSearchTerm('')
        setHighlightedIndex(-1)
        inputRef.current?.blur()
        break
      case 'ArrowDown':
        e.preventDefault()
        setHighlightedIndex(prev => 
          prev < filteredOptions.length - 1 ? prev + 1 : 0
        )
        break
      case 'ArrowUp':
        e.preventDefault()
        setHighlightedIndex(prev => 
          prev > 0 ? prev - 1 : filteredOptions.length - 1
        )
        break
      case 'Enter':
        e.preventDefault()
        if (highlightedIndex >= 0 && filteredOptions[highlightedIndex]) {
          handleOptionSelect(filteredOptions[highlightedIndex])
        }
        break
    }
  }

  // Scroll highlighted option into view
  useEffect(() => {
    if (highlightedIndex >= 0 && listRef.current) {
      const highlightedElement = listRef.current.children[highlightedIndex]
      if (highlightedElement) {
        highlightedElement.scrollIntoView({
          block: 'nearest',
          behavior: 'smooth'
        })
      }
    }
  }, [highlightedIndex])

  return (
    <div ref={dropdownRef} className={`relative ${className}`}>
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={isOpen ? searchTerm : selectedDisplayValue}
          onChange={handleInputChange}
          onFocus={handleInputFocus}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          required={required}
          className="w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-blue-500 focus:border-blue-500 rounded-md disabled:bg-gray-100 disabled:cursor-not-allowed"
          autoComplete="off"
        />
        <div className="absolute inset-y-0 right-0 flex items-center pr-2 pointer-events-none">
          <svg
            className={`h-5 w-5 text-gray-400 transition-transform duration-200 ${
              isOpen ? 'transform rotate-180' : ''
            }`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </div>

      {isOpen && (
        <div className="absolute z-50 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-auto">
          {filteredOptions.length === 0 ? (
            <div className="px-3 py-2 text-sm text-gray-500">
              {searchTerm ? 'No results found' : 'No options available'}
            </div>
          ) : (
            <ul ref={listRef} className="py-1">
              {filteredOptions.map((option, index) => {
                const optValue = typeof option === 'string' ? option : option[valueField]
                const displayValue = typeof option === 'string' ? option : option[displayField]
                const isSelected = optValue === value
                const isHighlighted = index === highlightedIndex

                return (
                  <li
                    key={optValue}
                    onClick={() => handleOptionSelect(option)}
                    className={`px-3 py-2 cursor-pointer text-sm ${
                      isSelected
                        ? 'bg-blue-100 text-blue-900 font-medium'
                        : isHighlighted
                        ? 'bg-gray-100 text-gray-900'
                        : 'text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    {displayValue}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

export default SearchableSelect