import { useState, useMemo, useEffect } from "react"
import { SearchableCombobox, type ComboboxOption } from "@/components/ui/searchable-combobox"

// Generic fetch hook that accepts a custom fetch function
const useSearchUsers = (
  query: string,
  _page: number = 1,
  limit: number = 20,
  fetchFn: (filters: { search?: string; limit?: number }) => Promise<any>
) => {
  const [data, setData] = useState<any>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isFetching, setIsFetching] = useState(false)

  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true)
      setIsFetching(true)
      try {
        const response = await fetchFn({ search: query, limit })
        setData({
          data: response.data || [],
          hasMore: false,
          total: response.data?.length || 0,
          page: 1,
          limit
        })
      } catch (error) {
        console.error('Error fetching users:', error)
        setData({ data: [], hasMore: false, total: 0, page: 1, limit })
      } finally {
        setIsLoading(false)
        setIsFetching(false)
      }
    }

    fetchData()
  }, [query, limit, fetchFn])

  return { data, isLoading, isFetching }
}

// Type interface
interface User {
  id: string
  email: string
  firstName: string
  lastName: string
  khmerFirstName?: string
  khmerLastName?: string
  avatarUrl?: string
}

// Shared User Combobox Component
interface UserComboboxProps {
  value?: string
  onValueChange: (value: string | undefined) => void
  disabled?: boolean
  className?: string
  users?: User[] // Fallback static data
  fetchUsers: (filters: { search?: string; limit?: number }) => Promise<any> // Custom fetch function
}

export function UserCombobox({
  value,
  onValueChange,
  disabled,
  className,
  users = [],
  fetchUsers
}: UserComboboxProps) {
  const [searchQuery, setSearchQuery] = useState("")
  const [searchPage, setSearchPage] = useState(1)

  const {
    data: searchResults,
    isLoading,
    isFetching
  } = useSearchUsers(searchQuery, searchPage, 20, fetchUsers)

  // Convert users to options, prioritize search results if available
  const options: ComboboxOption[] = useMemo(() => {
    const dataSource = searchResults?.data.length > 0 ? searchResults.data : users

    return dataSource.map((user: User) => {
      // Build display name: English name (Khmer last Khmer first) if Khmer names available
      const englishName = `${user.firstName} ${user.lastName}`
      const khmerName = user.khmerLastName && user.khmerFirstName
        ? `${user.khmerLastName} ${user.khmerFirstName}`
        : null

      const displayName = khmerName ? `${englishName} (${khmerName})` : englishName

      return {
        value: user.id,
        label: displayName,
        description: user.email,
        avatar: user.avatarUrl,
        user: { // Pass user data for avatar initials
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email
        }
      }
    })
  }, [searchResults?.data, users])

  const handleSearch = (query: string) => {
    setSearchQuery(query)
    setSearchPage(1)
  }

  const handleLoadMore = (query: string, page: number) => {
    setSearchQuery(query)
    setSearchPage(page)
  }

  const handleValueChange = (newValue: string | number | undefined) => {
    onValueChange(newValue as string | undefined)
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
      placeholder="Select a user"
      searchPlaceholder="Search users..."
      emptyMessage="No users found."
    />
  )
}
