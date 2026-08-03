import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface RefreshButtonProps {
  onRefresh: () => void
  /**
   * TanStack's `isFetching` — NOT `isLoading`.
   *
   * `isLoading` is `isPending && isFetching`, so it is true only until the
   * first data arrives. Binding the spinner to it (which is what the shared
   * table primitive does via its `loading` prop) means a manual refetch on a
   * populated table produces no visible change at all.
   */
  refreshing?: boolean
}

/**
 * Manual refresh for the data tables.
 *
 * Replaces the design-system table's built-in refresh button, which cannot be
 * used here: that button's spinner and disabled state are driven by the same
 * `loading` prop that swaps the table body for skeleton rows. Feeding it
 * `isFetching` would flash every row away on each background refetch (including
 * the refetch-on-window-focus), so the two states need separate props.
 */
export function RefreshButton({ onRefresh, refreshing = false }: RefreshButtonProps) {
  return (
    <Button
      variant="outline"
      aria-label="Refresh"
      // Swallow the click event: passing it straight to a TanStack `refetch`
      // hands a SyntheticEvent in where RefetchOptions is expected.
      onClick={() => onRefresh()}
      disabled={refreshing}
    >
      <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
    </Button>
  )
}
