import { useState, useMemo, useEffect, useCallback } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Fingerprint,
  ScanFace,
  Loader2,
  Wifi,
  WifiOff,
  CheckCircle2,
  XCircle,
  Clock,
  Radio,
  Send,
  ArrowLeft,
  AlertTriangle,
} from 'lucide-react'
import {
  useUserBiometrics,
  useSyncStatus,
  useStartEnrollment,
  useEnrollmentCommandStatus,
} from '@/hooks/use-users'
import type { UserEntry } from '@/services/user-service'
import { cn } from '@/lib/utils'

// ---------------------------------------------------------------------------
// Finger labels (ZKTeco finger ID 0-9)
// ---------------------------------------------------------------------------
const FINGER_LABELS: Record<number, string> = {
  0: 'Right Thumb',
  1: 'Right Index',
  2: 'Right Middle',
  3: 'Right Ring',
  4: 'Right Little',
  5: 'Left Thumb',
  6: 'Left Index',
  7: 'Left Middle',
  8: 'Left Ring',
  9: 'Left Little',
}

// ---------------------------------------------------------------------------
// Error code mapping from ZKTeco ENROLL_FP protocol
// ---------------------------------------------------------------------------
const ENROLL_ERROR_CODES: Record<string, { label: string; description: string }> = {
  '0': { label: 'Success', description: 'Enrollment completed successfully.' },
  '2': { label: 'Already Exists', description: 'A template already exists for this finger. Use overwrite to replace.' },
  '4': { label: 'Bad Quality', description: 'The captured template quality was too low. Please try again.' },
  '5': { label: 'Duplicate', description: 'This fingerprint matches another user in the device database.' },
  '6': { label: 'Cancelled', description: 'The user pressed ESC or cancelled on the device.' },
  '7': { label: 'Device Busy', description: 'The device is busy with another operation. Try again later.' },
}

function parseEnrollError(errorMessage: string | null | undefined): {
  code: string | null
  label: string
  description: string
} {
  if (!errorMessage)
    return { code: null, label: 'Unknown Error', description: 'The command failed with no error details.' }

  // Match "error code: 5", "Error 5", or just a standalone number
  const match = errorMessage.match(/error\s*(?:code:?)?\s*(\d+)/i)
  if (match) {
    const code = match[1]
    const mapped = ENROLL_ERROR_CODES[code]
    if (mapped) return { code, ...mapped }
    return { code, label: `Error Code ${code}`, description: errorMessage }
  }

  return { code: null, label: 'Failed', description: errorMessage }
}

// ---------------------------------------------------------------------------
// Enrollment phases
// ---------------------------------------------------------------------------
type EnrollPhase = 'idle' | 'queued' | 'enrolling' | 'success' | 'failed'

function getPhase(commandStatus: string | undefined | null, isPending: boolean, hasActiveCommand: boolean): EnrollPhase {
  if (isPending) return 'queued'
  if (hasActiveCommand && !commandStatus) return 'queued' // waiting for first poll
  if (!commandStatus) return 'idle'
  switch (commandStatus) {
    case 'pending': return 'queued'
    case 'sent': return 'enrolling'
    case 'success': return 'success'
    case 'failed': return 'failed'
    default: return 'idle'
  }
}

// ---------------------------------------------------------------------------
// Phase step indicator
// ---------------------------------------------------------------------------
const STEPS: { phase: EnrollPhase; label: string; icon: typeof Clock }[] = [
  { phase: 'queued', label: 'Command Queued', icon: Clock },
  { phase: 'enrolling', label: 'Enrolling on Device', icon: Radio },
  { phase: 'success', label: 'Template Received', icon: CheckCircle2 },
]

