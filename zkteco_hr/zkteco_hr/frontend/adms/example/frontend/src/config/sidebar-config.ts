/**
 * Sidebar Configuration with Role-Based Access Control
 * Maps sidebar sections to roles, operations, and database permissions
 */

import {
  GraduationCap,
  BookOpen,
  UserCheck,
  Bell,
  Settings,
  Settings2,
  BarChart3,
  type LucideIcon,
} from "lucide-react";

export interface SidebarSection {
  title: string;
  url: string;
  requiredPermissions: string[]; // Changed to use category:action format like "course_management:read"
  badge?: string;
}

export interface SidebarCategory {
  title: string;
  icon: LucideIcon;
  sections: SidebarSection[];
  key: string;
}

// Complete staff sidebar configuration based on database schema and user roles
export const STAFF_SIDEBAR_CONFIG: Record<string, SidebarCategory> = {
  // Core Academic Operations (Daily Operations)
  academic: {
    title: "Academic",
    icon: BookOpen,
    key: "academic",
    sections: [
      {
        title: "All Courses",
        url: "/admin/course-management",
        requiredPermissions: ["course_management:read"],
      },
      {
        title: "Course Offerings",
        url: "/admin/course-offerings",
        requiredPermissions: ["course_management:read"],
      },
      {
        title: "Schedules",
        url: "/academic/schedules",
        requiredPermissions: ["course_management:read"], // View course schedules
      },
      {
        title: "Program Management",
        url: "/academic/programs",
        requiredPermissions: ["program_management:read"], // Department management
      },
    ],
  },

  // Student Operations (Based on student_* tables)
  students: {
    title: "Students",
    icon: GraduationCap,
    key: "students",
    sections: [
      {
        title: "My Students",
        url: "/students/enrolled",
        requiredPermissions: ["student_management:read"], // Instructors see their students
      },
      {
        title: "Student Management",
        url: "/students",
        requiredPermissions: ["student_management:read"], // Manage student records
      },
      {
        title: "Course Enrollment",
        url: "/registration/courses",
        requiredPermissions: ["student_management:read"], // Manage enrollments
      }
    ],
  },

  // Attendance Operations (Based on attendance_* tables)
  attendance: {
    title: "Attendance",
    icon: UserCheck,
    key: "attendance",
    sections: [
      {
        title: "Take Attendance",
        url: "/attendance/take",
        requiredPermissions: ["attendance_management:read"], // Mark attendance
      },
      {
        title: "QR Sessions",
        url: "/attendance/qr-sessions",
        requiredPermissions: ["attendance_management:read"], // Create QR sessions
      },
      {
        title: "Excuse Requests",
        url: "/attendance/excuses",
        requiredPermissions: ["attendance_management:read"], // Process excuses
      },
      {
        title: "Attendance Records",
        url: "/attendance/records",
        requiredPermissions: ["attendance_management:read"], // View attendance data
      },
      {
        title: "Attendance Reports",
        url: "/attendance/reports",
        requiredPermissions: ["attendance_management:read"], // Generate reports
      },
      {
        title: "Attendance Config",
        url: "/settings/attendance",
        requiredPermissions: ["attendance_management:read"], // Admin settings
      },
    ],
  },

  // Communication System (Based on notification_* tables)
  notifications: {
    title: "Notifications",
    icon: Bell,
    key: "notifications",
    sections: [
      {
        title: "Send Notifications",
        url: "/notifications/send",
        requiredPermissions: ["notification_system:read"], // Create notifications
      },
      {
        title: "My Notifications",
        url: "/notifications/inbox",
        requiredPermissions: ["notification_system:read"], // View notifications
      },
      {
        title: "Notification Categories",
        url: "/notifications/categories",
        requiredPermissions: ["notification_system:read"], // Manage categories
      },
      {
        title: "User Notifications",
        url: "/notifications/users",
        requiredPermissions: ["notification_system:read"], // Manage user notifications
      },
    ],
  },

  // Reporting & Analytics (Cross-functional)
  reports: {
    title: "Reports & Analytics",
    icon: BarChart3,
    key: "reports",
    sections: [
      {
        title: "Enrollment Reports",
        url: "/reports/enrollment",
        requiredPermissions: ["student_management:read"], // View enrollment data
      },
      {
        title: "Academic Progress",
        url: "/reports/progress",
        requiredPermissions: ["student_management:read"], // View student progress
      },
      {
        title: "Department Reports",
        url: "/reports/department",
        requiredPermissions: ["hr_management:read"], // View department metrics
      },
      {
        title: "System Analytics",
        url: "/reports/analytics",
        requiredPermissions: ["system_config:read"], // View system metrics
      },
    ],
  },

  // Administrative Functions (Based on user_*, employee_* tables)
  administration: {
    title: "Administration",
    icon: Settings2,
    key: "administration",
    sections: [
      {
        title: "User Management",
        url: "/admin/users",
        requiredPermissions: ["user_administration:read"], // Manage user accounts
      },
      {
        title: "Employee Management",
        url: "/admin/employees",
        requiredPermissions: ["hr_management:read"], // Manage employees
      },
      {
        title: "Term Management",
        url: "/admin/terms",
        requiredPermissions: ["hr_management:read"], // Manage terms
      },
      {
        title: "Department Management",
        url: "/admin/departments",
        requiredPermissions: ["hr_management:read"], // Manage departments
      },
      {
        title: "Audit Logs",
        url: "/admin/logs",
        requiredPermissions: ["audit_logs:read"], // Manage departments
      },
    ],
  },

  // System Settings & Configuration (Based on config tables)
  settings: {
    title: "Settings",
    icon: Settings,
    key: "settings",
    sections: [
      {
        title: "System Configuration",
        url: "/settings/system",
        requiredPermissions: ["system_config:read"], // System settings
        badge: "Admin",
      },
      {
        title: "General Settings",
        url: "/settings/general",
        requiredPermissions: ["system_config:read"], // General settings
      },
    ],
  },
};

// Helper function to check if user has required permissions
export function hasRequiredPermissions(
  userPermissions: string[],
  requiredPermissions: string[],
): boolean {
  return requiredPermissions.some((required) =>
    userPermissions.includes(required.toLowerCase()),
  );
}

// Helper function to filter visible sidebar items based on user permissions
export function getVisibleSidebarItems(
  userPermissions: string[],
): Record<string, SidebarCategory> {
  const visibleItems: Record<string, SidebarCategory> = {};

  for (const [key, category] of Object.entries(STAFF_SIDEBAR_CONFIG)) {
    // Filter sections based on permissions
    const visibleSections = category.sections.filter((section) =>
      hasRequiredPermissions(userPermissions, section.requiredPermissions),
    );

    // Show category if user has access to at least one section
    if (visibleSections.length > 0) {
      visibleItems[key] = {
        ...category,
        sections: visibleSections,
      };
    }
  }

  return visibleItems;
}
