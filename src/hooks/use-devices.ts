import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { DeviceService, type DeviceFilters } from '@/services/device-service'

// Query key factory
const deviceKeys = {
  all: ['devices'] as const,
  lists: () => [...deviceKeys.all, 'list'] as const,
  list: (filters: DeviceFilters) => [...deviceKeys.lists(), filters] as const,
}

/**
 * Hook to fetch devices with filters and pagination
 */
export function useDevices(filters: DeviceFilters = {}) {
  return useQuery({
    queryKey: deviceKeys.list(filters),
    queryFn: () => DeviceService.getDevices(filters),
    staleTime: 30000, // 30 seconds
    gcTime: 1000 * 60 * 5, // 5 minutes
    retry: 2,
  })
}

/**
 * Hook to set master device
 */
export function useSetMasterDevice() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (serialNumber: string) => DeviceService.setMasterDevice(serialNumber),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: deviceKeys.lists() })
    },
  })
}

/**
 * Hook to queue a device command (REBOOT, INFO, CHECK, LOG, etc.)
 */
export function useDeviceCommand() {
  return useMutation({
    mutationFn: ({
      deviceSn,
      commandType,
      commandBody,
    }: {
      deviceSn: string
      commandType: string
      commandBody: string
    }) => DeviceService.queueDeviceCommand(deviceSn, commandType, commandBody),
  })
}

export interface CommandFilters {
  page?: number
  limit?: number
  status?: 'pending' | 'sent' | 'success' | 'failed' | 'all'
  commandType?: 'sync' | 'device' | 'all'
}

/**
 * Hook to fetch command history for a single device with pagination
 */
export function useDeviceCommands(deviceSn: string, filters: CommandFilters = {}) {
  return useQuery({
    queryKey: ['device', deviceSn, 'commands', filters] as const,
    queryFn: () => DeviceService.getDeviceCommands(deviceSn, filters),
    enabled: !!deviceSn,
    refetchInterval: 5000,
    staleTime: 3000,
  })
}

/**
 * Hook to fetch a single device
 */
export function useDevice(serialNumber: string) {
  return useQuery({
    queryKey: ['device', serialNumber] as const,
    queryFn: () => DeviceService.getDevice(serialNumber),
    enabled: !!serialNumber,
    refetchInterval: 5000,
  })
}

/**
 * Hook to retry a failed command
 */
export function useRetryCommand() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (commandId: number) => DeviceService.retryCommand(commandId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['device'] })
    },
  })
}

/**
 * Hook to clear a specific command
 */
export function useClearDeviceCommands() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ deviceSn, commandId }: { deviceSn: string; commandId: number }) =>
      DeviceService.clearCommand(deviceSn, commandId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['device'] })
    },
  })
}

  /**
   * Hook to update device configuration
   */
  export function useUpdateDevice() {
    const queryClient = useQueryClient()
  
    return useMutation({
      mutationFn: ({
        serialNumber,
        updates,
      }: {
        serialNumber: string
        updates: {
          name?: string
          location?: string
          is_registrar?: boolean
          registrar_capabilities?: string[]
        }
      }) => DeviceService.updateDevice(serialNumber, updates),
      onSuccess: () => {
        // Invalidate all device queries regardless of filters
        queryClient.invalidateQueries({ 
          queryKey: ['devices'],
          exact: false,
        })
      },
    })
  }
