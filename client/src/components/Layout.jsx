import { useState, useEffect } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useEdition } from '../contexts/EditionContext'

function Layout({ children }) {
  const location = useLocation()
  const { user, logout } = useAuth()
  const { selectedEdition } = useEdition()
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
  const [version, setVersion] = useState('')

  useEffect(() => {
    // Fetch version from backend
    fetch('/api/version')
      .then(res => res.json())
      .then(data => setVersion(data.version))
      .catch(() => setVersion('unknown'))
  }, [])

  const isActive = (path) => {
    if (path === '/' && location.pathname === '/') return true
    if (path !== '/' && location.pathname.startsWith(path)) return true
    return false
  }

  const toggleMobileMenu = () => {
    setIsMobileMenuOpen(!isMobileMenuOpen)
  }

  const closeMobileMenu = () => {
    setIsMobileMenuOpen(false)
  }

  const isDevelopment = process.env.NODE_ENV === 'development'

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className={`shadow-lg ${isDevelopment ? 'bg-blue-50 border-b border-blue-100' : 'bg-white'}`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            {/* Logo */}
            <div className="flex-shrink-0 flex items-center">
              <Link to="/" className="flex items-center" onClick={closeMobileMenu}>
                <img 
                  src="https://irmf.cz/wp-content/uploads/2022/07/irmf_web_logo_90px_black.png" 
                  alt="IRMF Logo" 
                  className="h-8 w-auto"
                  title={`IRMF Guest Manager v${version}`}
                />
                {selectedEdition && (
                  <span className="ml-2 px-2 py-1 text-xs font-medium text-white bg-gradient-to-r from-blue-600 to-blue-700 rounded-md">
                    {selectedEdition.year}
                  </span>
                )}
              </Link>
            </div>

            {/* Desktop Navigation */}
            <div className="hidden md:flex md:items-center md:space-x-8">
              <Link
                to="/invitations"
                className={`inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium ${
                  isActive('/invitations')
                    ? 'border-blue-500 text-gray-900'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                Invitations
              </Link>
              <Link
                to="/guests"
                onClick={() => {
                  // Force navigation to clean guests page
                  if (window.location.pathname === '/guests') {
                    window.location.href = '/guests'
                  }
                }}
                className={`inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium ${
                  isActive('/guests')
                    ? 'border-blue-500 text-gray-900'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                Guests
              </Link>
              <Link
                to="/templates"
                className={`inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium ${
                  isActive('/templates')
                    ? 'border-blue-500 text-gray-900'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                Templates
              </Link>
              {user?.email === 'vaclav@irmf.cz' && (
                <Link
                  to="/audit"
                  className={`inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium ${
                    isActive('/audit')
                      ? 'border-blue-500 text-gray-900'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                >
                  Audit Logs
                </Link>
              )}
            </div>

            {/* Desktop User Menu */}
            <div className="hidden md:flex md:items-center md:space-x-4">
              {user && (
                <>
                  <div className="flex items-center space-x-2">
                    {user.photo && (
                      <img 
                        src={user.photo} 
                        alt={user.name}
                        className="w-8 h-8 rounded-full"
                      />
                    )}
                    <span className="text-sm text-gray-700 hidden lg:block">{user.name}</span>
                  </div>
                  <button
                    onClick={logout}
                    className="text-sm text-gray-500 hover:text-gray-700 px-3 py-2 rounded-md hover:bg-gray-100"
                  >
                    Logout
                  </button>
                </>
              )}
            </div>

            {/* Mobile menu button */}
            <div className="md:hidden flex items-center">
              <button
                onClick={toggleMobileMenu}
                className="inline-flex items-center justify-center p-2 rounded-md text-gray-400 hover:text-gray-500 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-500"
                aria-expanded="false"
              >
                <span className="sr-only">Open main menu</span>
                {/* Hamburger icon */}
                <svg
                  className={`${isMobileMenuOpen ? 'hidden' : 'block'} h-6 w-6`}
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  aria-hidden="true"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
                {/* Close icon */}
                <svg
                  className={`${isMobileMenuOpen ? 'block' : 'hidden'} h-6 w-6`}
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  aria-hidden="true"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          {/* Mobile menu */}
          <div className={`${isMobileMenuOpen ? 'block' : 'hidden'} md:hidden`}>
            <div className="px-2 pt-2 pb-3 space-y-1 sm:px-3 border-t border-gray-200">
              <Link
                to="/invitations"
                onClick={closeMobileMenu}
                className={`block px-3 py-2 rounded-md text-base font-medium ${
                  isActive('/invitations')
                    ? 'text-blue-700 bg-blue-50'
                    : 'text-gray-700 hover:text-gray-900 hover:bg-gray-50'
                }`}
              >
                Invitations
              </Link>
              <Link
                to="/guests"
                onClick={() => {
                  closeMobileMenu()
                  // Force navigation to clean guests page
                  if (window.location.pathname === '/guests') {
                    window.location.href = '/guests'
                  }
                }}
                className={`block px-3 py-2 rounded-md text-base font-medium ${
                  isActive('/guests')
                    ? 'text-blue-700 bg-blue-50'
                    : 'text-gray-700 hover:text-gray-900 hover:bg-gray-50'
                }`}
              >
                Guests
              </Link>
              <Link
                to="/templates"
                onClick={closeMobileMenu}
                className={`block px-3 py-2 rounded-md text-base font-medium ${
                  isActive('/templates')
                    ? 'text-blue-700 bg-blue-50'
                    : 'text-gray-700 hover:text-gray-900 hover:bg-gray-50'
                }`}
              >
                Templates
              </Link>
              {user?.email === 'vaclav@irmf.cz' && (
                <Link
                  to="/audit"
                  onClick={closeMobileMenu}
                  className={`block px-3 py-2 rounded-md text-base font-medium ${
                    isActive('/audit')
                      ? 'text-blue-700 bg-blue-50'
                      : 'text-gray-700 hover:text-gray-900 hover:bg-gray-50'
                  }`}
                >
                  Audit Logs
                </Link>
              )}
              
              {/* Mobile User Section */}
              {user && (
                <div className="border-t border-gray-200 pt-4 mt-4">
                  <div className="flex items-center px-3 py-2">
                    {user.photo && (
                      <img 
                        src={user.photo} 
                        alt={user.name}
                        className="w-8 h-8 rounded-full mr-3"
                      />
                    )}
                    <span className="text-base font-medium text-gray-700">{user.name}</span>
                  </div>
                  <button
                    onClick={() => {
                      logout()
                      closeMobileMenu()
                    }}
                    className="block w-full text-left px-3 py-2 rounded-md text-base font-medium text-gray-700 hover:text-gray-900 hover:bg-gray-50"
                  >
                    Logout
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </nav>
      
      <main className="max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
        {children}
      </main>
    </div>
  )
}

export default Layout