/**
 * Column allowlists for direct Supabase reads made from the BROWSER.
 *
 * The dashboard reads several tables directly with the anon key, which bypasses
 * every projection the bridge applies server-side — stripUserSecrets, the F-043
 * device projection, and the biometric column allowlist in
 * handleAdminUserBiometrics. A `select('*')` therefore handed secrets to every
 * admin's browser and left them sitting in the React Query cache (and in any
 * devtools or HAR capture).
 *
 * Never add to these lists:
 *   devices.comm_key              — device authentication secret
 *   user_biometrics.template_data — raw fingerprint/face templates
 *   users.device_menu_password    — device LCD admin secret
 *
 * These are single literal strings with `as const` on purpose: supabase-js
 * infers the row type from the literal passed to .select(), so a computed
 * string (e.g. an array .join()) degrades `data` to GenericStringError and
 * silently costs the whole file its type-checking.
 */

export const DEVICE_PUBLIC_COLUMNS =
  'serial_number, name, location, last_seen, is_master, is_registrar, registrar_capabilities, attlog_stamp, operlog_stamp, fp_algorithm_version, face_algorithm_version, timezone, total_users, last_verified_at, reported_user_count, reported_fp_count, reported_face_count, reported_at, stats_drift_detected, stats_drift_details, attlog_last_closed_date, attlog_time_drift_suspected, attlog_closure_last_tick_at, attlog_last_device_purge_at, frappe_retry_last_tick_at, frappe_sync_last_tick_at, connection_status, created_at, registration_data' as const

export const BIOMETRIC_METADATA_COLUMNS =
  'id, user_id, type, finger_id, template_size, enrolled_at, enrolled_device_sn, format, major_ver, minor_ver' as const
