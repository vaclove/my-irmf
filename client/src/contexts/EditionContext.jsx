import { createContext, useContext, useState, useEffect } from 'react'

const EditionContext = createContext()

export const useEdition = () => {
  const context = useContext(EditionContext)
  if (!context) {
    throw new Error('useEdition must be used within an EditionProvider')
  }
  return context
}

export const EditionProvider = ({ children }) => {
  const [selectedEdition, setSelectedEdition] = useState(null)
  const [loading, setLoading] = useState(true)

  // Load selected edition from localStorage on mount
  useEffect(() => {
    const storedEdition = localStorage.getItem('selectedEdition')
    if (storedEdition) {
      try {
        setSelectedEdition(JSON.parse(storedEdition))
      } catch (error) {
        console.error('Error parsing stored edition:', error)
        localStorage.removeItem('selectedEdition')
      }
    }
    setLoading(false)
  }, [])

  // Save selected edition to localStorage whenever it changes
  useEffect(() => {
    if (selectedEdition) {
      localStorage.setItem('selectedEdition', JSON.stringify(selectedEdition))
    } else {
      localStorage.removeItem('selectedEdition')
    }
  }, [selectedEdition])

  const selectEdition = (edition) => {
    setSelectedEdition(edition)
  }

  const clearSelection = () => {
    setSelectedEdition(null)
  }

  const value = {
    selectedEdition,
    selectEdition,
    clearSelection,
    loading
  }

  return (
    <EditionContext.Provider value={value}>
      {children}
    </EditionContext.Provider>
  )
}