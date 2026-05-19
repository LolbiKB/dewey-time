"use client"

import { useState, useEffect, useMemo } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/animate-ui/components/radix/tabs'
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from '@/components/animate-ui/components/radix/accordion'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { ConfirmationDialog } from '@/components/ui/base-modal'
import { useUserPhoto } from '@/hooks/use-user-photo'
import {
  RefreshCw,
  Loader2,
  Fingerprint,
  ScanFace,
  Wifi,
  WifiOff,
  CheckCircle2,
  AlertCircle,
  RotateCcw,
  Zap,
  X,
  Users,
  UserPlus,
  CloudOff,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import {
  useSyncStatus,
  useSyncUser,
  useCommandQueue,
  useGlobalSyncState,
  useRetryUserSync,
  useForceUserSync,
  useUserBiometrics,
  useDeleteBiometric,
  useStartEnrollment,
  useEnrollmentCommandStatus,
  useCancelEnrollment,
} from '@/hooks/use-users'
import type { UserEntry } from '@/services/user-service'

interface UserDetailModalProps {
  user: UserEntry | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onRefreshList?: () => void
}

const FINGER_LABELS: Record<number, string> = {
  0: 'R-Thumb', 1: 'R-Index', 2: 'R-Middle', 3: 'R-Ring', 4: 'R-Little',
  5: 'L-Thumb', 6: 'L-Index', 7: 'L-Middle', 8: 'L-Ring', 9: 'L-Little',
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

interface DeviceCardProps {
  status: any
  device: any
  commands: any[]
  onSync: (sn: string) => void
  isSyncing: boolean
}

function DeviceCard({ status, device, commands, onSync, isSyncing }: DeviceCardProps) {
  const isOnline = status.is_online
  const hasActiveCommands = commands.some((c: any) => c.device_sn === status.device_sn && (c.status === 'pending' || c.status === 'sent'))
  const allSynced = status.user_synced && status.fingerprint_synced && status.face_synced && status.photo_synced

  return (
    <Accordion type="single" collapsible className="border rounded-lg overflow-hidden">
      <AccordionItem value={status.id} className="border-0">
        <AccordionTrigger className="px-3 py-2 hover:bg-muted/30 rounded-lg [&>svg]:h-4 [&>svg]:w-4" showArrow>
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <div className={cn("w-1.5 h-1.5 rounded-full shrink-0", isOnline ? "bg-green-500" : "bg-gray-400")} />
            {allSynced && <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />}
            <span className="text-sm font-medium truncate">{device?.name || status.device_sn}</span>
          </div>
        </AccordionTrigger>
        <AccordionContent className="px-4 pb-3 pt-2">
          <div className="grid grid-cols-4 gap-2 text-xs">
            <div className={cn("p-2 rounded-lg", status.user_synced ? "bg-green-50 border border-green-200" : "bg-gray-50")}>
              <div className="flex items-center gap-1 mb-1"><Users className="h-3 w-3" /><span className="font-medium">User</span></div>
              <div className="text-muted-foreground">{status.user_synced ? 'synced' : 'pending'}</div>
            </div>
            <div className={cn("p-2 rounded-lg", status.fingerprint_synced ? "bg-green-50 border border-green-200" : "bg-gray-50")}>
              <div className="flex items-center gap-1 mb-1"><Fingerprint className="h-3 w-3" /><span className="font-medium">FP</span></div>
              <div className="text-muted-foreground">{status.fingerprint_synced ? 'synced' : 'pending'}</div>
            </div>
            <div className={cn("p-2 rounded-lg", status.face_synced ? "bg-green-50 border border-green-200" : "bg-gray-50")}>
              <div className="flex items-center gap-1 mb-1"><ScanFace className="h-3 w-3" /><span className="font-medium">Face</span></div>
              <div className="text-muted-foreground">{status.face_synced ? 'synced' : 'pending'}</div>
            </div>
            <div className={cn("p-2 rounded-lg", status.photo_synced ? "bg-green-50 border border-green-200" : "bg-gray-50")}>
              <div className="flex items-center gap-1 mb-1"><X className="h-3 w-3" /><span className="font-medium">Photo</span></div>
              <div className="text-muted-foreground">{status.photo_synced ? 'synced' : 'pending'}</div>
            </div>
          </div>
          <div className="flex justify-end mt-3">
            <Button variant="outline" size="sm" onClick={() => onSync(status.device_sn)} disabled={isSyncing || hasActiveCommands} className="h-7 gap-1.5">
              {isSyncing ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
              Sync
            </Button>
          </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  )
}

type EnrollPhase = 'idle' | 'queued' | 'enrolling' | 'accepted' | 'success' | 'failed'

function getPhase(commandStatus: string | undefined | null, hasTemplate: boolean | null): EnrollPhase {
  if (!commandStatus) return 'idle'
  if (commandStatus === 'pending') return 'queued'
  if (commandStatus === 'sent') return 'enrolling'
  if (commandStatus === 'success') return hasTemplate ? 'success' : 'accepted'
  if (commandStatus === 'failed') return 'failed'
  return 'idle'
}

const ENROLL_ERROR_CODES: Record<string, { label: string; description: string; action?: string }> = {
  '0': { label: 'Success', description: 'Enrollment completed.' },
  '1': { label: 'Unknown Error', description: 'An unexpected error occurred.', action: 'Try again.' },
  '2': { label: 'Already Exists', description: 'Template exists for this finger.', action: 'Select a different finger.' },
  '4': { label: 'Poor Quality', description: 'Placement was unclear.', action: 'Clean finger and sensor.' },
  '5': { label: 'Duplicate', description: 'Fingerprint matches another user.', action: 'Cannot enroll.' },
  '6': { label: 'Cancelled', description: 'Cancelled on device.', action: 'Try again.' },
  '7': { label: 'Device Busy', description: 'Device is busy.', action: 'Wait and try again.' },
  '8': { label: 'Memory Full', description: 'Device memory is full.', action: 'Delete unused templates.' },
}

function parseEnrollError(errorMessage: string | null | undefined) {
  if (!errorMessage) return { label: 'Failed', description: 'Enrollment failed.' }
  const match = errorMessage.match(/error\s*(?:code:?)?\s*(\d+)/i)
  if (match) {
    const code = match[1]
    const mapped = ENROLL_ERROR_CODES[code]
    if (mapped) return { code, ...mapped }
    return { code, label: `Error ${code}`, description: errorMessage }
  }
  return { label: 'Failed', description: errorMessage }
}

interface EnrollContentProps {
  user: UserEntry
  onSuccess: () => void
}

function EnrollContent({ user, onSuccess }: EnrollContentProps) {
  const { data: bioData, refetch: refetchBiometrics } = useUserBiometrics(user.id || '')
  const { data: syncData } = useSyncStatus(user.id || '')
  const startEnrollment = useStartEnrollment()
  const cancelEnrollment = useCancelEnrollment()

  const [biometricType, setBiometricType] = useState<'fingerprint' | 'face'>('fingerprint')
  const [fingerId, setFingerId] = useState<number>(0)
  const [deviceSn, setDeviceSn] = useState<string>('')
  const [activeCommandId, setActiveCommandId] = useState<number | null>(null)
  const [showTimeout, setShowTimeout] = useState(false)

  const { data: commandData } = useEnrollmentCommandStatus(activeCommandId, user?.id || '')

  useEffect(() => {
    setActiveCommandId(null)
    setDeviceSn('')
    startEnrollment.reset()
  }, [])

  const syncStatus = useMemo(() => syncData?.data || [], [syncData])
  const biometricsList = useMemo(() => bioData?.data || [], [bioData])
  const registrarDevices = useMemo(() => syncStatus.filter(s => s.is_online && s.devices?.is_registrar), [syncStatus])
  const selectedDevice = useMemo(() => registrarDevices.find(d => d.device_sn === deviceSn), [registrarDevices, deviceSn])
  const capabilities = selectedDevice?.devices?.registrar_capabilities || []
  const enrolledFingers = useMemo(() => new Set(biometricsList.filter(b => b.type === 'fingerprint' && b.finger_id !== null).map(b => b.finger_id!)), [biometricsList])
  const hasTemplateForType = useMemo(() => biometricType === 'fingerprint' ? biometricsList.some(b => b.type === 'fingerprint' && b.finger_id === fingerId) : biometricsList.some(b => b.type === 'face'), [biometricsList, biometricType, fingerId])

  const phase = getPhase(commandData?.status, hasTemplateForType)
  const errorInfo = phase === 'failed' ? parseEnrollError(commandData?.error_message) : null

  useEffect(() => {
    if (phase !== 'idle' && phase !== 'success' && phase !== 'failed') {
      const timer = setTimeout(() => setShowTimeout(true), 30000)
      return () => clearTimeout(timer)
    }
    setShowTimeout(false)
  }, [phase])

  useEffect(() => {
    if (phase === 'accepted') {
      const interval = setInterval(() => refetchBiometrics(), 2000)
      return () => clearInterval(interval)
    }
  }, [phase, refetchBiometrics])

  useEffect(() => {
    if (phase === 'success') {
      refetchBiometrics()
      onSuccess()
    }
  }, [phase])

  useEffect(() => {
    if (deviceSn && !capabilities.includes('fingerprint') && capabilities.includes('face')) setBiometricType('face')
  }, [deviceSn])

  const handleStart = () => {
    if (!user?.id || !deviceSn) return
    setActiveCommandId(null)
    startEnrollment.mutate(
      { userId: user.id, deviceSn, biometricType, fingerId: biometricType === 'fingerprint' ? fingerId : undefined },
      { onSuccess: (result: any) => setActiveCommandId(result.commandId) }
    )
  }

  const handleReset = () => {
    setActiveCommandId(null)
    startEnrollment.reset()
  }

  const handleCancel = () => {
    if (user?.id) cancelEnrollment.mutate(user.id)
    handleReset()
  }

  const showForm = phase === 'idle'

  return (
    <div className="space-y-4">
      {/* Current Biometrics */}
      <div className="flex items-center justify-center gap-6 p-3 bg-muted/30 rounded-lg">
        <div className="flex items-center gap-1.5">
          <Fingerprint className="h-4 w-4 text-blue-500" />
          <span className="text-sm font-bold">{biometricsList.filter(b => b.type === 'fingerprint').length}</span>
          <span className="text-xs text-muted-foreground">FP</span>
        </div>
        <div className="w-px h-4 bg-border" />
        <div className="flex items-center gap-1.5">
          <ScanFace className="h-4 w-4 text-purple-500" />
          <span className="text-sm font-bold">{biometricsList.some(b => b.type === 'face') ? 1 : 0}</span>
          <span className="text-xs text-muted-foreground">Face</span>
        </div>
      </div>

      {showForm ? (
        <div className="space-y-4">
          {/* Type Selection */}
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setBiometricType('fingerprint')} disabled={!capabilities.includes('fingerprint')} className={cn("flex items-center gap-2 p-3 rounded-lg border-2 transition-all", biometricType === 'fingerprint' ? "border-blue-500 bg-blue-50" : "border-border hover:border-muted-foreground/30", !capabilities.includes('fingerprint') && "opacity-50")}>
              <Fingerprint className="h-5 w-5 text-blue-500" />
              <div className="text-left">
                <div className="text-sm font-semibold">Fingerprint</div>
                <div className="text-[10px] text-muted-foreground">{capabilities.includes('fingerprint') ? 'Select' : 'N/A'}</div>
              </div>
            </button>
            <button type="button" onClick={() => setBiometricType('face')} disabled={!capabilities.includes('face')} className={cn("flex items-center gap-2 p-3 rounded-lg border-2 transition-all", biometricType === 'face' ? "border-purple-500 bg-purple-50" : "border-border hover:border-muted-foreground/30", !capabilities.includes('face') && "opacity-50")}>
              <ScanFace className="h-5 w-5 text-purple-500" />
              <div className="text-left">
                <div className="text-sm font-semibold">Face</div>
                <div className="text-[10px] text-muted-foreground">{capabilities.includes('face') ? 'Select' : 'N/A'}</div>
              </div>
            </button>
          </div>

          {/* Finger Selection */}
          {biometricType === 'fingerprint' && (
            <div className="space-y-2">
              <div className="text-xs text-muted-foreground font-medium">Select Finger</div>
              <div className="grid grid-cols-5 gap-1">
                {[0, 1, 2, 3, 4, 9, 8, 7, 6, 5].map(id => {
                  const enrolled = enrolledFingers.has(id)
                  const isSelected = fingerId === id
                  return (
                    <button key={id} type="button" onClick={() => !enrolled && setFingerId(id)} disabled={enrolled} className={cn("aspect-square rounded-lg border-2 flex items-center justify-center transition-all", isSelected && "border-blue-500 bg-blue-100", !isSelected && enrolled && "border-red-200 bg-red-50 opacity-50 cursor-not-allowed", !isSelected && !enrolled && "border-dashed border-gray-300 text-gray-400 hover:border-blue-300")}>
                      <span className="text-xs font-bold">{id < 5 ? ['T', 'I', 'M', 'R', 'L'][id] : ['L', 'R', 'M', 'I', 'T'][id - 5]}</span>
                      {enrolled && <span className="absolute text-[6px]">X</span>}
                    </button>
                  )
                })}
              </div>
              <div className="flex justify-between text-[9px] text-muted-foreground">
                <span>Right</span>
                <span className={cn(enrolledFingers.has(fingerId) && "text-red-500")}>{FINGER_LABELS[fingerId]}{enrolledFingers.has(fingerId) && ' (in use)'}</span>
                <span>Left</span>
              </div>
            </div>
          )}

          {/* Device Selection */}
          <div className="space-y-2">
            <div className="text-xs text-muted-foreground font-medium">Device</div>
            {registrarDevices.length === 0 ? (
              <div className="flex items-center gap-2 p-3 rounded-lg border border-orange-200 bg-orange-50 text-orange-800">
                <WifiOff className="h-4 w-4" />
                <div className="text-xs font-medium">No registrar devices online</div>
              </div>
            ) : (
              <Select value={deviceSn} onValueChange={setDeviceSn}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select a device" />
                </SelectTrigger>
                <SelectContent>
                  {registrarDevices.map(s => {
                    const caps = s.devices?.registrar_capabilities || []
                    return (
                      <SelectItem key={s.device_sn} value={s.device_sn}>
                        <div className="flex items-center gap-2">
                          <Wifi className="h-3 w-3 text-green-600" />
                          <span>{s.devices?.name || s.device_sn}</span>
                          <span className="text-xs text-muted-foreground ml-1">
                            {caps.includes('fingerprint') && 'FP'}
                            {caps.includes('fingerprint') && caps.includes('face') && ' / '}
                            {caps.includes('face') && 'Face'}
                          </span>
                        </div>
                      </SelectItem>
                    )
                  })}
                </SelectContent>
              </Select>
            )}
          </div>

          <Button onClick={handleStart} disabled={!deviceSn || !capabilities.includes(biometricType) || (biometricType === 'fingerprint' && enrolledFingers.has(fingerId)) || startEnrollment.isPending} className="w-full gap-2">
            {startEnrollment.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : biometricType === 'fingerprint' ? <Fingerprint className="h-4 w-4" /> : <ScanFace className="h-4 w-4" />}
            {biometricType === 'fingerprint' ? 'Start Fingerprint' : 'Start Face'}
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Phase indicator */}
          <div className="flex items-center justify-center gap-1 py-3">
            {['queued', 'enrolling', 'accepted', 'success'].map((p, idx) => {
              const phaseOrder: EnrollPhase[] = ['queued', 'enrolling', 'accepted', 'success']
              const currentIdx = phaseOrder.indexOf(phase)
              const isCompleted = currentIdx > idx
              const isCurrent = phase === p
              const isFailed = phase === 'failed'
              return (
                <div key={p} className="flex items-center">
                  <div className="flex flex-col items-center gap-0.5">
                    <div className={cn("w-7 h-7 rounded-full flex items-center justify-center border-2 text-xs font-bold", isCompleted && "border-green-500 bg-green-100 text-green-600", isCurrent && !isFailed && "border-blue-500 bg-blue-100 text-blue-600", isFailed && "border-red-500 bg-red-100 text-red-600", !isCompleted && !isCurrent && !isFailed && "border-gray-200 bg-gray-50 text-gray-400")}>
                      {isCompleted ? <CheckCircle2 className="h-4 w-4" /> : isCurrent && !isFailed ? <Loader2 className="h-4 w-4 animate-spin" /> : isFailed ? <AlertCircle className="h-4 w-4" /> : idx + 1}
                    </div>
                    <span className="text-[9px] font-medium">{p === 'queued' ? 'Queued' : p === 'enrolling' ? 'Capture' : p === 'accepted' ? 'Process' : 'Done'}</span>
                  </div>
                  {idx < 3 && <div className={cn("h-0.5 w-5 mx-0.5", isCompleted ? "bg-green-500" : "bg-gray-200")} />}
                </div>
              )
            })}
          </div>

          {/* Phase content */}
          <div className="rounded-lg border p-4 text-center">
            {phase === 'queued' && <div><div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center mx-auto mb-2"><RefreshCw className="h-5 w-5 text-blue-600" /></div><div className="font-medium text-sm">Command Sent</div><div className="text-xs text-muted-foreground">Waiting for device...</div></div>}
            {phase === 'enrolling' && <div><div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center mx-auto mb-2"><Loader2 className="h-5 w-5 text-blue-600 animate-spin" /></div><div className="font-medium text-sm">{biometricType === 'fingerprint' ? 'Place finger on sensor' : 'Look at camera'}</div><div className="text-xs text-muted-foreground">{biometricType === 'fingerprint' ? 'Follow device prompts' : 'Center your face'}</div></div>}
            {phase === 'accepted' && <div><div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center mx-auto mb-2"><Progress className="h-5 w-5 animate-pulse" /></div><div className="font-medium text-sm">Template Captured</div><div className="text-xs text-muted-foreground">Uploading...</div><Progress value={75} className="h-1 mt-2" /></div>}
            {phase === 'success' && <div><div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-2"><CheckCircle2 className="h-5 w-5 text-green-600" /></div><div className="font-medium text-sm text-green-700">Success</div><div className="text-xs text-muted-foreground">{biometricType === 'fingerprint' ? `${FINGER_LABELS[fingerId]} enrolled` : 'Face enrolled'}</div></div>}
            {phase === 'failed' && errorInfo && <div><div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-2"><AlertCircle className="h-5 w-5 text-red-600" /></div><div className="font-medium text-sm text-red-700">{errorInfo.label}</div><div className="text-xs text-muted-foreground">{errorInfo.description}</div></div>}
          </div>

          {showTimeout && phase === 'enrolling' && (
            <div className="flex items-center gap-2 p-2 rounded-lg border border-amber-200 bg-amber-50 text-xs text-amber-800">
              <AlertCircle className="h-3.5 w-3.5" />
              <span>Taking longer than expected...</span>
            </div>
          )}

          <div className="flex gap-2">
            {(phase === 'enrolling' || phase === 'queued') && <Button variant="outline" onClick={handleCancel} className="flex-1">Cancel</Button>}
            {phase === 'success' && <><Button onClick={handleReset} className="flex-1 gap-1.5"><Fingerprint className="h-3.5 w-3.5" /> More</Button><Button variant="ghost" onClick={() => { handleReset(); }}>Done</Button></>}
            {phase === 'failed' && <><Button onClick={handleReset} className="flex-1">Try Again</Button><Button variant="ghost" onClick={handleReset}>Close</Button></>}
          </div>
        </div>
      )}
    </div>
  )
}

export function UserDetailModal({ user, open, onOpenChange, onRefreshList }: UserDetailModalProps) {
  const [activeTab, setActiveTab] = useState('sync')
  const [enrollOpen, setEnrollOpen] = useState(false)
  const [copiedPin, setCopiedPin] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<{ open: boolean; bioId?: string; type?: 'fingerprint' | 'face'; fingerId?: number }>({ open: false })

  const userId = user?.id || ''
  const refetchInterval = open ? 3000 : undefined

  const { data: syncData, isLoading: syncLoading } = useSyncStatus(userId, { refetchInterval })
  const { data: commandData } = useCommandQueue(userId, 50, { refetchInterval })
  const { data: biometricsData, refetch: refetchBiometrics } = useUserBiometrics(userId)

  const syncUser = useSyncUser()
  const globalSyncState = useGlobalSyncState()
  const retryUserSync = useRetryUserSync()
  const forceUserSync = useForceUserSync()
  const deleteBiometric = useDeleteBiometric()

  useEffect(() => {
    if (!open && user) {
      setActiveTab('sync')
      setEnrollOpen(false)
    }
  }, [open, user])

  const commands = commandData?.data || []
  const syncStatus = syncData?.data || []
  const biometrics = biometricsData?.data || []

  const fingerprints = useMemo(() => biometrics.filter(b => b.type === 'fingerprint'), [biometrics])
  const faces = useMemo(() => biometrics.filter(b => b.type === 'face'), [biometrics])

  const stats = useMemo(() => {
    const hasFP = fingerprints.length > 0
    const hasFace = faces.length > 0
    
    const synced = syncStatus.filter(s => {
      const userSynced = s.user_synced
      const fpSynced = hasFP ? s.fingerprint_synced : true
      const faceSynced = hasFace ? s.face_synced : true
      const photoSynced = s.photo_synced
      return userSynced && fpSynced && faceSynced && photoSynced
    }).length
    const syncing = commands.filter(c => c.status === 'pending' || c.status === 'sent').length
    const failed = syncStatus.filter(s => {
      const hasActiveCmd = commands.some(c => c.device_sn === s.device_sn && (c.status === 'pending' || c.status === 'sent'))
      if (hasActiveCmd) return false
      const fpMissing = hasFP && !s.fingerprint_synced
      const faceMissing = hasFace && !s.face_synced
      return !s.user_synced || fpMissing || faceMissing
    }).length
    return { total: syncStatus.length, synced, syncing, failed }
  }, [syncStatus, commands, fingerprints, faces])

  const handleCopyPin = async () => {
    if (user?.pin) {
      await navigator.clipboard.writeText(user.pin)
      setCopiedPin(true)
      toast.success('PIN copied')
      setTimeout(() => setCopiedPin(false), 2000)
    }
  }

  const handleSyncToDevice = (deviceSn: string) => {
    if (!user?.id) return
    syncUser.mutate({ userId: user.id, deviceSns: [deviceSn] })
  }

  const handleDeleteBiometric = (bioId: string, type: 'fingerprint' | 'face', fingerId?: number) => {
    setDeleteConfirm({ open: true, bioId, type, fingerId })
  }

  const confirmDeleteBiometric = async () => {
    if (!user?.id || !deleteConfirm.bioId) return
    try {
      await deleteBiometric.mutateAsync({ userId: user.id, type: deleteConfirm.type!, fingerId: deleteConfirm.fingerId })
      refetchBiometrics()
      onRefreshList?.()
    } catch (error: any) {
      toast.error(`Failed to delete biometric: ${error.message}`)
    }
    setDeleteConfirm({ open: false })
  }

  const isSyncing = globalSyncState.active

  const { photoUrl: displayPhotoUrl } = useUserPhoto({
    photoUrl: user?.photo_url,
    hasCachedPhoto: !!user?.photo_storage_path,
    userId: user?.id || undefined,
    frappeEmployeeId: user?.frappe_employee_id,
    enabled: true,
  })

  if (!user) return null

  const isRegistered = user.is_registered

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="relative">
                <Avatar className="h-10 w-10">
                  <AvatarImage key={displayPhotoUrl || 'no-photo'} src={displayPhotoUrl || undefined} alt={user.name} className="object-cover" />
                  <AvatarFallback className="bg-primary/10 text-primary font-medium">{getInitials(user.name)}</AvatarFallback>
                </Avatar>
                {user.photo_url && !user.photo_storage_path && (
                  <div className="absolute -bottom-1 -right-1 bg-background rounded-full p-0.5">
                    <CloudOff className="w-3 h-3 text-blue-500" />
                  </div>
                )}
              </div>
              <div>
                <DialogTitle>{user.name || 'Unknown'}</DialogTitle>
                <DialogDescription className="flex items-center gap-2 text-xs">
                  {user.frappe_employee_id && <span>{user.frappe_employee_id}</span>}
                  {user.pin && (
                    <button onClick={handleCopyPin} className="flex items-center gap-1 font-mono bg-muted px-1.5 py-0.5 rounded hover:bg-muted/80">
                      {copiedPin ? <CheckCircle2 className="h-3 w-3 text-green-500" /> : <X className="h-3 w-3" />}
                      PIN {user.pin}
                    </button>
                  )}
                  {user.status && isRegistered && (
                    <Badge variant={user.status === 'active' ? 'default' : 'secondary'} className="text-[10px]">{user.status}</Badge>
                  )}
                  {!isRegistered && <Badge variant="outline" className="text-[10px]">Unregistered</Badge>}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="sync" className="flex items-center gap-2 text-xs">
                <Users className="h-4 w-4" />
                Sync ({stats.total})
              </TabsTrigger>
              <TabsTrigger value="biometrics" className="flex items-center gap-2 text-xs">
                <Fingerprint className="h-4 w-4" />
                Bio ({fingerprints.length + faces.length})
              </TabsTrigger>
            </TabsList>

            <TabsContent value="sync" className="flex-1 flex flex-col min-h-0 mt-4">
              {!isRegistered && (
                <div className="flex-1 flex items-center justify-center">
                  <div className="text-center text-muted-foreground">
                    <UserPlus className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">Register to enable sync</p>
                  </div>
                </div>
              )}
              {isRegistered && (
                <div className="flex flex-col min-h-0">
                  <div className="flex items-center justify-between mb-4 gap-4">
                    <div className="flex items-center gap-4 text-sm">
                      {stats.synced > 0 && (
                        <div className="flex items-center gap-2">
                          <CheckCircle2 className="h-4 w-4 text-green-500" />
                          <span>{stats.synced} synced</span>
                        </div>
                      )}
                      {stats.syncing > 0 && (
                        <div className="flex items-center gap-2">
                          <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />
                          <span>{stats.syncing} syncing</span>
                        </div>
                      )}
                      {stats.failed > 0 && (
                        <div className="flex items-center gap-2">
                          <AlertCircle className="h-4 w-4 text-red-500" />
                          <span>{stats.failed} failed</span>
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      <Button size="sm" variant="outline" onClick={() => syncStatus.forEach(s => syncUser.mutate({ userId: user.id!, deviceSns: [s.device_sn] }))} disabled={isSyncing || stats.total === 0} className="h-8 gap-1.5 text-xs">
                        <RefreshCw className="h-3 w-3" /> Sync All
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => retryUserSync.mutate({ userId: user.id!, deviceSns: syncStatus.map(s => s.device_sn) })} className="h-8 text-xs">
                        <RotateCcw className="h-3 w-3" />
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => forceUserSync.mutate({ userId: user.id!, deviceSns: syncStatus.map(s => s.device_sn) })} className="h-8 text-xs text-orange-600">
                        <Zap className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>

                  <div className="flex-1 min-h-0 overflow-y-auto">
                    {syncLoading ? (
                      <div className="flex items-center justify-center h-32"><Loader2 className="h-6 w-6 animate-spin" /></div>
                    ) : syncStatus.length === 0 ? (
                      <div className="flex items-center justify-center h-32 text-muted-foreground">No devices configured</div>
                    ) : (
                      <div className="space-y-2">
                        {syncStatus.map((status) => (
                          <DeviceCard key={status.id} status={status} device={status.devices} commands={commands} onSync={handleSyncToDevice} isSyncing={syncUser.isPending} />
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </TabsContent>

            <TabsContent value="biometrics" className="flex-1 flex flex-col min-h-0 mt-4">
              {!isRegistered ? (
                <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">Register first to manage biometrics</div>
              ) : (
                <div className="flex-1 min-h-0 overflow-y-auto">
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4 text-xs">
                        <div className="flex items-center gap-1.5">
                          <Fingerprint className="h-4 w-4 text-blue-500" />
                          <span>{fingerprints.length} fingerprints</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <ScanFace className="h-4 w-4 text-purple-500" />
                          <span>{faces.length > 0 ? 'Face enrolled' : 'No face'}</span>
                        </div>
                      </div>
                      <Button size="sm" onClick={() => setEnrollOpen(true)} className="h-8 gap-1.5 text-xs">
                        <Fingerprint className="h-3.5 w-3.5" /> Enroll
                      </Button>
                    </div>

                    {/* Fingerprints list */}
                    {fingerprints.length > 0 && (
                      <div className="space-y-1">
                        <div className="text-xs text-muted-foreground font-medium">Fingerprints</div>
                        {fingerprints.map(bio => (
                          <div key={bio.id} className="flex items-center justify-between text-sm rounded-lg border px-3 py-2">
                            <div className="flex items-center gap-2">
                              <Fingerprint className="h-4 w-4 text-blue-500" />
                              <span className="font-mono text-xs">{FINGER_LABELS[bio.finger_id || 0]}</span>
                            </div>
                            <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-muted-foreground hover:text-red-500" onClick={() => handleDeleteBiometric(bio.id, 'fingerprint', bio.finger_id ?? undefined)}>
                              <X className="h-3 w-3" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Face */}
                    <div className="rounded-lg border p-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <ScanFace className="h-4 w-4 text-purple-500" />
                          <span className="text-sm font-medium">Face</span>
                        </div>
                        {faces.length > 0 ? (
                          <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-muted-foreground hover:text-red-500" onClick={() => handleDeleteBiometric(faces[0].id, 'face')}>
                            <X className="h-3 w-3" />
                          </Button>
                        ) : (
                          <Badge variant="outline" className="text-[10px]">Not enrolled</Badge>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </TabsContent>

            </Tabs>
        </DialogContent>
      </Dialog>

      {/* Enroll Dialog */}
      <Dialog open={enrollOpen} onOpenChange={setEnrollOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center">
                <Fingerprint className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <DialogTitle>Enroll Biometric</DialogTitle>
                <DialogDescription className="flex items-center gap-2 text-xs">
                  <span>{user.name}</span>
                  {user.pin && <Badge variant="outline" className="text-[10px] font-mono">{user.pin}</Badge>}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
          <EnrollContent user={user} onSuccess={() => { refetchBiometrics(); onRefreshList?.() }} />
        </DialogContent>
      </Dialog>

      <ConfirmationDialog
        isOpen={deleteConfirm.open}
        title="Delete Biometric"
        message={`Are you sure you want to delete this ${deleteConfirm.type === 'fingerprint' ? 'fingerprint' : 'face'} template? This will sync the deletion to all devices.`}
        confirmLabel="Delete"
        variant="destructive"
        isProcessing={deleteBiometric.isPending}
        onConfirm={confirmDeleteBiometric}
        onCancel={() => setDeleteConfirm({ open: false })}
      />
    </>
  )
}