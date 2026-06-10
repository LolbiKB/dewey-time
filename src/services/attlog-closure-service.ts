import { getAuthHeaders } from '@/lib/auth-token'

const API_URL = import.meta.env.VITE_API_URL || ''

async function fetchAdmin<T>(path: string, options?: RequestInit): Promise<T> {
  const hasBody = !!options?.body
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
      ...(await getAuthHeaders()),
      ...options?.headers,
    },
  })
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }))
    throw new Error(error.error || `HTTP ${response.status}`)
  }
  return response.json() as Promise<T>
}

export class AttlogClosureService {
  static retry(deviceSn: string, localDate: string): Promise<{ ok: boolean; device_sn: string; local_date: string }> {
    return fetchAdmin(`/admin/attlog-closure/${encodeURIComponent(deviceSn)}/retry`, {
      method: 'POST',
      body: JSON.stringify({ local_date: localDate }),
    })
  }

  static forceLog(deviceSn: string): Promise<{ ok: boolean; command_id: number | null }> {
    return fetchAdmin(`/admin/attlog-closure/${encodeURIComponent(deviceSn)}/log`, {
      method: 'POST',
      body: JSON.stringify({}),
    })
  }

  static forceSync(deviceSn: string): Promise<{ ok: boolean }> {
    return fetchAdmin(`/admin/attlog-closure/${encodeURIComponent(deviceSn)}/sync`, {
      method: 'POST',
      body: JSON.stringify({}),
    })
  }

  static purge(deviceSn: string): Promise<{ ok: boolean; command_id?: number | null; error?: string }> {
    return fetchAdmin(`/admin/attlog-closure/${encodeURIComponent(deviceSn)}/purge`, {
      method: 'POST',
      body: JSON.stringify({}),
    })
  }
}
