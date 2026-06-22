// Permission constants for type-safe authorization
// This centralizes all permission strings and makes refactoring easy
export const PERMISSIONS = {
  // HR Management
  EMPLOYEE_MANAGEMENT: {
    CREATE: "hr_management:create",
    READ: "hr_management:read",
    WRITE: "hr_management:write",
    DELETE: "hr_management:delete",
  },

  // User Administration
  USER_ADMINISTRATION: {
    CREATE: "user_administration:create",
    READ: "user_administration:read",
    WRITE: "user_administration:write",
    DELETE: "user_administration:delete",
  },

  // Term Management
  TERM_MANAGEMENT: {
    CREATE: "hr_management:create",
    READ: "hr_management:read",
    WRITE: "hr_management:write",
    DELETE: "hr_management:delete",
  },

  // Term Management
  PROGRAM_MANAGEMENT: {
    CREATE: "program_management:create",
    READ: "program_management:read",
    WRITE: "program_management:write",
    DELETE: "program_management:delete",
  },

  // Department Management
  DEPARTMENT_MANAGEMENT: {
    CREATE: "hr_management:create",
    READ: "hr_management:read",
    WRITE: "hr_management:write",
    DELETE: "hr_management:delete",
  },

  // Student Management
  STUDENT_MANAGEMENT: {
    CREATE: "student_management:create",
    READ: "student_management:read",
    WRITE: "student_management:write",
    DELETE: "student_management:delete",
  },

  // Course Management
  COURSE_MANAGEMENT: {
    CREATE: "course_management:create",
    READ: "course_management:read",
    UPDATE: "course_management:write",
    WRITE: "course_management:write",
    DELETE: "course_management:delete",
  },

  // Audit Logs
  AUDIT_LOGS: {
    READ: "audit_logs:read",
    WRITE: "audit_logs:write",
    DELETE: "audit_logs:delete",
  },
} as const;

// Extract all permission values for type safety
type PermissionCategory = typeof PERMISSIONS[keyof typeof PERMISSIONS];
type PermissionConstant = PermissionCategory[keyof PermissionCategory];

// Permission type accepts both constant strings and generic strings for backward compatibility
export type Permission = PermissionConstant | string;
