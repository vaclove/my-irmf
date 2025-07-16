import { Routes, Route } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import { ToastProvider } from './contexts/ToastContext'
import { EditionProvider } from './contexts/EditionContext'
import ProtectedRoute from './components/ProtectedRoute'
import Layout from './components/Layout'
import ToastContainer from './components/ToastContainer'
import Guests from './pages/Guests'
import Editions from './pages/Editions'
import EditionDetail from './pages/EditionDetail'
import Invitations from './pages/Invitations'
import EmailTemplates from './pages/EmailTemplates'
import AuditLogs from './pages/AuditLogs'
import Confirmation from './pages/Confirmation'

function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <EditionProvider>
          <Routes>
          {/* Public route for confirmation */}
          <Route path="/confirm/:token" element={<Confirmation />} />
          
          {/* Protected routes */}
          <Route path="/*" element={
            <ProtectedRoute>
              <Layout>
                <Routes>
                  <Route path="/" element={<Editions />} />
                  <Route path="/guests" element={<Guests />} />
                  <Route path="/editions" element={<Editions />} />
                  <Route path="/editions/:id" element={<EditionDetail />} />
                  <Route path="/invitations" element={<Invitations />} />
                  <Route path="/templates" element={<EmailTemplates />} />
                  <Route path="/audit" element={<AuditLogs />} />
                </Routes>
              </Layout>
            </ProtectedRoute>
          } />
          </Routes>
          <ToastContainer />
        </EditionProvider>
      </ToastProvider>
    </AuthProvider>
  )
}

export default App