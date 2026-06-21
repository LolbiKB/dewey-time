import { useState } from "react"
import { cn } from "@/lib/utils"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Loader2 } from "lucide-react"
import { useAuth } from "@/hooks/use-auth"
import { GoogleLogin, type CredentialResponse } from '@react-oauth/google'

// Get Google Client ID from environment
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || "YOUR_GOOGLE_CLIENT_ID"

export function LoginFormPrebuilt({
  className,
  ...props
}: React.ComponentProps<"div">) {
  const { signInWithGoogle, authError } = useAuth()
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [authStage, setAuthStage] = useState<'idle' | 'verifying' | 'validating' | 'creating_session' | 'redirecting'>('idle')

  // Log if Google Client ID is not configured
  if (GOOGLE_CLIENT_ID === "YOUR_GOOGLE_CLIENT_ID") {
    console.warn('⚠️ Google Client ID not configured. Please set VITE_GOOGLE_CLIENT_ID environment variable.')
  }

  // Get auth stage message
  const getAuthStageMessage = (stage: typeof authStage) => {
    switch (stage) {
      case 'verifying':
        return 'Verifying credentials...'
      case 'validating':
        return 'Validating account...'
      case 'creating_session':
        return 'Creating session...'
      case 'redirecting':
        return 'Redirecting...'
      default:
        return 'Signing in...'
    }
  }

  // Get user-friendly error message
  const getUserFriendlyError = (errorMessage: string) => {
    const message = errorMessage.toLowerCase()

    if (message.includes('domain') || message.includes('organization')) {
      return 'Please use your organization email address to sign in.'
    }
    if (message.includes('unauthorized') || message.includes('permission')) {
      return 'Your account does not have access. Contact your administrator.'
    }
    if (message.includes('network') || message.includes('connection')) {
      return 'Check your internet connection and try again.'
    }
    if (message.includes('cancelled') || message.includes('popup')) {
      return 'Sign-in was cancelled. Please try again.'
    }
    if (message.includes('invalid') || message.includes('expired')) {
      return 'Session expired. Please try signing in again.'
    }
    return 'Something went wrong. Please try again.'
  }

  // Handle Google OAuth success
  const handleGoogleSuccess = async (credentialResponse: CredentialResponse) => {
    try {
      setError(null)
      setSuccess(false) // Reset success state

      if (credentialResponse.credential) {
        // Set to validating state immediately
        setAuthStage('validating')

        // Call backend authentication - this is the actual work
        await signInWithGoogle(credentialResponse.credential)

        // If we reach here, auth succeeded - show redirecting state
        setAuthStage('redirecting')
        setSuccess(true)
      } else {
        setError('Something went wrong. Please try again.')
        setAuthStage('idle')
        setSuccess(false)
      }
    } catch (error) {
      console.error('❌ Sign-in failed:', error)
      setSuccess(false)
      setAuthStage('idle')
      if (error instanceof Error) {
        setError(getUserFriendlyError(error.message))
      } else {
        setError('Something went wrong. Please try again.')
      }
    }
  }  // Handle Google OAuth error
  const handleGoogleError = () => {
    console.error('❌ Google OAuth failed')
    setError('Sign-in was cancelled. Please try again.')
    setSuccess(false)
    setAuthStage('idle')
  }

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card>
        <CardHeader className="text-center">
          <a href="#" className="flex items-center justify-center m-4">
            <img
              src="/icons/DIU-Horizontal-480w-lossless.webp"
              alt="DIU Logo"
              className="h-16 w-auto"
            />
          </a>
          <CardTitle className="text-xl">Welcome to DIU Manage</CardTitle>
          <CardDescription>
            Login with your Google account
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3">
            {(error || authError) && (
              <div className="p-4 text-sm text-destructive border border-destructive/20 rounded-lg">
                <div className="font-medium mb-1">Unable to sign in</div>
                <div>
                  {error || authError}
                </div>
              </div>
            )}

            {/* Show redirecting state */}
            {(success || authStage === 'redirecting') && !error && !authError ? (
              <div className="flex items-center justify-center gap-2 p-6">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="text-sm text-muted-foreground">Redirecting...</span>
              </div>
            ) : /* Show loading states (but not if there's an error) */
              (authStage !== 'idle' && authStage !== 'redirecting' && !error && !authError) ? (
                <div className="flex items-center justify-center gap-2 p-6">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="text-sm text-muted-foreground">{getAuthStageMessage(authStage)}</span>
                </div>
              ) : /* Always show Google button if not actively loading and successful */
                (
                  <div className="flex justify-center">
                    <GoogleLogin
                      onSuccess={handleGoogleSuccess}
                      onError={handleGoogleError}
                      size="large"
                      theme="outline"
                      text="signin_with"
                      shape="circle"
                      width="250"
                    />
                  </div>
                )}

            <div className="text-center text-sm">
              Don&apos;t have an account?{" "}
              <br />
              <span className="text-muted-foreground">Contact Admin for further details.</span>
            </div>
          </div>
        </CardContent>
      </Card>
      <div className="text-muted-foreground text-center text-xs text-balance">
        By clicking continue, you agree to our <a href="#" className="underline underline-offset-4 hover:text-primary">Terms of Service</a>{" "}
        and <a href="#" className="underline underline-offset-4 hover:text-primary">Privacy Policy</a>.
      </div>
    </div>
  )
}

export default LoginFormPrebuilt