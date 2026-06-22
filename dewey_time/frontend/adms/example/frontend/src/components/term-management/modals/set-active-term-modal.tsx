import { ConfirmationDialog } from '@/components/ui/base-modal'
import type { Term } from '../columns'

interface SetActiveTermModalProps {
  term: Term | null
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  onConfirmSetActive: (termId: number) => Promise<void>
  isProcessing?: boolean
}

export function SetActiveTermModal({
  term,
  isOpen,
  onOpenChange,
  onConfirmSetActive,
  isProcessing = false
}: SetActiveTermModalProps) {
  if (!term) return null

  const handleConfirm = async () => {
    await onConfirmSetActive(term.id)
  }

  return (
    <ConfirmationDialog
      isOpen={isOpen}
      title="Set Active Term"
      message={`Are you sure you want to set "${term.name}" as the active term?`}
      confirmLabel="Set Active"
      cancelLabel="Cancel"
      variant="default"
      isProcessing={isProcessing}
      onConfirm={handleConfirm}
      onCancel={() => onOpenChange(false)}
    />
  )
}
