import * as React from "react"
import type { ColumnDef, VisibilityState } from "@tanstack/react-table"
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table"
import { ChevronDown, Search, Filter, RefreshCw, Loader2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Card, CardContent } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

// Base filters that all data tables should support
export interface BaseFilters {
  page?: number
  limit?: number
  sort?: string
  order?: 'asc' | 'desc'
  search?: string
}

// Base metadata that all paginated responses should include
export interface BaseTableMeta {
  total: number
  page: number
  limit: number
  totalPages: number
  hasNext: boolean
  hasPrev: boolean
}

// Base props for action callbacks (can be extended per entity)
export interface BaseTableActions<T> {
  onCreate?: () => void
  onEdit?: (item: T) => void
  onDelete?: (item: T) => void
  onView?: (item: T) => void
  onRefresh?: () => void
}

// Generic table configuration
export interface TableConfig {
  entityName: string // e.g., "users", "courses", "students" 
  entityNameSingular: string // e.g., "user", "course", "student"
  searchPlaceholder?: string
}

interface GenericDataTableProps<TData, TFilters extends BaseFilters> {
  // Core table data
  columns: ColumnDef<TData, any>[]
  data: TData[]
  meta?: BaseTableMeta
  loading?: boolean

  // Server-side operations
  filters: TFilters
  onFiltersChange: (filters: TFilters) => void

  // Configuration
  config: TableConfig

  // Actions (all optional)
  actions?: BaseTableActions<TData>

  // Toolbar customization
  hideToolbar?: boolean
  toolbarActions?: React.ReactNode

  // Core toolbar feature toggles
  hideSearch?: boolean
  hideRefresh?: boolean
  hideColumnToggle?: boolean
}

