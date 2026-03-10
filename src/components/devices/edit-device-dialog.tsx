import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { X, Plus } from 'lucide-react'
import type { DeviceEntry } from '@/services/device-service'

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

export function EditDeviceDialog({
  device,
  open,
  onOpenChange,
  onSave,
  isSaving = false,
}: EditDeviceDialogProps) {
  const [name, setName] = useState('')
  const [location, setLocation] = useState('')
  const [isRegistrar, setIsRegistrar] = useState(false)
  const [capabilities, setCapabilities] = useState<string[]>([])

  // Reset form when device changes
  useEffect(() => {
    if (device) {
      setName(device.name || '')
      setLocation(device.location || '')
      setIsRegistrar(device.is_registrar || false)
      setCapabilities(device.registrar_capabilities || [])
    }
  }, [device])

  const handleSave = async () => {
    if (!device) return

    const updates: {
      name?: string
      location?: string
      is_registrar?: boolean
      registrar_capabilities?: string[]
    } = {}

    // Only include changed fields
    if (name !== device.name) updates.name = name || undefined
    if (location !== device.location) updates.location = location || undefined
    if (isRegistrar !== device.is_registrar) updates.is_registrar = isRegistrar
    if (JSON.stringify(capabilities) !== JSON.stringify(device.registrar_capabilities || [])) {
      updates.registrar_capabilities = capabilities
    }

    await onSave(device.serial_number, updates)
    onOpenChange(false)
  }

  const toggleCapability = (capability: string) => {
    setCapabilities(prev =>
      prev.includes(capability)
        ? prev.filter(c => c !== capability)
        : [...prev, capability]
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Edit Device</DialogTitle>
          <DialogDescription>
            Update device configuration for {device?.serial_number}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          {/* Device Name */}
          <div className="grid gap-2">
            <Label htmlFor="name">Device Name</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Main Entrance"
            />
          </div>

          {/* Location */}
          <div className="grid gap-2">
            <Label htmlFor="location">Location</Label>
            <Input
              id="location"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="e.g., Building A, Floor 1"
            />
          </div>

          {/* Registrar Toggle */}
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

          {/* Registrar Capabilities */}
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

        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSaving}
          >
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving ? 'Saving...' : 'Save Changes'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
