import { useQuery } from '@tanstack/react-query'
import { Shield } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { useAuth } from '@/contexts/auth-context'
import { signalText } from '@/lib/signal'
import { supabase } from '@/lib/supabase'
import type { DeviceEntry } from '@/services/device-service'

export interface DeviceSecurityGaps {
  pendingApprovalCount: number
  missingDeviceAdmin: boolean
}

function normalizeGaps(data: unknown): DeviceSecurityGaps | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  const g = data as Partial<DeviceSecurityGaps>
  return {
    missingDeviceAdmin: !!g.missingDeviceAdmin,
    pendingApprovalCount:
      typeof g.pendingApprovalCount === 'number' ? g.pendingApprovalCount : 0,
  }
}

export function useDeviceSecurityGaps(): DeviceSecurityGaps | null {
  const { data } = useQuery({
    queryKey: ['security-setup-gaps', 'v2'],
    queryFn: async (): Promise<DeviceSecurityGaps> => {
      const { count: deviceAdminCount } = await supabase
        .from('users')
        .select('id', { count: 'exact', head: true })
        .eq('is_device_admin', true)

      const { count: pendingCount } = await supabase
        .from('devices')
        .select('serial_number', { count: 'exact', head: true })
        .eq('connection_status', 'pending')

      return {
        missingDeviceAdmin: !deviceAdminCount,
        pendingApprovalCount: pendingCount ?? 0,
      }
    },
    staleTime: 60_000,
  })

  return normalizeGaps(data)
}

function gapCount(gaps: DeviceSecurityGaps): number {
  let n = 0
  if (gaps.missingDeviceAdmin) n++
  if ((gaps.pendingApprovalCount ?? 0) > 0) n++
  return n
}

/** Compact toolbar control — Super Admin only when gaps exist. */
export function DeviceSecuritySetupHint() {
  const { isSuperAdmin } = useAuth()
  const gaps = useDeviceSecurityGaps()

  if (!isSuperAdmin || !gaps || gapCount(gaps) === 0) return null

  const total = gapCount(gaps)

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 border-dashed text-muted-foreground font-normal"
        >
          <Shield className="h-3.5 w-3.5 opacity-70" />
          <span className="text-xs">Setup</span>
          <span className="rounded-full bg-muted px-1.5 py-0 text-[10px] font-medium text-foreground">
            {total}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-3">
        <p className="text-xs font-medium text-foreground mb-2">Provisioning</p>
        <ul className="space-y-2 text-xs text-muted-foreground">
          {gaps.missingDeviceAdmin && (
            <li>Create a terminal admin user (Users → device admin, PIN e.g. 9999).</li>
          )}
          {gaps.pendingApprovalCount > 0 && (
            <li>
              {gaps.pendingApprovalCount} device
              {gaps.pendingApprovalCount !== 1 ? 's' : ''} awaiting SN approval — open device →
              Approve.
            </li>
          )}
        </ul>
        <p className="mt-2 text-[10px] text-muted-foreground/80">
          MVP: approve each device serial number before it can sync.
        </p>
      </PopoverContent>
    </Popover>
  )
}

/** Inline serial-cell hint when pending approval applies. */
export function DeviceSecuritySerialHint({ device }: { device: DeviceEntry }) {
  const { isSuperAdmin } = useAuth()
  if (!isSuperAdmin) return null

  if (device.connection_status === 'pending') {
    return (
      <span className={`text-[10px] ${signalText.attention} whitespace-nowrap`}>
        pending
      </span>
    )
  }

  return null
}
