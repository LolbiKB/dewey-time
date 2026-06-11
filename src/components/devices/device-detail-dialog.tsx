// Refactored DeviceDetailDialog using centralized hooks
import { useState, useEffect, useMemo } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from '@/components/animate-ui/components/radix/accordion'
import { Badge } from '@/components/ui/badge'
import { 
  Wifi, 
  WifiOff, 
  Users, 
  CheckCircle2,
  AlertCircle,
  Loader2,
  RotateCcw,
  Zap,
  Fingerprint,
  ScanFace,
  Image,
  Clock,
  Search,
  Info,
  MapPin,
  Activity,
  CalendarCheck,
  Shield,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { supabase } from '@/lib/supabase'
import { useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query-keys'
import { 
  useDeviceWithUsers, 
  useForceSync,
  useRealtimeCommands,
  useDeviceUsersPaginated,
  useCommandQueue,
  useDevice,
} from '@/hooks'
import { parseDeviceRegistrationData } from '@/lib/device-registration'
import { DeviceAttlogOverviewTab } from '@/components/devices/device-attlog-overview-tab'
import { DeviceAttlogDailyCloseoutTab } from '@/components/devices/device-attlog-daily-closeout-tab'
import type { DeviceDetailTab } from '@/components/devices/device-detail-tabs'
import {
  buildComponentSyncOptions,
  getComponentSyncStatus,
  syncComponentTileClass,
  type SyncComponent,
  type SyncComponentState,
  type SyncStatusRow,
} from '@/lib/sync-component-status'

interface DeviceDetailDialogProps {
  deviceSn: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  initialTab?: DeviceDetailTab
}

// Component to show individual sync component status
// Simple icon-only status indicator
function StatusIcon({ status }: { status: SyncComponentState }) {
  switch (status) {
    case 'not_enrolled':
      return <span className="text-gray-300">-</span>
    case 'syncing':
      return <Loader2 className="h-5 w-5 text-blue-500 animate-spin mx-auto" />
    case 'synced':
      return <CheckCircle2 className="h-5 w-5 text-green-500 mx-auto" />
    case 'pending':
      return <Clock className="h-5 w-5 text-amber-500 mx-auto" />
    case 'failed':
      return <AlertCircle className="h-5 w-5 text-red-500 mx-auto" />
    default:
      return <span className="text-gray-300">-</span>
  }
}

// User row component with animated accordion
function ComponentStatusCard({
  label,
  icon: Icon,
  state,
  statusLabel,
}: {
  label: string
  icon: typeof Fingerprint
  state: SyncComponentState
  statusLabel: string
}) {
  return (
    <div className={cn('p-2 rounded-lg', syncComponentTileClass(state))}>
      <div className="flex items-center gap-1 mb-1">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="font-medium">{label}</span>
      </div>
      <div className="text-muted-foreground">{statusLabel}</div>
    </div>
  )
}

function UserSyncRow({
  user,
  onForceSync,
  isSyncing
}: {
  user: any
  onForceSync: (userId: string) => void
  isSyncing: boolean
}) {
  return (
    <Accordion type="single" collapsible className="border rounded-lg overflow-hidden">
      <AccordionItem value={user.userId} className="border-0">
        <AccordionTrigger className="px-3 py-2.5 hover:bg-muted/30 hover:no-underline rounded-lg [&>svg]:h-4 [&>svg]:w-4" showArrow>
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <span className="text-sm font-medium">{user.userName}</span>
            {user.employeeId && (
              <Badge variant="secondary" className="text-[10px] font-mono">{user.employeeId}</Badge>
            )}
            <span className={`w-1.5 h-1.5 rounded-full ${
              user.userStatus === 'synced' ? 'bg-green-500' :
              user.userStatus === 'syncing' ? 'bg-blue-500' :
              user.userStatus === 'failed' ? 'bg-red-500' :
              'bg-gray-400'
            }`} />
            <span className="text-xs text-muted-foreground">PIN: {user.userPin}</span>
          </div>
          <div className="flex items-center gap-1 ml-auto">
            <StatusIcon status={user.userComponentStatus} />
            <StatusIcon status={user.fingerprintStatus} />
            <StatusIcon status={user.faceStatus} />
            <StatusIcon status={user.photoStatus} />
            {/* Avoid nested <button> inside AccordionTrigger (Radix Trigger is a <button>) */}
            <Button variant="ghost" size="sm" asChild disabled={isSyncing} title={isSyncing ? 'Sync in progress' : 'Force sync'}>
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation()
                  onForceSync(user.userId)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    e.stopPropagation()
                    onForceSync(user.userId)
                  }
                }}
              >
                {isSyncing ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
              </span>
            </Button>
          </div>
        </AccordionTrigger>
        <AccordionContent className="px-4 pb-3 pt-2">
          {/* Biometric status cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
            <ComponentStatusCard
              label="Fingerprint"
              icon={Fingerprint}
              state={user.fingerprintStatus}
              statusLabel={user.fingerprintLabel}
            />
            <ComponentStatusCard
              label="Face"
              icon={ScanFace}
              state={user.faceStatus}
              statusLabel={user.faceLabel}
            />
            <ComponentStatusCard
              label="Photo"
              icon={Image}
              state={user.photoStatus}
              statusLabel={user.photoLabel}
            />
          </div>
          
          {/* Metadata */}
          <div className="flex items-center gap-4 text-xs text-muted-foreground mt-3">
            <span>Last attempt: {user.lastSyncAttempt ? new Date(user.lastSyncAttempt).toLocaleString() : 'Never'}</span>
          </div>
          
          {/* Error message */}
          {user.errorMessage && (
            <div className="text-sm text-red-600 p-2.5 bg-red-50 border border-red-200 rounded-lg mt-2 break-words">
              {user.errorMessage}
            </div>
          )}
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  )
}

