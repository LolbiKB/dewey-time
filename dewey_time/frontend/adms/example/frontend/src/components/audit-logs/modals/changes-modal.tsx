import { BaseModal } from '@/components/ui/base-modal'
import { Separator } from '@/components/ui/separator'
import type { AuditLogEntry } from "../../../services/audit-log-service"

interface ChangesModalProps {
  isOpen: boolean
  onClose: () => void
  auditLog: AuditLogEntry
}

/**
 * Format field name to be more readable
 */
function formatFieldName(key: string): string {
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, str => str.toUpperCase())
    .replace(/Id$/, ' ID')
}

/**
 * Determine the type of change for styling
 */
function getChangeType(oldValue: any, newValue: any): 'added' | 'removed' | 'modified' | 'unchanged' {
  if (oldValue === undefined || oldValue === null) return 'added'
  if (newValue === undefined || newValue === null) return 'removed'
  if (oldValue === newValue) return 'unchanged'
  return 'modified'
}

/**
 * Format value for display
 */
function formatValue(value: any): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'string' && value === '') return '(empty)'
  return String(value)
}

export function ChangesModal({ isOpen, onClose, auditLog }: ChangesModalProps) {
  // Parse the old and new values
  let oldValues: Record<string, any> | null = null
  let newValues: Record<string, any> | null = null

  try {
    if (auditLog.old_values) oldValues = JSON.parse(auditLog.old_values)
    if (auditLog.new_values) newValues = JSON.parse(auditLog.new_values)
  } catch (error) {
    console.error('Error parsing audit log values:', error)
  }

  // Get all unique field names from both old and new values
  const allFields = new Set([
    ...(oldValues ? Object.keys(oldValues) : []),
    ...(newValues ? Object.keys(newValues) : [])
  ])

  const changes = Array.from(allFields)
    .map(field => {
      const oldValue = oldValues?.[field]
      const newValue = newValues?.[field]
      const changeType = getChangeType(oldValue, newValue)

      return {
        field,
        oldValue,
        newValue,
        changeType
      }
    })
    .filter(change => change.changeType !== 'unchanged') // Only show actual changes

  return (
    <BaseModal
      isOpen={isOpen}
      onOpenChange={onClose}
      title="Change Summary"
      description={`${auditLog.action} • ${auditLog.resource_type?.replace(/_/g, ' ')}`}
    >
      <div className="space-y-4">
        {changes.length > 0 ? (
          <div className="max-h-80 overflow-y-auto">
            {changes.map(({ field, oldValue, newValue, changeType }, index) => (
              <div key={field}>
                <div className="py-3">
                  <div className="flex items-baseline justify-between">
                    <span className="text-sm font-medium text-foreground">
                      {formatFieldName(field)}
                    </span>
                    <div className="text-xs text-muted-foreground">
                      {changeType === 'added' && (
                        <span className="text-success">+added</span>
                      )}
                      {changeType === 'removed' && (
                        <span className="text-destructive">-removed</span>
                      )}
                      {changeType === 'modified' && (
                        <span className="text-primary">~modified</span>
                      )}
                    </div>
                  </div>

                  <div className="mt-2 text-sm">
                    {changeType === 'added' && (
                      <div className="text-success">
                        <span className="font-mono bg-success/10 px-2 py-1 rounded text-xs">
                          {formatValue(newValue)}
                        </span>
                      </div>
                    )}
                    {changeType === 'removed' && (
                      <div className="text-destructive">
                        <span className="font-mono bg-destructive/10 px-2 py-1 rounded text-xs line-through">
                          {formatValue(oldValue)}
                        </span>
                      </div>
                    )}
                    {changeType === 'modified' && (
                      <div className="flex items-center gap-2 text-xs">
                        <span className="font-mono bg-destructive/10 px-2 py-1 rounded text-destructive line-through">
                          {formatValue(oldValue)}
                        </span>
                        <span className="text-muted-foreground">→</span>
                        <span className="font-mono bg-success/10 px-2 py-1 rounded text-success">
                          {formatValue(newValue)}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
                {index < changes.length - 1 && <Separator />}
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-8 text-muted-foreground">
            <div className="text-sm">No changes to display</div>
          </div>
        )}
      </div>
    </BaseModal>
  )
}