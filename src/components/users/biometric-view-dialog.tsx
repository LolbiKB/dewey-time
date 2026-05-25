import { useEffect, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Fingerprint, ScanFace, Trash2, Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useDeleteBiometric } from '@/hooks/use-users'
import { protocolFingerLabel } from '@/lib/zk-finger-fid'

interface BiometricViewDialogProps {
  userId: string | null
  userName: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

interface BiometricRecord {
  id: string
  type: string
  finger_id: number | null
  template_data: string | null
  enrolled_at: string | null
  enrolled_device_sn: string | null
}

export function BiometricViewDialog({
  userId,
  userName,
  open,
  onOpenChange,
}: BiometricViewDialogProps) {
  const [biometrics, setBiometrics] = useState<BiometricRecord[]>([])
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const deleteBiometric = useDeleteBiometric()

  // Fetch biometrics for this user
  useEffect(() => {
    if (!userId || !open) return

    const fetchBiometrics = async () => {
      const { data, error } = await supabase
        .from('user_biometrics')
        .select('*')
        .eq('user_id', userId)
        .order('enrolled_at', { ascending: false })

      if (!error && data) {
        setBiometrics(data)
      }
    }

    fetchBiometrics()
  }, [userId, open])

  const handleDelete = async (bio: BiometricRecord) => {
    if (!userId) return
    
    setDeletingId(bio.id)
    try {
      await deleteBiometric.mutateAsync({
        userId,
        type: bio.type as 'fingerprint' | 'face',
        fingerId: bio.finger_id ?? undefined,
      })
      // Refresh biometrics
      const { data } = await supabase
        .from('user_biometrics')
        .select('*')
        .eq('user_id', userId)
        .order('enrolled_at', { ascending: false })
      if (data) setBiometrics(data)
    } finally {
      setDeletingId(null)
    }
  }

  // Group by type
  const fingerprints = biometrics.filter(b => b.type === 'fingerprint')
  const faces = biometrics.filter(b => b.type === 'face')

const formatHash = (hash: string | null) => {
    if (!hash) return 'N/A'
    return hash.length > 20 ? hash.substring(0, 20) + '...' : hash
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Biometrics Summary</DialogTitle>
          <DialogDescription>{userName || 'User'}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Fingerprints */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Fingerprint className="h-4 w-4" />
              <span className="text-sm font-medium">Fingerprints</span>
              <Badge variant="outline">{fingerprints.length}</Badge>
            </div>

            {fingerprints.length === 0 ? (
              <p className="text-sm text-muted-foreground pl-6">Not enrolled</p>
            ) : (
              <div className="space-y-1 pl-6">
                {fingerprints.map(bio => (
                  <div key={bio.id} className="flex items-center justify-between text-sm gap-2">
                    <span className="font-mono text-muted-foreground text-xs break-all">
                      {formatHash(bio.template_data)}
                    </span>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-muted-foreground text-xs">
                        {protocolFingerLabel(bio.finger_id ?? 0)}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 text-muted-foreground hover:text-red-500"
                        onClick={() => handleDelete(bio)}
                        disabled={deletingId === bio.id}
                      >
                        {deletingId === bio.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Trash2 className="h-3 w-3" />
                        )}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Divider */}
          <div className="border-t" />

          {/* Face */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <ScanFace className="h-4 w-4" />
              <span className="text-sm font-medium">Face</span>
              <Badge variant={faces.length > 0 ? 'default' : 'outline'}>
                {faces.length > 0 ? 'Enrolled' : 'Not enrolled'}
              </Badge>
            </div>

            {faces.length > 0 && (
              <div className="space-y-1 pl-6">
                {faces.map(bio => (
                  <div key={bio.id} className="flex items-center justify-between text-sm gap-2">
                    <span className="font-mono text-muted-foreground text-xs break-all">
                      {formatHash(bio.template_data)}
                    </span>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-muted-foreground text-xs">
                        {bio.enrolled_device_sn || 'N/A'}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 text-muted-foreground hover:text-red-500"
                        onClick={() => handleDelete(bio)}
                        disabled={deletingId === bio.id}
                      >
                        {deletingId === bio.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Trash2 className="h-3 w-3" />
                        )}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}