import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { X, Plus, Loader2, ShieldCheck } from 'lucide-react'
import type { DeviceEntry } from '@/services/device-service'
import { DeviceService } from '@/services/device-service'
import { useFrappeBranches } from '@/hooks/use-frappe-branches'
import { ConfirmationDialog } from '@/components/ui/base-modal'
import { useAuth } from '@/contexts/auth-context'
import { notifyError, notifySuccess } from '@/lib/toast'

interface EditDeviceDialogProps {
  device: DeviceEntry | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSave: (serialNumber: string, updates: {
    name?: string
    location?: string
    is_registrar?: boolean
    registrar_capabilities?: string[]
  }) => Promise<void>
  isSaving?: boolean
}

const REGISTRAR_CAPABILITIES = [
  { value: 'fingerprint', label: 'Fingerprint' },
  { value: 'face', label: 'Face Recognition' },
  { value: 'card', label: 'Card' },
]

function getChanges(
  device: DeviceEntry | null,
  name: string,
  location: string,
  isRegistrar: boolean,
  capabilities: string[]
): Record<string, { from: string; to: string }> {
  if (!device) return {}
  const changes: Record<string, { from: string; to: string }> = {}

  if (name !== (device.name || '')) {
    changes['Name'] = { from: device.name || '(empty)', to: name || '(empty)' }
  }
  if (location !== (device.location || '')) {
    changes['Location'] = { from: device.location || '(empty)', to: location || '(empty)' }
  }
  if (isRegistrar !== (device.is_registrar || false)) {
    changes['Registrar'] = {
      from: device.is_registrar ? 'Enabled' : 'Disabled',
      to: isRegistrar ? 'Enabled' : 'Disabled',
    }
  }
  if (JSON.stringify(capabilities) !== JSON.stringify(device.registrar_capabilities || [])) {
    changes['Capabilities'] = {
      from: (device.registrar_capabilities || []).join(', ') || '(none)',
      to: capabilities.join(', ') || '(none)',
    }
  }

  return changes
}

