/**
 * Tier-2 beta orchestration: opt-in, reversible, self-checking.
 *
 * Flag: localStorage `adms_beta_direct` === '1' (and only in embedded/frappe
 * mode). OPT-IN — anything else, including absent or unreadable, means
 * bridge-only. Flip it in the browser console — no rebuild, instant rollback:
 *     localStorage.adms_beta_direct = '1'   // on
 *     delete localStorage.adms_beta_direct  // off
 *
 * It was briefly default-on. That is what put an unproven read path in front of
 * a real admin on 2026-08-04 — see isBetaDirectReads below. Do not promote it
 * again on the strength of a clean shadow-compare from one account: the direct
 * path reads Employee with the SIGNED-IN USER's Frappe session, so parity
 * proven for you proves nothing for a colleague with different permissions.
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
    // Opt-IN, exactly as the docstring above says.
    //
    // This previously read `!== '0'` — default ON in embedded mode — while the
    // docstring described it as opt-in via '1'. The code and the documentation
    // disagreed and the code won, so an unproven read path was in front of
    // every embedded admin. On 2026-08-04 one of them had Frappe permissions
    // that returned no employees and saw every registered colleague badged
    // "Compromised User Detected".
    //
    // Defaulting off costs nothing: betaEmployeeRead awaits BOTH paths
    // (Promise.allSettled), so the direct read never saved a round-trip, and
    // its result is now discarded unless it matches the bridge anyway. The
    // parity claim that justified promoting it was also never true for every
    // user — the direct path reads Employee with the SIGNED-IN USER's Frappe
    // session, so it is only ever as correct as that account's permissions.
    return localStorage.getItem('adms_beta_direct') === '1'
  } catch {
    // A storage failure must not silently enrol someone in the experiment.
    return false
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

export function shadowDiffs(direct: UsersResponse, bridge: UsersResponse): string[] {
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

  return diffs
}

/**
 * Run the direct path with the bridge path in shadow.
 *
 * The bridge is the TRUSTED path. The direct result is served only when it
 * AGREES with the bridge — any discrepancy means the direct path is wrong about
 * something, and we cannot know which fields are safe, so the whole result is
 * discarded in favour of the bridge's.
 *
 * This previously logged discrepancies and returned the direct result anyway.
 * On 2026-08-04 that served a real admin a list of 49 rows with every
 * registered employee badged "Compromised User Detected", while the bridge — in
 * the very same call — had 504 employees with correct statuses. The direct path
 * reads Employee with the LOGGED-IN USER's Frappe session
 * (frappe-direct.ts, credentials: 'include'), and that user's permissions
 * returned nothing. The comparator detected all 46 discrepancies and served the
 * broken data regardless.
 *
 * A comparator that notices the new path disagreeing with the trusted one and
 * then returns the new path's answer is not a safety net.
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

  if (bridgeRes.status !== 'fulfilled') {
    // No baseline to compare against. Serve direct — this is the only path on
    // which an unverified direct result reaches the user.
    // eslint-disable-next-line no-console
    console.warn('[beta-direct] bridge read failed (side-effects skipped this cycle):', bridgeRes.reason)
    return directRes.value
  }

  const diffs = shadowDiffs(directRes.value, bridgeRes.value)
  if (diffs.length === 0) return directRes.value

  const page = filters.page ?? 1
  // eslint-disable-next-line no-console
  console.warn(
    `[beta-direct] ✗ ${diffs.length} discrepancy(ies) — page ${page}: serving the BRIDGE result\n` +
      diffs.slice(0, 40).join('\n')
  )

  return {
    ...bridgeRes.value,
    degraded: {
      reason: 'direct-read-mismatch',
      diffCount: diffs.length,
      message:
        'Your Frappe account returned different employee data than the server, so the server result is being shown. ' +
        'Ask an administrator to check your Frappe roles and User Permissions for the Employee doctype.',
    },
  }
}
