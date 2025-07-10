import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { invitationApi } from '../utils/api'

function Confirmation() {
  const { token } = useParams()
  const [status, setStatus] = useState('loading')
  const [confirmationData, setConfirmationData] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    confirmInvitation()
  }, [token])

  const confirmInvitation = async () => {
    try {
      const response = await invitationApi.confirm(token)
      setConfirmationData(response.data)
      setStatus('success')
    } catch (error) {
      console.error('Error confirming invitation:', error)
      setError(error.response?.data?.error || 'Failed to confirm invitation')
      setStatus('error')
    }
  }

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="max-w-md w-full bg-white shadow-lg rounded-lg p-8 text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Confirming your invitation...</h2>
          <p className="text-gray-600">Please wait while we process your confirmation.</p>
        </div>
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="max-w-md w-full bg-white shadow-lg rounded-lg p-8 text-center">
          <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path>
            </svg>
          </div>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Confirmation Failed</h2>
          <p className="text-gray-600 mb-4">{error}</p>
          <p className="text-sm text-gray-500">
            This link may have already been used or may have expired. 
            Please contact the festival organizers if you need assistance.
          </p>
        </div>
      </div>
    )
  }

  if (status === 'success') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="max-w-md w-full bg-white shadow-lg rounded-lg p-8 text-center">
          <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path>
            </svg>
          </div>
          
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Invitation Confirmed!</h2>
          
          <div className="bg-gray-50 rounded-lg p-4 mb-6">
            <p className="text-sm text-gray-600 mb-2">
              <strong>Guest:</strong> {confirmationData?.guest}
            </p>
            <p className="text-sm text-gray-600 mb-2">
              <strong>Event:</strong> {confirmationData?.edition}
            </p>
            <p className="text-sm text-gray-600 mb-2">
              <strong>Category:</strong> {confirmationData?.category}
            </p>
            <p className="text-sm text-gray-600">
              <strong>Confirmed at:</strong> {new Date(confirmationData?.confirmed_at).toLocaleString()}
            </p>
          </div>
          
          <p className="text-gray-600 mb-4">
            Thank you for confirming your attendance! We look forward to seeing you at the festival.
          </p>
          
          <p className="text-sm text-gray-500">
            You will receive further details about the event via email closer to the date.
          </p>
        </div>
      </div>
    )
  }

  return null
}

export default Confirmation