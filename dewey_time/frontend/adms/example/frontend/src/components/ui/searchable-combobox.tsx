import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Check, ChevronsUpDown, X } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

// Generic option interface
export interface ComboboxOption {
  value: string | number
  label: string
  description?: string
  icon?: React.ComponentType<{ className?: string }>
  avatar?: string // URL for avatar image
  user?: { firstName?: string; lastName?: string; email?: string } // For generating avatar initials
  disabled?: boolean
}

// Search result interface for server-side pagination
export interface SearchResult<T> {
  data: T[]
  hasMore: boolean
  total: number
  page: number
  limit: number
}

interface SearchableComboboxProps {
  // Value and change handling - supports both single and multi-select
  value?: string | number
  values?: (string | number)[]
  onValueChange?: (value: string | number | undefined) => void
  onValuesChange?: (values: (string | number)[]) => void

  // Options and search
  options: ComboboxOption[]
  onSearch?: (query: string) => void
  onLoadMore?: (query: string, page: number) => void

  // State
  disabled?: boolean
  isLoading?: boolean
  isLoadingMore?: boolean
  hasMore?: boolean

  // Appearance
  placeholder?: string
  emptyMessage?: string
  searchPlaceholder?: string
  className?: string
  placeholderClassName?: string

  // Behavior
  allowClear?: boolean
  autoFocus?: boolean
  multiSelect?: boolean
  maxDisplayItems?: number
}

