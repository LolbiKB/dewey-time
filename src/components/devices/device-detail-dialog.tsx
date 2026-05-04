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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/animate-ui/components/radix/tabs'
import { 
  Wifi, 
  WifiOff, 
  Users, 
  CheckCircle2, 
  AlertCircle,
  Loader2,
  RotateCcw,
  Zap,
  History,
  Fingerprint,
  ScanFace,
  Image,
  Clock,
  Search,
} from 'lucide-react'
import { toast } from 'sonner'
import { format } from 'date-fns'
import { supabase } from '@/lib/supabase'
import { useQueryClient } from '@tanstack/react-query'
import { 
  useDeviceWithUsers, 
  useForceSync,
  useRealtimeCommands,
  useDeviceUsersPaginated,
  useDeviceBatches,
} from '@/hooks'

interface DeviceDetailDialogProps {
  deviceSn: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

// Batch history row component
function BatchHistoryRow({ batch }: { batch: any }) {
  const statusConfig: Record<string, { icon: any; color: string; label: string }> = {
    pending: { icon: Clock, color: 'text-amber-500', label: 'Pending' },
    processing: { icon: Loader2, color: 'text-blue-500', label: 'Processing' },
    completed: { icon: CheckCircle2, color: 'text-green-500', label: 'Completed' },
    failed: { icon: AlertCircle, color: 'text-red-500', label: 'Failed' },
  }
  const config = statusConfig[batch.status] || statusConfig.pending
  const Icon = config.icon

  const timeAgo = useMemo(() => {
    const date = new Date(batch.created_at)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    if (diffMins < 1) return 'just now'
    if (diffMins < 60) return `${diffMins}m ago`
    const diffHours = Math.floor(diffMins / 60)
    if (diffHours < 24) return `${diffHours}h ago`
    return format(date, 'MMM d HH:mm')
  }, [batch.created_at])

  return (
    <div className="flex items-center gap-3 p-3 border rounded-lg bg-card">
      <Icon className={`h-5 w-5 ${config.color} ${batch.status === 'processing' ? 'animate-spin' : ''}`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm truncate">
            {batch.user_id.slice(0, 8)}...
          </span>
          <span className={`text-xs px-1.5 py-0.5 rounded ${config.color} bg-opacity-10`}>
            {config.label}
          </span>
        </div>
        <div className="text-xs text-muted-foreground mt-1">
          {batch.batch_type} · {batch.commands_count} cmds · {batch.completed_count} ok · {batch.failed_count} fail
        </div>
      </div>
      <span className="text-xs text-muted-foreground whitespace-nowrap">{timeAgo}</span>
    </div>
  )
}

// Component to show individual sync component status
// Simple icon-only status indicator
function StatusIcon({
  hasData = true,
  status = 'never'
}: {
  hasData?: boolean
  status?: 'never' | 'syncing' | 'synced' | 'failed'
}) {
  if (!hasData) {
    return <span className="text-gray-300">-</span>
  }

  switch (status) {
    case 'failed':
      return <AlertCircle className="h-5 w-5 text-red-500 mx-auto" />
    case 'syncing':
      return <Loader2 className="h-5 w-5 text-blue-500 animate-spin mx-auto" />
    case 'synced':
      return <CheckCircle2 className="h-5 w-5 text-green-500 mx-auto" />
    case 'never':
    default:
      return (
        <div className="h-5 w-5 mx-auto flex items-center justify-center">
          <div className="w-4 h-4 rounded-full border-2 border-dashed border-gray-400" />
        </div>
      )
  }
}

// User row component with detailed sync breakdown
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
    <tr className="hover:bg-muted/50">
      <td className="px-4 py-3">
        <div className="flex flex-col">
          <span className="text-sm font-medium">{user.userName}</span>
          <span className="text-xs text-muted-foreground">
            PIN: {user.userPin}
            {user.employeeId && ` · ${user.employeeId}`}
          </span>
        </div>
      </td>
      <td className="px-4 py-3 text-center">
        <StatusIcon
          hasData={true}
          status={user.userStatus}
        />
      </td>
      <td className="px-4 py-3 text-center">
        <StatusIcon
          hasData={user.hasFingerprint}
          status={user.fingerprintStatus}
        />
      </td>
      <td className="px-4 py-3 text-center">
        <StatusIcon
          hasData={user.hasFace}
          status={user.faceStatus}
        />
      </td>
      <td className="px-4 py-3 text-center">
        <StatusIcon
          hasData={user.hasPhoto}
          status={user.photoStatus}
        />
      </td>
      <td className="px-4 py-3 text-right">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onForceSync(user.userId)}
          disabled={isSyncing}
          title="Force sync this user"
        >
          <RotateCcw className="h-3 w-3" />
        </Button>
      </td>
    </tr>
  )
}

