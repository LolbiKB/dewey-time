// Re-export shim: this primitive now lives in the shared Dewey design
// system. Keep importing from "@/components/ui/generic-data-table" — only the source moved.
export {
  GenericDataTable,
  type BaseFilters,
  type BaseTableMeta,
  type BaseTableActions,
  type TableConfig,
} from "@lolbikb/dewey-ui"
