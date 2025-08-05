import React, { useState, useEffect } from 'react';
import { useEdition } from '../contexts/EditionContext';
import { accommodationApi } from '../utils/api';

const AccommodationSettings = () => {
  const { selectedEdition } = useEdition();
  const [activeTab, setActiveTab] = useState('overview');
  const [hotels, setHotels] = useState([]);
  const [selectedHotel, setSelectedHotel] = useState(null);
  const [roomTypes, setRoomTypes] = useState([]);
  const [overview, setOverview] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Hotel form state
  const [hotelForm, setHotelForm] = useState({
    name: '',
    address: '',
    description: '',
    contact_phone: '',
    contact_email: '',
    website: '',
    sort_order: 0
  });

  // Room type form state
  const [roomTypeForm, setRoomTypeForm] = useState({
    name: '',
    description: '',
    capacity: 1,
    price_per_night: '',
    currency: 'CZK',
    amenities: [],
    sort_order: 0
  });

  // Availability form state
  const [availabilityForm, setAvailabilityForm] = useState({
    room_type_id: '',
    start_date: '',
    end_date: '',
    total_rooms: 1,
    notes: ''
  });

  const [availabilityData, setAvailabilityData] = useState([]);
  const [selectedRoomType, setSelectedRoomType] = useState(null);
  const [loadingAvailability, setLoadingAvailability] = useState(false);

  const [showHotelForm, setShowHotelForm] = useState(false);
  const [showRoomTypeForm, setShowRoomTypeForm] = useState(false);
  const [showAvailabilityForm, setShowAvailabilityForm] = useState(false);
  const [editingHotel, setEditingHotel] = useState(null);
  const [editingRoomType, setEditingRoomType] = useState(null);

  useEffect(() => {
    if (selectedEdition) {
      loadData();
    }
  }, [selectedEdition]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [hotelsRes, overviewRes] = await Promise.all([
        accommodationApi.getHotels(selectedEdition.id),
        accommodationApi.getOverview(selectedEdition.id)
      ]);
      setHotels(hotelsRes.data.hotels);
      setOverview(overviewRes.data.overview);
    } catch (error) {
      setError('Failed to load accommodation data');
      console.error('Error loading accommodation data:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadRoomTypes = async (hotelId) => {
    try {
      const response = await accommodationApi.getRoomTypes(hotelId);
      setRoomTypes(response.data.roomTypes);
    } catch (error) {
      setError('Failed to load room types');
      console.error('Error loading room types:', error);
    }
  };

  const handleCreateHotel = async (e) => {
    e.preventDefault();
    try {
      await accommodationApi.createHotel({
        ...hotelForm,
        edition_id: selectedEdition.id
      });
      setHotelForm({
        name: '',
        address: '',
        description: '',
        contact_phone: '',
        contact_email: '',
        website: '',
        sort_order: 0
      });
      setShowHotelForm(false);
      loadData();
    } catch (error) {
      setError('Failed to create hotel');
      console.error('Error creating hotel:', error);
    }
  };

  const handleUpdateHotel = async (e) => {
    e.preventDefault();
    try {
      await accommodationApi.updateHotel(editingHotel.id, hotelForm);
      setEditingHotel(null);
      setShowHotelForm(false);
      loadData();
    } catch (error) {
      setError('Failed to update hotel');
      console.error('Error updating hotel:', error);
    }
  };

  const handleDeleteHotel = async (hotelId) => {
    if (!confirm('Are you sure you want to delete this hotel? This will also delete all room types and availability data.')) {
      return;
    }
    try {
      await accommodationApi.deleteHotel(hotelId);
      loadData();
    } catch (error) {
      setError('Failed to delete hotel');
      console.error('Error deleting hotel:', error);
    }
  };

  const handleCreateRoomType = async (e) => {
    e.preventDefault();
    try {
      await accommodationApi.createRoomType({
        ...roomTypeForm,
        hotel_id: selectedHotel.id,
        amenities: roomTypeForm.amenities.filter(a => a.trim())
      });
      setRoomTypeForm({
        name: '',
        description: '',
        capacity: 1,
        price_per_night: '',
        currency: 'CZK',
        amenities: [],
        sort_order: 0
      });
      setShowRoomTypeForm(false);
      loadRoomTypes(selectedHotel.id);
      loadData();
    } catch (error) {
      setError('Failed to create room type');
      console.error('Error creating room type:', error);
    }
  };

  const handleUpdateRoomType = async (e) => {
    e.preventDefault();
    try {
      await accommodationApi.updateRoomType(editingRoomType.id, {
        ...roomTypeForm,
        amenities: roomTypeForm.amenities.filter(a => a.trim())
      });
      setEditingRoomType(null);
      setShowRoomTypeForm(false);
      loadRoomTypes(selectedHotel.id);
      loadData();
    } catch (error) {
      setError('Failed to update room type');
      console.error('Error updating room type:', error);
    }
  };

  const handleDeleteRoomType = async (roomTypeId) => {
    if (!confirm('Are you sure you want to delete this room type? This will also delete all availability data.')) {
      return;
    }
    try {
      await accommodationApi.deleteRoomType(roomTypeId);
      loadRoomTypes(selectedHotel.id);
      loadData();
    } catch (error) {
      setError('Failed to delete room type');
      console.error('Error deleting room type:', error);
    }
  };

  const startEditRoomType = (roomType) => {
    setEditingRoomType(roomType);
    setRoomTypeForm({
      name: roomType.name,
      description: roomType.description || '',
      capacity: roomType.capacity,
      price_per_night: roomType.price_per_night || '',
      currency: roomType.currency || 'CZK',
      amenities: roomType.amenities || [],
      sort_order: roomType.sort_order || 0
    });
    setShowRoomTypeForm(true);
  };

  const addAmenity = () => {
    setRoomTypeForm({
      ...roomTypeForm,
      amenities: [...roomTypeForm.amenities, '']
    });
  };

  const updateAmenity = (index, value) => {
    const newAmenities = [...roomTypeForm.amenities];
    newAmenities[index] = value;
    setRoomTypeForm({
      ...roomTypeForm,
      amenities: newAmenities
    });
  };

  const removeAmenity = (index) => {
    const newAmenities = roomTypeForm.amenities.filter((_, i) => i !== index);
    setRoomTypeForm({
      ...roomTypeForm,
      amenities: newAmenities
    });
  };

  const loadAvailability = async (roomTypeId, startDate = null, endDate = null) => {
    setLoadingAvailability(true);
    try {
      const params = {};
      if (startDate) params.start_date = startDate;
      if (endDate) params.end_date = endDate;
      
      const response = await accommodationApi.getAvailability(roomTypeId, params);
      setAvailabilityData(response.data.availability);
    } catch (error) {
      setError('Failed to load availability data');
      console.error('Error loading availability:', error);
    } finally {
      setLoadingAvailability(false);
    }
  };

  const handleBulkUpdateAvailability = async (e) => {
    e.preventDefault();
    try {
      await accommodationApi.bulkUpdateAvailability(availabilityForm);
      setAvailabilityForm({
        room_type_id: '',
        start_date: '',
        end_date: '',
        total_rooms: 1,
        notes: ''
      });
      setShowAvailabilityForm(false);
      if (selectedRoomType) {
        loadAvailability(selectedRoomType.room_type_id);
      }
      loadData();
    } catch (error) {
      setError('Failed to update availability');
      console.error('Error updating availability:', error);
    }
  };

  const handleUpdateSingleAvailability = async (availabilityId, newTotalRooms, notes) => {
    try {
      await accommodationApi.updateAvailability(availabilityId, {
        total_rooms: newTotalRooms,
        notes: notes
      });
      if (selectedRoomType) {
        loadAvailability(selectedRoomType.room_type_id);
      }
      loadData();
    } catch (error) {
      setError('Failed to update availability');
      console.error('Error updating availability:', error);
    }
  };

  const selectRoomTypeForAvailability = (roomType) => {
    setSelectedRoomType(roomType);
    setAvailabilityForm({
      ...availabilityForm,
      room_type_id: roomType.room_type_id
    });
    loadAvailability(roomType.room_type_id);
  };

  const getAllRoomTypesForAvailability = () => {
    const allRoomTypes = [];
    overview.forEach(item => {
      if (item.room_type_id) {
        allRoomTypes.push({
          room_type_id: item.room_type_id,
          room_type_name: item.room_type_name,
          hotel_name: item.hotel_name,
          capacity: item.capacity,
          price_per_night: item.price_per_night,
          currency: item.currency
        });
      }
    });
    return allRoomTypes;
  };

  const startEditHotel = (hotel) => {
    setEditingHotel(hotel);
    setHotelForm({
      name: hotel.name,
      address: hotel.address || '',
      description: hotel.description || '',
      contact_phone: hotel.contact_phone || '',
      contact_email: hotel.contact_email || '',
      website: hotel.website || '',
      sort_order: hotel.sort_order || 0
    });
    setShowHotelForm(true);
  };

  if (!selectedEdition) {
    return (
      <div className="text-center py-12">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">No Edition Selected</h2>
        <p className="text-gray-600">Please select an edition to manage accommodation.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Accommodation Management</h1>
        <p className="text-sm text-gray-500 mt-1">
          Manage hotels, room types, and availability for {selectedEdition.name}
        </p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-md p-4 mb-6">
          <p className="text-red-600">{error}</p>
        </div>
      )}

      {/* Tabs */}
      <div className="border-b border-gray-200 mb-6">
        <nav className="-mb-px flex space-x-8">
          {[
            { id: 'overview', name: 'Overview', icon: '📊' },
            { id: 'hotels', name: 'Hotels', icon: '🏨' },
            { id: 'rooms', name: 'Room Types', icon: '🛏️' },
            { id: 'availability', name: 'Availability', icon: '📅' }
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`py-2 px-1 border-b-2 font-medium text-sm whitespace-nowrap ${
                activeTab === tab.id
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <span className="mr-2">{tab.icon}</span>
              {tab.name}
            </button>
          ))}
        </nav>
      </div>

      {/* Overview Tab */}
      {activeTab === 'overview' && (
        <div>
          <div className="bg-white shadow rounded-lg p-6">
            <h3 className="text-lg font-medium text-gray-900 mb-4">Accommodation Overview</h3>
            {overview.length === 0 ? (
              <p className="text-gray-500">No accommodation data available. Start by creating hotels and room types.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Hotel</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Room Type</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Capacity</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Price/Night</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Available Days</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Room Nights</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {overview.map((item, index) => (
                      <tr key={index}>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                          {item.hotel_name}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {item.room_type_name || '-'}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {item.capacity || '-'} person{item.capacity > 1 ? 's' : ''}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {item.price_per_night ? `${item.price_per_night} ${item.currency}` : '-'}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {item.availability_days || 0}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          <span className="text-green-600">{item.available_room_nights || 0}</span> / 
                          <span className="text-gray-600"> {item.total_room_nights || 0}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Hotels Tab */}
      {activeTab === 'hotels' && (
        <div>
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-medium text-gray-900">Hotels</h3>
            <button
              onClick={() => {
                setEditingHotel(null);
                setHotelForm({
                  name: '',
                  address: '',
                  description: '',
                  contact_phone: '',
                  contact_email: '',
                  website: '',
                  sort_order: 0
                });
                setShowHotelForm(true);
              }}
              className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700"
            >
              Add Hotel
            </button>
          </div>

          {/* Hotel Form */}
          {showHotelForm && (
            <div className="bg-white shadow rounded-lg p-6 mb-6">
              <h4 className="text-lg font-medium text-gray-900 mb-4">
                {editingHotel ? 'Edit Hotel' : 'Add New Hotel'}
              </h4>
              <form onSubmit={editingHotel ? handleUpdateHotel : handleCreateHotel}>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Name *
                    </label>
                    <input
                      type="text"
                      required
                      value={hotelForm.name}
                      onChange={(e) => setHotelForm({ ...hotelForm, name: e.target.value })}
                      className="w-full border rounded-md px-3 py-2"
                    />
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Contact Phone
                    </label>
                    <input
                      type="text"
                      value={hotelForm.contact_phone}
                      onChange={(e) => setHotelForm({ ...hotelForm, contact_phone: e.target.value })}
                      className="w-full border rounded-md px-3 py-2"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Contact Email
                    </label>
                    <input
                      type="email"
                      value={hotelForm.contact_email}
                      onChange={(e) => setHotelForm({ ...hotelForm, contact_email: e.target.value })}
                      className="w-full border rounded-md px-3 py-2"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Website
                    </label>
                    <input
                      type="url"
                      value={hotelForm.website}
                      onChange={(e) => setHotelForm({ ...hotelForm, website: e.target.value })}
                      className="w-full border rounded-md px-3 py-2"
                    />
                  </div>

                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Address
                    </label>
                    <textarea
                      value={hotelForm.address}
                      onChange={(e) => setHotelForm({ ...hotelForm, address: e.target.value })}
                      rows={3}
                      className="w-full border rounded-md px-3 py-2"
                    />
                  </div>

                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Description
                    </label>
                    <textarea
                      value={hotelForm.description}
                      onChange={(e) => setHotelForm({ ...hotelForm, description: e.target.value })}
                      rows={3}
                      className="w-full border rounded-md px-3 py-2"
                    />
                  </div>
                </div>

                <div className="flex justify-end gap-2 mt-4">
                  <button
                    type="button"
                    onClick={() => {
                      setShowHotelForm(false);
                      setEditingHotel(null);
                    }}
                    className="px-4 py-2 border border-gray-300 rounded-md hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                  >
                    {editingHotel ? 'Update' : 'Create'} Hotel
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Hotels List */}
          <div className="bg-white shadow rounded-lg">
            {hotels.length === 0 ? (
              <div className="p-6 text-center text-gray-500">
                No hotels created yet. Click "Add Hotel" to get started.
              </div>
            ) : (
              <div className="divide-y divide-gray-200">
                {hotels.map((hotel) => (
                  <div key={hotel.id} className="p-6">
                    <div className="flex justify-between items-start">
                      <div className="flex-1">
                        <h4 className="text-lg font-medium text-gray-900">{hotel.name}</h4>
                        {hotel.address && (
                          <p className="text-sm text-gray-600 mt-1">{hotel.address}</p>
                        )}
                        {hotel.description && (
                          <p className="text-sm text-gray-600 mt-2">{hotel.description}</p>
                        )}
                        <div className="flex gap-4 mt-2 text-sm text-gray-500">
                          {hotel.contact_phone && <span>📞 {hotel.contact_phone}</span>}
                          {hotel.contact_email && <span>📧 {hotel.contact_email}</span>}
                          {hotel.website && (
                            <a href={hotel.website} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                              🌐 Website
                            </a>
                          )}
                        </div>
                        <div className="mt-2 text-sm text-gray-500">
                          Room Types: {hotel.room_types_count || 0}
                        </div>
                      </div>
                      <div className="flex gap-2 ml-4">
                        <button
                          onClick={() => {
                            setSelectedHotel(hotel);
                            loadRoomTypes(hotel.id);
                            setActiveTab('rooms');
                          }}
                          className="text-blue-600 hover:text-blue-800 text-sm"
                        >
                          Manage Rooms
                        </button>
                        <button
                          onClick={() => startEditHotel(hotel)}
                          className="text-indigo-600 hover:text-indigo-800 text-sm"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDeleteHotel(hotel.id)}
                          className="text-red-600 hover:text-red-800 text-sm"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Room Types Tab */}
      {activeTab === 'rooms' && (
        <div>
          {!selectedHotel ? (
            <div className="bg-white shadow rounded-lg p-6 text-center">
              <p className="text-gray-500 mb-4">Please select a hotel first to manage its room types.</p>
              <button
                onClick={() => setActiveTab('hotels')}
                className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700"
              >
                Go to Hotels
              </button>
            </div>
          ) : (
            <>
              <div className="flex justify-between items-center mb-4">
                <div>
                  <h3 className="text-lg font-medium text-gray-900">Room Types for {selectedHotel.name}</h3>
                  <button
                    onClick={() => {
                      setSelectedHotel(null);
                      setActiveTab('hotels');
                    }}
                    className="text-sm text-blue-600 hover:text-blue-800"
                  >
                    ← Back to Hotels
                  </button>
                </div>
                <button
                  onClick={() => {
                    setEditingRoomType(null);
                    setRoomTypeForm({
                      name: '',
                      description: '',
                      capacity: 1,
                      price_per_night: '',
                      currency: 'CZK',
                      amenities: [],
                      sort_order: 0
                    });
                    setShowRoomTypeForm(true);
                  }}
                  className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700"
                >
                  Add Room Type
                </button>
              </div>

              {/* Room Type Form */}
              {showRoomTypeForm && (
                <div className="bg-white shadow rounded-lg p-6 mb-6">
                  <h4 className="text-lg font-medium text-gray-900 mb-4">
                    {editingRoomType ? 'Edit Room Type' : 'Add New Room Type'}
                  </h4>
                  <form onSubmit={editingRoomType ? handleUpdateRoomType : handleCreateRoomType}>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Name *
                        </label>
                        <input
                          type="text"
                          required
                          value={roomTypeForm.name}
                          onChange={(e) => setRoomTypeForm({ ...roomTypeForm, name: e.target.value })}
                          className="w-full border rounded-md px-3 py-2"
                          placeholder="e.g., Single Room, Double Room"
                        />
                      </div>
                      
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Capacity *
                        </label>
                        <input
                          type="number"
                          required
                          min="1"
                          value={roomTypeForm.capacity}
                          onChange={(e) => setRoomTypeForm({ ...roomTypeForm, capacity: parseInt(e.target.value) })}
                          className="w-full border rounded-md px-3 py-2"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Price per Night
                        </label>
                        <input
                          type="number"
                          step="0.01"
                          value={roomTypeForm.price_per_night}
                          onChange={(e) => setRoomTypeForm({ ...roomTypeForm, price_per_night: e.target.value })}
                          className="w-full border rounded-md px-3 py-2"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Currency
                        </label>
                        <select
                          value={roomTypeForm.currency}
                          onChange={(e) => setRoomTypeForm({ ...roomTypeForm, currency: e.target.value })}
                          className="w-full border rounded-md px-3 py-2"
                        >
                          <option value="CZK">CZK</option>
                          <option value="EUR">EUR</option>
                          <option value="USD">USD</option>
                        </select>
                      </div>

                      <div className="md:col-span-2">
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Description
                        </label>
                        <textarea
                          value={roomTypeForm.description}
                          onChange={(e) => setRoomTypeForm({ ...roomTypeForm, description: e.target.value })}
                          rows={3}
                          className="w-full border rounded-md px-3 py-2"
                        />
                      </div>

                      <div className="md:col-span-2">
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Amenities
                        </label>
                        <div className="space-y-2">
                          {roomTypeForm.amenities.map((amenity, index) => (
                            <div key={index} className="flex gap-2">
                              <input
                                type="text"
                                value={amenity}
                                onChange={(e) => updateAmenity(index, e.target.value)}
                                className="flex-1 border rounded-md px-3 py-2"
                                placeholder="e.g., WiFi, TV, Bathroom"
                              />
                              <button
                                type="button"
                                onClick={() => removeAmenity(index)}
                                className="px-3 py-2 text-red-600 hover:bg-red-50 rounded-md"
                              >
                                Remove
                              </button>
                            </div>
                          ))}
                          <button
                            type="button"
                            onClick={addAmenity}
                            className="text-blue-600 hover:text-blue-800 text-sm"
                          >
                            + Add Amenity
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="flex justify-end gap-2 mt-4">
                      <button
                        type="button"
                        onClick={() => {
                          setShowRoomTypeForm(false);
                          setEditingRoomType(null);
                        }}
                        className="px-4 py-2 border border-gray-300 rounded-md hover:bg-gray-50"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                      >
                        {editingRoomType ? 'Update' : 'Create'} Room Type
                      </button>
                    </div>
                  </form>
                </div>
              )}

              {/* Room Types List */}
              <div className="bg-white shadow rounded-lg">
                {roomTypes.length === 0 ? (
                  <div className="p-6 text-center text-gray-500">
                    No room types created yet. Click "Add Room Type" to get started.
                  </div>
                ) : (
                  <div className="divide-y divide-gray-200">
                    {roomTypes.map((roomType) => (
                      <div key={roomType.id} className="p-6">
                        <div className="flex justify-between items-start">
                          <div className="flex-1">
                            <h4 className="text-lg font-medium text-gray-900">{roomType.name}</h4>
                            {roomType.description && (
                              <p className="text-sm text-gray-600 mt-1">{roomType.description}</p>
                            )}
                            <div className="flex gap-4 mt-2 text-sm text-gray-500">
                              <span>👥 {roomType.capacity} person{roomType.capacity > 1 ? 's' : ''}</span>
                              {roomType.price_per_night && (
                                <span>💰 {roomType.price_per_night} {roomType.currency}/night</span>
                              )}
                            </div>
                            {roomType.amenities && roomType.amenities.length > 0 && (
                              <div className="mt-2">
                                <div className="flex flex-wrap gap-1">
                                  {roomType.amenities.map((amenity, index) => (
                                    <span
                                      key={index}
                                      className="inline-block bg-blue-100 text-blue-800 text-xs px-2 py-1 rounded-full"
                                    >
                                      {amenity}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                          <div className="flex gap-2 ml-4">
                            <button
                              onClick={() => {
                                setAvailabilityForm({
                                  ...availabilityForm,
                                  room_type_id: roomType.id
                                });
                                setActiveTab('availability');
                              }}
                              className="text-green-600 hover:text-green-800 text-sm"
                            >
                              Manage Availability
                            </button>
                            <button
                              onClick={() => startEditRoomType(roomType)}
                              className="text-indigo-600 hover:text-indigo-800 text-sm"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => handleDeleteRoomType(roomType.id)}
                              className="text-red-600 hover:text-red-800 text-sm"
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* Availability Tab */}
      {activeTab === 'availability' && (
        <div>
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-medium text-gray-900">Room Availability Management</h3>
            <button
              onClick={() => {
                setAvailabilityForm({
                  room_type_id: selectedRoomType?.room_type_id || '',
                  start_date: '',
                  end_date: '',
                  total_rooms: 1,
                  notes: ''
                });
                setShowAvailabilityForm(true);
              }}
              className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700"
            >
              Set Availability
            </button>
          </div>

          {/* Bulk Availability Form */}
          {showAvailabilityForm && (
            <div className="bg-white shadow rounded-lg p-6 mb-6">
              <h4 className="text-lg font-medium text-gray-900 mb-4">Set Room Availability</h4>
              <form onSubmit={handleBulkUpdateAvailability}>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Room Type *
                    </label>
                    <select
                      required
                      value={availabilityForm.room_type_id}
                      onChange={(e) => {
                        const roomType = getAllRoomTypesForAvailability().find(rt => rt.room_type_id === e.target.value);
                        setSelectedRoomType(roomType);
                        setAvailabilityForm({ ...availabilityForm, room_type_id: e.target.value });
                      }}
                      className="w-full border rounded-md px-3 py-2"
                    >
                      <option value="">Select a room type</option>
                      {getAllRoomTypesForAvailability().map((roomType) => (
                        <option key={roomType.room_type_id} value={roomType.room_type_id}>
                          {roomType.hotel_name} - {roomType.room_type_name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Total Rooms *
                    </label>
                    <input
                      type="number"
                      required
                      min="0"
                      value={availabilityForm.total_rooms}
                      onChange={(e) => setAvailabilityForm({ ...availabilityForm, total_rooms: parseInt(e.target.value) })}
                      className="w-full border rounded-md px-3 py-2"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Start Date *
                    </label>
                    <input
                      type="date"
                      required
                      value={availabilityForm.start_date}
                      onChange={(e) => setAvailabilityForm({ ...availabilityForm, start_date: e.target.value })}
                      className="w-full border rounded-md px-3 py-2"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      End Date *
                    </label>
                    <input
                      type="date"
                      required
                      value={availabilityForm.end_date}
                      onChange={(e) => setAvailabilityForm({ ...availabilityForm, end_date: e.target.value })}
                      className="w-full border rounded-md px-3 py-2"
                    />
                  </div>

                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Notes
                    </label>
                    <textarea
                      value={availabilityForm.notes}
                      onChange={(e) => setAvailabilityForm({ ...availabilityForm, notes: e.target.value })}
                      rows={3}
                      className="w-full border rounded-md px-3 py-2"
                      placeholder="Optional notes about this availability period"
                    />
                  </div>
                </div>

                <div className="flex justify-end gap-2 mt-4">
                  <button
                    type="button"
                    onClick={() => setShowAvailabilityForm(false)}
                    className="px-4 py-2 border border-gray-300 rounded-md hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                  >
                    Set Availability
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Room Type Selector */}
          {!selectedRoomType && (
            <div className="bg-white shadow rounded-lg p-6 mb-6">
              <h4 className="text-lg font-medium text-gray-900 mb-4">Select Room Type</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {getAllRoomTypesForAvailability().map((roomType) => (
                  <button
                    key={roomType.room_type_id}
                    onClick={() => selectRoomTypeForAvailability(roomType)}
                    className="text-left p-4 border rounded-lg hover:bg-blue-50 hover:border-blue-300"
                  >
                    <h5 className="font-medium text-gray-900">{roomType.room_type_name}</h5>
                    <p className="text-sm text-gray-600">{roomType.hotel_name}</p>
                    <div className="flex justify-between items-center mt-2 text-sm text-gray-500">
                      <span>👥 {roomType.capacity} person{roomType.capacity > 1 ? 's' : ''}</span>
                      {roomType.price_per_night && (
                        <span>💰 {roomType.price_per_night} {roomType.currency}</span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Availability Data */}
          {selectedRoomType && (
            <div className="bg-white shadow rounded-lg">
              <div className="p-6 border-b border-gray-200">
                <div className="flex justify-between items-center">
                  <div>
                    <h4 className="text-lg font-medium text-gray-900">
                      {selectedRoomType.room_type_name} - {selectedRoomType.hotel_name}
                    </h4>
                    <p className="text-sm text-gray-600">
                      Capacity: {selectedRoomType.capacity} person{selectedRoomType.capacity > 1 ? 's' : ''}
                      {selectedRoomType.price_per_night && (
                        <span className="ml-4">Price: {selectedRoomType.price_per_night} {selectedRoomType.currency}/night</span>
                      )}
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      setSelectedRoomType(null);
                      setAvailabilityData([]);
                    }}
                    className="text-sm text-blue-600 hover:text-blue-800"
                  >
                    ← Back to Room Types
                  </button>
                </div>
              </div>

              <div className="p-6">
                {loadingAvailability ? (
                  <div className="flex items-center justify-center py-8">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                  </div>
                ) : availabilityData.length === 0 ? (
                  <div className="text-center py-8 text-gray-500">
                    No availability data found. Click "Set Availability" to add availability for this room type.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Total Rooms</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Reserved</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Available</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Notes</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {availabilityData.map((availability) => (
                          <AvailabilityRow 
                            key={availability.id} 
                            availability={availability} 
                            onUpdate={handleUpdateSingleAvailability}
                          />
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// Separate component for availability row with inline editing
const AvailabilityRow = ({ availability, onUpdate }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [totalRooms, setTotalRooms] = useState(availability.total_rooms);
  const [notes, setNotes] = useState(availability.notes || '');

  const handleSave = () => {
    onUpdate(availability.id, totalRooms, notes);
    setIsEditing(false);
  };

  const handleCancel = () => {
    setTotalRooms(availability.total_rooms);
    setNotes(availability.notes || '');
    setIsEditing(false);
  };

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric'
    });
  };

  return (
    <tr>
      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
        {formatDate(availability.available_date)}
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
        {isEditing ? (
          <input
            type="number"
            min="0"
            value={totalRooms}
            onChange={(e) => setTotalRooms(parseInt(e.target.value))}
            className="w-20 border rounded px-2 py-1"
          />
        ) : (
          totalRooms
        )}
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
        <span className="text-red-600">{availability.reserved_rooms}</span>
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
        <span className="text-green-600">{availability.available_rooms}</span>
      </td>
      <td className="px-6 py-4 text-sm text-gray-900">
        {isEditing ? (
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full border rounded px-2 py-1"
            placeholder="Optional notes"
          />
        ) : (
          <span className="text-gray-600">{availability.notes || '-'}</span>
        )}
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
        {isEditing ? (
          <div className="flex gap-2">
            <button
              onClick={handleSave}
              className="text-green-600 hover:text-green-800"
            >
              Save
            </button>
            <button
              onClick={handleCancel}
              className="text-gray-600 hover:text-gray-800"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={() => setIsEditing(true)}
            className="text-indigo-600 hover:text-indigo-800"
          >
            Edit
          </button>
        )}
      </td>
    </tr>
  );
};

export default AccommodationSettings;