export function DeviceDetailDialog({ deviceSn, open, onOpenChange }: DeviceDetailDialogProps) {
  const [activeTab, setActiveTab] = useState('users')
  const [searchQuery, setSearchQuery] = useState('')
  
  // Use centralized hooks - single source of truth
  const { 
    device, 
    users, 
    stats,
    batches,
  } = useDeviceWithUsers(deviceSn || '')
  
  const queryClient = useQueryClient()
  
  // Batch history for activity tab
  const batchHistory = useDeviceBatches(deviceSn || '')
  
  // Infinite query for users (TanStack)
  const paginatedUsers = useDeviceUsersPaginated(deviceSn || '', {
    limit: 20,
    search: searchQuery || undefined,
  })
  
  // Flatten pages into single array
  const allUsers = useMemo(() => {
    if (!paginatedUsers.data?.pages) return []
    const flatUsers = paginatedUsers.data.pages.flatMap(page => page.data || [])
    
    // Create batch map for quick lookup
    const batchMap = new Map((batches || []).map(b => [b.user_id, b]))
    
    // Use batch status as single source of truth
    return flatUsers.map(user => {
      const batch = batchMap.get(user.userId)
      
      let userStatus: 'never' | 'syncing' | 'synced' | 'failed' = 'never'
      if (batch) {
        if (batch.status === 'pending' || batch.status === 'processing') {
          userStatus = 'syncing'
        } else if (batch.status === 'completed') {
          userStatus = 'synced'
        } else if (batch.status === 'failed') {
          userStatus = 'failed'
        }
      }
      
      return {
        ...user,
        // User-level status from batch (primary - single source of truth)
        userStatus: userStatus,
        // Component status still from persistent flags for now
        fingerprintStatus: user.hasFingerprint ? (user.fingerprintSynced ? 'synced' : 'never') : 'never',
        faceStatus: user.hasFace ? (user.faceSynced ? 'synced' : 'never') : 'never',
        photoStatus: user.hasPhoto ? (user.photoSynced ? 'synced' : 'never') : 'never',
      }
    })
  }, [paginatedUsers.data, batches])
  
  // Reset when search changes
  useEffect(() => {
    paginatedUsers.refetch()
  }, [searchQuery])
  
  // Load more on scroll
  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const target = e.target as HTMLDivElement
    const nearBottom = target.scrollHeight - target.scrollTop <= target.clientHeight + 100
    if (nearBottom && !paginatedUsers.isLoading && paginatedUsers.hasNextPage) {
      paginatedUsers.fetchNextPage()
    }
  }
  
  // Real-time updates for commands
  useRealtimeCommands(deviceSn || undefined)
  
  // Real-time updates for batches
  useEffect(() => {
    if (!deviceSn) return
    const channel = supabase
      .channel('batches-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'sync_batches', filter: `device_sn=eq.${deviceSn}` },
        () => {
          // Refetch batches on any change
          queryClient.invalidateQueries({ queryKey: ['batches', deviceSn] })
        }
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [deviceSn, queryClient])

  // Mutations
  const forceSync = useForceSync()

  const handleForceSyncAll = async () => {
    if (!deviceSn || users.length === 0) return
    
    try {
      let totalQueued = 0
      
      // Sync each user to this device
      for (const user of users) {
        const result = await forceSync.mutateAsync({
          userId: user.userId,
          deviceSns: [deviceSn],
        })
        if (result.success) {
          totalQueued += result.commandsQueued
        }
      }
      
      toast.success(`Force synced ${users.length} user(s), ${totalQueued} commands queued`)
    } catch (error) {
      console.error('Error forcing sync:', error)
      toast.error('Failed to force sync')
    }
  }

  const handleForceSyncUser = async (userId: string) => {
    if (!deviceSn) return
    
    try {
      const result = await forceSync.mutateAsync({
        userId,
        deviceSns: [deviceSn],
      })
      
      if (result.success) {
        toast.success(`Force sync initiated for user`)
      }
    } catch (error) {
      console.error('Error forcing sync:', error)
      toast.error('Failed to force sync user')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-hidden flex flex-col">
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

        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="users" className="flex items-center gap-2">
              <Users className="h-4 w-4" />
              Users ({stats.total})
            </TabsTrigger>
            <TabsTrigger value="activity" className="flex items-center gap-2">
              <History className="h-4 w-4" />
              Activity
            </TabsTrigger>
          </TabsList>

          <TabsContent value="users" className="flex-1 flex flex-col min-h-0 mt-4">
            <div className="flex items-center justify-between mb-4 gap-4">
              <div className="flex items-center gap-4 text-sm">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                  <span>{stats.synced} synced</span>
                </div>
                <div className="flex items-center gap-2">
                  <Loader2 className={`h-4 w-4 text-blue-500 ${stats.syncing > 0 ? 'animate-spin' : ''}`} />
                  <span>{stats.syncing} syncing</span>
                </div>
                <div className="flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 text-red-500" />
                  <span>{stats.failed} failed</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search name, PIN, ID..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-9 h-8 w-48 text-sm"
                  />
                </div>
                <Button
                  onClick={handleForceSyncAll}
                  disabled={forceSync.isPending || users.length === 0}
                  size="sm"
                >
                  {forceSync.isPending ? (
                    <CheckCircle2 className="h-4 w-4 mr-2" />
                  ) : (
                    <Zap className="h-4 w-4 mr-2" />
                  )}
                  {forceSync.isPending ? 'Syncing...' : 'Force Sync All'}
                </Button>
              </div>
            </div>

            <div className="flex-1 min-h-0">
              {(paginatedUsers.isLoading || paginatedUsers.isFetching) && allUsers.length === 0 ? (
                <div className="flex items-center justify-center h-32">
                  <Loader2 className="h-6 w-6 animate-spin" />
                </div>
              ) : allUsers.length === 0 ? (
                <div className="flex items-center justify-center h-32 text-muted-foreground">
                  {searchQuery ? 'No matching users found' : 'No users synced to this device'}
                </div>
              ) : (
                <div 
                  className="h-[300px] overflow-y-auto border rounded-lg"
                  onScroll={handleScroll}
                >
                  <table className="w-full">
                    <thead className="bg-muted sticky top-0">
                      <tr>
                        <th className="px-4 py-2 text-left text-xs font-medium">User</th>
                        <th className="px-4 py-2 text-center text-xs font-medium w-12">
                          <Users className="h-4 w-4 mx-auto" />
                        </th>
                        <th className="px-4 py-2 text-center text-xs font-medium w-12">
                          <Fingerprint className="h-4 w-4 mx-auto" />
                        </th>
                        <th className="px-4 py-2 text-center text-xs font-medium w-12">
                          <ScanFace className="h-4 w-4 mx-auto" />
                        </th>
                        <th className="px-4 py-2 text-center text-xs font-medium w-12">
                          <Image className="h-4 w-4 mx-auto" />
                        </th>
                        <th className="px-4 py-2 text-right text-xs font-medium w-10"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {allUsers.map((user: any) => (
                        <UserSyncRow 
                          key={user.userId}
                          user={user}
                          onForceSync={handleForceSyncUser}
                          isSyncing={user.isUserInProgress || user.isFingerprintInProgress || user.isFaceInProgress || user.isPhotoInProgress}
                        />
                      ))}
                    </tbody>
                  </table>
                  {paginatedUsers.isFetchingNextPage && (
                    <div className="flex justify-center py-4">
                      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                    </div>
                  )}
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="activity" className="flex-1 flex flex-col min-h-0 mt-4">
            <div className="flex-1 overflow-y-auto">
              {batchHistory.isLoading ? (
                <div className="flex items-center justify-center h-32">
                  <Loader2 className="h-6 w-6 animate-spin" />
                </div>
              ) : batchHistory.data && batchHistory.data.length > 0 ? (
                <div className="space-y-2">
                  {batchHistory.data.slice(0, 20).map((batch: any) => (
                    <BatchHistoryRow key={batch.id} batch={batch} />
                  ))}
                </div>
              ) : (
                <div className="flex items-center justify-center h-32 text-muted-foreground">
                  No recent batch activity
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
