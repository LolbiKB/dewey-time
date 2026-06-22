import { Link } from 'react-router-dom'
import { Home, ArrowLeft, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'

export function NotFound() {
  const handleGoBack = () => {
    if (window.history.length > 1) {
      window.history.back()
    } else {
      // If no history, redirect to dashboard
      window.location.href = '/dashboard'
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Search />
          </EmptyMedia>
          <EmptyTitle>Page Not Found</EmptyTitle>
          <EmptyDescription>
            The page you're looking for doesn't exist.
          </EmptyDescription>
        </EmptyHeader>

        <EmptyContent>
          <div className="flex flex-col sm:flex-row gap-2 w-full max-w-xs">
            <Button asChild className="flex-1">
              <Link to="/dashboard">
                <Home className="w-4 h-4 mr-2" />
                Dashboard
              </Link>
            </Button>
            <Button
              variant="outline"
              onClick={handleGoBack}
              className="flex-1 cursor-pointer"
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back
            </Button>
          </div>
        </EmptyContent>
      </Empty>
    </div>
  )
}