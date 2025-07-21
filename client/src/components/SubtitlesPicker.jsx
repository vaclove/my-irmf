import LanguagePicker from './LanguagePicker'

const SubtitlesPicker = ({ 
  value = '', 
  onChange, 
  placeholder = 'Select subtitle languages...', 
  className = '' 
}) => {
  // SubtitlesPicker is essentially a LanguagePicker with multiple selection enabled
  // and different placeholder/label text
  return (
    <LanguagePicker
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      className={className}
      multiple={true}
      label="Subtitles"
    />
  )
}

export default SubtitlesPicker