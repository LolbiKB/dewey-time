// Export department management components
export { DepartmentModal } from './modals/department-modal'
export { DepartmentForm } from './forms/department-form'
export { DataTable } from './data-table'
export { createColumns, type Department } from './columns'

// Re-export schemas and hooks for convenience
export { 
  departmentFormSchema, 
  type DepartmentFormValues,
  type CreateDepartmentInput 
} from '../../schemas/department-validation'

export {
  useDepartments,
  useDepartment,
  useDepartmentForModal,
  useCreateDepartment,
  useUpdateDepartment,
  useDeleteDepartment
} from '../../hooks/use-departments'