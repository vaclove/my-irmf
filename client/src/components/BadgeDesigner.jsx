import React, { useState, useRef, useEffect } from 'react';
import { DndProvider, useDrag, useDrop } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';

const ELEMENT_TYPES = {
  GUEST_PHOTO: 'guest_photo',
  GUEST_NAME: 'guest_name',
  GUEST_CATEGORY: 'guest_category',
  BADGE_NUMBER: 'badge_number',
  BARCODE: 'barcode',
  STATIC_TEXT: 'static_text',
  LOGO: 'logo'
};

const CANVAS_PRESETS = {
  BUSINESS_CARD: { width: 85, height: 54, name: 'Business Card (85x54mm)' },
  ID_CARD: { width: 85.6, height: 54, name: 'ID Card (85.6x54mm)' },
  LARGE_BADGE: { width: 102, height: 76, name: 'Large Badge (102x76mm)' },
  CUSTOM: { width: 85, height: 54, name: 'Custom Size' }
};

const ElementToolbox = () => {
  const elements = [
    { type: ELEMENT_TYPES.GUEST_PHOTO, name: 'Guest Photo', icon: '👤' },
    { type: ELEMENT_TYPES.GUEST_NAME, name: 'Guest Name', icon: '📝' },
    { type: ELEMENT_TYPES.GUEST_CATEGORY, name: 'Category', icon: '🏷️' },
    { type: ELEMENT_TYPES.BADGE_NUMBER, name: 'Badge Number', icon: '🔢' },
    { type: ELEMENT_TYPES.BARCODE, name: 'Barcode', icon: '📊' },
    { type: ELEMENT_TYPES.STATIC_TEXT, name: 'Static Text', icon: '📄' },
    { type: ELEMENT_TYPES.LOGO, name: 'Logo', icon: '🖼️' }
  ];

  return (
    <div className="bg-white rounded-lg shadow-sm border p-4 mb-4">
      <h3 className="text-lg font-semibold mb-3">Elements</h3>
      <div className="grid grid-cols-2 gap-2">
        {elements.map((element) => (
          <DraggableElement key={element.type} element={element} />
        ))}
      </div>
    </div>
  );
};

const DraggableElement = ({ element }) => {
  const [{ isDragging }, drag] = useDrag(() => ({
    type: 'element',
    item: { elementType: element.type },
    collect: (monitor) => ({
      isDragging: monitor.isDragging(),
    }),
  }));

  return (
    <div
      ref={drag}
      className={`p-2 border rounded cursor-move text-center transition-opacity ${
        isDragging ? 'opacity-50' : 'opacity-100'
      } hover:bg-gray-50`}
    >
      <div className="text-xl mb-1">{element.icon}</div>
      <div className="text-xs">{element.name}</div>
    </div>
  );
};