export function EditDeviceDialog({
  device,
  open,
  onOpenChange,
  onSave,
  isSaving = false,
}: EditDeviceDialogProps) {
  const { data: branches = [], isLoading: isLoadingBranches } = useFrappeBranches()
  const { isSuperAdmin } = useAuth()
  
  const [name, setName] = useState('')
  const [location, setLocation] = useState('')
  const [approving, setApproving] = useState(false)
  const [isRegistrar, setIsRegistrar] = useState(false)
  const [capabilities, setCapabilities] = useState<string[]>([])
  const [confirmOpen, setConfirmOpen] = useState(false)

  useEffect(() => {
    if (device && open) {
      setName(device.name || '')
      const currentLocation = device.location || ''
      setLocation(currentLocation)
      setIsRegistrar(device.is_registrar || false)
      setCapabilities(device.registrar_capabilities || [])
      setConfirmOpen(false)
    }
  }, [device, open, branches])

  const changes = getChanges(device, name, location, isRegistrar, capabilities)
  const hasChanges = Object.keys(changes).length > 0

  const pendingUpdates = (() => {
    if (!device) return {}
    const updates: Record<string, unknown> = {}
    if (name !== (device.name || '')) updates.name = name || undefined
    if (location !== (device.location || '')) updates.location = location || undefined
    if (isRegistrar !== (device.is_registrar || false)) updates.is_registrar = isRegistrar
    if (JSON.stringify(capabilities) !== JSON.stringify(device.registrar_capabilities || [])) {
      updates.registrar_capabilities = capabilities
    }
    return updates
  })()

  const handleApproveSn = async () => {
    if (!device) return
    setApproving(true)
    try {
      await DeviceService.approveDevice(device.serial_number)
      notifySuccess('Device approved', `${device.serial_number} can now connect.`)
    } catch (e) {
      notifyError('Approve failed', e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setApproving(false)
    }
  }

  const handleConfirmSave = async () => {
    if (!device || Object.keys(pendingUpdates).length === 0) return
    if (Object.keys(pendingUpdates).length > 0) {
      await onSave(device.serial_number, pendingUpdates as {
        name?: string
        location?: string
        is_registrar?: boolean
        registrar_capabilities?: string[]
      })
    }
    setConfirmOpen(false)
    onOpenChange(false)
  }

  const toggleCapability = (capability: string) => {
    setCapabilities(prev =>
      prev.includes(capability)
        ? prev.filter(c => c !== capability)
        : [...prev, capability]
    )
  }

  const changesMessage = (
    <div className="grid gap-3">
      <div className="flex items-center gap-2 rounded-md border border-yellow-500/50 bg-yellow-500/10 p-3">
        <ShieldCheck className="h-5 w-5 text-yellow-600 shrink-0" />
        <span className="text-sm text-yellow-700 dark:text-yellow-400">
          Review the following changes before confirming:
        </span>
      </div>
      <div className="grid gap-2">
        {Object.entries(changes).map(([field, { from, to }]) => (
          <div key={field} className="flex items-center gap-2 text-sm">
            <span className="font-medium min-w-[100px]">{field}</span>
            <span className="text-muted-foreground truncate text-right flex-1">{from}</span>
            <span className="text-muted-foreground">→</span>
            <span className="font-medium truncate flex-1">{to}</span>
          </div>
        ))}
      </div>
    </div>
  )

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Device</DialogTitle>
            <DialogDescription>
              Update configuration for <code className="text-xs font-mono bg-muted px-1 py-0.5 rounded">{device?.serial_number}</code>
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="name">Device Name</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Main Entrance"
              />
            </div>

            <div className="grid gap-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="location">Location (Branch)</Label>
              </div>
              {isLoadingBranches ? (
                <div className="flex items-center gap-2 h-9 px-3 text-sm text-muted-foreground border rounded-md">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading branches...
                </div>
              ) : (
                <Select value={location} onValueChange={setLocation}>
                  <SelectTrigger id="location" className="w-full">
                    <SelectValue placeholder="Select a branch" />
                  </SelectTrigger>
                  <SelectContent className="max-h-60 overflow-y-auto">
                    {branches.length === 0 && (
                      <div className="px-2 py-4 text-sm text-muted-foreground text-center">
                        No branches found
                      </div>
                    )}
                    {branches.map((branch) => (
                      <SelectItem key={branch.value} value={branch.value}>
                        {branch.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            {device?.connection_status === 'pending' && isSuperAdmin && (
              <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 flex items-center justify-between gap-2">
                <p className="text-sm text-amber-800 dark:text-amber-200">
                  Serial pending approval — device cannot sync until approved.
                </p>
                <Button size="sm" onClick={handleApproveSn} disabled={approving}>
                  {approving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Approve SN'}
                </Button>
              </div>
            )}

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="registrar">Registrar Device</Label>
                <p className="text-xs text-muted-foreground">
                  Can enroll users and capture biometrics
                </p>
              </div>
              <Switch
                id="registrar"
                checked={isRegistrar}
                onCheckedChange={setIsRegistrar}
              />
            </div>

            {isRegistrar && (
              <div className="grid gap-2">
                <Label>Registrar Capabilities</Label>
                <div className="flex flex-wrap gap-2">
                  {REGISTRAR_CAPABILITIES.map((cap) => (
                    <Badge
                      key={cap.value}
                      variant={capabilities.includes(cap.value) ? 'default' : 'outline'}
                      className="cursor-pointer"
                      onClick={() => toggleCapability(cap.value)}
                    >
                      {capabilities.includes(cap.value) ? (
                        <X className="h-3 w-3 mr-1" />
                      ) : (
                        <Plus className="h-3 w-3 mr-1" />
                      )}
                      {cap.label}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </div>

          <DialogFooter variant="bar">
            <Button
              onClick={() => {
                if (!hasChanges) { onOpenChange(false); return }
                setConfirmOpen(true)
              }}
              disabled={isSaving}
            >
              {isSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {hasChanges ? 'Review Changes' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmationDialog
        isOpen={confirmOpen}
        title="Confirm Device Changes"
        message={changesMessage}
        confirmLabel="Confirm Changes"
        isProcessing={isSaving}
        onConfirm={handleConfirmSave}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  )
}