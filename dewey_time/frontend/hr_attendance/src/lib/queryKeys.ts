/**
 * Centralised query-key registry. Every cache key in the app is built here.
 *
 * Keys are hierarchical so invalidation works by prefix: invalidating
 * `queryKeys.schedule.all` reaches context, resolve, templates and holidays
 * without naming them. That property is what makes cache correctness
 * structural rather than a matter of remembering — it is asserted in
 * queryKeys.test.ts, so adding a key outside its family will fail the suite.
 */
export const queryKeys = {
  session: {
    all: ["session"] as const,
  },

  employees: {
    all: ["employees"] as const,
    list: () => [...queryKeys.employees.all, "list"] as const,
  },

  calendar: {
    all: ["calendar"] as const,
    employee: (employee: string, startDate: string, endDate: string) =>
      [...queryKeys.calendar.all, "employee", employee, startDate, endDate] as const,
  },

  schedule: {
    all: ["schedule"] as const,
    context: (employee: string) => [...queryKeys.schedule.all, "context", employee] as const,
    resolve: (employee: string, effectiveFrom: string, patternJson: string) =>
      [...queryKeys.schedule.all, "resolve", employee, effectiveFrom, patternJson] as const,
    templates: (limit: number) => [...queryKeys.schedule.all, "templates", limit] as const,
    holidays: (employee: string, startDate: string, endDate: string) =>
      [...queryKeys.schedule.all, "holidays", employee, startDate, endDate] as const,
  },

  coverage: {
    all: ["coverage"] as const,
  },

  maintenance: {
    all: ["maintenance"] as const,
    employeeClearPreview: (employee: string) =>
      [...queryKeys.maintenance.all, "employee-clear-preview", employee] as const,
    allClearPreview: (includeAllActive: boolean) =>
      [...queryKeys.maintenance.all, "all-clear-preview", includeAllActive] as const,
    siteClearPreview: (clearEmployeeData: boolean) =>
      [...queryKeys.maintenance.all, "site-clear-preview", clearEmployeeData] as const,
  },
} as const;
