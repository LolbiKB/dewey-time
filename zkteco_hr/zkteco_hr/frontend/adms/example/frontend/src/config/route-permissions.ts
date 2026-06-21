/**
 * Route Permission Configuration
 * Maps each route to its required permissions for access control
 */

export interface RoutePermissionConfig {
  path: string
  requiredPermissions: string[]
  requireAll?: boolean // If true, user must have ALL permissions. If false, user needs ANY permission
}

// Route permission mapping based on your current sidebar configuration
export const ROUTE_PERMISSIONS: RoutePermissionConfig[] = [
  // Dashboard - accessible to anyone with basic access
  {
    path: "/dashboard",
    requiredPermissions: ["course_management:read", "student_management:read", "user_administration:read"],
    requireAll: false // Any basic permission allows dashboard access
  },

  // Admin routes - specific permissions for each page
  {
    path: "/admin/users",
    requiredPermissions: ["user_administration:read"]
  },
  {
    path: "/admin/employees", 
    requiredPermissions: ["hr_management:read"]
  },
  {
    path: "/admin/departments",
    requiredPermissions: ["hr_management:read"]
  },
  {
    path: "/admin/course-management",
    requiredPermissions: ["course_management:read"]
  },
  {
    path: "/admin/logs",
    requiredPermissions: ["audit_logs:read"]
  },
]

/**
 * Get required permissions for a specific route
 */
export function getRoutePermissions(path: string): RoutePermissionConfig | null {
  // Find exact match by pathname
  return ROUTE_PERMISSIONS.find(route => route.path === path) || null
}

/**
 * Check if user has access to a specific route
 */
export function hasRouteAccess(
  userPermissions: string[], 
  path: string
): boolean {
  const routeConfig = getRoutePermissions(path)
  
  // If no specific permissions required, allow access
  if (!routeConfig) return true

  const { requiredPermissions, requireAll = false } = routeConfig

  if (requireAll) {
    // User must have ALL required permissions
    return requiredPermissions.every(permission => 
      userPermissions.some(userPerm => userPerm.toLowerCase() === permission.toLowerCase())
    )
  } else {
    // User needs ANY of the required permissions
    return requiredPermissions.some(permission => 
      userPermissions.some(userPerm => userPerm.toLowerCase() === permission.toLowerCase())
    )
  }
}