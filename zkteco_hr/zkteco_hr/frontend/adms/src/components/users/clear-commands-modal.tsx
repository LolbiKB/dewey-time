import { ConfirmationDialog } from '@/components/ui/base-modal'

interface ClearCommandsModalProps {
  commandCount: number
  deviceName: string
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
  isClearing?: boolean
}

export function ClearCommandsModal({
  commandCount,
  deviceName,
  isOpen,
  onOpenChange,
  onConfirm,
  isClearing = false
}: ClearCommandsModalProps) {
  return (
    <ConfirmationDialog
      isOpen={isOpen}
      title="Clear pending commands?"
      message={`This will permanently remove ${commandCount} pending command${commandCount !== 1 ? 's' : ''} for ${deviceName}. You'll need to re-sync if needed.`}
      confirmLabel={`Clear ${commandCount} command${commandCount !== 1 ? 's' : ''}`}
      isProcessing={isClearing}
      onConfirm={onConfirm}
      onCancel={() => onOpenChange(false)}
    />
  )
}
