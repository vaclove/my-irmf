import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { badgeApi } from '../utils/api';
import BadgeDesigner from '../components/BadgeDesigner';

const BadgeSettings = () => {
  const { editionId } = useParams();
  const navigate = useNavigate();
  const [layouts, setLayouts] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState('layouts');
  const [showDesigner, setShowDesigner] = useState(false);
  const [editingLayout, setEditingLayout] = useState(null);

  const categories = ['filmmaker', 'press', 'guest', 'staff'];

  useEffect(() => {
    fetchData();
  }, [editionId]);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [layoutsResponse, assignmentsResponse] = await Promise.all([
        badgeApi.getLayouts(editionId),
        badgeApi.getAssignments(editionId)
      ]);
      
      setLayouts(layoutsResponse.data);
      setAssignments(assignmentsResponse.data);
    } catch (err) {
      setError('Failed to load badge settings');
      console.error('Error fetching badge data:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateLayout = () => {
    setEditingLayout(null);
    setShowDesigner(true);
  };

  const handleEditLayout = (layout) => {
    setEditingLayout(layout);
    setShowDesigner(true);
  };

  const handleSaveLayout = async (layoutData) => {
    try {
      if (editingLayout) {
        await badgeApi.updateLayout(editingLayout.id, layoutData);
      } else {
        await badgeApi.createLayout(layoutData);
      }
      
      setShowDesigner(false);
      setEditingLayout(null);
      fetchData();
    } catch (err) {
      setError('Failed to save layout');
      console.error('Error saving layout:', err);
    }
  };

  const handleDeleteLayout = async (layoutId) => {
    if (!window.confirm('Are you sure you want to delete this layout?')) {
      return;
    }

    try {
      await badgeApi.deleteLayout(layoutId);
      fetchData();
    } catch (err) {
      setError('Failed to delete layout');
      console.error('Error deleting layout:', err);
    }
  };

  const handleAssignmentChange = (category, layoutId) => {
    setAssignments(prev => {
      const existing = prev.find(a => a.category === category);
      if (existing) {
        return prev.map(a => 
          a.category === category ? { ...a, layout_id: layoutId } : a
        );
      } else {
        return [...prev, { category, layout_id: layoutId }];
      }
    });
  };

  const handleSaveAssignments = async () => {
    try {
      await badgeApi.updateAssignments(editionId, assignments);
      setError('');
      alert('Assignments saved successfully!');
    } catch (err) {
      setError('Failed to save assignments');
      console.error('Error saving assignments:', err);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (showDesigner) {
    return (
      <BadgeDesigner
        initialLayout={editingLayout}
        onSave={handleSaveLayout}
        onCancel={() => {
          setShowDesigner(false);
          setEditingLayout(null);
        }}
        editionId={editionId}
      />
    );
  }

  return (
    <div className="min-h-screen bg-gray-100">
      <div className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex justify-between items-center">
            <h1 className="text-2xl font-bold">Badge Settings</h1>
            <button
              onClick={() => navigate('/settings')}
              className="px-4 py-2 text-gray-600 border border-gray-300 rounded-md hover:bg-gray-50"
            >
              Back to Settings
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-6">
        {error && (
          <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-md">
            <p className="text-red-700">{error}</p>
          </div>
        )}

        {/* Tabs */}
        <div className="mb-6">
          <div className="border-b border-gray-200">
            <nav className="-mb-px flex space-x-8">
              <button
                onClick={() => setActiveTab('layouts')}
                className={`py-2 px-1 border-b-2 font-medium text-sm ${
                  activeTab === 'layouts'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                Layouts
              </button>
              <button
                onClick={() => setActiveTab('assignments')}
                className={`py-2 px-1 border-b-2 font-medium text-sm ${
                  activeTab === 'assignments'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                Category Assignments
              </button>
            </nav>
          </div>
        </div>

        {/* Layouts Tab */}
        {activeTab === 'layouts' && (
          <div>
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-semibold">Badge Layouts</h2>
              <button
                onClick={handleCreateLayout}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
              >
                Create New Layout
              </button>
            </div>

            {layouts.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-gray-500">No layouts created yet.</p>
                <button
                  onClick={handleCreateLayout}
                  className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                >
                  Create First Layout
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {layouts.map((layout) => (
                  <div key={layout.id} className="bg-white rounded-lg shadow-sm border p-4">
                    <div className="flex justify-between items-start mb-3">
                      <h3 className="text-lg font-medium">{layout.name}</h3>
                      <div className="flex space-x-2">
                        <button
                          onClick={() => handleEditLayout(layout)}
                          className="text-blue-600 hover:text-blue-800"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDeleteLayout(layout.id)}
                          className="text-red-600 hover:text-red-800"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                    
                    <div className="text-sm text-gray-600 mb-3">
                      <p>Size: {layout.canvas_width_mm}mm × {layout.canvas_height_mm}mm</p>
                      <p>Elements: {layout.layout_data?.elements?.length || 0}</p>
                    </div>
                    
                    <div 
                      className="border border-gray-200 rounded mx-auto"
                      style={{
                        width: Math.min(200, layout.canvas_width_mm * 2),
                        height: Math.min(120, layout.canvas_height_mm * 2),
                        backgroundColor: layout.background_color || '#ffffff'
                      }}
                    >
                      <div className="w-full h-full flex items-center justify-center text-xs text-gray-500">
                        Preview
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Assignments Tab */}
        {activeTab === 'assignments' && (
          <div>
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-semibold">Category Assignments</h2>
              <button
                onClick={handleSaveAssignments}
                className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700"
              >
                Save Assignments
              </button>
            </div>

            <div className="bg-white rounded-lg shadow-sm border overflow-hidden">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Category
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Assigned Layout
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {categories.map((category) => {
                    const assignment = assignments.find(a => a.category === category);
                    return (
                      <tr key={category}>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm font-medium text-gray-900 capitalize">
                            {category}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <select
                            value={assignment?.layout_id || ''}
                            onChange={(e) => handleAssignmentChange(category, e.target.value || null)}
                            className="px-3 py-2 border border-gray-300 rounded-md text-sm"
                          >
                            <option value="">No layout assigned</option>
                            {layouts.map((layout) => (
                              <option key={layout.id} value={layout.id}>
                                {layout.name}
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default BadgeSettings;