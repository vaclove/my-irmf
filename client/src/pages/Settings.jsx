import React from 'react';
import { Link } from 'react-router-dom';
import { useEdition } from '../contexts/EditionContext';

const Settings = () => {
  const { selectedEdition } = useEdition();

  if (!selectedEdition) {
    return (
      <div className="text-center py-12">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">No Edition Selected</h2>
        <p className="text-gray-600 mb-6">Please select an edition from the homepage to access settings.</p>
        <Link
          to="/"
          className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
        >
          Go to Homepage
        </Link>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="text-sm text-gray-500 mt-1">
          Configure system settings for {selectedEdition.name}
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {/* Badge Settings */}
        <Link
          to={`/badges/${selectedEdition.id}`}
          className="block bg-white rounded-lg shadow-sm border hover:shadow-md transition-shadow p-6"
        >
          <div className="flex items-center mb-4">
            <div className="flex-shrink-0">
              <div className="w-8 h-8 bg-purple-100 rounded-full flex items-center justify-center">
                <span className="text-purple-600 text-lg">🏷️</span>
              </div>
            </div>
            <div className="ml-4">
              <h3 className="text-lg font-medium text-gray-900">Badge Settings</h3>
            </div>
          </div>
          <p className="text-sm text-gray-600">
            Design badge layouts, configure sequential numbering, and manage category assignments for guest badges.
          </p>
        </Link>

        {/* Email Templates */}
        <Link
          to="/templates"
          className="block bg-white rounded-lg shadow-sm border hover:shadow-md transition-shadow p-6"
        >
          <div className="flex items-center mb-4">
            <div className="flex-shrink-0">
              <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
                <span className="text-blue-600 text-lg">📧</span>
              </div>
            </div>
            <div className="ml-4">
              <h3 className="text-lg font-medium text-gray-900">Email Templates</h3>
            </div>
          </div>
          <p className="text-sm text-gray-600">
            Manage email templates for invitations, confirmations, and other communications.
          </p>
        </Link>

        {/* Audit Logs */}
        <Link
          to="/audit"
          className="block bg-white rounded-lg shadow-sm border hover:shadow-md transition-shadow p-6"
        >
          <div className="flex items-center mb-4">
            <div className="flex-shrink-0">
              <div className="w-8 h-8 bg-green-100 rounded-full flex items-center justify-center">
                <span className="text-green-600 text-lg">📊</span>
              </div>
            </div>
            <div className="ml-4">
              <h3 className="text-lg font-medium text-gray-900">Audit Logs</h3>
            </div>
          </div>
          <p className="text-sm text-gray-600">
            View system activity logs and track user actions for security and compliance.
          </p>
        </Link>



        {/* Placeholder for future settings */}
        <div className="bg-gray-50 rounded-lg shadow-sm border p-6 opacity-50">
          <div className="flex items-center mb-4">
            <div className="flex-shrink-0">
              <div className="w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center">
                <span className="text-gray-400 text-lg">⚙️</span>
              </div>
            </div>
            <div className="ml-4">
              <h3 className="text-lg font-medium text-gray-500">General Settings</h3>
            </div>
          </div>
          <p className="text-sm text-gray-500">
            System preferences and configuration options. Coming soon.
          </p>
        </div>

        <div className="bg-gray-50 rounded-lg shadow-sm border p-6 opacity-50">
          <div className="flex items-center mb-4">
            <div className="flex-shrink-0">
              <div className="w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center">
                <span className="text-gray-400 text-lg">👥</span>
              </div>
            </div>
            <div className="ml-4">
              <h3 className="text-lg font-medium text-gray-500">User Management</h3>
            </div>
          </div>
          <p className="text-sm text-gray-500">
            Manage user accounts and permissions. Coming soon.
          </p>
        </div>

        <div className="bg-gray-50 rounded-lg shadow-sm border p-6 opacity-50">
          <div className="flex items-center mb-4">
            <div className="flex-shrink-0">
              <div className="w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center">
                <span className="text-gray-400 text-lg">🔒</span>
              </div>
            </div>
            <div className="ml-4">
              <h3 className="text-lg font-medium text-gray-500">Security</h3>
            </div>
          </div>
          <p className="text-sm text-gray-500">
            Security settings and access controls. Coming soon.
          </p>
        </div>
      </div>
    </div>
  );
};

export default Settings;