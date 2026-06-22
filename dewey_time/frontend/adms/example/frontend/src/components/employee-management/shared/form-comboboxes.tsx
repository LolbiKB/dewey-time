import { useState, useMemo, useEffect } from "react"
import { Building2, Shield, Briefcase, Calendar } from "lucide-react"
import { SearchableCombobox, MultiSelectCombobox, type ComboboxOption } from "@/components/ui/searchable-combobox"
import {
  fetchEmployeeTermTypes,
  fetchEmployeePositionTypes,
  fetchEmployeeDepartmentTypes,
  fetchEmployeeRoles
} from "@/services/employee-service"

// Re-export shared UserCombobox
export { UserCombobox } from "@/components/shared/user-combobox"

const useSearchTermTypes = (query: string, _page: number = 1, limit: number = 20) => {
  const [allTermTypes, setAllTermTypes] = useState<any[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isFetching, setIsFetching] = useState(false)

  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true)
      setIsFetching(true)
      try {
        const response = await fetchEmployeeTermTypes()
        setAllTermTypes(response?.data || [])
      } catch (error) {
        console.error('Error fetching term types:', error)
        setAllTermTypes([])
      } finally {
        setIsLoading(false)
        setIsFetching(false)
      }
    }

    fetchData()
  }, []) // Only fetch once, no query dependency for reference data

  const filteredData = useMemo(() => {
    if (!query || !allTermTypes) return allTermTypes || []
    return allTermTypes.filter((item: any) =>
      item.name.toLowerCase().includes(query.toLowerCase())
    )
  }, [allTermTypes, query])

  return {
    data: {
      data: filteredData.slice(0, limit),
      hasMore: false,
      total: filteredData.length,
      page: 1,
      limit
    },
    isLoading,
    isFetching
  }
}

const useSearchPositionTypes = (query: string, _page: number = 1, limit: number = 20) => {
  const [allPositionTypes, setAllPositionTypes] = useState<any[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isFetching, setIsFetching] = useState(false)

  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true)
      setIsFetching(true)
      try {
        const response = await fetchEmployeePositionTypes()
        setAllPositionTypes(response?.data || [])
      } catch (error) {
        console.error('Error fetching position types:', error)
        setAllPositionTypes([])
      } finally {
        setIsLoading(false)
        setIsFetching(false)
      }
    }

    fetchData()
  }, []) // Only fetch once, no query dependency for reference data

  const filteredData = useMemo(() => {
    if (!query || !allPositionTypes) return allPositionTypes || []
    return allPositionTypes.filter((item: any) =>
      item.name.toLowerCase().includes(query.toLowerCase())
    )
  }, [allPositionTypes, query])

  return {
    data: {
      data: filteredData.slice(0, limit),
      hasMore: false,
      total: filteredData.length,
      page: 1,
      limit
    },
    isLoading,
    isFetching
  }
}

const useSearchDepartmentTypes = (query: string, _page: number = 1, limit: number = 20) => {
  const [allDepartmentTypes, setAllDepartmentTypes] = useState<any[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isFetching, setIsFetching] = useState(false)

  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true)
      setIsFetching(true)
      try {
        const response = await fetchEmployeeDepartmentTypes()
        setAllDepartmentTypes(response?.data || [])
      } catch (error) {
        console.error('Error fetching department types:', error)
        setAllDepartmentTypes([])
      } finally {
        setIsLoading(false)
        setIsFetching(false)
      }
    }

    fetchData()
  }, []) // Only fetch once, no query dependency for reference data

  const filteredData = useMemo(() => {
    if (!query || !allDepartmentTypes) return allDepartmentTypes || []
    return allDepartmentTypes.filter((item: any) =>
      item.name.toLowerCase().includes(query.toLowerCase())
    )
  }, [allDepartmentTypes, query])

  return {
    data: {
      data: filteredData.slice(0, limit),
      hasMore: false,
      total: filteredData.length,
      page: 1,
      limit
    },
    isLoading,
    isFetching
  }
}

