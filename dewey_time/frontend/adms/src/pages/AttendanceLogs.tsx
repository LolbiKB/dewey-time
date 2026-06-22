import { useState, useMemo, useCallback, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { startOfDay, endOfDay, formatISO, parseISO, isSameDay } from 'date-fns'
import { AlertCircle } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { DayTimelineStrip } from '@/components/attendance-logs/day-timeline-strip'
import { createAttendanceLogColumns } from '@/components/attendance-logs/columns'
import { AttendanceLogDataTable } from '@/components/attendance-logs/data-table'
import {
  useAttendanceLogs,
  useAttendanceLogSummary,
  useYesterdayAttlogClosure,
} from '@/hooks'
import { AttlogClosureBadge } from '@/components/shared/status-badges'
import { Page } from '@lolbikb/dewey-ui'
import type {
  AttendanceLogFilters,
  AttendanceLogStatFilter,
} from '@/services/attendance-log-service'
import {
  computeSequenceMap,
  daySequenceWarnings,
  formatCheckTimeForLog,
} from '@/lib/attendance-log-display'

export function AttendanceLogs() {
  const [searchParams] = useSearchParams()

  const [filters, setFilters] = useState<AttendanceLogFilters>(() => {
    const deviceSn = searchParams.get('device_sn') || undefined
    const dateFrom = searchParams.get('dateFrom') || undefined
    const dateTo = searchParams.get('dateTo') || undefined
    return {
      page: 1,
      limit: 20,
      sort: 'check_time',
      order: 'desc',
      ...(deviceSn && { device_sn: deviceSn }),
      ...(dateFrom && { dateFrom }),
      ...(dateTo && { dateTo }),
    }
  })

  useEffect(() => {
    const deviceSn = searchParams.get('device_sn')
    const dateFrom = searchParams.get('dateFrom')
    const dateTo = searchParams.get('dateTo')
    if (!deviceSn && !dateFrom && !dateTo) return
    setFilters((prev) => ({
      ...prev,
      ...(deviceSn && { device_sn: deviceSn }),
      ...(dateFrom && { dateFrom }),
      ...(dateTo && { dateTo }),
      page: 1,
    }))
  }, [searchParams])

  const { data, meta, isLoading, isError, error, refetchAttendanceLogs, isFetching } =
    useAttendanceLogs(filters)

  const { data: summary } = useAttendanceLogSummary()
  const { data: yesterdayClosure } = useYesterdayAttlogClosure()

  const closureAlerts = useMemo(() => {
    if (!yesterdayClosure?.size) return null
    let failed = 0
    let deferred = 0
    for (const row of yesterdayClosure.values()) {
      if (row.status === 'closure_failed') failed++
      if (row.status === 'deferred_offline') deferred++
    }
    if (failed === 0 && deferred === 0) return null
    return { failed, deferred }
  }, [yesterdayClosure])

  const isDayUserScope = useMemo(() => {
    if (!filters.user_pin || !filters.dateFrom || !filters.dateTo) return false
    return isSameDay(parseISO(filters.dateFrom), parseISO(filters.dateTo))
  }, [filters.user_pin, filters.dateFrom, filters.dateTo])

  const sequenceMap = useMemo(
    () => (isDayUserScope ? computeSequenceMap(data) : new Map<number, number>()),
    [data, isDayUserScope]
  )

  const dayWarnings = useMemo(
    () => (isDayUserScope ? daySequenceWarnings(data) : []),
    [data, isDayUserScope]
  )

  const timelinePunches = useMemo(() => {
    if (!isDayUserScope) return []
    return [...data]
      .sort((a, b) => parseISO(a.check_time).getTime() - parseISO(b.check_time).getTime())
      .map((log, i) => {
        const { time } = formatCheckTimeForLog(log.check_time, log.devices?.timezone)
        const loc = log.devices?.name || log.device_sn
        return { seq: i + 1, time, loc }
      })
  }, [data, isDayUserScope])

  const columns = useMemo(
    () =>
      createAttendanceLogColumns({
        onFilterByVerifyType: (type) =>
          setFilters((prev) => ({
            ...prev,
            verify_type: type ? parseInt(type, 10) : undefined,
            page: 1,
          })),
        onFilterByDate: (date) => {
          if (date) {
            setFilters((prev) => ({
              ...prev,
              dateFrom: formatISO(startOfDay(date)),
              dateTo: formatISO(endOfDay(date)),
              page: 1,
            }))
          } else {
            setFilters((prev) => {
              const { dateFrom, dateTo, ...rest } = prev
              return { ...rest, page: 1 }
            })
          }
        },
        currentVerifyTypeFilter: filters.verify_type?.toString(),
        currentDateFilter: filters.dateFrom ? new Date(filters.dateFrom) : undefined,
        showSequence: isDayUserScope,
        sequenceMap,
      }),
    [filters, isDayUserScope, sequenceMap]
  )

  const toggleStatFilter = useCallback((stat: AttendanceLogStatFilter) => {
    setFilters((prev) => {
      const { preset, sync_status, dateFrom, dateTo, ...rest } = prev
      if (preset === stat) {
        return { ...rest, page: 1, sort: 'check_time', order: 'desc' }
      }
      return { ...rest, preset: stat, page: 1, sort: 'check_time', order: 'desc' }
    })
  }, [])

  if (isError) {
    return (
      <div className="flex items-center justify-center flex-1 min-h-0">
        <Card className="border-destructive max-w-2xl w-full">
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-destructive">
              <AlertCircle className="h-5 w-5" />
              <p className="font-semibold">Error loading attendance logs</p>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              {error instanceof Error ? error.message : 'An unknown error occurred'}
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <Page className="min-h-0 gap-0">
      {closureAlerts && (
        <div className="mb-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span>Yesterday ledger closeout:</span>
          {closureAlerts.failed > 0 && (
            <AttlogClosureBadge status="closure_failed" label={`${closureAlerts.failed} failed`} />
          )}
          {closureAlerts.deferred > 0 && (
            <AttlogClosureBadge
              status="deferred_offline"
              label={`${closureAlerts.deferred} deferred (offline)`}
            />
          )}
        </div>
      )}
      {isDayUserScope && filters.user_pin && (
        <DayTimelineStrip
          userPin={filters.user_pin}
          punches={timelinePunches}
          warnings={dayWarnings}
        />
      )}

      <div className="flex-1 min-h-0">
        <AttendanceLogDataTable
          columns={columns}
          data={data}
          meta={meta}
          summary={summary}
          loading={isLoading}
          isFetching={isFetching}
          filters={filters}
          onFiltersChange={setFilters}
          onStatToggle={toggleStatFilter}
          onRefresh={() => void refetchAttendanceLogs()}
        />
      </div>
    </Page>
  )
}
