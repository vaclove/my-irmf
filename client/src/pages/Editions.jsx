import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { editionApi } from '../utils/api'

function Editions() {
  const [editions, setEditions] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [formData, setFormData] = useState({
    year: new Date().getFullYear(),
    name: '',
    start_date: '',
    end_date: ''
  })

  useEffect(() => {
    fetchEditions()
  }, [])

  const fetchEditions = async () => {
    try {
      const response = await editionApi.getAll()
      setEditions(response.data)
    } catch (error) {
      console.error('Error fetching editions:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    try {
      await editionApi.create(formData)
      await fetchEditions()
      resetForm()
    } catch (error) {
      console.error('Error creating edition:', error)
    }
  }

  const resetForm = () => {
    setFormData({
      year: new Date().getFullYear(),
      name: '',
      start_date: '',
      end_date: ''
    })
    setShowForm(false)
  }

  if (loading) {
    return <div className="text-center py-8">Loading editions...</div>
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Festival Editions</h1>
        <button
          onClick={() => setShowForm(true)}
          className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700"
        >
          Create Edition
        </button>
      </div>

      {showForm && (
        <div className="bg-white shadow rounded-lg p-6 mb-6">
          <h2 className="text-lg font-medium mb-4">Create New Edition</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">Year</label>
                <input
                  type="number"
                  required
                  value={formData.year}
                  onChange={(e) => setFormData({ ...formData, year: parseInt(e.target.value) })}
                  className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Name</label>
                <input
                  type="text"
                  required
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="e.g., Festival 2025"
                  className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Start Date</label>
                <input
                  type="date"
                  value={formData.start_date}
                  onChange={(e) => setFormData({ ...formData, start_date: e.target.value })}
                  className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">End Date</label>
                <input
                  type="date"
                  value={formData.end_date}
                  onChange={(e) => setFormData({ ...formData, end_date: e.target.value })}
                  className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
                />
              </div>
            </div>
            <div className="flex space-x-3">
              <button
                type="submit"
                className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700"
              >
                Create Edition
              </button>
              <button
                type="button"
                onClick={resetForm}
                className="bg-gray-300 text-gray-700 px-4 py-2 rounded-md hover:bg-gray-400"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {editions.map((edition) => (
          <Link
            key={edition.id}
            to={`/editions/${edition.id}`}
            className="bg-white rounded-lg shadow hover:shadow-lg transition-shadow p-6 border border-gray-200"
          >
            <div className="flex justify-between items-start mb-4">
              <h3 className="text-lg font-semibold text-gray-900">{edition.name}</h3>
              <span className="bg-blue-100 text-blue-800 px-2 py-1 rounded text-sm font-medium">
                {edition.year}
              </span>
            </div>
            
            {edition.start_date && edition.end_date && (
              <p className="text-gray-600 text-sm mb-3">
                {new Date(edition.start_date).toLocaleDateString()} - {new Date(edition.end_date).toLocaleDateString()}
              </p>
            )}
            
            <div className="text-blue-600 text-sm font-medium">
              Manage Guests →
            </div>
          </Link>
        ))}
      </div>

      {editions.length === 0 && (
        <div className="text-center py-12">
          <h3 className="text-lg font-medium text-gray-900 mb-2">No editions yet</h3>
          <p className="text-gray-600 mb-4">Create your first festival edition to get started</p>
          <button
            onClick={() => setShowForm(true)}
            className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700"
          >
            Create First Edition
          </button>
        </div>
      )}
    </div>
  )
}

export default Editions