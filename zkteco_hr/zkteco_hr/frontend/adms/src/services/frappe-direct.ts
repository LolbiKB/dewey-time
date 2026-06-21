/**
 * Tier-2 beta: read the employee list WITHOUT the bridge.
 *
 * When the dashboard is embedded in Frappe (/adms), the browser already holds a
 * Frappe session cookie, so it can read Employees straight from Frappe's REST
 * API under the logged-in user's DocType permissions — no bridge hop, no
 * service API key. We pair that with a direct Supabase read of the bridge users
 * (RLS via the minted token) and run the SAME pure merge the bridge runs
 * (lib/frappe-merge.ts), so the view is identical.
 *
 * What this path deliberately does NOT do (stays server-side, in the bridge):
 *   • queue device re-sync on rename (refreshIdentityCache)
 *   • persist PIN-row heals
 * During beta the bridge still runs (shadow-compare calls it), so those
 * side-effects keep happening; the compromised SET is recomputed here purely.
 */
import { supabase } from '@/lib/supabase'
import { mergeFrappeEmployees, type FrappeEmployeeRaw } from '@/lib/frappe-merge'
import type { UserFilters, UsersResponse } from './user-service'

const EMPLOYEE_FIELDS = [
  'name',
  'employee',
  'employee_name',
  'department',
  'status',
  'attendance_device_id',
  'image',
  'modified',
]

const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL || 'https://jihzfxcdbdpzrrefecys.supabase.co'

// Embedded mode is same-origin with the Frappe site (/adms), so the REST API
// and the session cookie live at window.location.origin.
function frappeOrigin(): string {
  return window.location.origin
}

export async function fetchFrappeEmployeesDirect(
  filters: UserFilters = {}
): Promise<UsersResponse> {
  // 1) Frappe Employees — direct, session cookie, user's DocType perms.
  const url =
    `${frappeOrigin()}/api/resource/Employee` +
    `?fields=${encodeURIComponent(JSON.stringify(EMPLOYEE_FIELDS))}` +
    `&limit_page_length=0`
  const fRes = await fetch(url, {
    credentials: 'include',
    headers: { Accept: 'application/json' },
  })
  if (!fRes.ok) {
    throw new Error(`Frappe Employee fetch failed: HTTP ${fRes.status}`)
  }
  const fJson = await fRes.json()
  const frappeEmployees: FrappeEmployeeRaw[] = fJson.data || []

  // 2) Bridge users — direct from Supabase (RLS via minted token).
  const { data: bridgeUsers, error } = await supabase
    .from('users')
    .select('*, user_biometrics(type, finger_id), photo_storage_path')
  if (error) throw error

  // 3) Compromised set — same rule as the bridge's refreshIdentityCache:
  //    a bridge user with a frappe_employee_id that no longer exists in Frappe
  //    (excluding device-admin rows, which are bridge-local by design).
  const frappeIds = new Set(frappeEmployees.map((e) => e.name))
  const missingInFrappeIds = new Set<string>(
    (bridgeUsers || [])
      .filter(
        (u: any) =>
          u.frappe_employee_id && !u.is_device_admin && !frappeIds.has(u.frappe_employee_id)
      )
      .map((u: any) => u.id as string)
  )

  // 4) Shared pure merge — identical to the bridge.
  const { data, meta } = mergeFrappeEmployees({
    frappeEmployees,
    bridgeUsers: bridgeUsers || [],
    missingInFrappeIds,
    frappeUrl: frappeOrigin(),
    supabaseUrl: SUPABASE_URL,
    filters: {
      page: filters.page ?? 1,
      limit: filters.limit ?? 20,
      search: filters.search,
      registrationStatus: filters.registration_status,
      status: filters.status,
      sortBy: filters.sortBy ?? 'name',
      sortOrder: filters.sortOrder ?? 'asc',
    },
  })

  return { success: true, data, meta } as UsersResponse
}

export interface BranchOptionDirect {
  value: string
  label: string
}

/**
 * Branch list, direct from Frappe (tier 1). The bridge endpoint is a pure
 * proxy that maps Branch.name → {value, label}; here we do the same under the
 * user's session, no API key, no hop.
 */
export async function fetchFrappeBranchesDirect(): Promise<BranchOptionDirect[]> {
  const url =
    `${frappeOrigin()}/api/resource/Branch` +
    `?fields=${encodeURIComponent('["name"]')}` +
    `&limit_page_length=0`
  const res = await fetch(url, {
    credentials: 'include',
    headers: { Accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`Frappe Branch fetch failed: HTTP ${res.status}`)
  const json = await res.json()
  return (json.data || []).map((b: any) => ({ value: b.name, label: b.name }))
}
