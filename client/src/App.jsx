import { Routes, Route } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import ProtectedRoute from './components/ProtectedRoute'
import Layout from './components/Layout'
import Guests from './pages/Guests'
import Editions from './pages/Editions'
import EditionDetail from './pages/EditionDetail'
import TemplateEditor from './pages/TemplateEditor'
import Confirmation from './pages/Confirmation'

function App() {
  return (
    <AuthProvider>
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
                <Route path="/editions/:editionId/templates" element={<TemplateEditor />} />
              </Routes>
            </Layout>
          </ProtectedRoute>
        } />
      </Routes>
    </AuthProvider>
  )
}

export default App