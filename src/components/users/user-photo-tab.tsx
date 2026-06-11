"use client"

import { useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ConfirmationDialog } from '@/components/ui/base-modal'
import { DialogFooter } from '@/components/ui/dialog'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Loader2, RefreshCw, Upload, CheckCircle2, Image } from 'lucide-react'
import { useUserPhoto } from '@/hooks/use-user-photo'
import { PhotoService } from '@/services/photo-service'
import { UserService } from '@/services/user-service'
import {
  PHOTO_CACHE_STATUS_LABELS,
  PHOTO_CACHE_STATUS_VARIANT,
  type PhotoCacheStatus,
} from '@/lib/photo-cache-status'
import { notifyError, notifySuccess } from '@/lib/toast'
import type { UserEntry, SyncStatusEntry } from '@/services/user-service'

interface UserPhotoTabProps {
  user: UserEntry
  syncStatus: SyncStatusEntry[]
  onProcessed?: () => void
}

export function UserPhotoTab({ user, syncStatus, onProcessed }: UserPhotoTabProps) {
  const [processing, setProcessing] = useState(false)
  const [pushing, setPushing] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [headStatus, setHeadStatus] = useState<PhotoCacheStatus | null>(null)
  const [pushConfirmOpen, setPushConfirmOpen] = useState(false)

  const userId = user.id || ''
  const frappeEmployeeId = user.frappe_employee_id
  const cacheStatus = (user.photo_cache_status as PhotoCacheStatus | undefined) ?? 'hr_no_photo'
  const displayStatus = headStatus ?? cacheStatus

  const { photoUrl: cachedPhotoUrl } = useUserPhoto({
    hasCachedPhoto: !!user.photo_storage_path,
    userId: userId || undefined,
    enabled: !!userId,
  })

  const { photoUrl: frappePhotoUrl } = useUserPhoto({
    hasCachedPhoto: false,
    frappeEmployeeId: user.frappe_employee_id,
    enabled: !!user.frappe_employee_id,
  })

  // Always use authenticated proxy (same as Users table avatar)
  const frappePreviewUrl = frappePhotoUrl

  const devicesWithPhoto = syncStatus.filter((s) => s.photo_synced).length
  const deviceTotal = syncStatus.length
  const canProcess =
    !!userId &&
    !!user.frappe_employee_id &&
    displayStatus !== 'hr_no_photo' &&
    displayStatus !== 'stale_cache'
  const canPush = !!user.photo_storage_path && deviceTotal > 0

  useEffect(() => {
    if (!userId) return
    let cancelled = false
    PhotoService.headCheckPhoto(userId, frappeEmployeeId)
      .then((res) => {
        if (!cancelled && res.photo_cache_status) {
          setHeadStatus(res.photo_cache_status as PhotoCacheStatus)
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [userId, frappeEmployeeId, user.photo_storage_path, user.photo_cache_status])

  const handleProcess = async () => {
    if (!userId) return
    setProcessing(true)
    try {
      const result = await PhotoService.processAndStorePhoto(userId, frappeEmployeeId)
      if (result.success) {
        notifySuccess('Photo cached', 'Processed from Frappe HR')
        setHeadStatus('cache_current')
        onProcessed?.()
      } else {
        notifyError('Process failed', result.message)
      }
    } catch (err) {
      notifyError('Process failed', err instanceof Error ? err.message : undefined)
    } finally {
      setProcessing(false)
    }
  }

  const handleVerifyHash = async () => {
    if (!userId) return
    setVerifying(true)
    try {
      const result = await PhotoService.checkPhoto(userId, frappeEmployeeId)
      if (result.needsRefresh) {
        setHeadStatus('hr_updated')
        notifyError('Verify', 'Frappe photo differs from cache (hash)')
      } else {
        setHeadStatus('cache_current')
        notifySuccess('Verify', 'Cache matches Frappe source')
        onProcessed?.()
      }
    } catch (err) {
      notifyError('Verify failed', err instanceof Error ? err.message : undefined)
    } finally {
      setVerifying(false)
    }
  }

  const handlePushPhoto = async () => {
    if (!userId) return
    setPushing(true)
    try {
      const deviceSns = syncStatus.map((s) => s.device_sn)
      const result = await UserService.pushPhotoToDevices(userId, deviceSns)
      notifySuccess(result.message)
      onProcessed?.()
    } catch (err) {
      notifyError('Push failed', err instanceof Error ? err.message : undefined)
    } finally {
      setPushing(false)
      setPushConfirmOpen(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto py-1">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <Badge variant={PHOTO_CACHE_STATUS_VARIANT[displayStatus]}>
            {PHOTO_CACHE_STATUS_LABELS[displayStatus]}
          </Badge>
          {user.photo_synced_at && (
            <span className="text-[11px] text-muted-foreground">
              Cache updated {new Date(user.photo_synced_at).toLocaleString()}
            </span>
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          HR (Frappe) ↔ bridge cache. Device photo status is on the Sync tab.
        </p>

        <div className="grid grid-cols-2 gap-4">
          <div className="rounded-lg border p-3 space-y-2">
            <div className="text-xs font-medium text-muted-foreground">Frappe (HR)</div>
            <Avatar className="h-20 w-20 mx-auto">
              <AvatarImage src={frappePreviewUrl || undefined} className="object-cover" />
              <AvatarFallback><Image className="h-6 w-6 text-muted-foreground" /></AvatarFallback>
            </Avatar>
          </div>
          <div className="rounded-lg border p-3 space-y-2">
            <div className="text-xs font-medium text-muted-foreground">Bridge cache</div>
            <Avatar className="h-20 w-20 mx-auto">
              <AvatarImage src={cachedPhotoUrl || undefined} className="object-cover" />
              <AvatarFallback><Image className="h-6 w-6 text-muted-foreground" /></AvatarFallback>
            </Avatar>
          </div>
        </div>

        <div className="text-xs text-muted-foreground rounded-md bg-muted/50 px-3 py-2">
          Devices: {devicesWithPhoto}/{deviceTotal} have photo synced (cloud → terminal)
        </div>
      </div>

      {/* Pinned action bar — Frappe↔cache↔device actions stay reachable while
          the previews above scroll. */}
      <DialogFooter variant="bar" className="sm:justify-start">
        <Button
          size="sm"
          onClick={handleProcess}
          disabled={!canProcess || processing}
          className="gap-1.5"
        >
          {processing ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          {user.photo_storage_path ? 'Reprocess from Frappe' : 'Process from Frappe'}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={handleVerifyHash}
          disabled={!userId || verifying}
          className="gap-1.5"
        >
          {verifying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
          Verify (hash)
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setPushConfirmOpen(true)}
          disabled={!canPush || pushing}
          className="gap-1.5"
        >
          {pushing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
          Push to devices
        </Button>
      </DialogFooter>

      <ConfirmationDialog
        isOpen={pushConfirmOpen}
        title="Push photo to devices?"
        message={`Queue photo upload to ${deviceTotal} device(s) from the current cache. User info is not re-synced.`}
        confirmLabel="Push photo"
        cancelLabel="Cancel"
        onConfirm={handlePushPhoto}
        onCancel={() => setPushConfirmOpen(false)}
        isProcessing={pushing}
      />
    </div>
  )
}
