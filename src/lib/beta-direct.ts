/**
 * Tier-2 beta orchestration: opt-in, reversible, self-checking.
 *
 * Flag: localStorage `adms_beta_direct` === '1' (and only in embedded/frappe
 * mode). Flip it in the browser console — no rebuild, instant rollback:
 *     localStorage.adms_beta_direct = '1'   // on
 *     delete localStorage.adms_beta_direct  // off
 *
 * When on, the employee list runs BOTH the new direct path and the bridge
 * path, returns the direct result (so we're truly exercising it), and the
 * bridge call still runs — which (a) preserves the server-side side-effects
 * (rename→device-resync, PIN-heal) and (b) gives us a shadow baseline to diff
 * against. Any discrepancy is logged to the console, so a week of real usage
 * with zero diffs = proof the direct path is faithful before any cutover.
 */
import { isFrappeMode } from '@/lib/auth-mode'
import { fetchFrappeEmployeesDirect } from '@/services/frappe-direct'
import type { UserFilters, UsersResponse } from '@/services/user-service'

export function isBetaDirectReads(): boolean {
  if (!isFrappeMode) return false
  try {
    // Promoted to the default in embedded mode after the shadow-compare proved
    // parity. `adms_beta_direct === '0'` is the kill-switch back to bridge-only.
    return localStorage.getItem('adms_beta_direct') !== '0'
  } catch {
    return true
  }
}

// Fields the shadow-compare checks per row (the trust-critical ones).
const SHADOW_FIELDS = [
  'name',
  'pin',
  'status',
  'is_registered',
  'has_fingerprint',
  'has_face',
  'fingerprint_count',
  'face_count',
  'photo_cache_status',
  'department',
  'frappe_status',
]

const rowKey = (r: any) => r?.frappe_employee_id || r?.id || r?.pin || JSON.stringify(r)

function logShadowDiff(direct: UsersResponse, bridge: UsersResponse, filters: UserFilters) {
  const d = (direct.data as any[]) || []
  const b = (bridge.data as any[]) || []
  const diffs: string[] = []

  if ((direct.meta?.total ?? -1) !== (bridge.meta?.total ?? -2)) {
    diffs.push(`meta.total: direct=${direct.meta?.total} bridge=${bridge.meta?.total}`)
  }

  const bMap = new Map(b.map((r) => [rowKey(r), r]))
  for (const dr of d) {
    const br = bMap.get(rowKey(dr))
    if (!br) {
      diffs.push(`row only in direct: ${rowKey(dr)}`)
      continue
    }
    for (const f of SHADOW_FIELDS) {
      if (JSON.stringify(dr[f]) !== JSON.stringify(br[f])) {
        diffs.push(`${rowKey(dr)}.${f}: direct=${JSON.stringify(dr[f])} bridge=${JSON.stringify(br[f])}`)
      }
    }
  }
  const dKeys = new Set(d.map(rowKey))
  for (const br of b) {
    if (!dKeys.has(rowKey(br))) diffs.push(`row only in bridge: ${rowKey(br)}`)
  }

  const page = filters.page ?? 1
  if (diffs.length === 0) {
    // eslint-disable-next-line no-console
    console.info(`%c[beta-direct] ✓ shadow match — page ${page}, ${d.length} rows`, 'color:#16a34a')
  } else {
    // eslint-disable-next-line no-console
    console.warn(
      `[beta-direct] ✗ ${diffs.length} discrepancy(ies) — page ${page}:\n` + diffs.slice(0, 40).join('\n')
    )
  }
}

/**
 * Run the direct path with the bridge path in shadow. Returns the direct
 * result; falls back to bridge if the direct path throws (so the beta can
 * never harm the user — worst case it's the current behavior).
 */
export async function betaEmployeeRead(
  filters: UserFilters,
  viaBridge: () => Promise<UsersResponse>
): Promise<UsersResponse> {
  const [directRes, bridgeRes] = await Promise.allSettled([
    fetchFrappeEmployeesDirect(filters),
    viaBridge(),
  ])

  if (directRes.status === 'rejected') {
    // eslint-disable-next-line no-console
    console.warn('[beta-direct] direct read failed — using bridge result:', directRes.reason)
    if (bridgeRes.status === 'fulfilled') return bridgeRes.value
    throw directRes.reason
  }

  if (bridgeRes.status === 'fulfilled') {
    logShadowDiff(directRes.value, bridgeRes.value, filters)
  } else {
    // eslint-disable-next-line no-console
    console.warn('[beta-direct] bridge read failed (side-effects skipped this cycle):', bridgeRes.reason)
  }
  return directRes.value
}