export function GenericDataTable<TData, TFilters extends BaseFilters>({
  columns,
  data,
  meta,
  loading = false,
  filters,
  onFiltersChange,
  config,
  actions,
  hideToolbar = false,
  toolbarActions,
  hideSearch = false,
  hideRefresh = false,
  hideColumnToggle = false,
}: GenericDataTableProps<TData, TFilters>) {
  const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>({})
  const [rowSelection, setRowSelection] = React.useState({})

  // Search input state (debounced)
  const [searchInput, setSearchInput] = React.useState(filters.search || "")
  const [debouncedSearch, setDebouncedSearch] = React.useState(filters.search || "")

  // Debounce search input
  React.useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchInput)
    }, 300)

    return () => clearTimeout(timer)
  }, [searchInput])

  // Update filters when debounced search changes
  React.useEffect(() => {
    if (debouncedSearch !== filters.search) {
      onFiltersChange({
        ...filters,
        search: debouncedSearch,
        page: 1
      })
    }
  }, [debouncedSearch, filters, onFiltersChange])

  // Handle sorting change
  const handleSortingChange = React.useCallback((updater: any) => {
    const newSorting = typeof updater === 'function'
      ? updater(filters.sort ? [{ id: filters.sort, desc: filters.order === 'desc' }] : [])
      : updater

    const sortColumn = newSorting[0]
    onFiltersChange({
      ...filters,
      sort: sortColumn?.id,
      order: sortColumn?.desc ? 'desc' : 'asc',
      page: 1
    })
  }, [filters, onFiltersChange])

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: setRowSelection,
    manualSorting: true,
    manualFiltering: true,
    manualPagination: true,
    pageCount: meta?.totalPages || 1,
    state: {
      sorting: filters.sort ? [{ id: filters.sort, desc: filters.order === 'desc' }] : [],
      columnVisibility,
      rowSelection,
      pagination: {
        pageIndex: (filters.page || 1) - 1,
        pageSize: filters.limit || 10
      }
    },
    onSortingChange: handleSortingChange,
    meta: actions,
  })

  const searchPlaceholder = config.searchPlaceholder || `Search ${config.entityName}...`

  return (
    <Card className="h-full w-full min-w-0">
      <CardContent className="h-full w-full">
        <div className="flex h-full w-full flex-col min-w-0">
          {/* Toolbar - Fixed at top */}
          {!hideToolbar && (
            <div className="flex shrink-0 items-center justify-between border-b bg-background pb-4">
              <div className="flex items-center space-x-2 min-w-0">
                {/* Search */}
                {!hideSearch && (
                  <div className="relative">
                    <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder={searchPlaceholder}
                      value={searchInput}
                      onChange={(event) => setSearchInput(event.target.value)}
                      className="pl-8 w-64"
                    />
                  </div>
                )}

                {/* Refresh button */}
                {!hideRefresh && actions?.onRefresh && (
                  <Button
                    variant="outline"
                    onClick={actions.onRefresh}
                    disabled={loading}
                  >
                    <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                  </Button>
                )}

                {/* Column visibility toggle */}
                {!hideColumnToggle && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline">
                        <Filter className="mr-2 h-4 w-4" />
                        Columns <ChevronDown className="ml-2 h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-[200px]">
                      {table
                        .getAllColumns()
                        .filter((column) => column.getCanHide())
                        .map((column) => {
                          return (
                            <DropdownMenuCheckboxItem
                              key={column.id}
                              className="capitalize"
                              checked={column.getIsVisible()}
                              onCheckedChange={(value) =>
                                column.toggleVisibility(!!value)
                              }
                            >
                              {column.id}
                            </DropdownMenuCheckboxItem>
                          )
                        })}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>

              {/* Right-side action area */}
              <div className="flex items-center space-x-2">
                {/* Selection count */}
                {Object.keys(rowSelection).length > 0 && (
                  <div className="text-sm text-muted-foreground mr-4">
                    {Object.keys(rowSelection).length} row(s) selected
                  </div>
                )}

                {/* Custom toolbar actions */}
                {toolbarActions}
              </div>
            </div>
          )}

          {/* Table Container - Scrollable content */}
          <div className="flex-1 min-h-0 min-w-0 overflow-hidden">
            <div className="h-full w-full overflow-auto">
              <div className={loading || !table.getRowModel().rows?.length ? "h-full w-full" : "h-0 min-h-full w-full"}>
                <Table
                  className={cn(loading || !table.getRowModel().rows?.length ? "h-full" : "", "min-w-max")}
                >
                  <TableHeader className="sticky top-0 bg-background z-10 border-b">
                    {table.getHeaderGroups().map((headerGroup) => (
                      <TableRow key={headerGroup.id}>
                        {headerGroup.headers.map((header) => {
                          return (
                            <TableHead key={header.id} className="bg-muted/50">
                              {header.isPlaceholder
                                ? null
                                : flexRender(
                                  header.column.columnDef.header,
                                  header.getContext()
                                )}
                            </TableHead>
                          )
                        })}
                      </TableRow>
                    ))}
                  </TableHeader>
                  <TableBody className={cn(loading || !table.getRowModel().rows?.length ? "h-full" : "")}>
                    {loading ? (
                      <TableRow className="h-full">
                        <TableCell
                          colSpan={columns.length}
                          className="h-full text-center"
                        >
                          <div className="flex flex-col items-center justify-center h-full space-y-3">
                            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                            <p className="text-sm text-muted-foreground">Loading data</p>
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : table.getRowModel().rows?.length ? (
                      table.getRowModel().rows.map((row) => (
                        <TableRow
                          key={row.id}
                          data-state={row.getIsSelected() && "selected"}
                          className="hover:bg-muted/50"
                        >
                          {row.getVisibleCells().map((cell) => (
                            <TableCell key={cell.id}>
                              {flexRender(
                                cell.column.columnDef.cell,
                                cell.getContext()
                              )}
                            </TableCell>
                          ))}
                        </TableRow>
                      ))
                    ) : (
                      <TableRow className="h-full">
                        <TableCell
                          colSpan={columns.length}
                          className="h-full text-center"
                        >
                          <div className="flex flex-col items-center justify-center h-full space-y-2">
                            <div className="text-muted-foreground">No {config.entityName} found</div>
                            <div className="text-sm text-muted-foreground">
                              Try adjusting your search or filters
                            </div>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>
          </div>

          {/* Pagination - Fixed at bottom */}
          <div className="shrink-0 flex items-center justify-between border-t bg-background pt-4">
            <div className="flex items-center space-x-4">
              <div className="text-sm text-muted-foreground">
                Showing {data.length} of {meta?.total || 0} {config.entityName}
              </div>
              <div className="h-4 w-px bg-border" />
              <div className="flex items-center space-x-2">
                <p className="text-sm font-medium">Rows per page</p>
                <select
                  className="h-8 w-16 rounded border border-input bg-background px-2 text-sm"
                  value={filters.limit || 10}
                  onChange={(e) => {
                    onFiltersChange({
                      ...filters,
                      limit: Number(e.target.value),
                      page: 1
                    })
                  }}
                >
                  {[10, 20, 30, 40, 50].map((pageSize) => (
                    <option key={pageSize} value={pageSize}>
                      {pageSize}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex items-center space-x-6 lg:space-x-8">
              <div className="flex items-center space-x-2">
                <p className="text-sm font-medium">
                  {loading || !meta ? 'Loading...' : `Page ${meta.page} of ${meta.totalPages}`}
                </p>
              </div>
              <div className="flex items-center space-x-2">
                <Button
                  variant="outline"
                  className="h-8 w-8 p-0"
                  onClick={() => onFiltersChange({ ...filters, page: 1 })}
                  disabled={!meta?.hasPrev}
                >
                  <span className="sr-only">Go to first page</span>
                  ««
                </Button>
                <Button
                  variant="outline"
                  className="h-8 w-8 p-0"
                  onClick={() => onFiltersChange({ ...filters, page: (filters.page || 1) - 1 })}
                  disabled={!meta?.hasPrev}
                >
                  <span className="sr-only">Go to previous page</span>
                  ‹
                </Button>
                <Button
                  variant="outline"
                  className="h-8 w-8 p-0"
                  onClick={() => onFiltersChange({ ...filters, page: (filters.page || 1) + 1 })}
                  disabled={!meta?.hasNext}
                >
                  <span className="sr-only">Go to next page</span>
                  ›
                </Button>
                <Button
                  variant="outline"
                  className="h-8 w-8 p-0"
                  onClick={() => onFiltersChange({ ...filters, page: meta?.totalPages || 1 })}
                  disabled={!meta?.hasNext}
                >
                  <span className="sr-only">Go to last page</span>
                  »»
                </Button>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
