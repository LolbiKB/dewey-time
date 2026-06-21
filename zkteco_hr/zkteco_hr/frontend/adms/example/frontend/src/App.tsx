import { Routes, Route, Navigate } from "react-router-dom";
import { MainLayout } from "@/components/layout/main-layout";
import LoginPage from "@/pages/auth/login-page";
import { NotFound } from "@/pages/not-found";
import { UserManagement } from "@/pages/admin/user-management";
import { EmployeeManagement } from "@/pages/admin/employee-management";
import { TermManagement } from "@/pages/admin/term-management";
import { DepartmentManagement } from "@/pages/admin/department-management";
import { AuditLogs } from "@/pages/admin/audit-logs";
import ProgramManagement from "@/pages/admin/program-management";
import { StudentManagement } from "@/pages/admin/student-management";
import { CourseManagement } from "@/pages/admin/course-management";
import { CourseOfferingManagement } from "@/pages/admin/course-offering-management";
import { ProtectedRouteAny } from "@/components/auth/protected-route";

// Simple mock pages
function DashboardPage() {
  return (
    <MainLayout breadcrumb={{ items: [{ label: "Dashboard" }] }}>
      <div className="space-y-4">
        <h1 className="text-3xl font-bold">Dashboard</h1>
        <p className="text-muted-foreground">
          Welcome to the University Management System dashboard
        </p>
        <div className="grid gap-4 md:grid-cols-3">
          <div className="bg-muted/50 aspect-video rounded-xl flex items-center justify-center">
            <span>Student Overview</span>
          </div>
          <div className="bg-muted/50 aspect-video rounded-xl flex items-center justify-center">
            <span>Course Overview</span>
          </div>
          <div className="bg-muted/50 aspect-video rounded-xl flex items-center justify-center">
            <span>Quick Actions</span>
          </div>
        </div>
      </div>
    </MainLayout>
  );
}

function App() {
  return (
    <div className="h-full">
      <Routes>
        {/* Public routes */}
        <Route path="/login" element={<LoginPage />} />

        {/* Protected routes */}
        <Route path="/" element={<Navigate to="/dashboard" replace />} />

        <Route
          path="/dashboard"
          element={
            <ProtectedRouteAny
              requiredPermissions={[
                "course_management:read",
                "student_management:read",
                "user_administration:read",
              ]}
            >
              <DashboardPage />
            </ProtectedRouteAny>
          }
        />

        <Route
          path="/registration/*"
          element={
            <ProtectedRouteAny
              requiredPermissions={["student_management:read"]}
            >
              <NotFound />
            </ProtectedRouteAny>
          }
        />

        <Route
          path="/attendance/*"
          element={
            <ProtectedRouteAny
              requiredPermissions={["attendance_management:read"]}
            >
              <NotFound />
            </ProtectedRouteAny>
          }
        />

        <Route
          path="/notifications/*"
          element={
            <ProtectedRouteAny
              requiredPermissions={["notification_system:read"]}
            >
              <NotFound />
            </ProtectedRouteAny>
          }
        />

        <Route
          path="/academic/programs"
          element={
            <ProtectedRouteAny requiredPermissions={["program_management:read"]}>
              <ProgramManagement />
            </ProtectedRouteAny>
          }
        />

        <Route
          path="/academic/*"
          element={
            <ProtectedRouteAny requiredPermissions={["course_management:read"]}>
              <NotFound />
            </ProtectedRouteAny>
          }
        />

        <Route
          path="/students"
          element={
            <ProtectedRouteAny
              requiredPermissions={["student_management:read"]}
            >
              <StudentManagement />
            </ProtectedRouteAny>
          }
        />

        <Route
          path="/admin/users"
          element={
            <ProtectedRouteAny
              requiredPermissions={["user_administration:read"]}
            >
              <UserManagement />
            </ProtectedRouteAny>
          }
        />

        <Route
          path="/admin/employees"
          element={
            <ProtectedRouteAny requiredPermissions={["hr_management:read"]}>
              <EmployeeManagement />
            </ProtectedRouteAny>
          }
        />

        <Route
          path="/admin/terms"
          element={
            <ProtectedRouteAny requiredPermissions={["hr_management:read"]}>
              <TermManagement />
            </ProtectedRouteAny>
          }
        />

        <Route
          path="/admin/departments"
          element={
            <ProtectedRouteAny requiredPermissions={["hr_management:read"]}>
              <DepartmentManagement />
            </ProtectedRouteAny>
          }
        />

        <Route
          path="/admin/course-management"
          element={
            <ProtectedRouteAny requiredPermissions={["course_management:read"]}>
              <CourseManagement />
            </ProtectedRouteAny>
          }
        />

        <Route
          path="/admin/course-offerings"
          element={
            <ProtectedRouteAny requiredPermissions={["course_management:read"]}>
              <CourseOfferingManagement />
            </ProtectedRouteAny>
          }
        />

        <Route
          path="/admin/logs"
          element={
            <ProtectedRouteAny requiredPermissions={["audit_logs:read"]}>
              <AuditLogs />
            </ProtectedRouteAny>
          }
        />

        <Route
          path="/admin/*"
          element={
            <ProtectedRouteAny
              requiredPermissions={[
                "user_administration:read",
                "hr_management:read",
                "audit_logs:read",
              ]}
            >
              <NotFound />
            </ProtectedRouteAny>
          }
        />

        {/* 404 - Catch all other routes (must be last) */}
        <Route path="*" element={<NotFound />} />
      </Routes>
    </div>
  );
}

export default App;
