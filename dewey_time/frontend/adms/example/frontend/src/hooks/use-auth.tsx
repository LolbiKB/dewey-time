import {
  createContext,
  useContext,
  useState,
  useEffect,
  type ReactNode,
} from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { STAFF_SIDEBAR_CONFIG } from "../config/sidebar-config";
import type { Permission } from "../lib/permissions";

// Types
export interface UserProfile {
  id: string;
  email: string;
  name?: string;
  first_name?: string;
  last_name?: string;
  avatar_url?: string;
  created_at?: string;
  updated_at?: string;
  // Backend-specific fields
  employee_id?: string;
  position_type?: string;
  department_id?: number;
  department_name?: string;
  // New simplified permission system
  permissions: string[]; // Array of "category:action" strings like ["course_management:read", "user_administration:write"]
}

interface AuthResponse {
  success: boolean;
  user?: UserProfile;
  token?: string;
  message?: string;
  error?: string;
}

interface AuthContextType {
  user: UserProfile | null;
  loading: boolean;
  authError: string | null;
  isAuthenticated: boolean;
  signInWithGoogle: (credential: string) => Promise<void>;
  signOut: () => Promise<void>;
  // New permission checking functions
  hasPermission: (permission: Permission | string) => boolean;
  hasAnyPermission: (permissions: (Permission | string)[]) => boolean;
  canAccessSection: (sectionKey: string) => boolean;
}

