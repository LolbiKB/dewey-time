import { useState, useMemo, useEffect } from "react"
import { Calendar, GraduationCap } from "lucide-react"
import { SearchableCombobox, type ComboboxOption } from "@/components/ui/searchable-combobox"
import { fetchStudentTermTypes, fetchStudentPrograms } from "@/services/student-service"

// Direct fetch hook for term types
const useSearchTermTypes = (query: string, _page: number = 1, limit: number = 20) => {
  const [allTermTypes, setAllTermTypes] = useState<any[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isFetching, setIsFetching] = useState(false)

  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true)
      setIsFetching(true)
      try {
        const response = await fetchStudentTermTypes()
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

// Direct fetch hook for programs
const useSearchPrograms = (query: string, _page: number = 1, limit: number = 20) => {
  const [allPrograms, setAllPrograms] = useState<any[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isFetching, setIsFetching] = useState(false)

  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true)
      setIsFetching(true)
      try {
        const response = await fetchStudentPrograms()
        setAllPrograms(response?.data || [])
      } catch (error) {
        console.error('Error fetching programs:', error)
        setAllPrograms([])
      } finally {
        setIsLoading(false)
        setIsFetching(false)
      }
    }

    fetchData()
  }, []) // Only fetch once, no query dependency for reference data

  const filteredData = useMemo(() => {
    if (!query || !allPrograms) return allPrograms || []
    return allPrograms.filter((item: any) =>
      item.major.toLowerCase().includes(query.toLowerCase()) ||
      item.degree?.name?.toLowerCase().includes(query.toLowerCase())
    )
  }, [allPrograms, query])

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

interface Program {
  id: number
  major: string
  description?: string
  degree?: {
    id: number
    name: string
    abbreviation?: string
  }
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
      placeholder="Select admission term"
      searchPlaceholder="Search terms..."
      emptyMessage="No terms found."
    />
  )
}

// Program Combobox Component
interface ProgramComboboxProps {
  value?: number
  onValueChange: (value: number | undefined) => void
  disabled?: boolean
  className?: string
  programs?: Program[] // Fallback static data
}

export function ProgramCombobox({
  value,
  onValueChange,
  disabled,
  className,
  programs = []
}: ProgramComboboxProps) {
  const [searchQuery, setSearchQuery] = useState("")
  const [searchPage, setSearchPage] = useState(1)

  const {
    data: searchResults,
    isLoading,
    isFetching
  } = useSearchPrograms(searchQuery, searchPage, 20)

  const options: ComboboxOption[] = useMemo(() => {
    const dataSource = searchResults?.data.length > 0 ? searchResults.data : programs

    return dataSource.map((program: Program) => ({
      value: program.id,
      label: program.major,
      description: program.degree?.name,
      icon: GraduationCap
    }))
  }, [searchResults?.data, programs])

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
      placeholder="Select a program"
      searchPlaceholder="Search programs..."
      emptyMessage="No programs found."
    />
  )
}
