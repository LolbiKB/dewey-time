/**
 * Which error, if any, should replace the week grid with a failure block.
 *
 * An employees failure only blanks the grid when there is nothing to show. With
 * rows already loaded, a failed background refetch (queryClient sets staleTime 0
 * and refetchOnWindowFocus, so a tab refocus refires the query) must not replace
 * a healthy grid with a false "didn't load" claim.
 *
 * A calendar failure always blanks it: the grid IS the calendar.
 */
export function gridLoadError<E>(args: {
  employeesError: E | null | undefined;
  calendarError: E | null | undefined;
  employeeCount: number;
}): E | null {
  const employees = args.employeeCount === 0 ? args.employeesError : null;
  return employees ?? args.calendarError ?? null;
}
