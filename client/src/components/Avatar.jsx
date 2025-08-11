const Avatar = ({ 
  photo, 
  image_urls,
  firstName, 
  lastName, 
  size = 'md', 
  className = '' 
}) => {
  const sizeClasses = {
    xs: 'w-6 h-6 text-xs',
    sm: 'w-8 h-8 text-xs',
    md: 'w-12 h-12 text-sm',
    lg: 'w-16 h-16 text-base',
    xl: 'w-20 h-20 text-lg'
  }

  const getInitials = () => {
    const first = firstName?.charAt(0)?.toUpperCase() || ''
    const last = lastName?.charAt(0)?.toUpperCase() || ''
    return `${first}${last}`
  }

  const getBackgroundColor = () => {
    // Generate consistent color based on initials
    const initials = getInitials()
    const colors = [
      'bg-red-500',
      'bg-blue-500', 
      'bg-green-500',
      'bg-yellow-500',
      'bg-purple-500',
      'bg-pink-500',
      'bg-indigo-500',
      'bg-teal-500'
    ]
    
    const charCode = initials.charCodeAt(0) + initials.charCodeAt(1) || 0
    return colors[charCode % colors.length]
  }

  // Determine which image source to use
  const getImageSrc = () => {
    // Priority: S3 URLs > legacy base64 photo
    if (image_urls) {
      // Use appropriate size based on avatar size
      if (size === 'xs' || size === 'sm') {
        return image_urls.thumbnail;
      } else if (size === 'md') {
        return image_urls.medium;
      } else {
        return image_urls.original || image_urls.medium;
      }
    }
    
    // Fallback to legacy base64 photo
    return photo;
  };

  const imageSrc = getImageSrc();
  
  if (imageSrc) {
    return (
      <img
        src={imageSrc}
        alt={`${firstName} ${lastName}`}
        className={`${sizeClasses[size]} rounded-full object-cover border-2 border-gray-200 ${className}`}
      />
    )
  }

  return (
    <div
      className={`${sizeClasses[size]} rounded-full ${getBackgroundColor()} flex items-center justify-center text-white font-semibold border-2 border-gray-200 ${className}`}
    >
      {getInitials()}
    </div>
  )
}

export default Avatar