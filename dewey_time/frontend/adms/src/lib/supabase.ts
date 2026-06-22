import { createClient } from '@supabase/supabase-js'
import { AUTH_MODE } from './auth-mode'
import { getFrappeToken } from './frappe-token'

// Supabase connection configuration
// Note: VITE_SUPABASE_ANON_KEY is also called "publishable key" - they are the same thing
// This key is safe to expose in client-side code (browsers, mobile apps)
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://jihzfxcdbdpzrrefecys.supabase.co'
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImppaHpmeGNkYmRwenJyZWZlY3lzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAyNzEyNDYsImV4cCI6MjA4NTg0NzI0Nn0.WBrSXLnXwynSyq5B2z_xIOvvKQbIp5FhAPGFQBXeOqE'

// In frappe mode the bridge-minted token (from the Frappe session exchange)
// authenticates PostgREST, Realtime, and Storage via the accessToken callback.
// supabase-js then forbids supabase.auth.* entirely — use lib/auth-token.ts.
// In supabase mode this is the classic Supabase Auth client.
export const supabase =
  AUTH_MODE === 'frappe'
    ? createClient(supabaseUrl, supabaseAnonKey, {
        accessToken: () => getFrappeToken(),
      })
    : createClient(supabaseUrl, supabaseAnonKey, {
        auth: {
          autoRefreshToken: true,
          persistSession: true,
          detectSessionInUrl: true,
        },
      })

export type AttendanceLog = {
  id: number
  device_sn: string
  user_id: string
  timestamp: string
  status: string
  verify_type: string
  raw_data: string
  created_at: string
}

export type Device = {
  serial_number: string
  last_seen: string
  registration_data: string
  created_at: string
}
