import { Clock8Icon } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { forwardRef } from 'react'

interface TimeInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  // Additional props can be added here if needed
}

export const TimeInput = forwardRef<HTMLInputElement, TimeInputProps>(
  ({ className, ...props }, ref) => {
    return (
      <div className='relative'>
        <div className='text-muted-foreground pointer-events-none absolute inset-y-0 left-0 flex items-center justify-center pl-3 peer-disabled:opacity-50'>
          <Clock8Icon className='size-4' />
          <span className='sr-only'>Time</span>
        </div>
        <Input
          ref={ref}
          type='time'
          className={`peer bg-background appearance-none pl-9 [&::-webkit-calendar-picker-indicator]:hidden [&::-webkit-calendar-picker-indicator]:appearance-none ${className || ''}`}
          {...props}
        />
      </div>
    )
  }
)

TimeInput.displayName = 'TimeInput'
