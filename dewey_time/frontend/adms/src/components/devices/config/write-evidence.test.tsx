import { test, expect, describe } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { WriteEvidence } from './write-evidence'
import type { OptionWriteRecord } from '@/services/device-service'

const REC: OptionWriteRecord = {
  id: 1, device_sn: 'A', key: 'VOLUME', desired_value: '50', observed_value: '50',
  status: 'applied', is_canary: true, error_code: null,
  created_at: '2026-08-06T14:22:00Z', resolved_at: '2026-08-06T14:22:13Z',
}

describe('WriteEvidence', () => {
  test('says nothing has been written rather than showing an empty box', () => {
    const html = renderToStaticMarkup(<WriteEvidence records={[]} loading={false} error={null} />)
    expect(html).toMatch(/never been written/i)
  })

  test('a failed read does not render as "never written"', () => {
    // The two are indistinguishable to an operator, and one of them sends them
    // to re-run an experiment that already has an answer.
    const html = renderToStaticMarkup(
      <WriteEvidence records={[]} loading={false} error={new Error('boom')} />
    )
    expect(html).not.toMatch(/never been written/i)
    expect(html).toMatch(/could not load/i)
  })

  test('shows the outcome and how long the terminal took', () => {
    const html = renderToStaticMarkup(<WriteEvidence records={[REC]} loading={false} error={null} />)
    expect(html).toContain('13s')
    expect(html).toMatch(/applied/)
  })

  test('an unresolved write shows no duration', () => {
    const html = renderToStaticMarkup(
      <WriteEvidence records={[{ ...REC, status: 'pending', resolved_at: null }]}
        loading={false} error={null} />
    )
    expect(html).not.toMatch(/\d+s</)
  })

  test('a trail under the bound makes no claim about completeness', () => {
    const html = renderToStaticMarkup(<WriteEvidence records={[REC]} loading={false} error={null} />)
    expect(html).not.toMatch(/incomplete/i)
  })

  test('a trail one record short of the bound still makes no claim about completeness', () => {
    // Pins the boundary itself, not just "more than one record" — a
    // `records.length >= 2` check would satisfy the two-vs-fifty test above
    // without actually reading the real bound.
    const records = Array.from({ length: 49 }, (_, i) => ({ ...REC, id: i + 1 }))
    const html = renderToStaticMarkup(<WriteEvidence records={records} loading={false} error={null} />)
    expect(html).not.toMatch(/incomplete/i)
  })

  test('a trail at the bound says it may be incomplete, not that it is the full history', () => {
    // The endpoint gives no truncation signal, so exactly 50 rows is
    // indistinguishable from "the history was cut" — the panel must not claim
    // completeness it has not established.
    const records = Array.from({ length: 50 }, (_, i) => ({ ...REC, id: i + 1 }))
    const html = renderToStaticMarkup(<WriteEvidence records={records} loading={false} error={null} />)
    expect(html).toMatch(/may be incomplete/i)
  })
})
