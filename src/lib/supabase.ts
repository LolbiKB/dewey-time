import { createClient } from '@supabase/supabase-js'

// Supabase connection configuration
// Note: VITE_SUPABASE_ANON_KEY is also called "publishable key" - they are the same thing
// This key is safe to expose in client-side code (browsers, mobile apps)
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://jihzfxcdbdpzrrefecys.supabase.co'
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImppaHpmeGNkYmRwenJyZWZlY3lzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAyNzEyNDYsImV4cCI6MjA4NTg0NzI0Nn0.d4989eb14e4ee44782bfbb2f45543f5b44bf7caf32ba83f3722d6e35fbc7e063'

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
  }
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
