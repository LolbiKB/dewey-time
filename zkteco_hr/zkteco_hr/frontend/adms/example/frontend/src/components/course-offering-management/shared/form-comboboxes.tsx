import { useState, useMemo, useEffect } from "react"
import { BookOpen, Calendar, UserCheck } from "lucide-react"
import { SearchableCombobox, type ComboboxOption } from "@/components/ui/searchable-combobox"
import {
  fetchCourseOfferingCourses,
  fetchCourseOfferingTerms,
  fetchCourseOfferingInstructors
} from "@/services/course-offering-service"

// Re-export shared UserCombobox for instructor selection (if needed in future)
export { UserCombobox } from "@/components/shared/user-combobox"

const useSearchCourses = (query: string, _page: number = 1, limit: number = 20) => {
  const [allCourses, setAllCourses] = useState<any[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isFetching, setIsFetching] = useState(false)

  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true)
      setIsFetching(true)
      try {
        const response = await fetchCourseOfferingCourses()
        setAllCourses(response?.data || [])
      } catch (error) {
        console.error('Error fetching courses:', error)
        setAllCourses([])
      } finally {
        setIsLoading(false)
        setIsFetching(false)
      }
    }

    fetchData()
  }, [])

  const filteredData = useMemo(() => {
    if (!query || !allCourses) return allCourses || []
    return allCourses.filter((item: any) =>
      item.course_code.toLowerCase().includes(query.toLowerCase()) ||
      item.course_name.toLowerCase().includes(query.toLowerCase())
    )
  }, [allCourses, query])

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

const useSearchTerms = (query: string, _page: number = 1, limit: number = 20) => {
  const [allTerms, setAllTerms] = useState<any[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isFetching, setIsFetching] = useState(false)

  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true)
      setIsFetching(true)
      try {
        const response = await fetchCourseOfferingTerms()
        setAllTerms(response?.data || [])
      } catch (error) {
        console.error('Error fetching terms:', error)
        setAllTerms([])
      } finally {
        setIsLoading(false)
        setIsFetching(false)
      }
    }

    fetchData()
  }, [])

  const filteredData = useMemo(() => {
    if (!query || !allTerms) return allTerms || []
    return allTerms.filter((item: any) =>
      item.name.toLowerCase().includes(query.toLowerCase())
    )
  }, [allTerms, query])

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

const useSearchInstructors = (query: string, _page: number = 1, limit: number = 20) => {
  const [allInstructors, setAllInstructors] = useState<any[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isFetching, setIsFetching] = useState(false)

  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true)
      setIsFetching(true)
      try {
        const response = await fetchCourseOfferingInstructors()
        setAllInstructors(response?.data || [])
      } catch (error) {
        console.error('Error fetching instructors:', error)
        setAllInstructors([])
      } finally {
        setIsLoading(false)
        setIsFetching(false)
      }
    }

    fetchData()
  }, [])

  const filteredData = useMemo(() => {
    if (!query || !allInstructors) return allInstructors || []
    return allInstructors.filter((item: any) =>
      item.first_name.toLowerCase().includes(query.toLowerCase()) ||
      item.last_name.toLowerCase().includes(query.toLowerCase()) ||
      item.employee_id.toLowerCase().includes(query.toLowerCase())
    )
  }, [allInstructors, query])

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
interface Course {
  id: number
  course_code: string
  course_name: string
}

interface Term {
  id: number
  name: string
  start_date?: string
  end_date?: string
  is_active: boolean
}

interface Instructor {
  id: number
  employee_id: string
  first_name: string
  last_name: string
}

// Course Combobox Component
interface CourseComboboxProps {
  value?: number
  onValueChange: (value: number | undefined) => void
  disabled?: boolean
  className?: string
  courses?: Course[]
}

export function CourseCombobox({
  value,
  onValueChange,
  disabled,
  className,
  courses = []
}: CourseComboboxProps) {
  const [searchQuery, setSearchQuery] = useState("")
  const [searchPage, setSearchPage] = useState(1)

  const {
    data: searchResults,
    isLoading,
    isFetching
  } = useSearchCourses(searchQuery, searchPage, 20)

  const options: ComboboxOption[] = useMemo(() => {
    const dataSource = searchResults?.data.length > 0 ? searchResults.data : courses

    return dataSource.map((course: Course) => ({
      value: course.id,
      label: `${course.course_code} - ${course.course_name}`,
      description: course.course_code,
      icon: BookOpen
    }))
  }, [searchResults?.data, courses])

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
      placeholder="Select a course"
      searchPlaceholder="Search courses..."
      emptyMessage="No courses found."
    />
  )
}

// Term Combobox Component
interface TermComboboxProps {
  value?: number
  onValueChange: (value: number | undefined) => void
  disabled?: boolean
  className?: string
  terms?: Term[]
}

export function TermCombobox({
  value,
  onValueChange,
  disabled,
  className,
  terms = []
}: TermComboboxProps) {
  const [searchQuery, setSearchQuery] = useState("")
  const [searchPage, setSearchPage] = useState(1)

  const {
    data: searchResults,
    isLoading,
    isFetching
  } = useSearchTerms(searchQuery, searchPage, 20)

  const options: ComboboxOption[] = useMemo(() => {
    const dataSource = searchResults?.data.length > 0 ? searchResults.data : terms

    return dataSource.map((term: Term) => ({
      value: term.id,
      label: term.name,
      description: term.is_active ? "Active term" : undefined,
      icon: Calendar
    }))
  }, [searchResults?.data, terms])

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
      placeholder="Select a term"
      searchPlaceholder="Search terms..."
      emptyMessage="No terms found."
    />
  )
}

// Instructor Combobox Component
interface InstructorComboboxProps {
  value?: number | null
  onValueChange: (value: number | null) => void
  disabled?: boolean
  className?: string
  instructors?: Instructor[]
}

export function InstructorCombobox({
  value,
  onValueChange,
  disabled,
  className,
  instructors = []
}: InstructorComboboxProps) {
  const [searchQuery, setSearchQuery] = useState("")
  const [searchPage, setSearchPage] = useState(1)

  const {
    data: searchResults,
    isLoading,
    isFetching
  } = useSearchInstructors(searchQuery, searchPage, 20)

  const options: ComboboxOption[] = useMemo(() => {
    const dataSource = searchResults?.data.length > 0 ? searchResults.data : instructors

    return dataSource.map((instructor: Instructor) => ({
      value: instructor.id,
      label: `${instructor.first_name} ${instructor.last_name}`,
      description: instructor.employee_id,
      icon: UserCheck
    }))
  }, [searchResults?.data, instructors])

  const handleSearch = (query: string) => {
    setSearchQuery(query)
    setSearchPage(1)
  }

  const handleLoadMore = (query: string, page: number) => {
    setSearchQuery(query)
    setSearchPage(page)
  }

  const handleValueChange = (newValue: string | number | undefined) => {
    if (newValue === null || newValue === undefined) {
      onValueChange(null)
    } else {
      onValueChange(newValue as number)
    }
  }

  return (
    <SearchableCombobox
      value={value ?? undefined}
      onValueChange={handleValueChange}
      options={options}
      onSearch={handleSearch}
      onLoadMore={handleLoadMore}
      disabled={disabled}
      className={className}
      isLoading={isLoading}
      isLoadingMore={isFetching}
      hasMore={searchResults?.hasMore || false}
      placeholder="Select an instructor (optional)"
      searchPlaceholder="Search instructors..."
      emptyMessage="No instructors found."
    />
  )
}
