import { useQuery, useMutation } from '@tanstack/react-query'
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

/** Canonical implementations with notifications — see use-mutations.ts */
export { useRetryCommand, useClearDeviceCommands } from './use-mutations'
