/**
 * Read every row of a table, not just the first page.
 *
 * PostgREST caps an unbounded `select()` at 1000 rows and says nothing about
 * it — no error, no flag, just a short array. `useSyncStatus` selected all of
 * `user_device_sync_status` that way; once the fleet crossed 1000 rows (264
 * users x 4 devices = 1056) it started receiving 1000 and dropping 56. The
 * device dialog filtered that truncated set client-side and reported
 * "Users (244)" for a terminal holding 264, while synced+syncing — which come
 * from the server-side summary — still added up to 264.
 *
 * The failure scales with users x devices, so it gets worse quietly: adding a
 * fifth terminal would hide 320 rows instead of 56.
 *
 * Callers MUST paginate over a stable, unique sort key (the table's primary
 * key). Without a deterministic order, PostgREST is free to return rows in a
 * different order per request, and consecutive ranges can then skip and
 * duplicate rows rather than tile the table.
 */

/** PostgREST's default `max-rows`, which is the cap this exists to defeat. */
export const SUPABASE_PAGE_SIZE = 1000

/**
 * Hard stop on the number of requests. If the server ignored `range` and kept
 * returning full pages, an unbounded loop would spin until the tab died; this
 * turns that into a bad result rather than a hung dashboard.
 */
const MAX_PAGES = 100

export async function fetchAllPages<T>(
  fetchPage: (from: number, to: number) => Promise<T[]>,
  pageSize: number = SUPABASE_PAGE_SIZE
): Promise<T[]> {
  const all: T[] = []
  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * pageSize
    const rows = await fetchPage(from, from + pageSize - 1)
    all.push(...rows)
    // A short page is the last page. An EMPTY page also ends it — without that
    // guard a total that is an exact multiple of pageSize never terminates on
    // the short-page test alone.
    if (rows.length < pageSize) break
  }
  return all
}