function PhaseSteps({ currentPhase }: { currentPhase: EnrollPhase }) {
  const phaseOrder: EnrollPhase[] = ['queued', 'enrolling', 'success']
  const currentIdx = phaseOrder.indexOf(currentPhase)
  const isFailed = currentPhase === 'failed'

  return (
    <div className="flex items-center gap-1">
      {STEPS.map((step, idx) => {
        const isCompleted = !isFailed && (currentIdx > idx || (currentPhase === 'success' && currentIdx === idx))
        const isCurrent = !isCompleted && currentPhase === step.phase
        const isFailedStep = isFailed && idx === Math.max(currentIdx, 1)
        const Icon = step.icon

        return (
          <div key={step.phase} className="flex items-center gap-1">
            {idx > 0 && (
              <div
                className={cn(
                  'h-px w-6',
                  isCompleted ? 'bg-green-500' : isFailed && idx <= Math.max(currentIdx, 1) ? 'bg-red-300' : 'bg-border',
                )}
              />
            )}
            <div className="flex flex-col items-center gap-0.5">
              <div
                className={cn(
                  'flex h-7 w-7 items-center justify-center rounded-full border transition-all',
                  isCompleted && 'border-green-500 bg-green-50 text-green-600',
                  isCurrent && !isFailed && 'border-blue-500 bg-blue-50 text-blue-600 ring-2 ring-blue-200',
                  isFailedStep && 'border-red-500 bg-red-50 text-red-600 ring-2 ring-red-200',
                  !isCompleted && !isCurrent && !isFailedStep && 'border-border text-muted-foreground',
                )}
              >
                {isCompleted ? (
                  <CheckCircle2 className="h-3.5 w-3.5" />
                ) : isCurrent && !isFailed ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : isFailedStep ? (
                  <XCircle className="h-3.5 w-3.5" />
                ) : (
                  <Icon className="h-3.5 w-3.5" />
                )}
              </div>
              <span
                className={cn(
                  'text-[9px] leading-tight text-center max-w-[60px]',
                  (isCompleted || isCurrent) && !isFailed && 'font-medium text-foreground',
                  isFailedStep && 'font-medium text-red-600',
                  !isCompleted && !isCurrent && !isFailedStep && 'text-muted-foreground',
                )}
              >
                {step.label}
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Elapsed timer
// ---------------------------------------------------------------------------
function ElapsedTimer({ since }: { since: string }) {
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    const start = new Date(since).getTime()
    const update = () => setElapsed(Math.floor((Date.now() - start) / 1000))
    update()
    const interval = setInterval(update, 1000)
    return () => clearInterval(interval)
  }, [since])

  const minutes = Math.floor(elapsed / 60)
  const seconds = elapsed % 60

  return (
    <p className="text-center text-[10px] text-muted-foreground">
      Elapsed: {minutes > 0 ? `${minutes}m ` : ''}{seconds}s
    </p>
  )
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface EnrollBiometricDialogProps {
  user: UserEntry | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function EnrollBiometricDialog({
  user,
  open,
  onOpenChange,
}: EnrollBiometricDialogProps) {
  const { data: bioData, isLoading: bioLoading } = useUserBiometrics(user?.id || '')
  const { data: syncData } = useSyncStatus(user?.id || '')
  const startEnrollment = useStartEnrollment()

  const [biometricType, setBiometricType] = useState<'fingerprint' | 'face'>('fingerprint')
  const [fingerId, setFingerId] = useState<number>(0)
  const [deviceSn, setDeviceSn] = useState<string>('')
  const [activeCommandId, setActiveCommandId] = useState<number | null>(null)

  // Poll active enrollment command
  const { data: commandData } = useEnrollmentCommandStatus(
    activeCommandId,
    user?.id || '',
  )

  const biometrics = bioData?.data || []
  const syncStatus = syncData?.data || []

  // Filter to only registrar devices with capabilities
  const registrarDevices = useMemo(
    () => syncStatus.filter((s) => s.is_online && s.devices?.is_registrar),
    [syncStatus],
  )

  // Get selected device capabilities
  const selectedDevice = useMemo(
    () => registrarDevices.find((d) => d.device_sn === deviceSn),
    [registrarDevices, deviceSn]
  )

  const selectedDeviceCapabilities = selectedDevice?.devices?.registrar_capabilities || []
  const supportsFingerprint = selectedDeviceCapabilities.includes('fingerprint')
  const supportsFace = selectedDeviceCapabilities.includes('face')

  const hasFingerprint = biometrics.some((b) => b.type === 'fingerprint')
  const hasFace = biometrics.some((b) => b.type === 'face')

  // Set of enrolled finger IDs
  const enrolledFingers = useMemo(
    () => new Set(biometrics.filter((b) => b.type === 'fingerprint' && b.finger_id !== null).map((b) => b.finger_id!)),
    [biometrics],
  )

  // Derive enrollment phase
  const phase = getPhase(commandData?.status, startEnrollment.isPending, !!activeCommandId)
  const isTerminal = phase === 'success' || phase === 'failed'
  const isInProgress = phase === 'queued' || phase === 'enrolling'

  // Parse error details for failed enrollments
  const errorInfo = phase === 'failed' ? parseEnrollError(commandData?.error_message) : null

  const handleStartEnrollment = useCallback(() => {
    if (!user?.id || !deviceSn) return
    setActiveCommandId(null)
    startEnrollment.mutate(
      {
        userId: user.id,
        deviceSn,
        biometricType,
        fingerId: biometricType === 'fingerprint' ? fingerId : undefined,
      },
      {
        onSuccess: (result) => {
          setActiveCommandId(result.commandId)
        },
      },
    )
  }, [user?.id, deviceSn, biometricType, startEnrollment])

  const handleReset = useCallback(() => {
    setActiveCommandId(null)
    startEnrollment.reset()
  }, [startEnrollment])

  // Reset enrollment state when dialog closes
  useEffect(() => {
    if (!open) {
      setActiveCommandId(null)
      startEnrollment.reset()
    }
  }, [open])

  // Auto-select supported biometric type when device changes
  useEffect(() => {
    if (deviceSn) {
      if (!supportsFingerprint && supportsFace) {
        setBiometricType('face')
      } else if (supportsFingerprint && !supportsFace) {
        setBiometricType('fingerprint')
      }
      // If both supported, keep current selection or default to fingerprint
    }
  }, [deviceSn, supportsFingerprint, supportsFace])

  if (!user) return null

  const showForm = phase === 'idle'
  const showProgress = !showForm

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Enroll Biometric</DialogTitle>
          <DialogDescription>
            {user.name} (PIN: {user.pin})
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {/* ── Current biometrics ── */}
          <div className="space-y-2">
            <h4 className="text-sm font-medium">Current Biometrics</h4>

            {bioLoading ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <Fingerprint className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">Fingerprint</span>
                  <Badge
                    variant="outline"
                    className={cn(
                      'h-5 px-1.5 text-[10px]',
                      hasFingerprint && 'bg-green-50 text-green-700 border-green-200',
                    )}
                  >
                    {hasFingerprint ? 'Enrolled' : 'Not enrolled'}
                  </Badge>
                </div>
                <div className="flex items-center gap-2">
                  <ScanFace className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">Face</span>
                  <Badge
                    variant="outline"
                    className={cn(
                      'h-5 px-1.5 text-[10px]',
                      hasFace && 'bg-green-50 text-green-700 border-green-200',
                    )}
                  >
                    {hasFace ? 'Enrolled' : 'Not enrolled'}
                  </Badge>
                </div>
              </div>
            )}
          </div>

          {/* ── Enrollment Form (idle state) ── */}
          {showForm && (
            <div className="space-y-4 border-t pt-4">
              <h4 className="text-sm font-medium">New Enrollment</h4>

              {/* Biometric Type */}
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => supportsFingerprint && setBiometricType('fingerprint')}
                  disabled={!supportsFingerprint}
                  className={cn(
                    'flex items-center gap-2 rounded-lg border p-3 transition-all text-left',
                    biometricType === 'fingerprint'
                      ? 'border-primary bg-primary/5 ring-1 ring-primary'
                      : 'border-border hover:border-muted-foreground/30',
                    !supportsFingerprint && 'opacity-50 cursor-not-allowed bg-muted',
                  )}
                >
                  <Fingerprint className="h-5 w-5 shrink-0" />
                  <div>
                    <div className="text-sm font-medium">Fingerprint</div>
                    <div className="text-[10px] text-muted-foreground">
                      {!deviceSn 
                        ? 'Select device first' 
                        : !supportsFingerprint 
                          ? 'Not supported'
                          : hasFingerprint 
                            ? 'Enrolled' 
                            : 'Not enrolled'}
                    </div>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => supportsFace && setBiometricType('face')}
                  disabled={!supportsFace}
                  className={cn(
                    'flex items-center gap-2 rounded-lg border p-3 transition-all text-left',
                    biometricType === 'face'
                      ? 'border-primary bg-primary/5 ring-1 ring-primary'
                      : 'border-border hover:border-muted-foreground/30',
                    !supportsFace && 'opacity-50 cursor-not-allowed bg-muted',
                  )}
                >
                  <ScanFace className="h-5 w-5 shrink-0" />
                  <div>
                    <div className="text-sm font-medium">Face</div>
                    <div className="text-[10px] text-muted-foreground">
                      {!deviceSn 
                        ? 'Select device first' 
                        : !supportsFace 
                          ? 'Not supported'
                          : hasFace 
                            ? 'Enrolled' 
                            : 'Not enrolled'}
                    </div>
                  </div>
                </button>
              </div>

              {/* Finger selection (fingerprint only) */}
              {biometricType === 'fingerprint' && (
                <div className="space-y-1.5">
                  <Label className="text-xs">Finger</Label>
                  <Select value={String(fingerId)} onValueChange={(v) => setFingerId(Number(v))}>
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(FINGER_LABELS).map(([id, label]) => {
                        const isEnrolled = enrolledFingers.has(Number(id))
                        return (
                          <SelectItem key={id} value={id}>
                            <span className="flex items-center gap-2">
                              {label}
                              {isEnrolled && (
                                <Badge variant="outline" className="h-4 px-1 text-[9px] bg-green-50 text-green-700 border-green-200">
                                  enrolled
                                </Badge>
                              )}
                            </span>
                          </SelectItem>
                        )
                      })}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Overwrite warning */}
              {biometricType === 'fingerprint' && enrolledFingers.has(fingerId) && (
                <div className="flex items-start gap-2.5 rounded-lg border border-yellow-300 bg-yellow-50 p-3">
                  <AlertTriangle className="h-4 w-4 text-yellow-600 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs font-medium text-yellow-800">Overwrite existing template</p>
                    <p className="text-[11px] text-yellow-700 mt-0.5">
                      {FINGER_LABELS[fingerId]} is already enrolled. This will replace the current template.
                    </p>
                  </div>
                </div>
              )}
              {biometricType === 'face' && hasFace && (
                <div className="flex items-start gap-2.5 rounded-lg border border-yellow-300 bg-yellow-50 p-3">
                  <AlertTriangle className="h-4 w-4 text-yellow-600 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs font-medium text-yellow-800">Overwrite existing template</p>
                    <p className="text-[11px] text-yellow-700 mt-0.5">
                      Face is already enrolled. This will replace the current template.
                    </p>
                  </div>
                </div>
              )}

              {/* Device selection */}
              <div className="space-y-1.5">
                <Label className="text-xs">Device</Label>
                {registrarDevices.length === 0 ? (
                  <div className="flex items-start gap-2 rounded-md border border-dashed border-orange-300 bg-orange-50 p-3 text-xs">
                    <WifiOff className="h-4 w-4 text-orange-600 mt-0.5" />
                    <div>
                      <p className="font-medium text-orange-800">No registrar devices available</p>
                      <p className="text-orange-700 mt-0.5">
                        A device must be configured as a registrar with biometric capabilities.
                        Go to Device Management → Edit Device to enable.
                      </p>
                    </div>
                  </div>
                ) : (
                  <Select value={deviceSn} onValueChange={setDeviceSn}>
                    <SelectTrigger className="h-9">
                      <SelectValue placeholder="Select a device…" />
                    </SelectTrigger>
                    <SelectContent>
                      {registrarDevices.map((s) => {
                        const capabilities = s.devices?.registrar_capabilities || []
                        return (
                          <SelectItem key={s.device_sn} value={s.device_sn}>
                            <span className="flex items-center gap-2">
                              <Wifi className="h-3 w-3 text-green-600" />
                              <span className="font-medium">{s.devices?.name || s.device_sn}</span>
                              <span className="flex gap-1">
                                {capabilities.includes('fingerprint') && (
                                  <Fingerprint className="h-3 w-3 text-blue-500" />
                                )}
                                {capabilities.includes('face') && (
                                  <ScanFace className="h-3 w-3 text-purple-500" />
                                )}
                              </span>
                            </span>
                          </SelectItem>
                        )
                      })}
                    </SelectContent>
                  </Select>
                )}
                {deviceSn && selectedDevice && (
                  <div className="flex gap-1.5 text-[10px]">
                    {selectedDeviceCapabilities.includes('fingerprint') && (
                      <Badge variant="outline" className="h-4 px-1 text-[9px]">
                        <Fingerprint className="h-2.5 w-2.5 mr-0.5" />
                        Fingerprint
                      </Badge>
                    )}
                    {selectedDeviceCapabilities.includes('face') && (
                      <Badge variant="outline" className="h-4 px-1 text-[9px]">
                        <ScanFace className="h-2.5 w-2.5 mr-0.5" />
                        Face
                      </Badge>
                    )}
                    {selectedDeviceCapabilities.includes('card') && (
                      <Badge variant="outline" className="h-4 px-1 text-[9px]">
                        Card
                      </Badge>
                    )}
                  </div>
                )}
              </div>

            </div>
          )}

          {/* ── Enrollment Progress (after starting) ── */}
          {showProgress && (
            <div className="space-y-4 border-t pt-4">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-medium">
                  {biometricType === 'fingerprint'
                    ? `Fingerprint — ${FINGER_LABELS[fingerId] || `Finger ${fingerId}`}`
                    : 'Face'} Enrollment
                </h4>
                <Badge variant="outline" className="text-[10px]">
                  {deviceSn}
                </Badge>
              </div>

              {/* Phase stepper */}
              <div className="flex justify-center py-2">
                <PhaseSteps currentPhase={phase} />
              </div>

              {/* Phase-specific content */}
              <div className="rounded-lg border p-4">
                {phase === 'queued' && (
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-50">
                      <Send className="h-5 w-5 text-blue-600" />
                    </div>
                    <div>
                      <p className="text-sm font-medium">Command Queued</p>
                      <p className="text-xs text-muted-foreground">
                        Waiting for the device to pick up the enrollment command…
                      </p>
                    </div>
                  </div>
                )}

                {phase === 'enrolling' && (
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-50">
                      <Loader2 className="h-5 w-5 text-blue-600 animate-spin" />
                    </div>
                    <div>
                      <p className="text-sm font-medium">Enrolling on Device</p>
                      <p className="text-xs text-muted-foreground">
                        {biometricType === 'fingerprint'
                          ? 'The user should place their finger on the sensor when prompted…'
                          : 'The user should look at the camera when prompted…'}
                      </p>
                    </div>
                  </div>
                )}

                {phase === 'success' && (
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-green-50">
                      <CheckCircle2 className="h-5 w-5 text-green-600" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-green-700">Enrollment Successful</p>
                      <p className="text-xs text-muted-foreground">
                        {biometricType === 'fingerprint' ? 'Fingerprint' : 'Face'} template has been captured
                        and stored in the cloud.
                      </p>
                    </div>
                  </div>
                )}

                {phase === 'failed' && errorInfo && (
                  <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-50">
                      <XCircle className="h-5 w-5 text-red-600" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-red-700">{errorInfo.label}</p>
                      <p className="text-xs text-muted-foreground">{errorInfo.description}</p>
                      {errorInfo.code && (
                        <p className="mt-1 text-[10px] text-muted-foreground/70">
                          Error code: {errorInfo.code}
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Elapsed time for in-progress states */}
              {isInProgress && commandData?.created_at && (
                <ElapsedTimer since={commandData.created_at} />
              )}
            </div>
          )}

          {/* ── Actions ── */}
          <div className="flex justify-end gap-2 border-t pt-4">
            {showForm && (
              <>
                <Button variant="ghost" onClick={() => onOpenChange(false)}>
                  Close
                </Button>
                <Button
                  onClick={handleStartEnrollment}
                  disabled={!deviceSn || startEnrollment.isPending || registrarDevices.length === 0}
                >
                  {startEnrollment.isPending && (
                    <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                  )}
                  Start Enrollment
                </Button>
              </>
            )}

            {isInProgress && (
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                Close (enrollment continues)
              </Button>
            )}

            {isTerminal && (
              <>
                <Button variant="ghost" size="sm" onClick={handleReset}>
                  <ArrowLeft className="h-3.5 w-3.5 mr-1" />
                  Enroll Another
                </Button>
                <Button onClick={() => onOpenChange(false)}>
                  Done
                </Button>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
