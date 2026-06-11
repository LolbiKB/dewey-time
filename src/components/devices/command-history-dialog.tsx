import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  CheckCircle2,
  AlertCircle,
  Clock,
  Loader2,
  Wifi,
  WifiOff,
  Trash2,
  Copy,
  Server,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  ChevronRightIcon,
} from 'lucide-react'
import { useClearDeviceCommands } from '@/hooks'
import { notifySuccess } from '@/lib/toast'
import { useDeviceCommands, type CommandFilters } from '@/hooks/use-devices'
import { useDevice } from '@/hooks/use-core-data'
import { useDevicePresence } from '@/hooks/use-device-presence'
import { format, formatDistanceToNow } from 'date-fns'
import { useState } from 'react'
import { getCommandLabel } from '@/lib/command-types'

interface CommandHistoryDialogProps {
  deviceSn: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

const STATUS_CONFIG = {
  pending: {
    icon: Clock,
    color: 'text-gray-500',
    border: 'border-gray-200',
  },
  sent: {
    icon: Loader2,
    color: 'text-blue-500',
    border: 'border-blue-300',
  },
  success: {
    icon: CheckCircle2,
    color: 'text-green-500',
    border: 'border-green-300',
  },
  failed: {
    icon: AlertCircle,
    color: 'text-red-500',
    border: 'border-red-300',
  },
  cancelled: {
    icon: Clock,
    color: 'text-gray-400',
    border: 'border-gray-200',
  },
}

function getErrorMessage(errorCode: string | null | undefined): string | null {
  if (!errorCode) return null
  const errorMap: Record<string, string> = {
    '-1004': 'PIN exists with different data',
    '-1002': 'Not supported',
    '-1': 'Invalid parameter',
  }
  return errorMap[errorCode] || errorCode.replace(/^Error\s*/, '')
}

function formatCommandDisplay(command: string, maxLength: number = 200): { display: string; wasTruncated: boolean; size: string } {
  const size = `${(command.length / 1024).toFixed(1)} KB`
  
  if (command.length <= maxLength) {
    return { display: command, wasTruncated: false, size }
  }
  
  // For photo commands, truncate the base64 content
  if (command.includes('Content=') && command.length > maxLength) {
    const contentIndex = command.indexOf('Content=')
    const prefix = command.substring(0, contentIndex + 8)
    const suffix = '... [truncated]'
    return { 
      display: prefix + suffix, 
      wasTruncated: true, 
      size 
    }
  }
  
  return { 
    display: command.substring(0, maxLength) + '...', 
    wasTruncated: true, 
    size 
  }
}

const PAGE_SIZE = 20

export function CommandHistoryDialog({ deviceSn, open, onOpenChange }: CommandHistoryDialogProps) {
  const { data: device } = useDevice(deviceSn || '', { enabled: !!deviceSn && open })
  const { isOnline } = useDevicePresence(deviceSn || undefined)
  const clearCommands = useClearDeviceCommands()
  
  // Pagination and filter state
  const [filters, setFilters] = useState<CommandFilters>({
    page: 1,
    limit: PAGE_SIZE,
    status: 'all',
    commandType: 'all',
  })
  
  const [expandedCommands, setExpandedCommands] = useState<Set<number>>(new Set())

  // TanStack Query with pagination
  const { data: response, isLoading, isFetching } = useDeviceCommands(deviceSn || '', filters)
  
  const commands = response?.data || []
  const meta = response?.meta

  const toggleExpand = (cmdId: number) => {
    const newSet = new Set(expandedCommands)
    if (newSet.has(cmdId)) {
      newSet.delete(cmdId)
    } else {
      newSet.add(cmdId)
    }
    setExpandedCommands(newSet)
  }

  const handleClear = (commandId: number) => {
    if (!deviceSn) return
    clearCommands.mutate({ deviceSn, commandId })
  }

  const handlePageChange = (newPage: number) => {
    setFilters(prev => ({ ...prev, page: newPage }))
    // Clear expanded state when changing pages
    setExpandedCommands(new Set())
  }

  const handleStatusChange = (value: string) => {
    const status = value as CommandFilters['status']
    setFilters(prev => ({ ...prev, status, page: 1 }))
    setExpandedCommands(new Set())
  }

  const handleCommandTypeChange = (value: string) => {
    const commandType = value as CommandFilters['commandType']
    setFilters(prev => ({ ...prev, commandType, page: 1 }))
    setExpandedCommands(new Set())
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="panel" className="flex flex-col overflow-hidden">
        <DialogHeader className="shrink-0 border-b pb-4">
          <DialogTitle className="flex items-center gap-2 text-lg">
            <Server className="h-5 w-5" />
            Command History
          </DialogTitle>
          <DialogDescription className="space-y-3">
            <div className="flex items-center gap-3 text-sm">
              <span className="font-mono">{deviceSn}</span>
              <span className="flex items-center gap-1">
                {isOnline ? (
                  <>
                    <Wifi className="h-3.5 w-3.5 text-green-500" />
                    <span className="text-green-600">Online</span>
                  </>
                ) : (
                  <>
                    <WifiOff className="h-3.5 w-3.5 text-gray-400" />
                    <span className="text-gray-500">Offline</span>
                  </>
                )}
              </span>
              {device?.last_seen && (
                <span className="text-gray-400">
                  {formatDistanceToNow(new Date(device.last_seen), { addSuffix: true })}
                </span>
              )}
            </div>
            
            {/* Filters */}
            <div className="flex flex-wrap items-center gap-2">
              <Select value={filters.commandType} onValueChange={handleCommandTypeChange}>
                <SelectTrigger className="w-[120px] h-8 text-xs">
                  <SelectValue placeholder="Type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  <SelectItem value="sync">Sync</SelectItem>
                  <SelectItem value="device">Device</SelectItem>
                </SelectContent>
              </Select>

              <Select value={filters.status} onValueChange={handleStatusChange}>
                <SelectTrigger className="w-[120px] h-8 text-xs">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="sent">Sent</SelectItem>
                  <SelectItem value="success">Success</SelectItem>
                  <SelectItem value="failed">Failed</SelectItem>
                </SelectContent>
              </Select>

              <div className="text-xs text-gray-400 ml-auto">
                {meta?.total ?? 0} total
              </div>
            </div>
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto py-2">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
            </div>
          ) : commands.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              <Server className="h-12 w-12 mx-auto mb-3 opacity-20" />
              <p className="text-sm">No commands found</p>
              <p className="text-xs mt-1">Try adjusting your filters</p>
            </div>
          ) : (
            <div className="space-y-1">
              {commands.map((cmd) => {
                const isExpanded = expandedCommands.has(cmd.id)
                const statusCfg = STATUS_CONFIG[cmd.status as keyof typeof STATUS_CONFIG]
                const StatusIcon = statusCfg.icon
                const label = getCommandLabel(cmd.command_type)
                const errorMsg = cmd.status === 'failed' ? getErrorMessage(cmd.error_message) : null

                return (
                  <div
                    key={cmd.id}
                    className={`p-3 rounded-lg border ${statusCfg.border} bg-white hover:shadow-sm transition-shadow`}
                  >
                    <div className="flex items-start gap-3">
                      <div className={`mt-0.5 ${statusCfg.color}`}>
                        <StatusIcon className={`h-4 w-4 ${cmd.status === 'sent' ? 'animate-spin' : ''}`} />
                      </div>
                      
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-sm">{label}</span>
                          <span className="text-xs text-gray-400 ml-auto">
                            {format(new Date(cmd.created_at), 'MMM d, h:mm a')}
                          </span>
                        </div>

                        {errorMsg && (
                          <div className="text-xs text-red-600 mt-1.5 flex items-start gap-1">
                            <AlertCircle className="h-3 w-3 mt-0.5 shrink-0" />
                            <span>{errorMsg}</span>
                          </div>
                        )}

                        {isExpanded && (
                          <div className="mt-3 pt-3 border-t border-dashed space-y-2">
                            {(() => {
                              const { display, wasTruncated, size } = formatCommandDisplay(cmd.command)
                              return (
                                <div className="space-y-1">
                                  <div className="flex items-center justify-between">
                                    <span className="text-[10px] text-gray-400">Command</span>
                                    <span className="text-[10px] text-gray-400">{size}</span>
                                  </div>
                                  <code className="text-[10px] font-mono text-gray-600 block break-all bg-gray-50 p-2 rounded border">
                                    {display}
                                  </code>
                                  {wasTruncated && (
                                    <p className="text-[10px] text-gray-400">
                                      Command truncated — use Copy to get full command
                                    </p>
                                  )}
                                </div>
                              )
                            })()}
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => {
                                  navigator.clipboard?.writeText(cmd.command)
                                  notifySuccess('Copied')
                                }}
                                className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1"
                              >
                                <Copy className="h-3 w-3" />
                                Copy
                              </button>
                              {(cmd.status === 'pending' || cmd.status === 'sent') && (
                                <button
                                  onClick={() => handleClear(cmd.id)}
                                  className="text-xs text-red-600 hover:text-red-700 flex items-center gap-1"
                                >
                                  <Trash2 className="h-3 w-3" />
                                  Clear
                                </button>
                              )}
                            </div>
                          </div>
                        )}
                      </div>

                      <button
                        onClick={() => toggleExpand(cmd.id)}
                        className="text-gray-400 hover:text-gray-600 p-1"
                      >
                        {isExpanded ? (
                          <ChevronDown className="h-4 w-4" />
                        ) : (
                          <ChevronRight className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Pagination */}
        {meta && meta.totalPages > 1 && (
          <div className="shrink-0 pt-4 border-t flex items-center justify-between">
            <div className="text-xs text-gray-400">
              Page {meta.page} of {meta.totalPages}
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                className="h-8 w-8 p-0"
                onClick={() => handlePageChange(meta.page - 1)}
                disabled={!meta.hasPrev || isFetching}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              
              {/* Page numbers */}
              <div className="flex items-center gap-1 mx-2">
                {Array.from({ length: Math.min(5, meta.totalPages) }, (_, i) => {
                  // Show pages around current page
                  let pageNum: number
                  if (meta.totalPages <= 5) {
                    pageNum = i + 1
                  } else if (meta.page <= 3) {
                    pageNum = i + 1
                  } else if (meta.page >= meta.totalPages - 2) {
                    pageNum = meta.totalPages - 4 + i
                  } else {
                    pageNum = meta.page - 2 + i
                  }
                  
                  return (
                    <button
                      key={pageNum}
                      onClick={() => handlePageChange(pageNum)}
                      className={`h-8 w-8 rounded text-xs font-medium transition-colors ${
                        pageNum === meta.page
                          ? 'bg-gray-900 text-white'
                          : 'hover:bg-gray-100 text-gray-600'
                      }`}
                      disabled={isFetching}
                    >
                      {pageNum}
                    </button>
                  )
                })}
              </div>
              
              <Button
                variant="outline"
                size="sm"
                className="h-8 w-8 p-0"
                onClick={() => handlePageChange(meta.page + 1)}
                disabled={!meta.hasNext || isFetching}
              >
                <ChevronRightIcon className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

      </DialogContent>
    </Dialog>
  )
}
