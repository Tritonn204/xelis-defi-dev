import { useState } from 'react'
import { SlidersHorizontal } from 'lucide-react'
import Button from '@/components/ui/Button'

interface SlippageSettingsProps {
  slippage: number
  onSlippageChange: (value: number) => void
}

const SlippageSettings = ({ slippage, onSlippageChange }: SlippageSettingsProps) => {
  const [isOpen, setIsOpen] = useState(false)
  const [customValue, setCustomValue] = useState(slippage.toString())
  
  const presetValues = [0.1, 0.5, 1.0]
  
  const handleCustomChange = (value: string) => {
    let numValue = Math.min(parseFloat(value), 50)
    setCustomValue(numValue.toString())
    if (!isNaN(numValue) && numValue >= 0 && numValue <= 50) {
      onSlippageChange(numValue)
    }
  }
  
  return (
    <div className="relative">
      <Button
        onClick={() => setIsOpen(!isOpen)}
        className="text-forge-orange transition-all duration-200 hover:text-white p-1 rounded-lg hover:bg-white/10"
        focusOnClick={false}
      >
        <SlidersHorizontal className="w-5 h-5" />
      </Button>
      
      {isOpen && (
        <>
          {/* Backdrop */}
          <div 
            className="fixed inset-0 z-40"
            onClick={() => setIsOpen(false)}
          />
          
          {/* Dropdown */}
          <div className="absolute right-0 top-full mt-2 bg-black/90 border border-white/20 rounded-xl p-4 z-50 min-w-[280px] backdrop-blur-xl">
            <div className="text-white font-medium mb-3">Slippage Tolerance</div>
            
            {/* Preset buttons */}
            <div className="flex gap-2 mb-3">
              {presetValues.map(value => (
                <button
                  key={value}
                  onClick={() => {
                    onSlippageChange(value)
                    setCustomValue(value.toString())
                  }}
                  className={`
                    flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-all
                    ${slippage === value 
                      ? 'bg-forge-orange text-white' 
                      : 'bg-white/10 text-gray-300 hover:bg-white/20'
                    }
                  `}
                >
                  {value}%
                </button>
              ))}
            </div>
            
            {/* Custom input */}
            <div className="flex items-center gap-2">
              <input
                type="number"
                value={customValue}
                onChange={(e) => handleCustomChange(e.target.value)}
                placeholder="0.5"
                className="flex-1 bg-black/50 border border-white/20 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-forge-orange focus:border-transparent"
                min="0"
                max="50"
                step="0.1"
              />
              <span className="text-gray-400">%</span>
            </div>
            
            {/* Warning for high slippage */}
            {slippage > 5 && (
              <div className="mt-2 text-xs text-yellow-400">
                ⚠️ High slippage tolerance
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

export default SlippageSettings