import { X } from 'lucide-react'
import Button from './Button'

interface ChoiceDialogProps {
  isOpen: boolean
  onClose: () => void
  title: string
  message: string
  actions: {
    label: string
    variant: 'primary' | 'danger' | 'neutral' | 'white'
    onClick: () => void
    fontClassName?: string
  }[]
}

const buttonStyles: Record<string, string> = {
  primary: 'bg-forge-orange hover:bg-orange-600 text-white',
  danger: 'bg-red-600 hover:bg-red-700 text-white',
  neutral: 'bg-gray-700 hover:bg-gray-600 text-white',
  white: 'bg-white text-black ring-forge-orange',
}

const sharedButtonStyle = `
  w-full 
  py-1 px-4 
  rounded-xl 
  transition-all duration-200
  hover:shadow-lg
  hover:ring-2 
  hover:scale-[1.015]
  active:scale-[0.98]
`

const defaultFontClass = 'font-light text-[1.5rem]'

const ChoiceDialog = ({
  isOpen,
  onClose,
  title,
  message,
  actions,
}: ChoiceDialogProps) => {
  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center z-50">
      <div className="bg-black/90 border border-white/8 rounded-xl p-6 w-full max-w-sm mx-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-2xl font-semibold text-white">{title}</h2>
          <Button onClick={onClose} className="text-gray-400 transition-all duration-200 hover:text-white">
            <X className="w-5 h-5" />
          </Button>
        </div>

        <p className="text-gray-300 font-xl mb-6">{message}</p>

        <div className="flex flex-col gap-2">
          {actions.map(({ label, onClick, variant, fontClassName }, idx) => (
            <Button
              key={idx}
              onClick={() => {
                onClick()
                onClose()
              }}
              className={`${sharedButtonStyle} ${buttonStyles[variant]} ${fontClassName || defaultFontClass}`}
            >
              {label}
            </Button>
          ))}
        </div>
      </div>
    </div>
  )
}

export default ChoiceDialog
