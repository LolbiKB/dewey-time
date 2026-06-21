import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables')
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true
  }
})

// Database types based on your schema
export interface Database {
  public: {
    Tables: {
      users: {
        Row: {
          id: string
          email: string
          first_name: string
          last_name: string
          khmer_first_name: string | null
          khmer_last_name: string | null
          gender: string | null
          avatar_url: string | null
          phone: string | null
          date_of_birth: string | null
          address: string | null
          created_at: string
          updated_at: string
          auth_id: string | null
        }
        Insert: {
          id?: string
          email: string
          first_name: string
          last_name: string
          khmer_first_name?: string | null
          khmer_last_name?: string | null
          gender?: string | null
          avatar_url?: string | null
          phone?: string | null
          date_of_birth?: string | null
          address?: string | null
          created_at?: string
          updated_at?: string
          auth_id?: string | null
        }
        Update: {
          id?: string
          email?: string
          first_name?: string
          last_name?: string
          khmer_first_name?: string | null
          khmer_last_name?: string | null
          gender?: string | null
          avatar_url?: string | null
          phone?: string | null
          date_of_birth?: string | null
          address?: string | null
          created_at?: string
          updated_at?: string
          auth_id?: string | null
        }
      }
      user_roles: {
        Row: {
          id: number
          user_id: string | null
          role_id: number | null
          status: string | null
          created_at: string | null
        }
        Insert: {
          id?: number
          user_id?: string | null
          role_id?: number | null
          status?: string | null
          created_at?: string | null
        }
        Update: {
          id?: number
          user_id?: string | null
          role_id?: number | null
          status?: string | null
          created_at?: string | null
        }
      }
      roles: {
        Row: {
          id: number
          name: string
          description: string | null
        }
        Insert: {
          id?: number
          name: string
          description?: string | null
        }
        Update: {
          id?: number
          name?: string
          description?: string | null
        }
      }
    }
  }
}