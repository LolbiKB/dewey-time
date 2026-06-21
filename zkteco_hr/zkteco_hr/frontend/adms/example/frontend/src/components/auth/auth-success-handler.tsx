import { useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '@/hooks/use-auth'

export function AuthSuccessHandler() {
  const { user, isAuthenticated } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  useEffect(() => {
    if (isAuthenticated && user) {
      // Get intended destination or default to dashboard
      const from = location.state?.from?.pathname || '/dashboard'

      // Smooth transition with user feedback
      navigate(from, {
        replace: true,
        state: {
          message: `Welcome, ${user.first_name || user.name}!`
        }
      })
    }
  }, [isAuthenticated, user, navigate, location])

  return null // This component only handles navigation
}