const CanvasElement = ({ element, isSelected, onSelect, onMove, onResize, zoom }) => {
  const elementRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [resizeHandle, setResizeHandle] = useState(null);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [initialSize, setInitialSize] = useState({ width: 0, height: 0 });
  const [initialPosition, setInitialPosition] = useState({ x: 0, y: 0 });

  const handleMouseDown = (e) => {
    if (e.target.classList.contains('resize-handle')) {
      setIsResizing(true);
      setResizeHandle(e.target.dataset.handle);
      setDragStart({ x: e.clientX, y: e.clientY });
      setInitialSize({ width: element.width, height: element.height });
      setInitialPosition({ x: element.x, y: element.y });
    } else {
      setIsDragging(true);
      // Calculate relative position within the canvas
      const canvasContainer = elementRef.current?.parentElement;
      if (canvasContainer) {
        const rect = canvasContainer.getBoundingClientRect();
        setDragStart({
          x: e.clientX - rect.left - element.x * zoom,
          y: e.clientY - rect.top - element.y * zoom
        });
      }
    }
    onSelect(element.id);
    e.stopPropagation();
  };

  const handleMouseMove = (e) => {
    if (isDragging && !isResizing) {
      // Get canvas container to calculate relative position
      const canvasContainer = elementRef.current?.parentElement;
      if (canvasContainer) {
        const rect = canvasContainer.getBoundingClientRect();
        const newX = (e.clientX - rect.left - dragStart.x) / zoom;
        const newY = (e.clientY - rect.top - dragStart.y) / zoom;
        onMove(element.id, { x: newX, y: newY });
      }
    } else if (isResizing && resizeHandle) {
      const deltaX = (e.clientX - dragStart.x) / zoom;
      const deltaY = (e.clientY - dragStart.y) / zoom;

      let newWidth = initialSize.width;
      let newHeight = initialSize.height;
      let newX = initialPosition.x;
      let newY = initialPosition.y;

      switch (resizeHandle) {
        case 'nw': // Top-left
          newWidth = Math.max(20, initialSize.width - deltaX);
          newHeight = Math.max(20, initialSize.height - deltaY);
          newX = initialPosition.x + (initialSize.width - newWidth);
          newY = initialPosition.y + (initialSize.height - newHeight);
          break;
        case 'ne': // Top-right
          newWidth = Math.max(20, initialSize.width + deltaX);
          newHeight = Math.max(20, initialSize.height - deltaY);
          newY = initialPosition.y + (initialSize.height - newHeight);
          break;
        case 'sw': // Bottom-left
          newWidth = Math.max(20, initialSize.width - deltaX);
          newHeight = Math.max(20, initialSize.height + deltaY);
          newX = initialPosition.x + (initialSize.width - newWidth);
          break;
        case 'se': // Bottom-right
          newWidth = Math.max(20, initialSize.width + deltaX);
          newHeight = Math.max(20, initialSize.height + deltaY);
          break;
      }

      // Update both size and position
      onResize(element.id, { width: newWidth, height: newHeight });
      if (newX !== initialPosition.x || newY !== initialPosition.y) {
        onMove(element.id, { x: newX, y: newY });
      }
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
    setIsResizing(false);
    setResizeHandle(null);
  };

  useEffect(() => {
    if (isDragging || isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDragging, isResizing, dragStart, resizeHandle, initialSize, initialPosition]);

  const renderElementContent = () => {
    switch (element.type) {
      case ELEMENT_TYPES.GUEST_PHOTO:
        return (
          <div className="w-full h-full bg-gray-200 flex items-center justify-center border border-gray-300">
            <span className="text-gray-500 text-xs">Photo</span>
          </div>
        );
      case ELEMENT_TYPES.GUEST_NAME:
        return (
          <div
            className="w-full h-full flex items-center justify-center border border-gray-300"
            style={{
              fontSize: `${element.fontSize * zoom}px`,
              fontWeight: element.fontWeight,
              color: element.color,
              textAlign: element.textAlign
            }}
          >
            John Doe
          </div>
        );
      case ELEMENT_TYPES.GUEST_CATEGORY:
        return (
          <div
            className="w-full h-full flex items-center justify-center border border-gray-300"
            style={{
              fontSize: `${element.fontSize * zoom}px`,
              fontWeight: element.fontWeight,
              color: element.color,
              backgroundColor: element.backgroundColor
            }}
          >
            Filmmaker
          </div>
        );
      case ELEMENT_TYPES.BADGE_NUMBER:
        return (
          <div
            className="w-full h-full flex items-center justify-center border border-gray-300"
            style={{
              fontSize: `${element.fontSize * zoom}px`,
              fontWeight: element.fontWeight,
              color: element.color
            }}
          >
            2024001
          </div>
        );
      case ELEMENT_TYPES.BARCODE:
        return (
          <div className="w-full h-full bg-white flex items-center justify-center border border-gray-300">
            <div style={{ fontSize: `${12 * zoom}px` }} className="text-gray-600">|||||||||||</div>
          </div>
        );
      case ELEMENT_TYPES.STATIC_TEXT:
        return (
          <div
            className="w-full h-full flex items-center justify-center border border-gray-300"
            style={{
              fontSize: `${element.fontSize * zoom}px`,
              fontWeight: element.fontWeight,
              color: element.color,
              textAlign: element.textAlign
            }}
          >
            {element.text || 'Text'}
          </div>
        );
      case ELEMENT_TYPES.LOGO:
        return (
          <div className="w-full h-full bg-gray-200 flex items-center justify-center border border-gray-300">
            <span className="text-gray-500 text-xs">Logo</span>
          </div>
        );
      default:
        return <div className="w-full h-full bg-gray-200 border border-gray-300"></div>;
    }
  };

  return (
    <div
      ref={elementRef}
      className={`absolute cursor-move ${isSelected ? 'ring-2 ring-blue-500' : ''}`}
      style={{
        left: element.x * zoom,
        top: element.y * zoom,
        width: element.width * zoom,
        height: element.height * zoom,
        zIndex: element.zIndex || 1
      }}
      onMouseDown={handleMouseDown}
    >
      {renderElementContent()}

      {isSelected && (
        <>
          <div className="absolute -top-1 -left-1 w-2 h-2 bg-blue-500 cursor-nw-resize resize-handle" data-handle="nw"></div>
          <div className="absolute -top-1 -right-1 w-2 h-2 bg-blue-500 cursor-ne-resize resize-handle" data-handle="ne"></div>
          <div className="absolute -bottom-1 -left-1 w-2 h-2 bg-blue-500 cursor-sw-resize resize-handle" data-handle="sw"></div>
          <div className="absolute -bottom-1 -right-1 w-2 h-2 bg-blue-500 cursor-se-resize resize-handle" data-handle="se"></div>
        </>
      )}
    </div>
  );
};

const CanvasArea = ({
  canvasSize,
  elements,
  selectedElement,
  onElementSelect,
  onElementMove,
  onElementResize,
  onElementAdd,
  backgroundColor,
  zoom
}) => {
  const canvasRef = useRef(null);
  const scale = 2 * zoom; // 2 pixels per mm for display, multiplied by zoom

  const [{ isOver }, drop] = useDrop(() => ({
    accept: 'element',
    drop: (item, monitor) => {
      const offset = monitor.getClientOffset();
      const canvasRect = canvasRef.current.getBoundingClientRect();
      const x = offset.x - canvasRect.left;
      const y = offset.y - canvasRect.top;
      
      onElementAdd(item.elementType, { x, y });
    },
    collect: (monitor) => ({
      isOver: monitor.isOver(),
    }),
  }));

  const handleCanvasClick = (e) => {
    if (e.target === canvasRef.current) {
      onElementSelect(null);
    }
  };

  return (
    <div className="bg-white rounded-lg shadow-sm border p-4">
      <h3 className="text-lg font-semibold mb-3">Canvas</h3>
      <div className="overflow-auto max-h-[600px]">
        <div
          ref={drop}
          className="relative border-2 border-dashed border-gray-300 mx-auto"
          style={{
            width: canvasSize.width * scale,
            height: canvasSize.height * scale,
            backgroundColor: backgroundColor || '#ffffff'
          }}
          onClick={handleCanvasClick}
        >
          <div
            ref={canvasRef}
            className={`relative w-full h-full ${isOver ? 'bg-blue-50' : ''}`}
          >
            {elements.map((element) => (
              <CanvasElement
                key={element.id}
                element={element}
                isSelected={selectedElement === element.id}
                onSelect={onElementSelect}
                onMove={onElementMove}
                onResize={onElementResize}
                zoom={zoom}
              />
            ))}
          </div>
        </div>
      </div>
      <div className="text-xs text-gray-500 text-center mt-2">
        {canvasSize.width}mm × {canvasSize.height}mm (Zoom: {Math.round(zoom * 100)}%)
      </div>
    </div>
  );
};

const PropertyPanel = ({ selectedElement, elements, onElementUpdate }) => {
  const element = elements.find(e => e.id === selectedElement);

  if (!element) {
    return (
      <div className="bg-white rounded-lg shadow-sm border p-4">
        <h3 className="text-lg font-semibold mb-3">Properties</h3>
        <p className="text-gray-500">Select an element to edit its properties</p>
      </div>
    );
  }

  const handlePropertyChange = (property, value) => {
    onElementUpdate(element.id, { [property]: value });
  };

  return (
    <div className="bg-white rounded-lg shadow-sm border p-4">
      <h3 className="text-lg font-semibold mb-3">Properties</h3>
      
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Position X
          </label>
          <input
            type="number"
            value={element.x}
            onChange={(e) => handlePropertyChange('x', parseInt(e.target.value))}
            className="w-full px-3 py-2 border border-gray-300 rounded-md"
          />
        </div>
        
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Position Y
          </label>
          <input
            type="number"
            value={element.y}
            onChange={(e) => handlePropertyChange('y', parseInt(e.target.value))}
            className="w-full px-3 py-2 border border-gray-300 rounded-md"
          />
        </div>
        
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Width
          </label>
          <input
            type="number"
            value={element.width}
            onChange={(e) => handlePropertyChange('width', parseInt(e.target.value))}
            className="w-full px-3 py-2 border border-gray-300 rounded-md"
          />
        </div>
        
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Height
          </label>
          <input
            type="number"
            value={element.height}
            onChange={(e) => handlePropertyChange('height', parseInt(e.target.value))}
            className="w-full px-3 py-2 border border-gray-300 rounded-md"
          />
        </div>

        {/* Text-based elements */}
        {[ELEMENT_TYPES.GUEST_NAME, ELEMENT_TYPES.GUEST_CATEGORY, ELEMENT_TYPES.BADGE_NUMBER, ELEMENT_TYPES.STATIC_TEXT].includes(element.type) && (
          <>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Font Size
              </label>
              <input
                type="number"
                value={element.fontSize || 14}
                onChange={(e) => handlePropertyChange('fontSize', parseInt(e.target.value))}
                className="w-full px-3 py-2 border border-gray-300 rounded-md"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Font Weight
              </label>
              <select
                value={element.fontWeight || 'normal'}
                onChange={(e) => handlePropertyChange('fontWeight', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md"
              >
                <option value="normal">Normal</option>
                <option value="bold">Bold</option>
                <option value="lighter">Light</option>
              </select>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Color
              </label>
              <input
                type="color"
                value={element.color || '#000000'}
                onChange={(e) => handlePropertyChange('color', e.target.value)}
                className="w-full h-10 border border-gray-300 rounded-md"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Text Align
              </label>
              <select
                value={element.textAlign || 'center'}
                onChange={(e) => handlePropertyChange('textAlign', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md"
              >
                <option value="left">Left</option>
                <option value="center">Center</option>
                <option value="right">Right</option>
              </select>
            </div>
          </>
        )}

        {/* Static text specific */}
        {element.type === ELEMENT_TYPES.STATIC_TEXT && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Text
            </label>
            <input
              type="text"
              value={element.text || ''}
              onChange={(e) => handlePropertyChange('text', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md"
            />
          </div>
        )}

        {/* Category specific */}
        {element.type === ELEMENT_TYPES.GUEST_CATEGORY && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Background Color
            </label>
            <input
              type="color"
              value={element.backgroundColor || '#ffffff'}
              onChange={(e) => handlePropertyChange('backgroundColor', e.target.value)}
              className="w-full h-10 border border-gray-300 rounded-md"
            />
          </div>
        )}
      </div>
    </div>
  );
};

const BadgeDesigner = ({
  initialLayout,
  onSave,
  onCancel,
  editionId
}) => {
  const [layoutName, setLayoutName] = useState(initialLayout?.name || '');
  const [canvasSize, setCanvasSize] = useState({
    width: initialLayout?.canvas_width_mm || 85,
    height: initialLayout?.canvas_height_mm || 54
  });
  const [backgroundColor, setBackgroundColor] = useState(initialLayout?.background_color || '#ffffff');
  const [elements, setElements] = useState(initialLayout?.layout_data?.elements || []);
  const [selectedElement, setSelectedElement] = useState(null);
  const [zoom, setZoom] = useState(1);
  
  // Use ref to track next ID to avoid async state issues
  const nextElementIdRef = useRef(
    (() => {
      const existingElements = initialLayout?.layout_data?.elements || [];
      return existingElements.length > 0 ? Math.max(...existingElements.map(e => e.id)) + 1 : 1;
    })()
  );
  
  const getNextElementId = () => {
    const id = nextElementIdRef.current;
    nextElementIdRef.current += 1;
    return id;
  };

  const handleCanvasSizeChange = (preset) => {
    if (preset === 'CUSTOM') return;
    setCanvasSize({
      width: CANVAS_PRESETS[preset].width,
      height: CANVAS_PRESETS[preset].height
    });
  };

  const handleElementAdd = (elementType, position) => {
    const newElementId = getNextElementId();
    
    const newElement = {
      id: newElementId,
      type: elementType,
      x: position.x,
      y: position.y,
      width: 80,
      height: 30,
      fontSize: 14,
      fontWeight: 'normal',
      color: '#000000',
      textAlign: 'center',
      zIndex: 1
    };

    // Adjust default size for specific element types
    if (elementType === ELEMENT_TYPES.GUEST_PHOTO) {
      newElement.width = 60;
      newElement.height = 80;
    } else if (elementType === ELEMENT_TYPES.BARCODE) {
      newElement.width = 100;
      newElement.height = 40;
    }

    setElements(prev => [...prev, newElement]);
    setSelectedElement(newElementId);
  };

  const handleElementMove = (elementId, position) => {
    setElements(prev => prev.map(el => 
      el.id === elementId ? { ...el, ...position } : el
    ));
  };

  const handleElementResize = (elementId, size) => {
    setElements(prev => prev.map(el => 
      el.id === elementId ? { ...el, ...size } : el
    ));
  };

  const handleElementUpdate = (elementId, updates) => {
    setElements(prev => prev.map(el => 
      el.id === elementId ? { ...el, ...updates } : el
    ));
  };

  const handleElementDelete = () => {
    if (selectedElement) {
      setElements(prev => prev.filter(el => el.id !== selectedElement));
      setSelectedElement(null);
    }
  };

  const handleSave = () => {
    const layoutData = {
      name: layoutName,
      edition_id: editionId,
      canvas_width_mm: canvasSize.width,
      canvas_height_mm: canvasSize.height,
      background_color: backgroundColor,
      layout_data: { elements }
    };

    onSave(layoutData);
  };

  return (
    <DndProvider backend={HTML5Backend}>
      <div className="min-h-screen bg-gray-100">
        <div className="bg-white shadow-sm border-b">
          <div className="max-w-7xl mx-auto px-4 py-4">
            <div className="flex justify-between items-center">
              <h1 className="text-2xl font-bold">Badge Designer</h1>
              <div className="flex space-x-2">
                <button
                  onClick={onCancel}
                  className="px-4 py-2 text-gray-600 border border-gray-300 rounded-md hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                >
                  Save Layout
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="max-w-7xl mx-auto px-4 py-6">
          {/* Layout Settings */}
          <div className="bg-white rounded-lg shadow-sm border p-4 mb-6">
            <h3 className="text-lg font-semibold mb-4">Layout Settings</h3>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Layout Name
                </label>
                <input
                  type="text"
                  value={layoutName}
                  onChange={(e) => setLayoutName(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  placeholder="Enter layout name"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Canvas Size
                </label>
                <select
                  onChange={(e) => handleCanvasSizeChange(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md"
                >
                  {Object.entries(CANVAS_PRESETS).map(([key, preset]) => (
                    <option key={key} value={key}>{preset.name}</option>
                  ))}
                </select>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Width (mm)
                </label>
                <input
                  type="number"
                  value={canvasSize.width}
                  onChange={(e) => setCanvasSize({...canvasSize, width: parseFloat(e.target.value)})}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Height (mm)
                </label>
                <input
                  type="number"
                  value={canvasSize.height}
                  onChange={(e) => setCanvasSize({...canvasSize, height: parseFloat(e.target.value)})}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md"
                />
              </div>
            </div>
            
            <div className="mt-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Background Color
              </label>
              <input
                type="color"
                value={backgroundColor}
                onChange={(e) => setBackgroundColor(e.target.value)}
                className="w-20 h-10 border border-gray-300 rounded-md"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
            {/* Element Toolbox */}
            <div>
              <ElementToolbox />
              
              {/* Actions */}
              <div className="bg-white rounded-lg shadow-sm border p-4">
                <h3 className="text-lg font-semibold mb-3">Actions</h3>
                <button
                  onClick={handleElementDelete}
                  disabled={!selectedElement}
                  className="w-full px-3 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Delete Selected
                </button>
              </div>
            </div>

            {/* Canvas */}
            <div className="lg:col-span-2">
              {/* Zoom Controls */}
              <div className="bg-white rounded-lg shadow-sm border p-4 mb-4">
                <h3 className="text-lg font-semibold mb-3">Zoom</h3>
                <div className="flex items-center gap-4">
                  <button
                    onClick={() => setZoom(1)}
                    className={`px-4 py-2 rounded-md ${zoom === 1 ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
                  >
                    100%
                  </button>
                  <button
                    onClick={() => setZoom(2)}
                    className={`px-4 py-2 rounded-md ${zoom === 2 ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
                  >
                    200%
                  </button>
                  <div className="flex-1 flex items-center gap-2">
                    <span className="text-sm text-gray-600">Custom:</span>
                    <input
                      type="range"
                      min="0.5"
                      max="3"
                      step="0.1"
                      value={zoom}
                      onChange={(e) => setZoom(parseFloat(e.target.value))}
                      className="flex-1"
                    />
                    <span className="text-sm font-medium w-12">{Math.round(zoom * 100)}%</span>
                  </div>
                </div>
              </div>

              <CanvasArea
                canvasSize={canvasSize}
                elements={elements}
                selectedElement={selectedElement}
                onElementSelect={setSelectedElement}
                onElementMove={handleElementMove}
                onElementResize={handleElementResize}
                onElementAdd={handleElementAdd}
                backgroundColor={backgroundColor}
                zoom={zoom}
              />
            </div>

            {/* Properties Panel */}
            <div>
              <PropertyPanel
                selectedElement={selectedElement}
                elements={elements}
                onElementUpdate={handleElementUpdate}
              />
            </div>
          </div>
        </div>
      </div>
    </DndProvider>
  );
};

export default BadgeDesigner;