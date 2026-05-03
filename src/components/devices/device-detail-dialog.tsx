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
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/animate-ui/components/radix/accordion'
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
  Copy,
  Clock,
  Search,
} from 'lucide-react'
import { toast } from 'sonner'
import { format } from 'date-fns'
import { 
  useDeviceWithUsers, 
  useForceSync,
  useRealtimeCommands,
  useDeviceUsersPaginated,
} from '@/hooks'

interface DeviceDetailDialogProps {
  deviceSn: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

// Helper to format command display with size and truncation
function formatCommandDisplay(command: string, maxLength: number = 200): { display: string; wasTruncated: boolean; size: string } {
  const size = `${(command.length / 1024).toFixed(1)} KB`
  
  if (command.length <= maxLength) {
    return { display: command, wasTruncated: false, size }
  }
  
  if (command.includes('Content=') && command.length > maxLength) {
    const contentIndex = command.indexOf('Content=')
    const prefix = command.substring(0, contentIndex + 8)
    const suffix = '... [truncated]'
    return { display: prefix + suffix, wasTruncated: true, size }
  }
  
  return { display: command.substring(0, maxLength) + '...', wasTruncated: true, size }
}

function getCommandLabel(type: string): string {
  const labels: Record<string, string> = {
    sync_user: 'Sync User',
    enroll_fingerprint: 'Enroll Fingerprint',
    enroll_face: 'Enroll Face',
    upload_photo: 'Upload Photo',
    delete_user: 'Delete User',
    reboot: 'Reboot',
    info: 'Info Request',
    check: 'Force Check',
  }
  return labels[type] || type
}

// Command list with detailed view using animated accordion
function CommandList({ commands }: { commands: any[] }) {
  const statusConfig = {
    pending: { icon: Clock, color: 'text-gray-500' },
    sent: { icon: Loader2, color: 'text-blue-500' },
    success: { icon: CheckCircle2, color: 'text-green-500' },
    failed: { icon: AlertCircle, color: 'text-red-500' },
  }
  
  return (
    <Accordion type="multiple" className="space-y-2">
      {commands.map((cmd) => {
        const cfg = statusConfig[cmd.status as keyof typeof statusConfig] || statusConfig.pending
        const StatusIcon = cfg.icon
        const label = getCommandLabel(cmd.command_type)
        
        return (
          <AccordionItem 
            key={cmd.id} 
            value={cmd.id.toString()}
            className={`rounded-lg border ${cmd.status === 'success' ? 'border-green-200' : cmd.status === 'failed' ? 'border-red-200' : cmd.status === 'sent' ? 'border-blue-200' : 'border-gray-200'} bg-white overflow-hidden`}
          >
            <AccordionTrigger className="px-3 py-2 hover:no-underline hover:bg-muted/50 transition-colors">
              <div className="flex items-center gap-3 flex-1">
                <div className={cfg.color}>
                  <StatusIcon className={`h-4 w-4 ${cmd.status === 'sent' ? 'animate-spin' : ''}`} />
                </div>
                <span className="font-medium text-sm flex-1 text-left">{label}</span>
                <span className="text-xs text-muted-foreground">
                  {format(new Date(cmd.created_at), 'MMM d, h:mm a')}
                </span>
              </div>
            </AccordionTrigger>
            <AccordionContent className="px-3 pb-3">
              {cmd.status === 'failed' && cmd.error_message && (
                <div className="text-xs text-red-600 mb-3 flex items-start gap-1 bg-red-50 p-2 rounded">
                  <AlertCircle className="h-3 w-3 mt-0.5 shrink-0" />
                  <span>{cmd.error_message}</span>
                </div>
              )}
              <div className="space-y-2">
                {(() => {
                  const { display, wasTruncated, size } = formatCommandDisplay(cmd.command)
                  return (
                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] text-muted-foreground">Command</span>
                        <span className="text-[10px] text-muted-foreground">{size}</span>
                      </div>
                      <code className="text-[10px] font-mono text-muted-foreground block break-all bg-muted p-2 rounded">
                        {display}
                      </code>
                      {wasTruncated && (
                        <p className="text-[10px] text-muted-foreground">
                          Command truncated — use Copy to get full command
                        </p>
                      )}
                    </div>
                  )
                })()}
                <button
                  onClick={() => {
                    navigator.clipboard?.writeText(cmd.command)
                    toast.success('Copied')
                  }}
                  className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
                >
                  <Copy className="h-3 w-3" />
                  Copy
                </button>
              </div>
            </AccordionContent>
          </AccordionItem>
        )
      })}
    </Accordion>
  )
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
  const [searchQuery, setSearchQuery] = useState('')
  
  // Use centralized hooks - single source of truth
  const { 
    device, 
    users, 
    commands, 
    stats, 
  } = useDeviceWithUsers(deviceSn || '')
  
  // Infinite query for users (TanStack)
  const paginatedUsers = useDeviceUsersPaginated(deviceSn || '', {
    limit: 20,
    search: searchQuery || undefined,
  })
  
  // Flatten pages into single array
  const allUsers = useMemo(() => {
    if (!paginatedUsers.data?.pages) return []
    return paginatedUsers.data.pages.flatMap(page => page.data || [])
  }, [paginatedUsers.data])
  
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
            <div className="flex items-center justify-between mb-4 gap-4">
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
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Zap className="h-4 w-4 mr-2" />
                  )}
                  Force Sync All
                </Button>
              </div>
            </div>

            <div className="flex-1 min-h-0">
              {paginatedUsers.isLoading && allUsers.length === 0 ? (
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
                          isSyncing={forceSync.isPending}
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

          <TabsContent value="commands" className="flex-1 flex flex-col min-h-0 mt-4">
            <div className="flex-1 overflow-y-auto space-y-2">
              {commands.length === 0 ? (
                <div className="flex items-center justify-center h-32 text-muted-foreground">
                  No recent commands
                </div>
              ) : (
                <CommandList commands={commands} />
              )}
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
