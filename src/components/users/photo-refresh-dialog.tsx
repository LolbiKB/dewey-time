import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Loader2, Check, X, Download, RefreshCw, Image } from 'lucide-react'
import type { UserEntry } from '@/services/user-service'
import { supabase } from '@/lib/supabase'
import { getAuthHeaders } from '@/lib/auth-token'

interface PhotoRefreshDialogProps {
  user: UserEntry | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess?: () => void
}

type PhotoStatus = 'idle' | 'checking' | 'ready' | 'processing' | 'success' | 'error'

interface PhotoInfo {
  hasCached: boolean
  cachedPath: string | null
  frappeUrl: string | null
  isSame: boolean | null
}

export function PhotoRefreshDialog({ user, open, onOpenChange, onSuccess }: PhotoRefreshDialogProps) {
  const [status, setStatus] = useState<PhotoStatus>('idle')
  const [photoInfo, setPhotoInfo] = useState<PhotoInfo | null>(null)
  const [progress, setProgress] = useState(0)
  const [progressStage, setProgressStage] = useState('')
  const [error, setError] = useState<string | null>(null)

  // Check photo status when dialog opens
  useEffect(() => {
    if (!user || !open) return

    const checkPhotoStatus = async () => {
      setStatus('checking')
      setError(null)

      try {
        // Get cached photo info from local DB
        const { data: userData } = await supabase
          .from('users')
          .select('photo_storage_path')
          .eq('id', user.id)
          .single()

        const hasCached = !!userData?.photo_storage_path

        // The check endpoint fetches fresh from Frappe using frappe_employee_id
        // So we always call it regardless of stored photo_url
        const API_URL = import.meta.env.VITE_API_URL || ''

        try {
          const response = await fetch(`${API_URL}/admin/photo/${user.id}/check`, {
            headers: await getAuthHeaders(),
          })

          let needsRefresh = true // default to refresh if can't check
          let exists = false

          if (response.ok) {
            const checkResult = await response.json()
            exists = checkResult.exists
            needsRefresh = checkResult.needsRefresh
          }

          setPhotoInfo({
            hasCached,
            cachedPath: userData?.photo_storage_path,
            frappeUrl: exists ? 'available' : null,
            isSame: !needsRefresh
          })
        } catch (e) {
          console.error('Photo check failed:', e)
          setPhotoInfo({
            hasCached,
            cachedPath: userData?.photo_storage_path,
            frappeUrl: null,
            isSame: null
          })
        }
        
        setStatus('ready')
      } catch (err) {
        console.error('Failed to check photo status:', err)
        setError('Failed to check photo status')
        setStatus('error')
      }
    }

    checkPhotoStatus()
  }, [user, open])

  const handleRefresh = async () => {
    if (!user?.id) {
      setError('No user ID')
      return
    }

    setStatus('processing')
    setProgress(0)
    setProgressStage('Downloading from Frappe...')
    setError(null)

    try {
      // Stage 1: Download (simulated - actual progress comes from backend)
      setProgress(20)
      
      // Call the backend to process photo
      const API_URL = import.meta.env.VITE_API_URL || ''

      setProgressStage('Processing photo...')
      setProgress(50)

      const response = await fetch(`${API_URL}/admin/photo/process`, {
        method: 'POST',
        headers: await getAuthHeaders(),
        body: JSON.stringify({
          user_id: user.id,
        }),
      })

      setProgressStage('Uploading to storage...')
      setProgress(80)

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: 'Unknown error' }))
        throw new Error(err.error || 'Failed to process photo')
      }

      setProgress(100)
      setProgressStage('Complete!')
      setStatus('success')

      // Refresh user data after short delay
      setTimeout(() => {
        onSuccess?.()
        onOpenChange(false)
      }, 1500)

    } catch (err) {
      console.error('Photo refresh failed:', err)
      setError(err instanceof Error ? err.message : 'Failed to refresh photo')
      setStatus('error')
    }
  }

  const handleClose = () => {
    setStatus('idle')
    setPhotoInfo(null)
    setProgress(0)
    setProgressStage('')
    setError(null)
    onOpenChange(false)
  }

  if (!user) return null

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Image className="h-5 w-5" />
            Photo Sync
          </DialogTitle>
          <DialogDescription>
            {user.name}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Current Status */}
          <div className="space-y-2">
            <h4 className="text-sm font-medium">Current Status</h4>
            
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Cached in Bridge:</span>
              {photoInfo?.hasCached ? (
                <Badge variant="secondary" className="gap-1 text-green-700">
                  <Check className="h-3 w-3" />
                  Yes
                </Badge>
              ) : (
                <Badge variant="outline" className="gap-1">
                  <X className="h-3 w-3" />
                  No
                </Badge>
              )}
            </div>

            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Source (Frappe):</span>
              {photoInfo?.frappeUrl ? (
                <Badge variant="outline" className="gap-1">
                  <Download className="h-3 w-3" />
                  Available
                </Badge>
              ) : (
                <Badge variant="outline" className="gap-1">
                  <X className="h-3 w-3" />
                  No URL
                </Badge>
              )}
            </div>

            {/* Comparison Result */}
            {status === 'ready' && photoInfo && (
              <div className={`p-3 rounded-lg border ${
                !photoInfo.frappeUrl 
                  ? 'bg-muted/40 border-border'
                  : !photoInfo.hasCached 
                    ? 'bg-blue-50 border-blue-200' 
                    : 'bg-green-50 border-green-200'
              }`}>
                <div className="flex items-center gap-2">
                  {!photoInfo.frappeUrl ? (
                    <>
                      <X className="h-4 w-4 text-muted-foreground/70" />
                      <span className="text-sm text-muted-foreground">
                        No photo in Frappe - cannot refresh
                      </span>
                    </>
                  ) : !photoInfo.hasCached ? (
                    <>
                      <Download className="h-4 w-4 text-blue-600" />
                      <span className="text-sm text-blue-700">
                        No cached photo - click refresh to download
                      </span>
                    </>
                  ) : (
                    <>
                      <Check className="h-4 w-4 text-green-600" />
                      <span className="text-sm text-green-700">
                        Photo cached in Bridge
                      </span>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Progress */}
          {status === 'processing' && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{progressStage}</span>
                <span className="text-muted-foreground">{progress}%</span>
              </div>
              <Progress value={progress} className="h-2" />
            </div>
          )}

          {/* Error */}
          {status === 'error' && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200">
              <div className="flex items-center gap-2 text-red-700">
                <X className="h-4 w-4" />
                <span className="text-sm">{error}</span>
              </div>
            </div>
          )}

          {/* Success */}
          {status === 'success' && (
            <div className="p-3 rounded-lg bg-green-50 border border-green-200">
              <div className="flex items-center gap-2 text-green-700">
                <Check className="h-4 w-4" />
                <span className="text-sm">Photo refreshed successfully!</span>
              </div>
            </div>
          )}
        </div>

        <DialogFooter variant="bar">
          {status === 'success' && (
            <Button variant="outline" onClick={handleClose}>
              Done
            </Button>
          )}
          
          {status === 'ready' && (
            <Button 
              onClick={handleRefresh}
              disabled={!photoInfo?.frappeUrl}
              className="gap-2"
            >
              <RefreshCw className="h-4 w-4" />
              Refresh Photo
            </Button>
          )}

          {status === 'checking' && (
            <Button disabled>
              <Loader2 className="h-4 w-4 animate-spin" />
              Checking...
            </Button>
          )}

          {status === 'processing' && (
            <Button disabled>
              <Loader2 className="h-4 w-4 animate-spin" />
              Processing...
            </Button>
          )}

          {status === 'error' && (
            <Button onClick={handleRefresh} className="gap-2">
              <RefreshCw className="h-4 w-4" />
              Try Again
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
