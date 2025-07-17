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

const CanvasElement = ({ element, isSelected, onSelect, onMove, onResize }) => {
  const elementRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  const handleMouseDown = (e) => {
    if (e.target.classList.contains('resize-handle')) {
      setIsResizing(true);
    } else {
      setIsDragging(true);
      setDragStart({
        x: e.clientX - element.x,
        y: e.clientY - element.y
      });
    }
    onSelect(element.id);
    e.stopPropagation();
  };

  const handleMouseMove = (e) => {
    if (isDragging && !isResizing) {
      const newX = e.clientX - dragStart.x;
      const newY = e.clientY - dragStart.y;
      onMove(element.id, { x: newX, y: newY });
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
    setIsResizing(false);
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
  }, [isDragging, isResizing, dragStart]);

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
              fontSize: `${element.fontSize}px`,
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
              fontSize: `${element.fontSize}px`,
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
              fontSize: `${element.fontSize}px`,
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
            <div className="text-xs text-gray-600">|||||||||||</div>
          </div>
        );
      case ELEMENT_TYPES.STATIC_TEXT:
        return (
          <div 
            className="w-full h-full flex items-center justify-center border border-gray-300"
            style={{ 
              fontSize: `${element.fontSize}px`,
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
        left: element.x,
        top: element.y,
        width: element.width,
        height: element.height,
        zIndex: element.zIndex || 1
      }}
      onMouseDown={handleMouseDown}
    >
      {renderElementContent()}
      
      {isSelected && (
        <>
          <div className="absolute -top-1 -left-1 w-2 h-2 bg-blue-500 cursor-nw-resize resize-handle"></div>
          <div className="absolute -top-1 -right-1 w-2 h-2 bg-blue-500 cursor-ne-resize resize-handle"></div>
          <div className="absolute -bottom-1 -left-1 w-2 h-2 bg-blue-500 cursor-sw-resize resize-handle"></div>
          <div className="absolute -bottom-1 -right-1 w-2 h-2 bg-blue-500 cursor-se-resize resize-handle"></div>
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
  canvasScale,
  onScaleChange
}) => {
  const canvasRef = useRef(null);
  const baseScale = 3; // 3 pixels per mm for better visibility
  const displayScale = baseScale * canvasScale;

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
      <div className="flex justify-between items-center mb-3">
        <h3 className="text-lg font-semibold">Canvas</h3>
        <div className="flex items-center space-x-2">
          <label className="text-sm font-medium text-gray-700">Zoom:</label>
          <select
            value={canvasScale}
            onChange={(e) => onScaleChange(parseFloat(e.target.value))}
            className="px-2 py-1 border border-gray-300 rounded text-sm"
          >
            <option value={0.5}>50%</option>
            <option value={0.75}>75%</option>
            <option value={1}>100%</option>
            <option value={1.5}>150%</option>
            <option value={2}>200%</option>
          </select>
        </div>
      </div>
      
      <div className="overflow-auto max-h-[500px] border border-gray-200 rounded p-4 bg-gray-50">
        <div 
          ref={drop}
          className="relative border-2 border-dashed border-gray-300 mx-auto"
          style={{
            width: canvasSize.width * displayScale,
            height: canvasSize.height * displayScale,
            backgroundColor: backgroundColor || '#ffffff',
            minWidth: 200,
            minHeight: 150
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
                element={{
                  ...element,
                  x: element.x * displayScale,
                  y: element.y * displayScale,
                  width: element.width * displayScale,
                  height: element.height * displayScale
                }}
                isSelected={selectedElement === element.id}
                onSelect={onElementSelect}
                onMove={(id, pos) => onElementMove(id, { x: pos.x, y: pos.y })}
                onResize={onElementResize}
              />
            ))}
          </div>
        </div>
      </div>
      
      <div className="text-xs text-gray-500 text-center mt-2">
        {canvasSize.width}mm × {canvasSize.height}mm (Scale: {Math.round(canvasScale * 100)}%)
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
  const [nextElementId, setNextElementId] = useState(() => {
    const existingElements = initialLayout?.layout_data?.elements || [];
    return existingElements.length > 0 ? Math.max(...existingElements.map(e => e.id)) + 1 : 1;
  });
  const [canvasScale, setCanvasScale] = useState(() => {
    // Default scale to fit nicely on screen - smaller canvases get bigger scale
    const maxDimension = Math.max(canvasSize.width, canvasSize.height);
    if (maxDimension < 60) return 2;
    if (maxDimension < 100) return 1.5;
    return 1;
  });

  const handleCanvasSizeChange = (preset) => {
    if (preset === 'CUSTOM') return;
    setCanvasSize({
      width: CANVAS_PRESETS[preset].width,
      height: CANVAS_PRESETS[preset].height
    });
  };

  const handleElementAdd = (elementType, position) => {
    const newElement = {
      id: nextElementId,
      type: elementType,
      x: Math.round(position.x / canvasScale),
      y: Math.round(position.y / canvasScale),
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
    setNextElementId(prev => prev + 1);
    setSelectedElement(newElement.id);
  };

  const handleElementMove = (elementId, position) => {
    setElements(prev => prev.map(el => 
      el.id === elementId ? { 
        ...el, 
        x: Math.round(position.x / canvasScale), 
        y: Math.round(position.y / canvasScale) 
      } : el
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
              <CanvasArea
                canvasSize={canvasSize}
                elements={elements}
                selectedElement={selectedElement}
                onElementSelect={setSelectedElement}
                onElementMove={handleElementMove}
                onElementResize={handleElementResize}
                onElementAdd={handleElementAdd}
                backgroundColor={backgroundColor}
                canvasScale={canvasScale}
                onScaleChange={setCanvasScale}
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