const useSearchRoles = (query: string, _page: number = 1, limit: number = 20) => {
  const [allRoles, setAllRoles] = useState<any[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isFetching, setIsFetching] = useState(false)

  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true)
      setIsFetching(true)
      try {
        const response = await fetchEmployeeRoles()
        setAllRoles(response?.data || [])
      } catch (error) {
        console.error('Error fetching roles:', error)
        setAllRoles([])
      } finally {
        setIsLoading(false)
        setIsFetching(false)
      }
    }

    fetchData()
  }, []) // Only fetch once, no query dependency for reference data

  const filteredData = useMemo(() => {
    if (!query || !allRoles) return allRoles || []
    return allRoles.filter((item: any) =>
      item.name.toLowerCase().includes(query.toLowerCase())
    )
  }, [allRoles, query])

  return {
    data: {
      data: filteredData.slice(0, limit),
      hasMore: false,
      total: filteredData.length,
      page: 1,
      limit
    },
    isLoading,
    isFetching
  }
}

// Type interfaces
interface TermType {
  id: number
  name: string
  start_date?: string
  end_date?: string
  is_current: boolean
}

interface PositionType {
  id: number
  name: string
  description?: string
}

interface DepartmentType {
  id: number
  name: string
  description?: string
}

interface Role {
  id: number
  name: string
  description?: string
}

// Term Type Combobox Component
interface TermTypeComboboxProps {
  value?: number
  onValueChange: (value: number | undefined) => void
  disabled?: boolean
  className?: string
  termTypes?: TermType[] // Fallback static data
}

export function TermTypeCombobox({
  value,
  onValueChange,
  disabled,
  className,
  termTypes = []
}: TermTypeComboboxProps) {
  const [searchQuery, setSearchQuery] = useState("")
  const [searchPage, setSearchPage] = useState(1)

  const {
    data: searchResults,
    isLoading,
    isFetching
  } = useSearchTermTypes(searchQuery, searchPage, 20)

  const options: ComboboxOption[] = useMemo(() => {
    const dataSource = searchResults?.data.length > 0 ? searchResults.data : termTypes

    return dataSource.map((term: TermType) => ({
      value: term.id,
      label: term.name,
      description: term.is_current ? "Current term" : undefined,
      icon: Calendar
    }))
  }, [searchResults?.data, termTypes])

  const handleSearch = (query: string) => {
    setSearchQuery(query)
    setSearchPage(1)
  }

  const handleLoadMore = (query: string, page: number) => {
    setSearchQuery(query)
    setSearchPage(page)
  }

  const handleValueChange = (newValue: string | number | undefined) => {
    onValueChange(newValue as number | undefined)
  }

  return (
    <SearchableCombobox
      value={value}
      onValueChange={handleValueChange}
      options={options}
      onSearch={handleSearch}
      onLoadMore={handleLoadMore}
      disabled={disabled}
      className={className}
      isLoading={isLoading}
      isLoadingMore={isFetching}
      hasMore={searchResults?.hasMore || false}
      placeholder="Select hire term"
      searchPlaceholder="Search terms..."
      emptyMessage="No terms found."
    />
  )
}

// Position Type Combobox Component
interface PositionTypeComboboxProps {
  value?: number
  onValueChange: (value: number | undefined) => void
  disabled?: boolean
  className?: string
  positionTypes?: PositionType[] // Fallback static data
}

export function PositionTypeCombobox({
  value,
  onValueChange,
  disabled,
  className,
  positionTypes = []
}: PositionTypeComboboxProps) {
  const [searchQuery, setSearchQuery] = useState("")
  const [searchPage, setSearchPage] = useState(1)

  const {
    data: searchResults,
    isLoading,
    isFetching
  } = useSearchPositionTypes(searchQuery, searchPage, 20)

  const options: ComboboxOption[] = useMemo(() => {
    const dataSource = searchResults?.data.length > 0 ? searchResults.data : positionTypes

    return dataSource.map((position: PositionType) => ({
      value: position.id,
      label: position.name,
      description: position.description,
      icon: Briefcase
    }))
  }, [searchResults?.data, positionTypes])

  const handleSearch = (query: string) => {
    setSearchQuery(query)
    setSearchPage(1)
  }

  const handleLoadMore = (query: string, page: number) => {
    setSearchQuery(query)
    setSearchPage(page)
  }

  const handleValueChange = (newValue: string | number | undefined) => {
    onValueChange(newValue as number | undefined)
  }

  return (
    <SearchableCombobox
      value={value}
      onValueChange={handleValueChange}
      options={options}
      onSearch={handleSearch}
      onLoadMore={handleLoadMore}
      disabled={disabled}
      className={className}
      isLoading={isLoading}
      isLoadingMore={isFetching}
      hasMore={searchResults?.hasMore || false}
      placeholder="Select position"
      searchPlaceholder="Search positions..."
      emptyMessage="No positions found."
    />
  )
}

