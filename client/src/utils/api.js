import axios from 'axios'

// Use relative URLs in production, absolute URLs in development
const API_BASE_URL = import.meta.env.PROD 
  ? '/api'  // In production, API is served from same domain
  : 'http://localhost:3001/api'  // In development, API is on different port

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  withCredentials: true,
})

// Guests API
export const guestApi = {
  getAll: () => api.get('/guests'),
  getById: (id) => api.get(`/guests/${id}`),
  create: (guest) => api.post('/guests', guest),
  update: (id, guest) => api.put(`/guests/${id}`, guest),
  delete: (id) => api.delete(`/guests/${id}`),
  generateGreeting: (data) => api.post('/guests/generate-greeting', data),
}

// Editions API
export const editionApi = {
  getAll: () => api.get('/editions'),
  getById: (id) => api.get(`/editions/${id}`),
  create: (edition) => api.post('/editions', edition),
  getGuests: (id) => api.get(`/editions/${id}/guests`),
  assignGuest: (id, assignment) => api.post(`/editions/${id}/guests`, assignment),
  updateAssignment: (editionId, assignmentId, data) => 
    api.put(`/editions/${editionId}/guests/${assignmentId}`, data),
  removeGuest: (editionId, assignmentId) => 
    api.delete(`/editions/${editionId}/guests/${assignmentId}`),
  confirmGuest: (editionId, assignmentId) => 
    api.put(`/editions/${editionId}/guests/${assignmentId}/confirm`),
}

// Create a separate axios instance for public endpoints (no credentials)
const publicApi = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
})

// Invitations API
export const invitationApi = {
  send: (data) => api.post('/invitations/send', data),
  resend: (invitationId) => api.post('/invitations/resend', { invitation_id: invitationId }),
  delete: (invitationId) => api.delete(`/invitations/${invitationId}`),
  getByEdition: (editionId) => api.get(`/invitations/edition/${editionId}`),
  getAssignedNotInvited: (editionId) => api.get(`/invitations/edition/${editionId}/assigned-not-invited`),
  confirm: (token) => publicApi.post(`/confirm/${token}`),
  getStatus: (guestId, editionId) => publicApi.get(`/status/${guestId}/${editionId}`),
}

// Templates API
export const templateApi = {
  getByEdition: (editionId) => api.get(`/templates/edition/${editionId}`),
  getByLanguage: (editionId, language) => api.get(`/templates/edition/${editionId}/language/${language}`),
  createOrUpdate: (editionId, language, data) => api.put(`/templates/edition/${editionId}/language/${language}`, data),
  getVariables: () => api.get('/templates/variables'),
  preview: (editionId, language) => api.get(`/templates/preview/edition/${editionId}/language/${language}`),
  previewWithContent: (editionId, language, templateData) => api.post(`/templates/preview/edition/${editionId}/language/${language}`, templateData),
}

// Tags API
export const tagApi = {
  getAll: () => api.get('/tags'),
  create: (tag) => api.post('/tags', tag),
  update: (id, tag) => api.put(`/tags/${id}`, tag),
  delete: (id) => api.delete(`/tags/${id}`),
  checkDeletionStatus: (id) => api.get(`/tags/${id}/deletion-status`),
  assignToGuest: (guestId, tagId) => api.post('/tags/assign', { guest_id: guestId, tag_id: tagId }),
  removeFromGuest: (guestId, tagId) => api.delete(`/tags/assign/${guestId}/${tagId}`),
  getGuestTags: (guestId) => api.get(`/tags/guest/${guestId}`),
}

// Audit API
export const auditApi = {
  getLogs: (filters) => api.get('/audit', { params: filters }),
  getStats: (params) => api.get('/audit/stats', { params }),
  getById: (id) => api.get(`/audit/${id}`),
  exportCsv: (filters) => api.get('/audit/export/csv', { 
    params: filters,
    responseType: 'text'
  }),
}

// Badge API
export const badgeApi = {
  // Layouts
  getLayouts: (editionId) => api.get(`/badges/layouts/edition/${editionId}`),
  createLayout: (layout) => api.post('/badges/layouts', layout),
  updateLayout: (id, layout) => api.put(`/badges/layouts/${id}`, layout),
  deleteLayout: (id) => api.delete(`/badges/layouts/${id}`),
  
  // Assignments
  getAssignments: (editionId) => api.get(`/badges/assignments/edition/${editionId}`),
  updateAssignments: (editionId, assignments) => api.put(`/badges/assignments/edition/${editionId}`, { assignments }),
  
  // Badge numbers
  getBadgeNumbers: (editionId) => api.get(`/badges/numbers/edition/${editionId}`),
  assignBadgeNumber: (guestId, editionId) => api.post(`/badges/numbers/assign/${guestId}/${editionId}`),
  
  // Preview
  getPreview: (layoutId, guestId) => api.get(`/badges/preview/${layoutId}/${guestId}`),
  
  // Print data
  getPrintData: (guestId, editionId) => api.get(`/badges/print-data/${guestId}/${editionId}`),
}

// Movies API
export const movieApi = {
  getAll: (editionId) => api.get('/movies', { params: editionId ? { edition_id: editionId } : {} }),
  getById: (id) => api.get(`/movies/${id}`),
  create: (movie) => api.post('/movies', movie),
  update: (id, movie) => api.put(`/movies/${id}`, movie),
  delete: (id) => api.delete(`/movies/${id}`),
  getBySection: (section, editionId) => api.get(`/movies/section/${section}`, { params: editionId ? { edition_id: editionId } : {} }),
}

// Sections API
const sectionApi = {
  getByEdition: (editionId) => api.get(`/sections/edition/${editionId}`),
  getById: (id) => api.get(`/sections/${id}`),
  create: (section) => api.post('/sections', section),
  update: (id, section) => api.put(`/sections/${id}`, section),
  delete: (id) => api.delete(`/sections/${id}`),
  reorder: (editionId, data) => api.put(`/sections/edition/${editionId}/reorder`, data),
  initialize: (editionId) => api.post(`/sections/edition/${editionId}/initialize`),
}

// Export combined API object
const combinedApi = {
  ...api,
  sections: sectionApi
}

export { combinedApi as api }
export default api