import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Html5Qrcode } from 'html5-qrcode';

const Scanner = () => {
  const navigate = useNavigate();
  const [editions, setEditions] = useState([]);
  const [selectedEdition, setSelectedEdition] = useState(null);
  const [screenings, setScreenings] = useState([]);
  const [selectedScreening, setSelectedScreening] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [scannedGuests, setScannedGuests] = useState([]);
  const [showAllScans, setShowAllScans] = useState(false);
  const [scanCount, setScanCount] = useState(0);
  const [lastScan, setLastScan] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const scannerRef = useRef(null);
  const html5QrcodeRef = useRef(null);
  const selectedScreeningRef = useRef(null);
  const lastScannedBadgeRef = useRef(null);
  const scanCooldownRef = useRef(false);

  // Fetch editions on mount
  useEffect(() => {
    fetchEditions();
  }, []);

  // Fetch screenings when edition is selected
  useEffect(() => {
    if (selectedEdition) {
      fetchScreenings();
    }
  }, [selectedEdition]);

  // Cleanup scanner on unmount
  useEffect(() => {
    return () => {
      if (html5QrcodeRef.current && scanning) {
        html5QrcodeRef.current.stop();
      }
    };
  }, [scanning]);

  const fetchEditions = async () => {
    try {
      const response = await fetch('/api/public/editions');
      if (response.ok) {
        const data = await response.json();
        const editionsList = Array.isArray(data) ? data : (data.editions || []);
        setEditions(editionsList);
        // Auto-select the most recent edition
        if (editionsList.length > 0) {
          setSelectedEdition(editionsList[0].id);
        }
      } else {
        setEditions([]);
        setError('Failed to load editions. Please check your connection.');
      }
    } catch (error) {
      console.error('Error fetching editions:', error);
      setEditions([]);
      setError('Failed to load editions. Please check your connection.');
    }
  };

  const fetchScreenings = async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/scanner/screenings?edition_id=${selectedEdition}`, {
        credentials: 'include'
      });
      if (response.ok) {
        const data = await response.json();
        setScreenings(data.screenings);
      } else {
        setError('Failed to load screenings');
      }
    } catch (error) {
      console.error('Error fetching screenings:', error);
      setError('Failed to load screenings');
    } finally {
      setLoading(false);
    }
  };

  const startScanning = async (screening) => {
    setSelectedScreening(screening);
    selectedScreeningRef.current = screening;
    setScanCount(screening.scanCount || 0);
    setScanning(true);
    setError('');
    setLastScan(null);

    // Fetch existing scans
    fetchScannedGuests(screening.id);

    // Initialize QR code scanner
    setTimeout(() => {
      initializeScanner();
    }, 100);
  };

  const initializeScanner = async () => {
    try {
      const html5Qrcode = new Html5Qrcode("scanner-container");
      html5QrcodeRef.current = html5Qrcode;

      const config = {
        fps: 10,
        qrbox: { width: 250, height: 250 },
        aspectRatio: 1.0
      };

      await html5Qrcode.start(
        { facingMode: "environment" },
        config,
        onScanSuccess,
        onScanError
      );
    } catch (err) {
      console.error("Error starting scanner:", err);
      setError("Failed to start camera. Please grant camera permissions.");
    }
  };

  const onScanSuccess = async (decodedText) => {
    // Check if we're in cooldown period (overlay is showing)
    if (scanCooldownRef.current) {
      return;
    }

    if (!decodedText || decodedText.trim() === '') {
      setError('Invalid barcode');
      return;
    }

    // Check if this is the same badge as the last scan (prevent double scans)
    if (lastScannedBadgeRef.current === decodedText) {
      return;
    }

    // Pause scanner during overlay display
    if (html5QrcodeRef.current) {
      try {
        await html5QrcodeRef.current.pause();
      } catch (err) {
        console.error('Error pausing scanner:', err);
      }
    }

    // Submit scan to backend (send raw scanned text)
    await submitScan(decodedText);
  };

  const onScanError = (errorMessage) => {
    // Ignore scan errors (they happen continuously while scanning)
  };

  const submitScan = async (scannedCode) => {
    const screening = selectedScreeningRef.current;
    if (!screening) {
      setError('No screening selected');
      return;
    }

    try {
      setLoading(true);
      const response = await fetch('/api/scanner/scan', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify({
          programming_id: screening.id,
          scanned_code: scannedCode
        })
      });

      const data = await response.json();

      if (response.ok) {
        // Vibrate on success
        if (navigator.vibrate) {
          navigator.vibrate(200);
        }

        // Store the last scanned code
        lastScannedBadgeRef.current = scannedCode;

        // Set cooldown period
        scanCooldownRef.current = true;

        setLastScan({
          success: true,
          guest: data.guest,
          timestamp: new Date()
        });
        setScanCount(data.totalScans);
        // Add to scanned guests list
        setScannedGuests(prev => [{
          badgeNumber: data.guest.badgeNumber,
          firstName: data.guest.firstName,
          lastName: data.guest.lastName,
          scannedAt: data.scannedAt
        }, ...prev]);
        setError('');

        // Clear the success message and reset cooldown after 2.5 seconds
        setTimeout(async () => {
          setLastScan(null);
          scanCooldownRef.current = false;
          lastScannedBadgeRef.current = null;

          // Resume scanner after overlay is hidden
          if (html5QrcodeRef.current) {
            try {
              await html5QrcodeRef.current.resume();
            } catch (err) {
              console.error('Error resuming scanner:', err);
            }
          }
        }, 2500);
      } else if (response.status === 409) {
        // Already scanned
        // Vibrate on error (different pattern than success)
        if (navigator.vibrate) {
          navigator.vibrate([100, 50, 100]);
        }

        scanCooldownRef.current = true;
        setLastScan({
          success: false,
          error: 'Already scanned',
          guest: data.guest
        });
        setError(`Badge ${scannedCode} already scanned for this screening`);

        // Resume scanner after error overlay
        setTimeout(async () => {
          setLastScan(null);
          setError('');
          scanCooldownRef.current = false;
          if (html5QrcodeRef.current) {
            try {
              await html5QrcodeRef.current.resume();
            } catch (err) {
              console.error('Error resuming scanner:', err);
            }
          }
        }, 2500);
      } else if (response.status === 404) {
        // Vibrate on error (different pattern than success)
        if (navigator.vibrate) {
          navigator.vibrate([100, 50, 100]);
        }

        scanCooldownRef.current = true;
        setLastScan({
          success: false,
          error: 'Badge not found'
        });
        setError(`Badge ${scannedCode} not found`);

        // Resume scanner after error overlay
        setTimeout(async () => {
          setLastScan(null);
          setError('');
          scanCooldownRef.current = false;
          if (html5QrcodeRef.current) {
            try {
              await html5QrcodeRef.current.resume();
            } catch (err) {
              console.error('Error resuming scanner:', err);
            }
          }
        }, 2500);
      } else {
        // Vibrate on error (different pattern than success)
        if (navigator.vibrate) {
          navigator.vibrate([100, 50, 100]);
        }

        scanCooldownRef.current = true;
        setLastScan({
          success: false,
          error: data.error || 'Failed to submit scan'
        });
        setError(data.error || 'Failed to submit scan');

        // Resume scanner after error overlay
        setTimeout(async () => {
          setLastScan(null);
          setError('');
          scanCooldownRef.current = false;
          if (html5QrcodeRef.current) {
            try {
              await html5QrcodeRef.current.resume();
            } catch (err) {
              console.error('Error resuming scanner:', err);
            }
          }
        }, 2500);
      }
    } catch (error) {
      console.error('Error submitting scan:', error);

      // Vibrate on error (different pattern than success)
      if (navigator.vibrate) {
        navigator.vibrate([100, 50, 100]);
      }

      scanCooldownRef.current = true;
      setLastScan({
        success: false,
        error: 'Network error'
      });
      setError('Failed to submit scan');

      // Resume scanner after error overlay
      setTimeout(async () => {
        setLastScan(null);
        setError('');
        scanCooldownRef.current = false;
        if (html5QrcodeRef.current) {
          try {
            await html5QrcodeRef.current.resume();
          } catch (err) {
            console.error('Error resuming scanner:', err);
          }
        }
      }, 2500);
    } finally {
      setLoading(false);
    }
  };

  const stopScanning = async () => {
    if (html5QrcodeRef.current) {
      try {
        await html5QrcodeRef.current.stop();
        html5QrcodeRef.current = null;
      } catch (error) {
        console.error('Error stopping scanner:', error);
      }
    }
    setScanning(false);
    setSelectedScreening(null);
  };

  const fetchScannedGuests = async (programmingId) => {
    try {
      const response = await fetch(`/api/scanner/scans/${programmingId}`, {
        credentials: 'include'
      });
      if (response.ok) {
        const data = await response.json();
        setScannedGuests(data.scans);
      }
    } catch (error) {
      console.error('Error fetching scanned guests:', error);
    }
  };

  const removeScan = async (scanId) => {
    if (!confirm('Are you sure you want to remove this scan?')) {
      return;
    }

    try {
      const response = await fetch(`/api/scanner/scans/${scanId}`, {
        method: 'DELETE',
        credentials: 'include'
      });

      if (response.ok) {
        // Remove from local state
        setScannedGuests(prev => prev.filter(guest => guest.id !== scanId));
        setScanCount(prev => prev - 1);
      } else {
        setError('Failed to remove scan');
      }
    } catch (error) {
      console.error('Error removing scan:', error);
      setError('Failed to remove scan');
    }
  };

  const formatDate = (date) => {
    return new Date(date).toLocaleDateString('cs-CZ', {
      weekday: 'short',
      day: 'numeric',
      month: 'short'
    });
  };

  const formatTime = (time) => {
    return time.substring(0, 5);
  };

  if (!scanning) {
    return (
      <div className="max-w-2xl mx-auto">
          {/* Screenings List */}
          {loading && (
            <div className="text-center py-8">
              <div className="text-gray-500">Loading screenings...</div>
            </div>
          )}

          {!loading && screenings.length === 0 && selectedEdition && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 text-center">
              <p className="text-yellow-800">No upcoming screenings found</p>
            </div>
          )}

          {!loading && screenings.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-lg font-semibold mb-3">Upcoming Screenings</h2>
              {screenings.map(screening => (
                <div
                  key={screening.id}
                  className="bg-white rounded-lg shadow-sm border p-4"
                >
                  <div className="flex justify-between items-start mb-2">
                    <div className="flex-1">
                      <h3 className="font-semibold text-lg">
                        {screening.title.cs || screening.title.en}
                      </h3>
                      <p className="text-sm text-gray-600">
                        {screening.venue.cs}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center justify-between mt-3">
                    <div>
                      <p className="text-sm font-medium">
                        {formatDate(screening.date)} • {formatTime(screening.time)}
                      </p>
                      <p className="text-sm text-gray-600">
                        Scanned: {screening.scanCount || 0}
                      </p>
                    </div>
                    <button
                      onClick={() => startScanning(screening)}
                      className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm font-medium"
                    >
                      Start Scanning
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
      </div>
    );
  }

  // Scanning mode UI
  return (
    <div className="min-h-screen bg-gray-900 text-white relative">
      {/* Fullscreen Success Overlay */}
      {lastScan && lastScan.success && (
        <div className="fixed inset-0 bg-green-600 z-50 flex flex-col items-center justify-center">
          <div className="text-9xl mb-8">✓</div>
          <div className="text-4xl font-bold mb-4">OK</div>
          <div className="text-2xl">
            {lastScan.guest.firstName} {lastScan.guest.lastName}
          </div>
          <div className="text-xl text-green-100 mt-2">
            Badge #{lastScan.guest.badgeNumber}
          </div>
        </div>
      )}

      {/* Fullscreen Error Overlay */}
      {lastScan && !lastScan.success && (
        <div className="fixed inset-0 bg-red-600 z-50 flex flex-col items-center justify-center">
          <div className="text-9xl mb-8">✗</div>
          <div className="text-4xl font-bold mb-4">{lastScan.error}</div>
          {lastScan.guest && (
            <>
              <div className="text-2xl">
                {lastScan.guest.firstName} {lastScan.guest.lastName}
              </div>
              <div className="text-xl text-red-100 mt-2">
                Badge #{lastScan.guest.badgeNumber}
              </div>
            </>
          )}
        </div>
      )}

      {/* Header */}
      <div className="bg-gray-800 px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex-1">
            <h2 className="font-semibold text-lg line-clamp-1">
              {selectedScreening.title.cs || selectedScreening.title.en}
            </h2>
            <p className="text-sm text-gray-400">
              {formatDate(selectedScreening.date)} • {formatTime(selectedScreening.time)}
            </p>
          </div>
          <button
            onClick={stopScanning}
            className="ml-2 px-3 py-2 bg-gray-700 text-white rounded-md hover:bg-gray-600 text-sm"
          >
            Stop
          </button>
        </div>
      </div>

      {/* Scanner Container */}
      <div className="p-4">
        <div id="scanner-container" className="rounded-lg overflow-hidden mb-4"></div>

        {/* Scan Count */}
        <div className="bg-gray-800 rounded-lg p-4 mb-4 text-center">
          <div className="text-3xl font-bold">{scanCount}</div>
          <div className="text-sm text-gray-400">Total Scans</div>
        </div>

        {/* Toggle Scanned Guests List */}
        <button
          onClick={() => setShowAllScans(!showAllScans)}
          className="w-full px-4 py-2 bg-gray-800 text-white rounded-md hover:bg-gray-700 mb-4"
        >
          {showAllScans ? 'Hide' : 'Show'} Scanned Guests ({scannedGuests.length})
        </button>

        {/* Scanned Guests List */}
        {showAllScans && (
          <div className="bg-gray-800 rounded-lg p-4">
            <h3 className="font-semibold mb-3">Scanned Guests</h3>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {scannedGuests.length === 0 ? (
                <p className="text-sm text-gray-400">No scans yet</p>
              ) : (
                scannedGuests.map((guest, index) => (
                  <div key={index} className="bg-gray-700 rounded p-2">
                    <div className="flex justify-between items-center">
                      <div className="flex-1">
                        <div className="text-sm font-medium">
                          {guest.firstName} {guest.lastName}
                        </div>
                        <div className="text-xs text-gray-400">
                          Badge #{guest.badgeNumber}
                          {guest.category && ` • ${guest.category}`} • {new Date(guest.scannedAt).toLocaleTimeString('cs-CZ')}
                        </div>
                      </div>
                      <button
                        onClick={() => removeScan(guest.id)}
                        className="ml-2 px-2 py-1 bg-red-600 text-white text-xs rounded hover:bg-red-700"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Scanner;