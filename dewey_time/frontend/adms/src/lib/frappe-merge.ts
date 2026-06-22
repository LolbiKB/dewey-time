// CANONICAL SOURCE: zkteco-adms-bridg gcr-fastify/src/lib/frappe-merge.ts — keep identical (cross-repo).
// The beta shadow-compare surfaces any drift between this and the bridge.
/**
 * Pure Frappe-Employee ↔ bridge-user merge.
 *
 * This is the single source of truth for the employee-list view that both the
 * bridge (`GET /admin/frappe-employees`) and the embedded dashboard's
 * direct-read beta path use. It is intentionally **pure**: no DB writes, no
 * env reads, no network. The two server-only side effects of the old inline
 * merge are lifted out —
 *   • PIN-row healing → returned as `pinHealUpdates` for the caller to persist
 *   • compromised detection → driven by the caller-supplied `missingInFrappeIds`
 *     (bridge user ids whose Frappe employee no longer exists; the rename→device
 *     re-sync side effect stays in the caller's refreshIdentityCache)
 *
 * Keep this file identical to the dashboard copy (dashboard/src/lib/frappe-merge.ts);
 * the beta shadow-compare will surface any drift.
 */
import { computePhotoCacheStatus } from '@/lib/photo-cache-status'

export interface FrappeEmployeeRaw {
  name: string
  employee?: string
  employee_name?: string
  department?: string | null
  status?: string | null
  attendance_device_id?: string | null
  image?: string | null
  modified?: string | null
}

export interface MergeFilters {
  page: number
  limit: number
  search?: string
  registrationStatus?: string
  status?: string
  sortBy: string
  sortOrder: string
}

export interface MergeInput {
  frappeEmployees: FrappeEmployeeRaw[]
  /** Supabase users rows, each with `user_biometrics(type, finger_id)` + photo fields. */
  bridgeUsers: any[]
  /** Bridge user ids whose Frappe employee is gone (deleted in HR) → compromised. */
  missingInFrappeIds: Set<string>
  frappeUrl: string
  supabaseUrl: string
  filters: MergeFilters
}

export interface MergeMeta {
  total: number
  page: number
  limit: number
  totalPages: number
  hasNext: boolean
  hasPrev: boolean
}

export interface MergeResult {
  data: any[]
  meta: MergeMeta
  /** PIN-matched bridge rows missing frappe_employee_id — caller persists these. */
  pinHealUpdates: { id: string; frappe_employee_id: string }[]
}

function biometricCounts(bridgeUser: any) {
  const biometrics = bridgeUser.user_biometrics || []
  const fingerprintCount = biometrics.filter((b: any) => b.type === 'fingerprint').length
  const faceCount = biometrics.filter((b: any) => b.type === 'face').length
  return { fingerprintCount, faceCount }
}

