import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { useConnectionStatus } from '@/hooks/use-connection-status'
import { LogOut, Wifi, WifiOff, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { signalDot } from '@/lib/signal'

interface HeaderConnectionProps {
  userEmail?: string
  onSignOut: () => void
}

export function HeaderConnection({ userEmail, onSignOut }: HeaderConnectionProps) {
  const { network, supabase, backend, overall, refetch, isFetching } = useConnectionStatus()

  return (
    <div className="flex items-center gap-3">
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => refetch()}
              className="flex items-center gap-2 group"
              disabled={isFetching}
            >
              {/* Status Dot */}
              <span 
                className={`h-2 w-2 rounded-full transition-colors ${
                  overall === 'connected' ? signalDot.success :
                  overall === 'connecting' ? `${signalDot.progress} animate-pulse` :
                  signalDot.danger
                }`}
              />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs">
            <div className="space-y-1">
              <p className="font-medium">Connection Status</p>
              {overall === 'connected' && <p><Wifi className="h-3 w-3 inline mr-1" /> All systems operational</p>}
              {overall === 'connecting' && <p><Loader2 className="h-3 w-3 inline mr-1 animate-spin" /> Connecting...</p>}
              {overall === 'offline' && <p><WifiOff className="h-3 w-3 inline mr-1" /> You are offline</p>}
              <div className="text-muted-foreground text-[10px] pt-1">
                <div>Network: {network ? '✓' : '✗'}</div>
                <div>Supabase: {supabase ? '✓' : '✗'}</div>
                <div>Backend: {backend ? '✓' : '✗'}</div>
              </div>
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      {/* User Email */}
      <span className="text-sm text-muted-foreground hidden md:inline truncate max-w-[200px]">
        {userEmail}
      </span>

      {/* Sign Out */}
      <Button onClick={onSignOut} variant="ghost" size="sm">
        <LogOut className="h-4 w-4" />
      </Button>
    </div>
  )
}