import axios from 'axios'

const API_BASE_URL = 'http://localhost:3001/api'

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
  confirm: (token) => publicApi.post(`/invitations/confirm/${token}`),
  getStatus: (guestId, editionId) => publicApi.get(`/invitations/status/${guestId}/${editionId}`),
}

// Templates API
export const templateApi = {
  getByEdition: (editionId) => api.get(`/templates/edition/${editionId}`),
  getByLanguage: (editionId, language) => api.get(`/templates/edition/${editionId}/language/${language}`),
  createOrUpdate: (editionId, language, data) => api.put(`/templates/edition/${editionId}/language/${language}`, data),
  getVariables: () => api.get('/templates/variables'),
  preview: (editionId, language) => api.get(`/templates/preview/edition/${editionId}/language/${language}`),
}

// Tags API
export const tagApi = {
  getAll: () => api.get('/tags'),
  create: (tag) => api.post('/tags', tag),
  update: (id, tag) => api.put(`/tags/${id}`, tag),
  delete: (id) => api.delete(`/tags/${id}`),
  assignToGuest: (guestId, tagId) => api.post('/tags/assign', { guest_id: guestId, tag_id: tagId }),
  removeFromGuest: (guestId, tagId) => api.delete(`/tags/assign/${guestId}/${tagId}`),
  getGuestTags: (guestId) => api.get(`/tags/guest/${guestId}`),
}

export default api