// Industry-standard session keys
const SESSION_KEYS = {
  USER: "diu_user_session",
  TOKEN: "diu_auth_token",
  LAST_CHECK: "diu_last_auth_check",
} as const;

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Clean, industry-standard auth implementation using backend REST API
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();

  // Use environment variable from Docker compose
  const API_BASE_URL =
    import.meta.env.VITE_API_BASE_URL || "http://localhost:3001";
  const STORAGE_CHECK_INTERVAL = 5000; // Check localStorage changes every 5 seconds

  // Clear all auth data
  const clearAuth = () => {
    setUser(null);
    setAuthError(null);
    setLoading(false);
    localStorage.removeItem(SESSION_KEYS.USER);
    localStorage.removeItem(SESSION_KEYS.TOKEN);
    localStorage.removeItem(SESSION_KEYS.LAST_CHECK);
  };

  // Store auth data (cross-tab sync)
  const storeAuth = (userData: UserProfile, token?: string) => {
    setUser(userData);
    setAuthError(null);
    setLoading(false);
    localStorage.setItem(SESSION_KEYS.USER, JSON.stringify(userData));
    localStorage.setItem(SESSION_KEYS.LAST_CHECK, Date.now().toString());
    if (token) {
      localStorage.setItem(SESSION_KEYS.TOKEN, token);
    }
  };

  // Get stored session from localStorage
  const getStoredSession = (): UserProfile | null => {
    try {
      const stored = localStorage.getItem(SESSION_KEYS.USER);
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  };

  // Get stored token
  const getStoredToken = (): string | null => {
    return localStorage.getItem(SESSION_KEYS.TOKEN);
  };

  // TanStack Query for session validation - replaces complex manual logic
  const {
    data: validatedUser,
    error: validationError,
    isError: hasValidationError,
  } = useQuery({
    queryKey: ["auth", "validate"],
    queryFn: async (): Promise<UserProfile> => {
      const token = getStoredToken();
      if (!token) throw new Error("No token available");

      const response = await fetch(`${API_BASE_URL}/api/auth/validate`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(`Session validation failed: ${response.status}`);
      }

      const data: AuthResponse = await response.json();

      if (!data.success || !data.user) {
        throw new Error("Invalid session response");
      }

      localStorage.setItem(SESSION_KEYS.LAST_CHECK, Date.now().toString());

      return data.user; // Return fresh data from backend
    },
    enabled: !!user && !!getStoredToken(), // Only validate when logged in and have token
    refetchInterval: 15 * 60 * 1000, // 15 minutes - safety check for long-idle sessions
    retry: 3,
    staleTime: 5 * 60 * 1000, // 5 minutes - longer stale time since we validate on activity
    refetchOnWindowFocus: true, // Validate when user returns to tab
  });

  // Handle validation results - update user state when validation succeeds
  useEffect(() => {
    if (validatedUser && user) {
      setUser(validatedUser);
      storeAuth(validatedUser); // Update localStorage with fresh data
    }
  }, [validatedUser, user]);

  // Handle validation errors - logout on persistent failures
  useEffect(() => {
    if (hasValidationError && user) {
      console.warn("⚠️ Session validation failed:", validationError?.message);
      clearAuth();
      navigate("/login", { replace: true });
    }
  }, [hasValidationError, validationError, user, navigate]);

  // Activity-based validation: revalidate auth on route changes
  useEffect(() => {
    if (user && getStoredToken()) {
      queryClient.invalidateQueries({ queryKey: ["auth", "validate"] });
    }
  }, [location.pathname, user, queryClient]);

  // Google sign-in with backend API
  const signInWithGoogle = async (credential: string): Promise<void> => {
    setAuthError(null);

    try {
      // Call backend auth endpoint (let backend handle domain validation)
      const response = await fetch(`${API_BASE_URL}/api/auth/google`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ token: credential }),
      });

      const data: AuthResponse = await response.json();

      if (response.ok && data.success && data.user) {
        // Store auth data - let AuthSuccessHandler handle navigation
        storeAuth(data.user, data.token);
        // Don't set loading here - let the form component handle its own loading states
      } else {
        console.error("❌ Authentication failed:", data.message || data.error);
        setAuthError(data.message || data.error || "Authentication failed");
        throw new Error(data.message || data.error || "Authentication failed");
      }
    } catch (error) {
      console.error("❌ Google sign-in error:", error);
      const errorMessage = error instanceof Error ? error.message : "Authentication failed. Please try again.";
      setAuthError(errorMessage);
      throw error; // Re-throw so the form component can handle it
    }
  };

  // Sign out
  const signOut = async (): Promise<void> => {
    const token = getStoredToken();

    // Call backend sign-out endpoint if token exists
    if (token) {
      try {
        await fetch(`${API_BASE_URL}/api/auth/signout`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({}), // Send empty JSON object to satisfy Fastify
        });
      } catch (error) {
        console.error("Sign-out API call failed:", error);
        // Continue with local cleanup even if API call fails
      }
    }

    // Clear local auth state and redirect
    clearAuth();
    navigate("/login", { replace: true });
  };

  // Initialize auth state on mount - instant since localStorage is pre-checked
  useEffect(() => {
    const storedUser = getStoredSession()
    const storedToken = getStoredToken()

    if (storedUser && storedToken) {
      // localStorage was pre-checked, safe to use immediately
      setUser(storedUser)
      setLoading(false)
      // TanStack Query will validate in background and update if needed
    } else {
      // No valid session - navigate to login
      clearAuth()
      navigate('/login', { replace: true })
    };
  }, [navigate])

  // Additional check: if we have a user but no token, or validation is disabled, clear auth
  useEffect(() => {
    if (user && !getStoredToken()) {
      console.warn("⚠️ User state exists without token - clearing auth");
      clearAuth();
      navigate("/login", { replace: true });
    }
  }, [user, navigate]);

  // Force redirect to login if not authenticated and not already on login page
  useEffect(() => {
    const currentPath = window.location.pathname;
    if (!loading && !user && currentPath !== "/login") {
      // Try React Router navigation first
      navigate('/login', { replace: true })

      // Fallback: use window.location as backup after a short delay
      setTimeout(() => {
        if (window.location.pathname !== '/login') {
          console.warn('⚠️ React Router navigation failed, using window.location fallback')
          window.location.replace('/login')
        }
      }, 100)
    }
  }, [loading, user, navigate])  // Listen for avatar updates from user management - FIXES AVATAR CACHING ISSUE
  useEffect(() => {
    const handleAvatarUpdate = (event: CustomEvent) => {
      const { userId, newAvatarUrl } = event.detail;

      // Only update if it's the current user
      if (user && user.id === userId) {
        // Update user state immediately for instant UI feedback
        const updatedUser = { ...user, avatar_url: newAvatarUrl };
        setUser(updatedUser);
        storeAuth(updatedUser);

        // Also invalidate the auth query to force a fresh fetch from backend
        queryClient.invalidateQueries({ queryKey: ["auth", "validate"] });
      }
    };

    window.addEventListener(
      "userAvatarUpdated",
      handleAvatarUpdate as EventListener,
    );
    return () =>
      window.removeEventListener(
        "userAvatarUpdated",
        handleAvatarUpdate as EventListener,
      );
  }, [user, queryClient]);

  // Cross-tab synchronization
  useEffect(() => {
    const interval = setInterval(() => {
      const storedUser = getStoredSession();

      // If no stored user but we have one in state, clear state
      if (!storedUser && user) {
        setUser(null);
        setLoading(false);
      }
      // If stored user different from state user, update state
      else if (storedUser && (!user || storedUser.id !== user.id)) {
        setUser(storedUser);
        setLoading(false);
      }
    }, STORAGE_CHECK_INTERVAL);

    return () => clearInterval(interval);
  }, [user]);

  // Handle storage events (cross-tab logout)
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === SESSION_KEYS.USER) {
        if (!e.newValue && user) {
          // User logged out in another tab
          setUser(null);
          setLoading(false);
          navigate("/login", { replace: true });
        } else if (e.newValue) {
          // User logged in another tab
          try {
            const newUser = JSON.parse(e.newValue);
            setUser(newUser);
            setLoading(false);
          } catch {
            // Invalid data - ignore
          }
        }
      }
    };

    window.addEventListener("storage", handleStorageChange);
    return () => window.removeEventListener("storage", handleStorageChange);
  }, [user, navigate]);

  // New simplified permission checking functions
  const hasPermission = (permission: Permission | string): boolean => {
    if (!user || !user.permissions) return false;

    // Check exact permission match (case-insensitive)
    return user.permissions.some(
      (p) => p.toLowerCase() === permission.toLowerCase(),
    );
  };

  const hasAnyPermission = (permissions: (Permission | string)[]): boolean => {
    if (!user || !user.permissions) return false;

    // Check if user has any of the required permissions
    return permissions.some((permission) => hasPermission(permission));
  };

  const canAccessSection = (sectionKey: string): boolean => {
    if (!user) return false;

    // Get section from sidebar config
    const section = STAFF_SIDEBAR_CONFIG[sectionKey];
    if (!section) return false;

    // Check if user has access to ANY subsection within this section
    // A main section should be visible if user can access any of its subsections
    return section.sections.some((subsection) =>
      hasAnyPermission(subsection.requiredPermissions)
    );
  };

  const isAuthenticated = !!user;

  const contextValue: AuthContextType = {
    user,
    loading,
    authError,
    isAuthenticated,
    signInWithGoogle,
    signOut,
    hasPermission,
    hasAnyPermission,
    canAccessSection,
  };

  // Don't render children until auth state is determined
  // This must be after all hooks to avoid React hooks order error
  if (loading) {
    return null; // Keep browser loading until auth is ready
  }

  return (
    <AuthContext.Provider value={contextValue}>{children}</AuthContext.Provider>
  );
}

// Hook to use auth context
export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
