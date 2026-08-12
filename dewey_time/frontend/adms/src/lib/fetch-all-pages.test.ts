import { test, expect, describe } from 'vitest'
import { fetchAllPages, SUPABASE_PAGE_SIZE } from './fetch-all-pages'

/** A fake pager over a known array, recording the ranges it was asked for. */
function pagerOver(total: number) {
  const calls: [number, number][] = []
  const rows = Array.from({ length: total }, (_, i) => ({ id: i }))
  return {
    calls,
    fetchPage: async (from: number, to: number) => {
      calls.push([from, to])
      return rows.slice(from, to + 1)
    },
  }
}

describe('fetchAllPages', () => {
  test('returns rows past the first page instead of silently stopping at the cap', () => {
    // THE BUG. `useSyncStatus` selected every user_device_sync_status row with
    // no range, so PostgREST applied its 1000-row default and returned 1000 of
    // the 1056 that existed (264 users x 4 devices). The device dialog filtered
    // that truncated set client-side and reported "Users (244)" for a terminal
    // holding 264 — while synced+syncing, which come from the server summary,
    // still totalled 264. Twenty users were invisible, and the gap grows with
    // every device added.
    const { fetchPage } = pagerOver(1056)
    return fetchAllPages(fetchPage, 1000).then((all) => {
      expect(all).toHaveLength(1056)
    })
  })

  test('asks for consecutive, non-overlapping ranges', async () => {
    const { fetchPage, calls } = pagerOver(1056)
    await fetchAllPages(fetchPage, 1000)
    expect(calls).toEqual([
      [0, 999],
      [1000, 1999],
    ])
  })

  test('stops on a short page without an extra request', async () => {
    const { fetchPage, calls } = pagerOver(150)
    const all = await fetchAllPages(fetchPage, 1000)
    expect(all).toHaveLength(150)
    expect(calls).toHaveLength(1)
  })

  test('terminates when the total is an exact multiple of the page size', async () => {
    // The boundary that hangs a naive `while (rows.length === pageSize)` loop
    // written without an empty-page guard: page 1 is full, page 2 is empty.
    const { fetchPage, calls } = pagerOver(2000)
    const all = await fetchAllPages(fetchPage, 1000)
    expect(all).toHaveLength(2000)
    expect(calls).toHaveLength(3)
  })

  test('an empty table costs exactly one request and returns nothing', async () => {
    const { fetchPage, calls } = pagerOver(0)
    const all = await fetchAllPages(fetchPage, 1000)
    expect(all).toEqual([])
    expect(calls).toHaveLength(1)
  })

  test('a pager that never runs dry is bounded rather than looping forever', async () => {
    // Defensive: if the server ignored `range` and kept returning full pages,
    // an unbounded loop would spin until the tab died. The cap turns that into
    // a bad result instead of a hung dashboard.
    let calls = 0
    const alwaysFull = async () => {
      calls++
      return Array.from({ length: 10 }, (_, i) => ({ id: i }))
    }
    await fetchAllPages(alwaysFull, 10)
    expect(calls).toBeLessThan(1000)
  })

  test('the default page size matches the PostgREST cap this exists to defeat', () => {
    expect(SUPABASE_PAGE_SIZE).toBe(1000)
  })
})
