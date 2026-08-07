import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertCircle, AlertTriangle, RefreshCw } from 'lucide-react'
import { Page, PageHeader } from '@lolbikb/dewey-ui'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { QueryErrorCard } from '@/components/shared/query-error-card'
import { DeviceService, type DeviceOptionEntry, type OptionKeyState } from '@/services/device-service'
import { useDevices } from '@/hooks/use-core-data'
import { policyRefetchInterval, WATCH_WINDOW_MS } from '@/lib/device-option-polling'
import { buildOptionMatrix, deviceLabel } from '@/lib/device-option-matrix'
import { buildKeyPlan } from '@/lib/device-option-plan'
import {
  CURATED_SETTINGS,
  curatedLabel,
  parseSelection,
  type Selection,
} from '@/lib/device-option-catalogue'
import { signalAlert } from '@/lib/signal'
import { cn } from '@/lib/utils'
import { SettingList } from '@/components/devices/config/setting-list'
import { SettingDetail } from '@/components/devices/config/setting-detail'
import { DriftReport } from '@/components/devices/config/drift-report'
import { AllKeysReference } from '@/components/devices/config/all-keys-reference'
import {
  settingListEntries,
  uncuratedDriftRows,
} from '@/components/devices/config/setting-list-entries'
import {
  applyNote,
  overrideClearedNote,
  overrideStoredNote,
  rereadNote,
  standardStoredNote,
} from '@/components/devices/config/fleet-action-note'
import { splitSilentTerminals } from '@/components/devices/config/silent-terminals'
import { policyAvailability } from '@/components/devices/config/policy-availability'

/**
 * Fleet configuration — CONFIGURE FIRST, with drift kept first-class.
 *
 * Master–detail, not a grid. A settings-by-devices matrix gets WIDER with every
 * terminal, so the handful of settings that actually differ end up off-screen
 * among seventy that do not; and it answers "are they the same?" while the job
 * is usually "make them the same". The left rail is the five settings this
 * fleet is actually configured through plus two reference views; the right pane
 * is one setting at a time — its one value, what each terminal reports, and the
 * evidence trail behind it.
 *
 * The selection lives in the URL (`?key=` / `?view=`) because the page re-reads
 * itself every 5s while a write is outstanding, and a reload or a shared link
 * must not lose the operator's place.
 *
 * Every claim on this page is bounded by what was actually observed:
 *   - A FAILED QUERY is never rendered as a fact about the hardware. An empty
 *     fleet and an outage are different sentences.
 *   - A QUEUED command is never called "applied" or "refreshed" — the terminal
 *     has not been asked yet; it collects the command on its next poll.
 *   - The number in an apply result is the SERVER's, never the page's preview.
 */

/** Matches the bridge's MAX_DEVICE_OPTIONS_PAGE. */
const OPTIONS_PAGE_LIMIT = 500

/** How many terminals to name in a banner before summarising the rest. */
const MAX_NAMED_SILENT = 4

