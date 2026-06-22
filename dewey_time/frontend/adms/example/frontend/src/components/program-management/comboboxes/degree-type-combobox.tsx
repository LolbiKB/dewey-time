import { useState, useMemo, useEffect } from "react"
import { GraduationCap, Building2 } from "lucide-react"
import { SearchableCombobox, type ComboboxOption } from "@/components/ui/searchable-combobox"
import {
  fetchProgramDegreeTypes,
  fetchProgramDepartmentTypes,
} from "@/services/program-service"

// Direct fetch hook for degree types
const useSearchDegreeTypes = (query: string, _page: number = 1, limit: number = 20) => {
  const [allDegreeTypes, setAllDegreeTypes] = useState<any[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isFetching, setIsFetching] = useState(false)

  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true)
      setIsFetching(true)
      try {
        const response = await fetchProgramDegreeTypes()
        setAllDegreeTypes(response?.data || [])
      } catch (error) {
        console.error('Error fetching degree types:', error)
        setAllDegreeTypes([])
      } finally {
        setIsLoading(false)
        setIsFetching(false)
      }
    }

    fetchData()
  }, []) // Only fetch once, no query dependency for reference data

  const filteredData = useMemo(() => {
    if (!query || !allDegreeTypes) return allDegreeTypes || []
    return allDegreeTypes.filter((item: any) =>
      item.name.toLowerCase().includes(query.toLowerCase()) ||
      (item.abbreviation && item.abbreviation.toLowerCase().includes(query.toLowerCase()))
    )
  }, [allDegreeTypes, query])

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

// Direct fetch hook for department types
const useSearchDepartmentTypes = (query: string, _page: number = 1, limit: number = 20) => {
  const [allDepartmentTypes, setAllDepartmentTypes] = useState<any[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isFetching, setIsFetching] = useState(false)

  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true)
      setIsFetching(true)
      try {
        const response = await fetchProgramDepartmentTypes()
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

/**
 * DegreeTypeCombobox - Dropdown for selecting degree type (BS, BA, MS, PhD, etc.)
 */
interface DegreeTypeComboboxProps {
  value?: number
  onValueChange: (value: number | undefined) => void
  disabled?: boolean
  degreeTypes?: Array<{ id: number; name: string; abbreviation: string | null }>
}

export function DegreeTypeCombobox({
  value,
  onValueChange,
  disabled = false,
  degreeTypes = []
}: DegreeTypeComboboxProps) {
  const [query, setQuery] = useState("")
  const [_page, _setPage] = useState(1)

  const { data, isLoading } = useSearchDegreeTypes(query, _page, 50)

  // Use provided degreeTypes if available, otherwise use fetched data
  const options: ComboboxOption[] = useMemo(() => {
    const sourceData = degreeTypes.length > 0 ? degreeTypes : (data?.data || [])
    return sourceData.map((degree: any) => ({
      value: degree.id,
      label: degree.abbreviation
        ? `${degree.name} (${degree.abbreviation})`
        : degree.name,
      searchValue: `${degree.name} ${degree.abbreviation || ''}`.toLowerCase(),
      icon: GraduationCap,
    }))
  }, [degreeTypes, data?.data])

  const handleValueChange = (newValue: string | number | undefined) => {
    onValueChange(newValue as number | undefined)
  }

  return (
    <SearchableCombobox
      value={value}
      onValueChange={handleValueChange}
      options={options}
      placeholder="Select degree type..."
      searchPlaceholder="Search degrees..."
      disabled={disabled}
      isLoading={isLoading && degreeTypes.length === 0}
      onSearch={setQuery}
      allowClear={true}
    />
  )
}

/**
 * DepartmentTypeCombobox - Dropdown for selecting department
 */
interface DepartmentTypeComboboxProps {
  value?: number
  onValueChange: (value: number | undefined) => void
  disabled?: boolean
  departmentTypes?: Array<{ id: number; name: string; description?: string | null }>
}

export function DepartmentTypeCombobox({
  value,
  onValueChange,
  disabled = false,
  departmentTypes = []
}: DepartmentTypeComboboxProps) {
  const [query, setQuery] = useState("")
  const [_page, _setPage] = useState(1)

  const { data, isLoading } = useSearchDepartmentTypes(query, _page, 50)

  // Use provided departmentTypes if available, otherwise use fetched data
  const options: ComboboxOption[] = useMemo(() => {
    const sourceData = departmentTypes.length > 0 ? departmentTypes : (data?.data || [])
    return sourceData.map((dept: any) => ({
      value: dept.id,
      label: dept.name,
      searchValue: dept.name.toLowerCase(),
      icon: Building2,
    }))
  }, [departmentTypes, data?.data])

  const handleValueChange = (newValue: string | number | undefined) => {
    onValueChange(newValue as number | undefined)
  }

  return (
    <SearchableCombobox
      value={value}
      onValueChange={handleValueChange}
      options={options}
      placeholder="Select department..."
      searchPlaceholder="Search departments..."
      disabled={disabled}
      isLoading={isLoading && departmentTypes.length === 0}
      onSearch={setQuery}
      allowClear={true}
    />
  )
}
