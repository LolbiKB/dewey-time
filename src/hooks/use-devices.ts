import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { DeviceService, type DeviceFilters } from '@/services/device-service'

/**
 * Hook to fetch devices with filters and pagination
 */
export function useDevices(filters: DeviceFilters = {}) {
  return useQuery({
    queryKey: ['devices', filters],
    queryFn: () => DeviceService.getDevices(filters),
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
      queryClient.invalidateQueries({ queryKey: ['devices'] })
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