export function DeviceConfig() {
  const [searchParams, setSearchParams] = useSearchParams()
  const selection = parseSelection(searchParams.get('key'), searchParams.get('view'))
  const selectedKey = selection.kind === 'key' ? selection.key : null
  // `replace` so a session of clicking through settings does not fill the back
  // button with them — the URL is here to survive a reload, not to be history.
  const select = (s: Selection) =>
    setSearchParams(s.kind === 'key' ? { key: s.key } : { view: s.kind }, { replace: true })

  const devicesQuery = useDevices({ limit: 200 })
  const devices = useMemo(
    () =>
      (devicesQuery.data?.devices ?? []).filter(
        (d: { connection_status?: string }) => d.connection_status === 'approved'
      ),
    [devicesQuery.data]
  )
  const deviceSns: string[] = useMemo(
    () => devices.map((d: { serial_number: string }) => d.serial_number).sort(),
    [devices]
  )
  const label = useMemo(() => (sn: string) => deviceLabel(sn, devices), [devices])

  // The two reference views' expansion and filter state lives HERE, not inside
  // them: this suite renders with `renderToStaticMarkup` and cannot click a row
  // open, so state held internally would be unreachable by any test — which is
  // exactly how a bug shipped in the all-keys reference once already. Separate
  // filters per view, because a filter typed against one view's rows would be
  // a surprise when it silently applied to the other's.
  const [expandedTerminal, setExpandedTerminal] = useState<string | null>(null)
  const [driftSearch, setDriftSearch] = useState('')
  const [openKey, setOpenKey] = useState<string | null>(null)
  const [referenceSearch, setReferenceSearch] = useState('')

  // Set when a write is queued to HARDWARE, so a fleet apply — whose writes are
  // not canaries and raise no flag — is also watched to completion.
  const [watchUntil, setWatchUntil] = useState<number | null>(null)

  const policyQuery = useQuery({
    queryKey: ['device-option-policy'],
    queryFn: () => DeviceService.getOptionPolicy(),
    // A write resolves ASYNCHRONOUSLY, on the device's terms — the verdict only
    // exists once the terminal has polled, run all three commands, and its INFO
    // has come back. Refetching once on mutation success looked at the single
    // worst moment: the write is still `pending` then, so the ladder reports the
    // PREVIOUS verdict and the page sits frozen on it while the real answer
    // arrives seconds later.
    refetchInterval: (query) =>
      policyRefetchInterval(query.state.data?.keys, watchUntil, Date.now()),
  })
  const pollInterval = policyRefetchInterval(policyQuery.data?.keys, watchUntil, Date.now())

  // PER DEVICE, not one fleet-wide call. A single bounded query truncates once
  // the fleet outgrows it — ten terminals at ~78 keys is 780 rows against a 500
  // cap — and a cut key looks absent everywhere, which reads as drift that is
  // not real. Per-device queries stay far under the bound however large the
  // fleet gets, and React Query caches each separately.
  const optionQueries = useQueries({
    queries: deviceSns.map((sn) => ({
      queryKey: ['device-options', sn],
      queryFn: () => DeviceService.getDeviceOptions(sn),
      // Kept in step with the policy query: when a write lands, the terminal's
      // reported value is what proves it, so a stale grid beside a fresh ladder
      // is two panels disagreeing about the same device.
      refetchInterval: pollInterval,
    })),
  })

  // The write ledger is per-KEY, so it is fetched only while a key is on
  // screen: one trail, whatever the fleet size.
  const writesQuery = useQuery({
    queryKey: ['device-option-writes', selectedKey],
    queryFn: () => DeviceService.getKeyWrites(selectedKey as string),
    enabled: selectedKey != null,
    refetchInterval: pollInterval,
  })

  const optionsLoading = optionQueries.some((q) => q.isLoading)
  // The policy query counts too: without it the first render claims "No fleet
  // standard yet" for a key whose standard is merely still in flight.
  const loading = devicesQuery.isLoading || optionsLoading || policyQuery.isLoading
  const stamp = optionQueries.map((q) => q.dataUpdatedAt).join(',')
  const entries: DeviceOptionEntry[] = useMemo(
    () => optionQueries.flatMap((q) => q.data ?? []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stamp]
  )
  const truncated = optionQueries.some((q) => (q.data?.length ?? 0) >= OPTIONS_PAGE_LIMIT)

  const desired = useMemo(() => policyQuery.data?.desired ?? [], [policyQuery.data])
  const keyState = useMemo(() => {
    const map = new Map<string, OptionKeyState>()
    for (const k of policyQuery.data?.keys ?? []) map.set(k.key, k)
    return map
  }, [policyQuery.data])

  const matrix = useMemo(() => buildOptionMatrix(entries, deviceSns), [entries, deviceSns])
  const listEntries = useMemo(
    () => settingListEntries(matrix.rows, matrix.reportingDevices),
    [matrix.rows, matrix.reportingDevices]
  )
  const driftRows = useMemo(() => uncuratedDriftRows(matrix.rows), [matrix.rows])
  const plan = useMemo(
    () => (selectedKey ? buildKeyPlan(selectedKey, desired, entries, deviceSns) : null),
    [selectedKey, desired, entries, deviceSns]
  )

  const queryClient = useQueryClient()
  /**
   * Invalidate the DEVICE rows and the write trail as well as the policy.
   *
   * A write does not land until the terminal next polls, so no cache is correct
   * at this moment — but leaving the option rows stale is what makes the drift
   * view disagree with the ladder, and an operator reading two panels that
   * contradict each other trusts neither.
   */
  const invalidateFleet = () => {
    void queryClient.invalidateQueries({ queryKey: ['device-option-policy'] })
    void queryClient.invalidateQueries({ queryKey: ['device-option-writes'] })
    for (const sn of deviceSns) {
      void queryClient.invalidateQueries({ queryKey: ['device-options', sn] })
    }
  }
  /**
   * For actions that queue a command to a TERMINAL, which then resolve on the
   * device's terms. Storing a desired value does not: it is server-side state,
   * complete the moment the request returns, so it invalidates without arming a
   * thirty-minute 5s poll for hardware work that was never queued.
   */
  const watchQueuedWrite = () => {
    setWatchUntil(Date.now() + WATCH_WINDOW_MS)
    invalidateFleet()
  }

  const [actionError, setActionError] = useState<string | null>(null)
  const [actionNote, setActionNote] = useState<string | null>(null)
  const clearBanners = () => {
    setActionError(null)
    setActionNote(null)
  }

  const setStandardMutation = useMutation({
    mutationFn: ({ key, value }: { key: string; value: string }) =>
      DeviceService.setFleetOption(key, value),
    onMutate: clearBanners,
    onSuccess: (_data, vars) => {
      // Saving a value is not writing it. Nothing has been sent to a terminal.
      setActionNote(standardStoredNote(vars.key, vars.value))
      invalidateFleet()
    },
    onError: (e: Error) => setActionError(e.message),
  })

  const overrideMutation = useMutation({
    mutationFn: ({ key, sn, value }: { key: string; sn: string; value: string }) =>
      DeviceService.setDeviceOption(sn, key, value),
    onMutate: clearBanners,
    onSuccess: (_data, vars) => {
      setActionNote(overrideStoredNote(vars.key, label(vars.sn), vars.value))
      invalidateFleet()
    },
    onError: (e: Error) => setActionError(e.message),
  })

  const clearOverrideMutation = useMutation({
    mutationFn: ({ key, sn }: { key: string; sn: string }) =>
      DeviceService.clearDeviceOption(sn, key),
    onMutate: clearBanners,
    onSuccess: (_data, vars) => {
      setActionNote(overrideClearedNote(vars.key, label(vars.sn)))
      invalidateFleet()
    },
    onError: (e: Error) => setActionError(e.message),
  })

  const canaryMutation = useMutation({
    mutationFn: ({ key, sn, value }: { key: string; sn: string; value: string }) =>
      DeviceService.canaryOption(key, sn, value),
    onMutate: clearBanners,
    onSuccess: (_data, vars) => {
      // "Queued", never "applied". The terminal has not been asked yet.
      setActionNote(
        `${vars.key} queued for ${label(vars.sn)} — it applies when that terminal next polls.`
      )
      watchQueuedWrite()
    },
    onError: (e: Error) => setActionError(e.message),
  })

  const applyMutation = useMutation({
    mutationFn: (key: string) => DeviceService.applyOption(key),
    onMutate: clearBanners,
    onSuccess: (result, key) => {
      // The SERVER's count, not `plan.targetCount` — that one is a preview.
      setActionNote(applyNote(key, result))
      watchQueuedWrite()
    },
    onError: (e: Error) => setActionError(e.message),
  })

  const [rereading, setRereading] = useState(false)
  /**
   * Ask every approved terminal to report its configuration.
   *
   * `allSettled`, not `all`: one unreachable terminal must not cancel the rest,
   * and the ones that failed are NAMED — "3 of 4" leaves the operator to work
   * out which box is missing from a column of near-identical serials.
   */
  const rereadAll = async () => {
    setRereading(true)
    clearBanners()
    try {
      const settled = await Promise.allSettled(
        deviceSns.map((sn) => DeviceService.refreshDeviceOptions(sn))
      )
      const outcomes = deviceSns.map((deviceSn, i) => ({
        deviceSn,
        queued: settled[i].status === 'fulfilled',
      }))
      const note = rereadNote(outcomes, label)
      if (outcomes.some((o) => !o.queued)) setActionError(note)
      else setActionNote(note)
      // An INFO is outstanding on real hardware, so watch for the answer — the
      // values only change once each terminal has polled and replied.
      if (outcomes.some((o) => o.queued)) watchQueuedWrite()
    } finally {
      // `allSettled` cannot reject, but a synchronous throw before it would
      // otherwise strand the button disabled with no way back but a reload.
      setRereading(false)
    }
  }

  const pendingKey = canaryMutation.isPending
    ? canaryMutation.variables?.key
    : applyMutation.isPending
      ? applyMutation.variables
      : undefined

  const optionsError = optionQueries.find((q) => q.isError)?.error as Error | undefined
  const loadedNothing = optionQueries.every((q) => !q.data?.length)
  const fleetUnreadable = (devicesQuery.isError || optionsError !== undefined) && loadedNothing
  /**
   * The STORED side of the page is a separate read from the observed side.
   *
   * A failed policy query leaves `desired` empty and the ladder blank, and
   * every claim built on that inverts: "No fleet standard yet — save one
   * first" invites overwriting a standard the operator could not see. It does
   * NOT blank the whole page, though — the drift and reference views are built
   * from the option rows alone and remain entirely true. See
   * policy-availability.ts.
   */
  const policyState = policyAvailability({
    loading: policyQuery.isLoading,
    failed: policyQuery.isError,
    hasData: policyQuery.data != null,
  })
  const refetchAll = () => {
    void devicesQuery.refetch()
    void policyQuery.refetch()
    for (const q of optionQueries) void q.refetch()
  }

  const header = (
    <PageHeader
      title="Fleet Configuration"
      // Never a fleet size the page does not have. While loading that is
      // "Loading…"; when nothing could be loaded it is nothing at all, because
      // "0 keys reported" would be a claim about terminals that were never
      // successfully read. The card below says what actually happened.
      description={
        fleetUnreadable
          ? undefined
          : loading
            ? 'Loading…'
            : `${deviceSns.length} terminal${deviceSns.length === 1 ? '' : 's'} · ${matrix.rows.length} keys reported`
      }
      actions={
        <Button
          size="sm"
          variant="outline"
          onClick={() => void rereadAll()}
          disabled={rereading || loading}
        >
          <RefreshCw className={cn('mr-1.5 h-3.5 w-3.5', rereading && 'animate-spin')} />
          Re-read all terminals
        </Button>
      }
    />
  )

  // Nothing loaded AND something failed: an outage must not render as a fleet
  // that has reported nothing. That was the defect — an options fetch that
  // errored left the matrix empty and the page then stated "No terminal has
  // reported its configuration yet", which is a claim about the hardware.
  //
  // The frame stays: the header keeps the page inset and, more to the point,
  // keeps "Re-read all terminals" reachable, so the card's own retry is not the
  // operator's only way out.
  if (fleetUnreadable) {
    return (
      <Page className="min-h-0">
        {header}
        <QueryErrorCard
          title="Could not load fleet configuration"
          error={devicesQuery.error ?? optionsError}
          onRetry={refetchAll}
        />
      </Page>
    )
  }

  /**
   * A terminal missing from the comparison for two very different reasons.
   *
   * `matrix.silentDevices` cannot tell "reported nothing" from "we could not
   * read it" — and with per-device queries the second is the ordinary partial
   * failure. Naming them in one sentence would send an operator to check a
   * healthy box's poll schedule for what is an outage on this side of the
   * wire. See silent-terminals.ts.
   */
  const { silent, unreadable } = splitSilentTerminals(
    matrix.silentDevices,
    deviceSns.map((deviceSn, i) => ({
      deviceSn,
      failed: optionQueries[i]?.isError ?? false,
      rowCount: optionQueries[i]?.data?.length ?? 0,
    }))
  )
  const nameSome = (sns: string[]) => {
    const named = sns.slice(0, MAX_NAMED_SILENT).map(label)
    const extra = sns.length - named.length
    return `${named.join(', ')}${extra > 0 ? ` and ${extra} more` : ''}`
  }
  const keyLabel = selectedKey ? (curatedLabel(selectedKey) ?? selectedKey) : ''
  const keyHint = CURATED_SETTINGS.find((s) => s.key === selectedKey)?.hint ?? ''

  const detailPane = () => {
    // Nothing stored is in hand, so nothing about stored state may be stated —
    // not the standard, not the ladder, not the refusal reason. The whole pane
    // is built from those, so the pane says why instead of guessing.
    if (selectedKey && policyState === 'unavailable') {
      return (
        <QueryErrorCard
          title={`Could not load what is stored for ${selectedKey}`}
          error={policyQuery.error}
          onRetry={() => void policyQuery.refetch()}
        />
      )
    }

    if (selectedKey && plan) {
      const state = keyState.get(selectedKey)
      const standard = desired.find((d) => d.device_sn === null && d.key === selectedKey)
      return (
        // NOT keyed by `selectedKey`. This pane and its children reset their own
        // drafts in place when the key changes (see setting-detail.tsx); a
        // remount would throw that logic away and reintroduce the stale-draft
        // bug it was written for.
        <SettingDetail
          optionKey={selectedKey}
          label={keyLabel}
          hint={keyHint}
          plan={plan}
          status={state?.status ?? 'unproven'}
          canaryInFlight={state?.canaryInFlight ?? false}
          lastError={state?.lastError ?? null}
          updatedBy={standard?.updated_by ?? null}
          updatedAt={standard?.updated_at ?? null}
          devices={devices}
          writes={writesQuery.data ?? []}
          writesLoading={writesQuery.isLoading}
          writesError={(writesQuery.error as Error | null) ?? null}
          saving={
            setStandardMutation.isPending && setStandardMutation.variables?.key === selectedKey
          }
          pending={pendingKey === selectedKey}
          onSaveStandard={(value) => setStandardMutation.mutate({ key: selectedKey, value })}
          onOverride={(sn, value) => overrideMutation.mutate({ key: selectedKey, sn, value })}
          onClearOverride={(sn) => clearOverrideMutation.mutate({ key: selectedKey, sn })}
          onCanary={(sn, value) => canaryMutation.mutate({ key: selectedKey, sn, value })}
          onApply={() => applyMutation.mutate(selectedKey)}
        />
      )
    }

    if (selection.kind === 'drift') {
      // The guard the drift table cannot apply itself: with no rows at all it
      // would draw a bare "By terminal" header over a column of "Not reported",
      // which reads as a finding rather than as an absence of data.
      if (matrix.rows.length === 0) {
        return <EmptyState title="No terminal has reported its configuration yet" />
      }
      if (driftRows.length === 0) {
        return (
          <EmptyState
            title="Nothing outside the listed settings differs"
            description="Identity keys and live counters differ by nature and are not compared."
          />
        )
      }
      return (
        <DriftReport
          rows={driftRows}
          deviceSns={deviceSns}
          entries={entries}
          // The UNION — silent and unreadable together — deliberately, not the
          // split above. This prop only decides whether the "Off majority"
          // column says "Not reported" or a deviation count, and a terminal
          // whose read failed has no count that could be true: dropping it from
          // this list would render "—", which claims it matches the majority
          // everywhere. `unreadableDevices` is what tells the two APART, in the
          // column and in the row expansion, so neither says "has not reported"
          // about a terminal this page merely failed to load.
          silentDevices={matrix.silentDevices}
          unreadableDevices={unreadable}
          devices={devices}
          expanded={expandedTerminal}
          onExpand={setExpandedTerminal}
          search={driftSearch}
          onSearch={setDriftSearch}
        />
      )
    }

    return (
      <AllKeysReference
        rows={matrix.rows}
        reportingDevices={matrix.reportingDevices}
        search={referenceSearch}
        onSearch={setReferenceSearch}
        onConfigure={(key) => select({ kind: 'key', key })}
        open={openKey}
        onOpen={setOpenKey}
      />
    )
  }

  return (
    // <Page> is h-full flex-col, so the app's content inset does NOT scroll for
    // us. Header and banners stay put; the two panes scroll in their own
    // regions, so a page-level warning can never scroll away from the findings
    // it qualifies.
    <Page className="min-h-0">
      {header}

      {/* Rows are on screen but the latest fetch failed — say so rather than
          showing silently stale data as if it were current. */}
      {(devicesQuery.isError || optionsError || policyQuery.isError) && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Could not refresh fleet configuration</AlertTitle>
          <AlertDescription className="flex items-center justify-between">
            <span>
              Showing the values last loaded, which may no longer be what the terminals report or
              what is stored.{' '}
              {(devicesQuery.error ?? optionsError ?? policyQuery.error) instanceof Error
                ? ((devicesQuery.error ?? optionsError ?? policyQuery.error) as Error).message
                : 'An unknown error occurred'}
            </span>
            <Button
              variant="outline"
              size="sm"
              className="ml-4 bg-background hover:bg-background/80"
              onClick={refetchAll}
            >
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* Both banners are suppressed while loading: mid-load every terminal is
          silent, and saying so would be a statement about the hardware made
          from an incomplete read. */}
      {!loading && truncated && (
        <div className={cn('flex gap-2 rounded-lg border p-3 text-xs', signalAlert.danger)}>
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>
            A terminal reported more than {OPTIONS_PAGE_LIMIT} keys, so some are missing here. A key
            that was cut looks absent on every terminal, which reads as drift that may not be real —{' '}
            <strong>do not act on this view until it is resolved.</strong>
          </span>
        </div>
      )}

      {/* Only terminals whose read SUCCEEDED and came back empty. This sentence
          is a statement about the hardware, so it may only be made about a
          terminal the page actually heard from. */}
      {!loading && silent.length > 0 && (
        <div className={cn('rounded-lg border p-3 text-xs', signalAlert.attention)}>
          {silent.length} of {deviceSns.length} terminals have not reported yet ({nameSome(silent)}),
          so they are not compared. A terminal reports on approval, when a watched setting changes,
          and at least twice a day.
        </div>
      )}

      {/* The other reason a terminal is missing from the comparison, kept
          separate on purpose: this one is a fact about THIS PAGE, and the
          terminal may well have reported. */}
      {!loading && unreadable.length > 0 && (
        <div className={cn('flex gap-2 rounded-lg border p-3 text-xs', signalAlert.danger)}>
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>
            Could not load the configuration of {unreadable.length} terminal
            {unreadable.length === 1 ? '' : 's'} ({nameSome(unreadable)}), so{' '}
            {unreadable.length === 1 ? 'it is' : 'they are'} not compared here. That is this page
            failing to read {unreadable.length === 1 ? 'it' : 'them'}, not{' '}
            {unreadable.length === 1 ? 'a terminal' : 'the terminals'} failing to report — retry
            before drawing any conclusion about {unreadable.length === 1 ? 'it' : 'them'}.
          </span>
        </div>
      )}

      {/*
        The result of the last action, stated as what actually happened. A
        queued command is not an applied one, and the errors here include the
        two the bridge answers when a fleet apply could not compare anything at
        all (409, the value is withheld) or covers no approved terminal (400).
        Neither is success, and neither may render as one.
      */}
      {actionError && (
        <div className={cn('flex gap-2 rounded-lg border p-3 text-xs', signalAlert.danger)}>
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{actionError}</span>
        </div>
      )}
      {actionNote && !actionError && (
        <div className={cn('rounded-lg border p-3 text-xs', signalAlert.attention)}>
          {actionNote}
        </div>
      )}

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[17rem_minmax(0,1fr)]">
        <div className="min-h-0 overflow-y-auto rounded-xl border border-border">
          {loading ? (
            // The frame stays and fills with skeletons — a page replaced
            // wholesale by a spinner is why this one did not feel like its
            // siblings.
            <div className="space-y-2 p-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-9 w-full" />
              ))}
            </div>
          ) : (
            <SettingList
              entries={listEntries}
              driftCount={driftRows.length}
              totalKeys={matrix.rows.length}
              selected={selection}
              onSelect={select}
            />
          )}
        </div>

        <div className="min-h-0 overflow-y-auto rounded-xl border border-border p-3">
          {loading ? (
            <div className="space-y-3">
              <Skeleton className="h-5 w-48" />
              <Skeleton className="h-8 w-40" />
              <Skeleton className="h-32 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          ) : (
            detailPane()
          )}
        </div>
      </div>
    </Page>
  )
}
