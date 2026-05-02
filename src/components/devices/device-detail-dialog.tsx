// Refactored DeviceDetailDialog using centralized hooks
import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
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
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { 
  useDeviceWithUsers, 
  useForceSync,
  useRealtimeCommands,
} from '@/hooks'

interface DeviceDetailDialogProps {
  deviceSn: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

interface CommandEntry {
  id: number
  command: string
  command_type: string
  status: string
  created_at: string
  completed_at?: string
  error_message?: string
  retry_count?: number
}

// Component to show individual sync component status
// Simple icon-only status indicator
function StatusIcon({
  synced,
  hasData = true,
  isSyncing = false
}: {
  synced: boolean
  hasData?: boolean
  isSyncing?: boolean
}) {
  if (!hasData) {
    return <span className="text-gray-300">-</span>
  }

  if (isSyncing) {
    return <Loader2 className="h-5 w-5 text-blue-500 animate-spin mx-auto" />
  }

  if (synced) {
    return <CheckCircle2 className="h-5 w-5 text-green-500 mx-auto" />
  }

  return <div className="w-5 h-5 rounded-full border-2 border-gray-200 mx-auto" />
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
          <span className="text-xs text-muted-foreground">PIN: {user.userPin}</span>
        </div>
      </td>
      <td className="px-4 py-3 text-center">
        <StatusIcon
          synced={user.userSynced}
          hasData={true}
          isSyncing={user.isUserSyncing}
        />
      </td>
      <td className="px-4 py-3 text-center">
        <StatusIcon
          synced={user.fingerprintSynced}
          hasData={user.hasFingerprint}
          isSyncing={user.isFingerprintSyncing}
        />
      </td>
      <td className="px-4 py-3 text-center">
        <StatusIcon
          synced={user.faceSynced}
          hasData={user.hasFace}
          isSyncing={user.isFaceSyncing}
        />
      </td>
      <td className="px-4 py-3 text-center">
        <StatusIcon
          synced={user.photoSynced}
          hasData={user.hasPhoto}
          isSyncing={user.isPhotoSyncing}
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
  const [activeTab, setActiveTab] = useState('sync')
  
  // Use centralized hooks - single source of truth
  const { 
    device, 
    users, 
    commands, 
    stats, 
    isLoading 
  } = useDeviceWithUsers(deviceSn || '')
  
  // Real-time updates for commands
  useRealtimeCommands(deviceSn || undefined)
  
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
            <TabsTrigger value="sync" className="flex items-center gap-2">
              <Users className="h-4 w-4" />
              Users ({stats.total})
            </TabsTrigger>
            <TabsTrigger value="commands" className="flex items-center gap-2">
              <History className="h-4 w-4" />
              Commands
            </TabsTrigger>
          </TabsList>

          <TabsContent value="sync" className="flex-1 flex flex-col min-h-0 mt-4">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-4 text-sm">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                  <span>{stats.synced} synced</span>
                </div>
                <div className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 text-blue-500" />
                  <span>{stats.syncing} syncing</span>
                </div>
                <div className="flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 text-red-500" />
                  <span>{stats.failed} failed</span>
                </div>
              </div>
              <Button
                onClick={handleForceSyncAll}
                disabled={forceSync.isPending || users.length === 0}
                size="sm"
              >
                {forceSync.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Zap className="h-4 w-4 mr-2" />
                )}
                Force Sync All
              </Button>
            </div>

            <div className="flex-1 overflow-auto border rounded-lg">
              {isLoading ? (
                <div className="flex items-center justify-center h-32">
                  <Loader2 className="h-6 w-6 animate-spin" />
                </div>
              ) : users.length === 0 ? (
                <div className="flex items-center justify-center h-32 text-muted-foreground">
                  No users synced to this device
                </div>
              ) : (
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
                    {users.map((user) => (
                      <UserSyncRow 
                        key={user.userId}
                        user={user}
                        onForceSync={handleForceSyncUser}
                        isSyncing={forceSync.isPending}
                      />
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </TabsContent>

          <TabsContent value="commands" className="flex-1 flex flex-col min-h-0 mt-4">
            <div className="flex-1 overflow-auto border rounded-lg">
              {commands.length === 0 ? (
                <div className="flex items-center justify-center h-32 text-muted-foreground">
                  No recent commands
                </div>
              ) : (
                <table className="w-full">
                  <thead className="bg-muted sticky top-0">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-medium">ID</th>
                      <th className="px-4 py-2 text-left text-xs font-medium">Type</th>
                      <th className="px-4 py-2 text-left text-xs font-medium">Status</th>
                      <th className="px-4 py-2 text-left text-xs font-medium">User</th>
                      <th className="px-4 py-2 text-left text-xs font-medium">Time</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {commands.map((cmd: any) => (
                      <tr key={cmd.id} className="hover:bg-muted/50">
                        <td className="px-4 py-2 text-sm font-mono">{cmd.id}</td>
                        <td className="px-4 py-2 text-sm">{cmd.command_type}</td>
                        <td className="px-4 py-2">
                          <Badge 
                            variant="outline" 
                            className={cn(
                              "text-xs",
                              cmd.status === 'success' && "bg-green-100 text-green-700",
                              cmd.status === 'failed' && "bg-red-100 text-red-700",
                              cmd.status === 'pending' && "bg-yellow-100 text-yellow-700",
                              cmd.status === 'sent' && "bg-blue-100 text-blue-700",
                            )}
                          >
                            {cmd.status}
                          </Badge>
                        </td>
                        <td className="px-4 py-2 text-sm">{cmd.users?.name || '-'}</td>
                        <td className="px-4 py-2 text-xs text-muted-foreground">
                          {new Date(cmd.created_at).toLocaleTimeString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
