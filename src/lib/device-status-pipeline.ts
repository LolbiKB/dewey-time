// Central Device Status Pipeline
// Single source of truth for device online/offline status using Supabase Realtime

import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'

// Configuration
const ONLINE_THRESHOLD_MS = 65000 // 65 seconds (device pings every ~60s)
const HEARTBEAT_INTERVAL_MS = 5000 // Check every 5 seconds

export interface DeviceStatus {
  serialNumber: string
  lastSeen: Date | null
  isOnline: boolean
  lastCheckedAt: Date
}

class DeviceStatusPipeline {
  private static instance: DeviceStatusPipeline
  private subscribers = new Map<string, Set<(status: DeviceStatus) => void>>()
  private deviceCache = new Map<string, DeviceStatus>()
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null
  private realtimeChannel: ReturnType<typeof supabase.channel> | null = null
  private isRunning = false

  static getInstance(): DeviceStatusPipeline {
    if (!DeviceStatusPipeline.instance) {
      DeviceStatusPipeline.instance = new DeviceStatusPipeline()
    }
    return DeviceStatusPipeline.instance
  }

  // Calculate if device is online based on last_seen
  private calculateStatus(serialNumber: string, lastSeenStr: string | null): DeviceStatus {
    const lastSeen = lastSeenStr ? new Date(lastSeenStr) : null
    const now = new Date()
    const isOnline = lastSeen 
      ? (now.getTime() - lastSeen.getTime()) < ONLINE_THRESHOLD_MS 
      : false

    return {
      serialNumber,
      lastSeen,
      isOnline,
      lastCheckedAt: now,
    }
  }

  // Update cache and notify subscribers
  private updateDevice(serialNumber: string, lastSeenStr: string | null) {
    const status = this.calculateStatus(serialNumber, lastSeenStr)
    const prevStatus = this.deviceCache.get(serialNumber)
    
    // Only update if status changed
    if (!prevStatus || prevStatus.isOnline !== status.isOnline || 
        prevStatus.lastSeen?.getTime() !== status.lastSeen?.getTime()) {
      this.deviceCache.set(serialNumber, status)
      this.notifySubscribers(serialNumber, status)
    }
  }

  // Notify all subscribers for a device
  private notifySubscribers(serialNumber: string, status: DeviceStatus) {
    const callbacks = this.subscribers.get(serialNumber)
    if (callbacks) {
      callbacks.forEach(cb => cb(status))
    }
    // Also notify wildcard subscribers (those listening to all devices)
    const wildcardCallbacks = this.subscribers.get('*')
    if (wildcardCallbacks) {
      wildcardCallbacks.forEach(cb => cb(status))
    }
  }

  // Heartbeat: Recalculate all devices periodically to catch timeouts
  private heartbeat = () => {
    const now = new Date()
    this.deviceCache.forEach((status, serialNumber) => {
      const shouldBeOnline = status.lastSeen 
        ? (now.getTime() - status.lastSeen.getTime()) < ONLINE_THRESHOLD_MS 
        : false
      
      if (status.isOnline !== shouldBeOnline) {
        const newStatus = { ...status, isOnline: shouldBeOnline, lastCheckedAt: now }
        this.deviceCache.set(serialNumber, newStatus)
        this.notifySubscribers(serialNumber, newStatus)
      }
    })
  }

  // Start the pipeline
  start() {
    if (this.isRunning) return
    this.isRunning = true

    // Setup realtime subscription
    this.realtimeChannel = supabase
      .channel('device-status-central')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'devices',
        },
        (payload) => {
          if (payload.new.serial_number && payload.new.last_seen !== undefined) {
            this.updateDevice(payload.new.serial_number, payload.new.last_seen)
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'devices',
        },
        (payload) => {
          if (payload.new.serial_number) {
            this.updateDevice(payload.new.serial_number, payload.new.last_seen)
          }
        }
      )
      .subscribe()

