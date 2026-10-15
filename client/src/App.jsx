import { Routes, Route, Navigate, useLocation, useParams } from 'react-router-dom'
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
import Movies from './pages/Movies'
import MovieDetail from './pages/MovieDetail'
import SubtitleEditor from './pages/SubtitleEditor'
import ProgrammingTabs from './pages/ProgrammingTabs'
import Venues from './pages/Venues'
import AuditLogs from './pages/AuditLogs'
import BadgeSettings from './pages/BadgeSettings'
import Settings from './pages/Settings'
import Sections from './pages/Sections'
import AccommodationSettings from './pages/AccommodationSettings'
import Confirmation from './pages/Confirmation'
import TicketsTabs from './pages/TicketsTabs'

// Old URLs (bookmarks, links in emails) keep working
function RedirectTo({ to }) {
  const params = useParams()
  const location = useLocation()
  const path = to.replace(/:(\w+)/g, (_, name) => params[name])
  return <Navigate to={`${path}${location.search}${location.hash}`} replace />
}

function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <EditionProvider>
          <Routes>
          {/* Public route for confirmation */}
          <Route path="/confirm/:token" element={<Confirmation />} />

          {/* Fullscreen editor — auth-protected but rendered without app chrome */}
          <Route path="/catalogue/:id/subtitles" element={
            <ProtectedRoute>
              <SubtitleEditor />
            </ProtectedRoute>
          } />

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
                  <Route path="/catalogue" element={<Movies />} />
                  <Route path="/catalogue/:id" element={<MovieDetail />} />
                  <Route path="/programme" element={<ProgrammingTabs />} />
                  <Route path="/programme/blocks" element={<ProgrammingTabs />} />
                  <Route path="/programme/venues" element={<ProgrammingTabs />} />
                  <Route path="/tickets" element={<TicketsTabs />} />
                  <Route path="/tickets/scan" element={<TicketsTabs />} />
                  <Route path="/badges/:editionId" element={<BadgeSettings />} />
                  <Route path="/settings" element={<Settings />} />
                  <Route path="/settings/sections" element={<Sections />} />
                  <Route path="/settings/accommodation" element={<AccommodationSettings />} />
                  <Route path="/audit" element={<AuditLogs />} />
                  <Route path="/movies" element={<RedirectTo to="/catalogue" />} />
                  <Route path="/movies/:id" element={<RedirectTo to="/catalogue/:id" />} />
                  <Route path="/movies/:id/subtitles" element={<RedirectTo to="/catalogue/:id/subtitles" />} />
                  <Route path="/programming" element={<RedirectTo to="/programme" />} />
                  <Route path="/blocks" element={<RedirectTo to="/programme/blocks" />} />
                  <Route path="/venues" element={<RedirectTo to="/programme/venues" />} />
                  <Route path="/scanner" element={<RedirectTo to="/tickets/scan" />} />
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