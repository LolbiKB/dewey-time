import { useQuery } from '@tanstack/react-query'
import { getAuthToken } from '@/lib/auth-token'

export type ConnectionStatus = 'connected' | 'connecting' | 'offline'

interface ConnectionState {
  network: boolean
  backend: boolean
  supabase: boolean
  overall: ConnectionStatus
  lastCheck?: Date
}

const checkConnection = async (): Promise<ConnectionState> => {
  const newState: ConnectionState = {
    network: navigator.onLine,
    backend: false,
    supabase: false,
    overall: 'connecting',
    lastCheck: new Date(),
  }

  if (!newState.network) {
    newState.overall = 'offline'
    return newState
  }

  // Check auth/session presence (in frappe mode: a valid bridge token)
  try {
    const token = await getAuthToken()
    newState.supabase = !!token
  } catch {
    newState.supabase = false
  }

  // Check Fastify backend
  try {
    const API_URL = import.meta.env.VITE_API_URL
    const url = API_URL ? `${API_URL}/health` : '/health' // Empty uses Vite proxy in dev
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 3000)
    const response = await fetch(url, {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal
    })
    clearTimeout(timeoutId)
    newState.backend = response.ok
  } catch {
    newState.backend = false
  }

  // Overall status
  if (!newState.supabase) {
    newState.overall = 'offline'
  } else if (!newState.backend) {
    newState.overall = 'connecting'
  } else {
    newState.overall = 'connected'
  }

  return newState
}

export function useConnectionStatus() {
  const { data, refetch, isFetching, isLoading, error } = useQuery({
    queryKey: ['connection-status'],
    queryFn: checkConnection,
    refetchInterval: 15000,
    refetchOnWindowFocus: true,
    retry: 3,
    retryDelay: 1000,
    staleTime: 5000,
  })

  const state = data ?? {
    network: navigator.onLine,
    backend: false,
    supabase: false,
    overall: navigator.onLine ? 'connecting' : 'offline',
    lastCheck: undefined,
  }

  return {
    ...state,
    refetch,
    isFetching,
    isLoading,
    error,
  }
}