export function mergeFrappeEmployees(input: MergeInput): MergeResult {
  const { frappeEmployees, bridgeUsers, missingInFrappeIds, frappeUrl, supabaseUrl, filters } = input
  const { page, limit, search, registrationStatus, status, sortBy, sortOrder } = filters
  const pinHealUpdates: { id: string; frappe_employee_id: string }[] = []

  // Enrich bridge users + build lookup maps (by employee id, by PIN).
  const bridgeUserByEmployeeId = new Map<string, any>()
  const bridgeUserByPin = new Map<string, any>()

  bridgeUsers?.forEach((user: any) => {
    const { fingerprintCount, faceCount } = biometricCounts(user)
    const enrichedUser = {
      ...user,
      fingerprint_count: fingerprintCount,
      face_count: faceCount,
      has_fingerprint: fingerprintCount > 0,
      has_face: faceCount > 0,
    }
    if (user.frappe_employee_id) {
      bridgeUserByEmployeeId.set(user.frappe_employee_id, enrichedUser)
    }
    if (user.pin != null && user.pin !== '') {
      const pinKey = String(user.pin)
      bridgeUserByPin.set(pinKey, enrichedUser)
      if (pinKey !== user.pin) {
        bridgeUserByPin.set(user.pin, enrichedUser)
      }
    }
  })

  // Merge Frappe employees with bridge users.
  const mergedEmployees = frappeEmployees.map((emp: any) => {
    const employeeId = emp.name
    const pin = emp.attendance_device_id

    let photoUrl: string | null = null
    if (emp.image) {
      photoUrl = emp.image.startsWith('/') ? `${frappeUrl}${emp.image}` : emp.image
    }

    let bridgeUser = bridgeUserByEmployeeId.get(employeeId)
    if (!bridgeUser && pin != null && pin !== '') {
      bridgeUser = bridgeUserByPin.get(String(pin)) ?? bridgeUserByPin.get(pin)
    }

    if (bridgeUser) {
      // Heal PIN-only bridge rows: collect the write for the caller, and treat
      // it as healed in this view.
      if (!bridgeUser.frappe_employee_id && employeeId) {
        pinHealUpdates.push({ id: bridgeUser.id, frappe_employee_id: employeeId })
        bridgeUser.frappe_employee_id = employeeId
      }

      const cachedPhotoUrl = bridgeUser.photo_storage_path
        ? `${supabaseUrl}/storage/v1/object/public/user-photos/${bridgeUser.photo_storage_path}`
        : null

      const photo_cache_status = computePhotoCacheStatus({
        frappeImage: emp.image,
        frappeModified: emp.modified,
        photoStoragePath: bridgeUser.photo_storage_path,
        storedFrappeImagePath: bridgeUser.frappe_image_path,
        storedFrappeImageModifiedAt: bridgeUser.frappe_image_modified_at,
      })

      return {
        id: bridgeUser.id,
        frappe_employee_id: employeeId,
        name: emp.employee_name,
        photo_url: cachedPhotoUrl || photoUrl,
        photo_storage_path: bridgeUser.photo_storage_path,
        photo_cache_status,
        frappe_image_path: bridgeUser.frappe_image_path,
        photo_synced_at: bridgeUser.photo_synced_at,
        pin: bridgeUser.pin,
        card_number: bridgeUser.card_number,
        privilege: bridgeUser.privilege,
        status: bridgeUser.status,
        department: emp.department,
        frappe_status: emp.status,
        is_registered: true,
        has_fingerprint: bridgeUser.has_fingerprint,
        has_face: bridgeUser.has_face,
        fingerprint_count: bridgeUser.fingerprint_count,
        face_count: bridgeUser.face_count,
        created_at: bridgeUser.created_at,
        updated_at: bridgeUser.updated_at,
      }
    }

    const photo_cache_status = computePhotoCacheStatus({
      frappeImage: emp.image,
      frappeModified: emp.modified,
      photoStoragePath: null,
      storedFrappeImagePath: null,
      storedFrappeImageModifiedAt: null,
    })
    return {
      id: null,
      frappe_employee_id: employeeId,
      name: emp.employee_name,
      photo_url: photoUrl,
      photo_cache_status,
      pin: pin || null,
      card_number: null,
      privilege: null,
      department: emp.department,
      frappe_status: emp.status,
      is_registered: false,
      has_fingerprint: false,
      has_face: false,
      fingerprint_count: 0,
      face_count: 0,
      created_at: null,
      updated_at: null,
    }
  })

  // Bridge-only users (e.g. device admin) — not in the Frappe Employee list.
  const mergedFrappeIds = new Set(
    mergedEmployees.map((e: { frappe_employee_id?: string }) => e.frappe_employee_id).filter(Boolean)
  )
  const bridgeOnlyUsers = (bridgeUsers || [])
    .filter((u: any) => u.is_device_admin || (!u.frappe_employee_id && u.id))
    .filter((u: any) => !u.frappe_employee_id || !mergedFrappeIds.has(u.frappe_employee_id))
    .map((bridgeUser: any) => {
      const { fingerprintCount, faceCount } = biometricCounts(bridgeUser)
      return {
        id: bridgeUser.id,
        frappe_employee_id: bridgeUser.frappe_employee_id ?? null,
        name: bridgeUser.name,
        photo_url: null,
        photo_storage_path: bridgeUser.photo_storage_path,
        photo_cache_status: 'none',
        pin: bridgeUser.pin,
        card_number: bridgeUser.card_number,
        privilege: bridgeUser.privilege,
        status: bridgeUser.status,
        department: null,
        frappe_status: null,
        is_registered: true,
        is_device_admin: !!bridgeUser.is_device_admin,
        has_fingerprint: fingerprintCount > 0,
        has_face: faceCount > 0,
        fingerprint_count: fingerprintCount,
        face_count: faceCount,
        created_at: bridgeUser.created_at,
        updated_at: bridgeUser.updated_at,
      }
    })

  // Derived compromised: bridge users whose Frappe employee no longer exists.
  const compromisedRows = (bridgeUsers || [])
    .filter((u: any) => missingInFrappeIds.has(u.id))
    .map((bridgeUser: any) => {
      const { fingerprintCount, faceCount } = biometricCounts(bridgeUser)
      return {
        id: bridgeUser.id,
        frappe_employee_id: bridgeUser.frappe_employee_id,
        name: bridgeUser.name,
        photo_url: null,
        photo_storage_path: bridgeUser.photo_storage_path,
        photo_cache_status: 'none',
        pin: bridgeUser.pin,
        card_number: bridgeUser.card_number,
        privilege: bridgeUser.privilege,
        status: 'compromised',
        department: null,
        frappe_status: null,
        is_registered: true,
        is_device_admin: false,
        has_fingerprint: fingerprintCount > 0,
        has_face: faceCount > 0,
        fingerprint_count: fingerprintCount,
        face_count: faceCount,
        created_at: bridgeUser.created_at,
        updated_at: bridgeUser.updated_at,
      }
    })

  const allRows = [...bridgeOnlyUsers, ...compromisedRows, ...mergedEmployees]

  // Search filter.
  let filteredEmployees = allRows
  if (search) {
    const searchLower = search.toLowerCase()
    filteredEmployees = allRows.filter((emp: any) =>
      emp.name?.toLowerCase().includes(searchLower) ||
      emp.frappe_employee_id?.toLowerCase().includes(searchLower) ||
      String(emp.pin ?? '').includes(search)
    )
  }

  // Registration status filter.
  if (registrationStatus === 'registered') {
    filteredEmployees = filteredEmployees.filter((emp: any) => emp.is_registered)
  } else if (registrationStatus === 'unregistered') {
    filteredEmployees = filteredEmployees.filter((emp: any) => !emp.is_registered)
  } else if (registrationStatus === 'inactive') {
    filteredEmployees = filteredEmployees.filter((emp: any) => emp.is_registered && emp.status === 'inactive')
  }

  // ADMS status filter (registered users only).
  if (status && ['active', 'inactive', 'compromised', 'archived'].includes(status)) {
    filteredEmployees = filteredEmployees.filter((emp: any) => emp.is_registered && emp.status === status)
  }

  // Sort.
  const SORTABLE_FIELDS: Record<string, (a: any, b: any) => number> = {
    name: (a, b) => (a.name || '').localeCompare(b.name || ''),
    pin: (a, b) => (parseInt(a.pin ?? '0', 10) || 0) - (parseInt(b.pin ?? '0', 10) || 0),
    status: (a, b) => (a.status || '').localeCompare(b.status || ''),
    department: (a, b) => (a.department || '').localeCompare(b.department || ''),
    created_at: (a, b) => (a.created_at || '').localeCompare(b.created_at || ''),
    updated_at: (a, b) => (a.updated_at || '').localeCompare(b.updated_at || ''),
  }
  const comparator = SORTABLE_FIELDS[sortBy] || SORTABLE_FIELDS.name
  filteredEmployees = [...filteredEmployees].sort((a, b) =>
    sortOrder === 'desc' ? comparator(b, a) : comparator(a, b)
  )

  // Paginate.
  const total = filteredEmployees.length
  const totalPages = total === 0 ? 0 : Math.ceil(total / limit)
  const startIndex = (page - 1) * limit
  const paginatedEmployees = filteredEmployees.slice(startIndex, startIndex + limit)

  return {
    data: paginatedEmployees,
    meta: {
      total,
      page,
      limit,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1,
    },
    pinHealUpdates,
  }
}
