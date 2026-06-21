import { LoginFormPrebuilt } from "@/components/login-form-prebuilt"
import { useAuth } from "@/hooks/use-auth"
import { AuthSuccessHandler } from "@/components/auth"

export default function LoginPage() {
  const { isAuthenticated } = useAuth()

  return (
    <>
      {/* Handle post-login navigation */}
      {isAuthenticated && <AuthSuccessHandler />}

      <div className="bg-muted flex min-h-svh flex-col items-center justify-center gap-6 p-6 md:p-10">
        <div className="flex justify-center">
          <div className="w-full max-w-sm">
            <LoginFormPrebuilt />
          </div>
        </div>
      </div>
    </>
  )
}