// Department Type Combobox Component
interface DepartmentTypeComboboxProps {
  value?: number
  onValueChange: (value: number | undefined) => void
  disabled?: boolean
  className?: string
  departmentTypes?: DepartmentType[] // Fallback static data
}

export function DepartmentTypeCombobox({
  value,
  onValueChange,
  disabled,
  className,
  departmentTypes = []
}: DepartmentTypeComboboxProps) {
  const [searchQuery, setSearchQuery] = useState("")
  const [searchPage, setSearchPage] = useState(1)

  const {
    data: searchResults,
    isLoading,
    isFetching
  } = useSearchDepartmentTypes(searchQuery, searchPage, 20)

  const options: ComboboxOption[] = useMemo(() => {
    const dataSource = searchResults?.data.length > 0 ? searchResults.data : departmentTypes

    return dataSource.map((department: DepartmentType) => ({
      value: department.id,
      label: department.name,
      description: department.description,
      icon: Building2
    }))
  }, [searchResults?.data, departmentTypes])

  const handleSearch = (query: string) => {
    setSearchQuery(query)
    setSearchPage(1)
  }

  const handleLoadMore = (query: string, page: number) => {
    setSearchQuery(query)
    setSearchPage(page)
  }

  const handleValueChange = (newValue: string | number | undefined) => {
    onValueChange(newValue as number | undefined)
  }

  return (
    <SearchableCombobox
      value={value}
      onValueChange={handleValueChange}
      options={options}
      onSearch={handleSearch}
      onLoadMore={handleLoadMore}
      disabled={disabled}
      className={className}
      isLoading={isLoading}
      isLoadingMore={isFetching}
      hasMore={searchResults?.hasMore || false}
      placeholder="Select department"
      searchPlaceholder="Search departments..."
      emptyMessage="No departments found."
    />
  )
}

// Roles Multi-Select Combobox Component
interface RolesMultiSelectComboboxProps {
  values: number[]
  onValuesChange: (values: number[]) => void
  disabled?: boolean
  className?: string
  roles?: Role[] // Fallback static data
}

export function RolesMultiSelectCombobox({
  values,
  onValuesChange,
  disabled,
  className,
  roles = []
}: RolesMultiSelectComboboxProps) {
  const [searchQuery, setSearchQuery] = useState("")
  const [searchPage, setSearchPage] = useState(1)

  const {
    data: searchResults,
    isLoading,
    isFetching
  } = useSearchRoles(searchQuery, searchPage, 20)

  const options: ComboboxOption[] = useMemo(() => {
    const dataSource = searchResults?.data.length > 0 ? searchResults.data : roles

    return dataSource.map((role: Role) => ({
      value: role.id,
      label: role.name,
      description: role.description,
      icon: Shield
    }))
  }, [searchResults?.data, roles])

  const handleSearch = (query: string) => {
    setSearchQuery(query)
    setSearchPage(1)
  }

  const handleLoadMore = (query: string, page: number) => {
    setSearchQuery(query)
    setSearchPage(page)
  }

  const handleValuesChange = (newValues: (string | number)[]) => {
    onValuesChange(newValues as number[])
  }

  return (
    <MultiSelectCombobox
      values={values}
      onValuesChange={handleValuesChange}
      options={options}
      onSearch={handleSearch}
      onLoadMore={handleLoadMore}
      disabled={disabled}
      className={className}
      isLoading={isLoading}
      isLoadingMore={isFetching}
      hasMore={searchResults?.hasMore || false}
      placeholder="Select roles"
      searchPlaceholder="Search roles..."
      emptyMessage="No roles found."
    />
  )
}