import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { User, Session } from '@supabase/supabase-js'

interface AuthContextType {
  user: User | null
  session: Session | null
  isAdmin: boolean
  loading: boolean
  signInWithGoogle: () => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

/**
 * Check if the current user is an admin by querying the admin_users table directly.
 * This uses Supabase's built-in RLS (Row Level Security) - no custom API needed!
 */
async function checkAdminStatus(session: Session | null): Promise<boolean> {
  if (!session?.user?.email) {
    return false
  }

  try {
    // Query admin_users table directly - RLS policy allows authenticated users to check
    const { data, error } = await supabase
      .from('admin_users')
      .select('email')
      .eq('email', session.user.email)
      .maybeSingle()

    if (error) {
      return false
    }

    return !!data
  } catch (error) {
    return false
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [loading, setLoading] = useState(true)

  // Check admin status separately (non-blocking)
  const checkAndSetAdminStatus = async (session: Session | null) => {
    if (!session?.user?.email) {
      setIsAdmin(false)
      return
    }

    try {
      const adminStatus = await checkAdminStatus(session)
      setIsAdmin(adminStatus)
    } catch (error) {
      setIsAdmin(false)
    }
  }

  useEffect(() => {
    let mounted = true

    // Initialize auth state
    const initAuth = async () => {
      try {
        // Handle OAuth callback if present
        const hash = window.location.hash
        if (hash && hash.includes('access_token')) {
          const params = new URLSearchParams(hash.substring(1))
          const accessToken = params.get('access_token')
          const refreshToken = params.get('refresh_token')

          if (accessToken && refreshToken) {
            const { data, error } = await supabase.auth.setSession({
              access_token: accessToken,
              refresh_token: refreshToken,
            })

            if (!error && data.session) {
              window.history.replaceState(null, '', window.location.pathname)
            }
          }
        }

        // Get current session
        const { data: { session } } = await supabase.auth.getSession()

        if (!mounted) return
        setSession(session)
        setUser(session?.user ?? null)
        setLoading(false)

        // Check admin status asynchronously (don't block)
        if (session) {
          checkAndSetAdminStatus(session)
        }
      } catch (error) {
        if (mounted) {
          setLoading(false)
        }
      }
    }

    initAuth()

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (!mounted) return

      setSession(session)
      setUser(session?.user ?? null)

      if (session) {
        checkAndSetAdminStatus(session)
      } else {
        setIsAdmin(false)
      }
    })

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [])

  const signInWithGoogle = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin,
      },
    })
    if (error) throw error
  }

  const signOut = async () => {
    const { error } = await supabase.auth.signOut()
    if (error) throw error
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        isAdmin,
        loading,
        signInWithGoogle,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
