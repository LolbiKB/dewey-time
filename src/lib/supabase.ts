import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://jihzfxcdbdpzrrefecys.supabase.co'
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImppaHpmeGNkYmRwenJyZWZlY3lzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAyNzEyNDYsImV4cCI6MjA4NTg0NzI0Nn0.YBSJi5RKb5UUDqZqPmxY98FcMeqIwX1gQvwTDp2b82Q'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

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
