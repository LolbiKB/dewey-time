import { useAuth } from "@/hooks/use-auth";
import { NotFound } from "@/pages/not-found";
import type { ReactNode } from "react";

interface ProtectedRouteProps {
  children: ReactNode;
  requiredPermissions: string[];
  requireAll?: boolean; // If true, user must have ALL permissions. If false, user needs ANY permission
}

/**
 * ProtectedRoute component that checks user permissions before rendering children
 */
export function ProtectedRoute({
  children,
  requiredPermissions,
  requireAll = false,
}: ProtectedRouteProps) {
  const { user, hasPermission, hasAnyPermission } = useAuth();

  // If user is not logged in, they shouldn't see protected routes
  if (!user) {
    return <NotFound />;
  }

  // Check permissions based on requireAll flag
  const hasAccess = requireAll
    ? requiredPermissions.every((permission) => hasPermission(permission))
    : hasAnyPermission(requiredPermissions);

  if (!hasAccess) {
    return <NotFound />;
  }

  return <>{children}</>;
}

// Convenience wrapper for routes that need ANY of the permissions
export function ProtectedRouteAny({
  children,
  requiredPermissions,
}: Omit<ProtectedRouteProps, "requireAll">) {
  return (
    <ProtectedRoute
      requiredPermissions={requiredPermissions}
      requireAll={false}
    >
      {children}
    </ProtectedRoute>
  );
}

// Convenience wrapper for routes that need ALL permissions
export function ProtectedRouteAll({
  children,
  requiredPermissions,
}: Omit<ProtectedRouteProps, "requireAll">) {
  return (
    <ProtectedRoute requiredPermissions={requiredPermissions} requireAll={true}>
      {children}
    </ProtectedRoute>
  );
}