    // Start heartbeat
    this.heartbeatInterval = setInterval(this.heartbeat, HEARTBEAT_INTERVAL_MS)
  }

  // Stop the pipeline
  stop() {
    if (!this.isRunning) return
    this.isRunning = false

    if (this.realtimeChannel) {
      supabase.removeChannel(this.realtimeChannel)
      this.realtimeChannel = null
    }
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval)
      this.heartbeatInterval = null
    }
  }

  // Subscribe to a specific device or all devices ('*')
  subscribe(serialNumber: string | '*', callback: (status: DeviceStatus) => void): () => void {
    const key = serialNumber
    if (!this.subscribers.has(key)) {
      this.subscribers.set(key, new Set())
    }
    this.subscribers.get(key)!.add(callback)

    // If subscribing to specific device, immediately send current status if available
    if (serialNumber !== '*' && this.deviceCache.has(serialNumber)) {
      callback(this.deviceCache.get(serialNumber)!)
    }

    // Start pipeline if first subscriber
    if (this.subscribers.size === 1 && this.subscribers.get(key)!.size === 1) {
      this.start()
    }

    // Return unsubscribe function
    return () => {
      const callbacks = this.subscribers.get(key)
      if (callbacks) {
        callbacks.delete(callback)
        if (callbacks.size === 0) {
          this.subscribers.delete(key)
        }
      }
      // Stop pipeline if no more subscribers
      if (this.subscribers.size === 0) {
        this.stop()
      }
    }
  }

  // Get current status for a device
  getStatus(serialNumber: string): DeviceStatus | undefined {
    return this.deviceCache.get(serialNumber)
  }

  // Get all device statuses
  getAllStatuses(): Map<string, DeviceStatus> {
    return new Map(this.deviceCache)
  }

  // Initialize cache from device list
  initializeFromDevices(devices: Array<{ serial_number: string; last_seen?: string | null }>) {
    devices.forEach(device => {
      const status = this.calculateStatus(device.serial_number, device.last_seen || null)
      this.deviceCache.set(device.serial_number, status)
    })
  }
}

// Singleton instance
const pipeline = DeviceStatusPipeline.getInstance()

// React hook for using device status
export function useDeviceStatus(serialNumber: string): DeviceStatus | null {
  const [status, setStatus] = useState<DeviceStatus | null>(null)
  const isSubscribed = useRef(false)

  useEffect(() => {
    // Get initial status from cache if available
    const cached = pipeline.getStatus(serialNumber)
    if (cached) {
      setStatus(cached)
    }

    // Subscribe to updates
    const unsubscribe = pipeline.subscribe(serialNumber, (newStatus) => {
      setStatus(newStatus)
    })
    isSubscribed.current = true

    return () => {
      unsubscribe()
      isSubscribed.current = false
    }
  }, [serialNumber])

  return status
}

// React hook for all device statuses
export function useAllDeviceStatuses(): Map<string, DeviceStatus> {
  const [statuses, setStatuses] = useState<Map<string, DeviceStatus>>(() => 
    new Map(pipeline.getAllStatuses())
  )

  useEffect(() => {
    // Immediately get current state when subscribing
    setStatuses(new Map(pipeline.getAllStatuses()))
    
    const unsubscribe = pipeline.subscribe('*', () => {
      setStatuses(new Map(pipeline.getAllStatuses()))
    })

    return () => unsubscribe()
  }, [])

  return statuses
}

// Hook to initialize pipeline with device data
export function useInitializeDevicePipeline(devices?: Array<{ serial_number: string; last_seen?: string | null }>) {
  const isInitialized = useRef(false)

  useEffect(() => {
    if (devices && !isInitialized.current) {
      pipeline.initializeFromDevices(devices)
      isInitialized.current = true
    }
  }, [devices])
}

// Get singleton instance for non-react usage
export { pipeline as deviceStatusPipeline }

// For debugging
if (typeof window !== 'undefined') {
  (window as any).__deviceStatusPipeline = pipeline
}