export function SearchableCombobox({
  value,
  values = [],
  onValueChange,
  onValuesChange,
  options,
  onSearch,
  onLoadMore,
  disabled = false,
  isLoading = false,
  isLoadingMore = false,
  hasMore = false,
  placeholder = "Select option...",
  emptyMessage = "No options found.",
  searchPlaceholder = "Search...",
  className,
  placeholderClassName,
  allowClear = true,
  autoFocus = false,
  multiSelect = false,
  maxDisplayItems = 3
}: SearchableComboboxProps) {
  const [open, setOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const [currentPage, setCurrentPage] = useState(1)

  // Find selected option(s)
  const selectedOption = multiSelect ? null : options.find(option => option.value === value)
  const selectedOptions = multiSelect
    ? values.map(val => options.find(option => option.value === val)).filter(Boolean) as ComboboxOption[]
    : []

  const handleSearch = (query: string) => {
    setSearchQuery(query)
    setCurrentPage(1) // Reset page when searching
    onSearch?.(query)
  }

  // Filter options client-side when no server-side search is provided
  const filteredOptions = onSearch ? options : options.filter(option =>
    option.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
    option.description?.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const handleSelect = (selectedValue: string | number) => {
    if (multiSelect) {
      if (!onValuesChange) return

      const newValues = values.includes(selectedValue)
        ? values.filter(v => v !== selectedValue)
        : [...values, selectedValue]

      onValuesChange(newValues)
    } else {
      if (!onValueChange) return

      if (selectedValue === value) {
        // If same value is selected, clear it (toggle behavior)
        onValueChange(undefined)
      } else {
        onValueChange(selectedValue)
      }
      setOpen(false)
    }
  }

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (multiSelect) {
      onValuesChange?.([])
    } else {
      onValueChange?.(undefined)
    }
  }

  const removeValue = (valueToRemove: string | number) => {
    if (multiSelect && onValuesChange) {
      onValuesChange(values.filter(v => v !== valueToRemove))
    }
  }

  const handleLoadMore = () => {
    if (onLoadMore && hasMore && !isLoadingMore) {
      const nextPage = currentPage + 1
      setCurrentPage(nextPage)
      onLoadMore(searchQuery, nextPage)
    }
  }

  const handleOpenChange = (isOpen: boolean) => {
    setOpen(isOpen)
    if (!isOpen) {
      // Reset pagination when closing
      setCurrentPage(1)
      // Only reset search query when using server-side search
      if (onSearch) {
        setSearchQuery("")
      }
    }
  }

  // Reset search and pagination when options change (new search results)
  useEffect(() => {
    if (!isLoading && !isLoadingMore) {
      // Options have been updated, we can reset pagination state if needed
    }
  }, [options, isLoading, isLoadingMore])

  return (
    <div className={cn("w-full", className)}>
      {/* Multi-select: Selected Items Display */}
      {multiSelect && selectedOptions.length > 0 && maxDisplayItems > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {selectedOptions.slice(0, maxDisplayItems).map((option) => (
            <div
              key={option.value}
              className="inline-flex items-center gap-1 px-2 py-1 text-xs bg-secondary text-secondary-foreground rounded-md"
            >
              {option.avatar || option.user ? (
                <Avatar className="h-5 w-5 shrink-0">
                  <AvatarImage className="object-cover" src={option.avatar} />
                  <AvatarFallback className="text-xs">
                    {option.user && option.user.firstName && option.user.lastName
                      ? `${option.user.firstName[0]}${option.user.lastName[0]}`
                      : option.user?.email?.slice(0, 2).toUpperCase() || '?'
                    }
                  </AvatarFallback>
                </Avatar>
              ) : option.icon ? (
                <option.icon className="h-3 w-3" />
              ) : null}
              <span>{option.label}</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-3 w-3 p-0 hover:bg-destructive/10"
                onClick={() => removeValue(option.value)}
              >
                <X className="h-2 w-2" />
              </Button>
            </div>
          ))}
          {selectedOptions.length > maxDisplayItems && (
            <div className="inline-flex items-center px-2 py-1 text-xs bg-muted text-muted-foreground rounded-md">
              +{selectedOptions.length - maxDisplayItems} more
            </div>
          )}
        </div>
      )}

      {/* Combobox */}
      <div className="flex items-center gap-1 w-full">
        <Popover open={open} onOpenChange={handleOpenChange}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              role="combobox"
              aria-expanded={open}
              className="flex-1 justify-between min-w-0"
              disabled={disabled}
            >
              <div className="flex items-center gap-2 overflow-hidden">
                {!multiSelect && selectedOption && (
                  selectedOption.avatar || selectedOption.user ? (
                    <Avatar className="h-6 w-6 shrink-0">
                      <AvatarImage className="object-cover" src={selectedOption.avatar} />
                      <AvatarFallback className="text-xs">
                        {selectedOption.user && selectedOption.user.firstName && selectedOption.user.lastName
                          ? `${selectedOption.user.firstName[0]}${selectedOption.user.lastName[0]}`
                          : selectedOption.user?.email?.slice(0, 2).toUpperCase() || '?'
                        }
                      </AvatarFallback>
                    </Avatar>
                  ) : selectedOption.icon ? (
                    <selectedOption.icon className="h-4 w-4 shrink-0" />
                  ) : null
                )}
                <span className={cn(
                  "truncate",
                  (!selectedOption && !multiSelect) || (multiSelect && selectedOptions.length === 0)
                    ? (placeholderClassName || "text-muted-foreground") : ""

                )}>
                  {multiSelect
                    ? (selectedOptions.length > 0
                      ? `${selectedOptions.length} selected`
                      : placeholder)
                    : (selectedOption ? selectedOption.label : placeholder)
                  }
                </span>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <ChevronsUpDown className="h-4 w-4 opacity-50" />
              </div>
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-full min-w-[var(--radix-popper-anchor-width)] p-0" align="start">
            <Command shouldFilter={false}>
              <CommandInput
                placeholder={searchPlaceholder}
                value={searchQuery}
                onValueChange={handleSearch}
                autoFocus={autoFocus}
                data-1p-ignore="true"
                data-lpignore="true"
                data-bwignore="true"
                data-dashlane-ignore="true"
                data-form-type="search"
              />
              <CommandList>
                <CommandEmpty>
                  <span className="text-muted-foreground">
                    {isLoading ? "Loading..." : emptyMessage}
                  </span>
                </CommandEmpty>
                <CommandGroup>
                  {filteredOptions.map((option) => (
                    <CommandItem
                      key={option.value}
                      value={option.label}
                      onSelect={() => handleSelect(option.value)}
                      disabled={option.disabled}
                      className="flex items-center justify-between"
                    >
                      <div className="flex items-center gap-2 overflow-hidden">
                        {option.avatar || option.user ? (
                          <Avatar className="h-7 w-7 shrink-0">
                            <AvatarImage className="object-cover" src={option.avatar} />
                            <AvatarFallback className="text-xs">
                              {option.user && option.user.firstName && option.user.lastName
                                ? `${option.user.firstName[0]}${option.user.lastName[0]}`
                                : option.user?.email?.slice(0, 2).toUpperCase() || '?'
                              }
                            </AvatarFallback>
                          </Avatar>
                        ) : option.icon ? (
                          <option.icon className="h-4 w-4 shrink-0" />
                        ) : null}
                        <div className="flex flex-col overflow-hidden">
                          <span className="truncate font-medium">{option.label}</span>
                          {option.description && (
                            <span className="text-xs text-muted-foreground truncate">
                              {option.description}
                            </span>
                          )}
                        </div>
                      </div>
                      <Check
                        className={cn(
                          "h-4 w-4 shrink-0 ml-2",
                          multiSelect
                            ? (values.includes(option.value) ? "opacity-100" : "opacity-0")
                            : (value === option.value ? "opacity-100" : "opacity-0")
                        )}
                      />
                    </CommandItem>
                  ))}

                  {/* Load More Button */}
                  {hasMore && (
                    <CommandItem
                      disabled={isLoadingMore}
                      onSelect={handleLoadMore}
                      className="justify-center text-sm text-muted-foreground hover:text-foreground"
                    >
                      {isLoadingMore ? (
                        <div className="flex items-center gap-2">
                          <div className="animate-spin h-3 w-3 border border-current border-t-transparent rounded-full" />
                          Loading more...
                        </div>
                      ) : (
                        "Load more..."
                      )}
                    </CommandItem>
                  )}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>        {/* Clear Button */}
        {allowClear && !disabled && (
          (multiSelect ? selectedOptions.length > 0 : selectedOption)
        ) && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9 w-9 p-0 shrink-0"
              onClick={handleClear}
            >
              <X className="h-4 w-4 text-muted-foreground" />
            </Button>
          )}
      </div>
    </div>
  )
}

// Backward compatibility - MultiSelectCombobox as alias
interface MultiSelectComboboxProps extends Omit<SearchableComboboxProps, 'value' | 'onValueChange' | 'multiSelect'> {
  values: (string | number)[]
  onValuesChange: (values: (string | number)[]) => void
  maxDisplayItems?: number
}

export function MultiSelectCombobox(props: MultiSelectComboboxProps) {
  return (
    <SearchableCombobox
      {...props}
      multiSelect={true}
      values={props.values}
      onValuesChange={props.onValuesChange}
    />
  )
}
