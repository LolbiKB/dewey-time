import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { isFrappeMode } from '@/lib/auth-mode'
import {
  getFrappeToken,
  getFrappeTokenState,
  subscribeFrappeToken,
  AdmsForbiddenError,
} from '@/lib/frappe-token'
import type { User, Session } from '@supabase/supabase-js'

export type AdminRole = 'admin' | 'super_admin'

interface AuthContextType {
  user: User | null
  session: Session | null
  isAdmin: boolean
  adminRole: AdminRole | null
  isSuperAdmin: boolean
  loading: boolean
  isAdminLoading: boolean
  signInWithGoogle: () => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

/**
 * Check if the current user is an admin by querying the admin_users table directly.
 * This uses Supabase's built-in RLS (Row Level Security) - no custom API needed!
 */
async function checkAdminStatus(
  session: Session | null
): Promise<{ isAdmin: boolean; role: AdminRole | null }> {
  if (!session?.user?.email) {
    return { isAdmin: false, role: null }
  }

  try {
    const { data, error } = await supabase
      .from('admin_users')
      .select('email, role, is_admin')
      .eq('email', session.user.email)
      .eq('is_admin', true)
      .maybeSingle()

    if (error || !data) {
      return { isAdmin: false, role: null }
    }

    const role = data.role === 'super_admin' ? 'super_admin' : 'admin'
    return { isAdmin: true, role }
  } catch (error) {
    return { isAdmin: false, role: null }
  }
}

/**
 * Frappe-mode provider: the Frappe session is the credential. A successful
 * token exchange (dewey_time get_dashboard_token → bridge) already proves the
 * caller is a logged-in Frappe admin AND a bridge admin (admin_users), so the
 * exchange response IS the auth state — no supabase.auth anywhere (it is a
 * throwing Proxy in this mode). Auth failures redirect to Frappe login inside
 * lib/frappe-token.ts.
 */
function FrappeAuthProvider({ children }: { children: React.ReactNode }) {
  const [tokenState, setTokenState] = useState(getFrappeTokenState())
  const [loading, setLoading] = useState(!tokenState)
  const [forbidden, setForbidden] = useState<string | null>(null)

  useEffect(() => {
    const unsubscribe = subscribeFrappeToken(setTokenState)
    getFrappeToken()
      .catch((err) => {
        // 401 already redirected to Frappe login. A 403 means the Frappe user
        // is authenticated but not an ADMS admin (e.g. Administrator) — show a
        // terminal access-denied screen instead of looping back to /login.
        if (err instanceof AdmsForbiddenError) setForbidden(err.message)
      })
      .finally(() => setLoading(false))
    return unsubscribe
  }, [])

  if (forbidden) {
    return (
      <div className="flex h-screen items-center justify-center p-6">
        <div className="max-w-sm space-y-4 text-center">
          <h1 className="text-2xl font-bold">Access denied</h1>
          <p className="text-muted-foreground">{forbidden}</p>
          <p className="text-sm text-muted-foreground">
            You&apos;re signed in to Frappe, but this account isn&apos;t an ADMS admin.
            Sign in with an admin account.
          </p>
          <button
            onClick={async () => {
              try {
                await fetch('/api/method/logout', { credentials: 'same-origin' })
              } finally {
                window.location.href = '/login?redirect-to=' + encodeURIComponent('/adms')
              }
            }}
            className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Sign out &amp; switch account
          </button>
        </div>
      </div>
    )
  }

  // Minimal User shim — consumers only read `email` (and identity-ish fields).
  const user = tokenState
    ? ({ id: tokenState.email, email: tokenState.email } as unknown as User)
    : null

  const signOut = async () => {
    try {
      await fetch('/api/method/logout', { credentials: 'same-origin' })
    } finally {
      window.location.href = '/login'
    }
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        session: null,
        isAdmin: !!tokenState,
        adminRole: tokenState?.role ?? null,
        isSuperAdmin: tokenState?.role === 'super_admin',
        loading,
        isAdminLoading: loading,
        // Login is the Frappe site's job; land back on the dashboard after.
        signInWithGoogle: async () => {
          window.location.href = '/login?redirect-to=' + encodeURIComponent('/adms')
        },
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

function SupabaseAuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [adminRole, setAdminRole] = useState<AdminRole | null>(null)
  const [loading, setLoading] = useState(true)
  const [isAdminLoading, setIsAdminLoading] = useState(true)

  // Check admin status separately (non-blocking)
  const checkAndSetAdminStatus = async (session: Session | null) => {
    if (!session?.user?.email) {
      setIsAdmin(false)
      setAdminRole(null)
      setIsAdminLoading(false)
      return
    }

    try {
      const adminStatus = await checkAdminStatus(session)
      setIsAdmin(adminStatus.isAdmin)
      setAdminRole(adminStatus.role)
    } catch (error) {
      setIsAdmin(false)
      setAdminRole(null)
    } finally {
      setIsAdminLoading(false)
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
            try {
              const { data, error } = await supabase.auth.setSession({
                access_token: accessToken,
                refresh_token: refreshToken,
              })

              if (!error && data.session) {
                window.history.replaceState(null, '', window.location.pathname)
              } else if (error) {
                console.warn('Failed to set session:', error.message)
              }
            } catch (err) {
              console.warn('Failed to set session:', err)
            }
          }
        }

        // Get current session - handle stale sessions gracefully
        let session = null
        try {
          const { data } = await supabase.auth.getSession()
          session = data.session
        } catch (err) {
          console.warn('Failed to get session, clearing auth state:', err)
          await supabase.auth.signOut()
        }

        if (!mounted) return
        setSession(session)
        setUser(session?.user ?? null)
        setLoading(false)

        // Check admin status asynchronously (don't block)
        if (session) {
          checkAndSetAdminStatus(session)
        } else {
          setIsAdminLoading(false)
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
        setAdminRole(null)
        setIsAdminLoading(false)
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
        adminRole,
        isSuperAdmin: adminRole === 'super_admin',
        loading,
        isAdminLoading,
        signInWithGoogle,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  return isFrappeMode ? (
    <FrappeAuthProvider>{children}</FrappeAuthProvider>
  ) : (
    <SupabaseAuthProvider>{children}</SupabaseAuthProvider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