function connectionStatusLabel(status?: string | null): string {
  if (status === 'pending') return 'Pending approval'
  if (status === 'rejected') return 'Rejected'
  return 'Approved'
}

function connectionStatusClass(status?: string | null): string {
  if (status === 'pending') return 'bg-amber-100 text-amber-800 border-amber-200'
  if (status === 'rejected') return 'bg-red-100 text-red-800 border-red-200'
  return 'bg-green-100 text-green-800 border-green-200'
}

export function DeviceDetailDialog({
  deviceSn,
  open,
  onOpenChange,
  initialTab = 'users',
}: DeviceDetailDialogProps) {
  const [activeTab, setActiveTab] = useState<DeviceDetailTab>(initialTab)
  const [searchQuery, setSearchQuery] = useState('')
  // Use centralized hooks - single source of truth
  const { 
    device, 
    stats,
    batches,
  } = useDeviceWithUsers(deviceSn || '')

  const { data: freshDevice } = useDevice(deviceSn || '', {
    enabled: open && !!deviceSn && activeTab === 'info',
  })
  const infoDevice = freshDevice ?? device
  const registration = parseDeviceRegistrationData(infoDevice?.registration_data)

  const queryClient = useQueryClient()
  
  // Infinite query for users (TanStack)
  const paginatedUsers = useDeviceUsersPaginated(deviceSn || '', {
    limit: 20,
    search: searchQuery || undefined,
  })

  const { data: deviceCommands = [] } = useCommandQueue({ enabled: open && !!deviceSn })
  // Flatten pages into single array
  const allUsers = useMemo(() => {
    if (!paginatedUsers.data?.pages) return []
    const flatUsers = paginatedUsers.data.pages.flatMap(page => page.data || [])
    const TWO_MINUTES = 2 * 60 * 1000
    const now = Date.now()
    const cmdsForDevice = deviceCommands.filter((c: { device_sn: string }) => c.device_sn === deviceSn)
    
    // Create batch map for quick lookup
    const batchMap = new Map((batches || []).map(b => [b.user_id, b]))
    
    // Use batch status as primary source, fallback to actualState from API
    return flatUsers.map(user => {
      const batch = batchMap.get(user.userId)
      
      let userStatus: 'never' | 'syncing' | 'synced' = 'never'
      
      // Batch status takes priority
      // BULLETPROOF: Batches never fail - they retry forever
      if (batch) {
        if (batch.status === 'pending' || batch.status === 'processing') {
          userStatus = 'syncing'
        } else if (batch.status === 'completed') {
          userStatus = 'synced'
        }
        // Note: No 'failed' case - bulletproof batches never fail
      } else if (user.actualState) {
        // Fallback to actualState from sync_status table (set after successful sync)
        if (user.actualState === 'syncing') {
          userStatus = 'syncing'
        } else if (user.actualState === 'synced') {
          userStatus = 'synced'
        } else if (user.actualState === 'not_synced' && user.lastSuccessfulSync) {
          // Has successfully synced before but currently not in sync
          userStatus = 'synced'
        } else if (user.actualState === 'not_synced') {
          // BULLETPROOF: No failed state - just not synced (will retry)
          userStatus = 'never'
        }
      }
      
      const userCmds = cmdsForDevice.filter(
        (c: { related_user_id?: string }) => c.related_user_id === user.userId
      )
      const freshActiveCmds = userCmds.filter((c: { status: string; created_at: string }) => {
        if (c.status !== 'pending' && c.status !== 'sent') return false
        return now - new Date(c.created_at).getTime() < TWO_MINUTES
      })
      const activePhotoCmd = freshActiveCmds.find(
        (c: { command_type: string }) => c.command_type === 'upload_photo'
      )

      const syncOptions = buildComponentSyncOptions(userCmds, {
        fingerprints: user.fingerprints ?? [],
        hasFaceInDb: user.hasFace,
        hasPhotoInDb: user.hasPhoto,
      })
      const hasActiveCommands =
        user.isBatchInProgress ||
        userStatus === 'syncing' ||
        (syncOptions.activeComponents?.size ?? 0) > 0
      const isPhotoInProgress = syncOptions.activeComponents?.has('photo') ?? false

      const enriched = { ...user, userStatus, isUserInProgress: hasActiveCommands }

      const statusRow = {
        user_synced: user.userSynced,
        fingerprint_synced: user.fingerprintSynced,
        fingerprint_mask: user.fingerprintMask,
        face_synced: user.faceSynced,
        photo_synced: user.photoSynced,
        has_fingerprint: user.hasFingerprint,
        has_fingerprint_in_db: user.hasFingerprint,
        has_face: user.hasFace,
        has_photo_in_db: user.hasPhoto,
        actual_state: user.actualState,
        error_message: user.errorMessage,
      } as SyncStatusRow

      const pick = (component: SyncComponent) =>
        getComponentSyncStatus(component, statusRow, syncOptions)

      const userComp = pick('user')
      const fp = pick('fingerprint')
      const face = pick('face')
      const photo = pick('photo')

      const lastSyncAttempt = user.photoSynced && user.photoSyncedAt
        ? user.photoSyncedAt
        : activePhotoCmd?.sent_at || activePhotoCmd?.created_at || user.lastSyncAttempt

      return {
        ...enriched,
        userComponentStatus: userComp.state,
        userComponentLabel: userComp.label,
        fingerprintStatus: fp.state,
        fingerprintLabel: fp.label,
        faceStatus: face.state,
        faceLabel: face.label,
        photoStatus: photo.state,
        photoLabel: photo.label,
        lastSyncAttempt,
        isPhotoInProgress,
        isFingerprintInProgress: syncOptions.activeComponents?.has('fingerprint') ?? false,
        isFaceInProgress: syncOptions.activeComponents?.has('face') ?? false,
      }
    })
  }, [paginatedUsers.data, batches, deviceCommands, deviceSn])
  
  useEffect(() => {
    if (open) {
      setActiveTab(initialTab)
    }
  }, [open, initialTab, deviceSn])

  useEffect(() => {
    if (open && deviceSn) {
      queryClient.invalidateQueries({ queryKey: queryKeys.devices.users(deviceSn, '') })
      queryClient.invalidateQueries({ queryKey: ['device-sync-summary', deviceSn] })
    }
  }, [open, deviceSn, queryClient])
  
  // Reset when search changes
  useEffect(() => {
    paginatedUsers.refetch()
  }, [searchQuery])
  
  // Real-time updates for commands
  useRealtimeCommands(deviceSn || undefined)

  // Real-time updates for batches, batch_commands, and sync_status
  useEffect(() => {
    if (!deviceSn) return
    const channel = supabase
      .channel('device-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'sync_batches', filter: `device_sn=eq.${deviceSn}` },
        () => {
          queryClient.invalidateQueries({ queryKey: ['batches-detailed', deviceSn] })
          // Also invalidate sync status queries
          queryClient.invalidateQueries({ queryKey: ['sync-status', 'all'] })
          queryClient.invalidateQueries({ queryKey: queryKeys.devices.users(deviceSn, '') })
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'batch_commands' },
        () => {
          queryClient.invalidateQueries({ queryKey: ['batches-detailed', deviceSn] })
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'user_device_sync_status', filter: `device_sn=eq.${deviceSn}` },
        () => {
          // Invalidate all relevant queries when sync status changes
          queryClient.invalidateQueries({ queryKey: ['sync-status', 'all'] })
          queryClient.invalidateQueries({ queryKey: queryKeys.devices.users(deviceSn, '') })
          queryClient.invalidateQueries({ queryKey: ['batches-detailed', deviceSn] })
        }
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [deviceSn, queryClient])

  // Mutations
  const forceSync = useForceSync()

  const handleForceSyncUser = async (userId: string) => {
    if (!deviceSn) return
    await forceSync.mutateAsync({
      userId,
      deviceSns: [deviceSn],
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col overflow-hidden">
        <DialogHeader>
          <div className="flex items-center gap-3">
            {device?.isOnline ? (
              <Wifi className="h-5 w-5 text-green-500" />
            ) : (
              <WifiOff className="h-5 w-5 text-red-500" />
            )}
            <div>
              <DialogTitle className="text-lg">
                {device?.name || deviceSn}
              </DialogTitle>
              <DialogDescription className="text-xs">
                {device?.location || 'No location'} · {deviceSn}
                {device?.isOnline && (
                  <span className="ml-2 text-green-600">Online</span>
                )}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <Tabs
          value={activeTab}
          onValueChange={(v) => setActiveTab(v as DeviceDetailTab)}
          className="flex-1 flex flex-col min-h-0 gap-3"
        >
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="users">
              <Users className="shrink-0" />
              <span className="truncate">Users ({stats.total})</span>
            </TabsTrigger>
            <TabsTrigger value="info">
              <Info className="shrink-0" />
              <span className="truncate">Info</span>
            </TabsTrigger>
            <TabsTrigger value="overview">
              <Activity className="shrink-0" />
              <span className="truncate">Overview</span>
            </TabsTrigger>
            <TabsTrigger value="closeout">
              <CalendarCheck className="shrink-0" />
              <span className="truncate">Closeout</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="users" className="flex-1 flex flex-col min-h-0">
            <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b pb-3 mb-2 shrink-0 space-y-2.5">
              {/* Full-width search (no viewport-based side-by-side — the modal
                  is fixed-width, so always stack to avoid clipping). */}
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search user to sync..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="h-8 w-full pl-9 text-sm"
                />
              </div>
              {/* Sync stats as calm dot+text. */}
              {(stats.synced > 0 ||
                stats.syncing > 0 ||
                (stats as any).cleaning > 0 ||
                (stats as any).notSynced > 0) && (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                  {stats.synced > 0 && (
                    <span className="inline-flex items-center gap-1.5 text-green-600 dark:text-green-400">
                      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80" />
                      {stats.synced} synced
                    </span>
                  )}
                  {stats.syncing > 0 && (
                    <span className="inline-flex items-center gap-1.5 text-blue-600 dark:text-blue-400">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      {stats.syncing} syncing
                    </span>
                  )}
                  {(stats as any).cleaning > 0 && (
                    <span className="inline-flex items-center gap-1.5 text-purple-600 dark:text-purple-400">
                      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80" />
                      {(stats as any).cleaning} cleaning
                    </span>
                  )}
                  {(stats as any).notSynced > 0 && (
                    <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-60" />
                      {(stats as any).notSynced} pending
                    </span>
                  )}
                </div>
              )}
              <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
                <span className="font-medium">Row icons:</span>
                <span className="inline-flex items-center gap-1">
                  <StatusIcon status="synced" />
                  User
                </span>
                <span className="inline-flex items-center gap-1">
                  <StatusIcon status="synced" />
                  FP
                </span>
                <span className="inline-flex items-center gap-1">
                  <StatusIcon status="synced" />
                  Face
                </span>
                <span className="inline-flex items-center gap-1">
                  <StatusIcon status="synced" />
                  Photo
                </span>
              </div>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto pr-1">
              {(paginatedUsers.isLoading || paginatedUsers.isFetching) && allUsers.length === 0 ? (
                <div className="flex items-center justify-center h-32">
                  <Loader2 className="h-6 w-6 animate-spin" />
                </div>
              ) : allUsers.length === 0 ? (
                <div className="flex items-center justify-center h-32 text-muted-foreground">
                  {searchQuery ? 'No matching users found' : 'No users synced to this device'}
                </div>
              ) : (
                <div className="space-y-2">
                  {allUsers.map((user: any) => (
                    <UserSyncRow 
                      key={user.userId}
                      user={user}
                      onForceSync={handleForceSyncUser}
                      isSyncing={user.isUserInProgress || user.isFingerprintInProgress || user.isFaceInProgress || user.isPhotoInProgress}
                    />
                  ))}
                  {paginatedUsers.isFetchingNextPage && (
                    <div className="flex justify-center py-4">
                      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                    </div>
                  )}
                </div>
              )}
            </div>
          </TabsContent>
          
          <TabsContent value="info" className="flex-1 flex flex-col min-h-0">
            <div className="flex-1 min-h-0 overflow-y-auto pr-1">
            <div className="space-y-6 pb-4">
              {/* Header Card */}
              <div className="bg-gradient-to-r from-blue-500 to-blue-600 rounded-xl p-5 text-white">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-semibold">{device?.name || 'Unnamed Device'}</h3>
                    <p className="text-blue-100 text-sm font-mono mt-1">{device?.serial_number}</p>
                  </div>
                  <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full ${device?.isOnline ? 'bg-white/20' : 'bg-gray-500/30'}`}>
                    {device?.isOnline ? (
                      <Wifi className="h-4 w-4" />
                    ) : (
                      <WifiOff className="h-4 w-4" />
                    )}
                    <span className="text-sm font-medium">{device?.isOnline ? 'Online' : 'Offline'}</span>
                  </div>
                </div>
              </div>

              {/* Info Grid */}
              <div className="grid grid-cols-2 gap-3">
                <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
                  <div className="flex items-center gap-2 text-muted-foreground mb-1">
                    <MapPin className="h-3.5 w-3.5" />
                    <span className="text-xs">Location</span>
                  </div>
                  <div className="text-sm font-medium">{device?.location || '-'}</div>
                </div>
                <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
                  <div className="flex items-center gap-2 text-muted-foreground mb-1">
                    <Clock className="h-3.5 w-3.5" />
                    <span className="text-xs">Last Seen</span>
                  </div>
                  <div className="text-sm font-medium">{device?.last_seen ? new Date(device.last_seen).toLocaleString() : 'Never'}</div>
                </div>
                <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
                  <div className="flex items-center gap-2 text-muted-foreground mb-1">
                    <Zap className="h-3.5 w-3.5" />
                    <span className="text-xs">Registrar</span>
                  </div>
                  <div className="text-sm font-medium">{device?.is_registrar ? 'Enabled' : 'Disabled'}</div>
                </div>
                <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
                  <div className="flex items-center gap-2 text-muted-foreground mb-1">
                    <Users className="h-3.5 w-3.5" />
                    <span className="text-xs">Users</span>
                  </div>
                  <div className="text-sm font-medium">{stats.total} synced</div>
                </div>
              </div>

              {/* Registrar Capabilities */}
              {device?.registrar_capabilities?.length > 0 && (
                <div>
                  <div className="text-xs font-medium text-muted-foreground mb-3 uppercase tracking-wide">Registrar Capabilities</div>
                  <div className="flex gap-2 flex-wrap">
                    {device.registrar_capabilities.map((cap: string) => (
                      <span key={cap} className="px-3 py-1.5 bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-100 rounded-lg text-xs font-medium text-blue-700">
                        {cap}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Provisioning (MVP: approved SN only) */}
              <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Shield className="h-4 w-4 text-muted-foreground" />
                  Provisioning
                </div>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-xs text-muted-foreground mb-0.5">Serial approval</p>
                    <span
                      className={`inline-flex px-2 py-0.5 rounded-md text-xs font-medium border ${connectionStatusClass(infoDevice?.connection_status)}`}
                    >
                      {connectionStatusLabel(infoDevice?.connection_status)}
                    </span>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-0.5">PUSH protocol</p>
                    <p className="font-medium font-mono">
                      {registration?.pushver ? `v${registration.pushver}` : 'Unknown'}
                    </p>
                  </div>
                  <div className="col-span-2">
                    <p className="text-xs text-muted-foreground mb-0.5">Last ADMS init</p>
                    <p className="font-medium">
                      {registration?.last_init
                        ? new Date(registration.last_init).toLocaleString()
                        : 'Not observed yet'}
                    </p>
                  </div>
                </div>
                {infoDevice?.connection_status === 'pending' && (
                  <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2">
                    This serial is not approved yet. Use Edit device → Approve SN before the terminal
                    can sync users or attendance.
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  MVP security is approved serial number only. Use a plain Cloud Server URL on the
                  device (no pairing query string). Communication keys are not required on SenseFace
                  ADMS.
                </p>
              </div>
            </div>
            </div>
          </TabsContent>

          <TabsContent value="overview" className="flex-1 flex flex-col min-h-0">
            {deviceSn && (
              <div className="flex flex-col flex-1 min-h-0">
                <DeviceAttlogOverviewTab
                  deviceSn={deviceSn}
                  isOnline={!!device?.isOnline}
                  enabled={open && activeTab === 'overview'}
                />
              </div>
            )}
          </TabsContent>

          <TabsContent value="closeout" className="flex-1 flex flex-col min-h-0">
            {deviceSn && (
              <div className="flex flex-col flex-1 min-h-0">
                <DeviceAttlogDailyCloseoutTab
                  deviceSn={deviceSn}
                  enabled={open && activeTab === 'closeout'}
                />
              </div>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
