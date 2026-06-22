import { useState } from "react"
import { formatISO, format } from "date-fns"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Calendar } from "@/components/ui/calendar"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

import { X, ChevronsUpDown, MoreHorizontal, Copy, Check } from "lucide-react"
import { AvatarModal } from "../user-management/modals/avatar-modal"
import { SearchableCombobox, type ComboboxOption } from "./searchable-combobox"

// ========================================
// HEADER COMPONENTS (Filters)
// ========================================

interface SelectFilterHeaderProps {
  title: string
  currentFilter?: string
  options: Array<{ value: string; label: string; description?: string }>
  onFilterChange: (value: string) => void
  onClearFilter: () => void
  disabled?: boolean
}

export function SelectFilterHeader({
  title,
  currentFilter,
  options,
  onFilterChange,
  onClearFilter,
  disabled = false
}: SelectFilterHeaderProps) {
  // Convert options to ComboboxOption format
  const comboboxOptions: ComboboxOption[] = options.map(option => ({
    value: option.value,
    label: option.label,
    description: option.description
  }))

  const handleValueChange = (value: string | number | undefined) => {
    if (value === undefined || value === '') {
      onClearFilter()
    } else {
      onFilterChange(String(value))
    }
  }

  return (
    <SearchableCombobox
      value={currentFilter || ''}
      onValueChange={handleValueChange}
      options={comboboxOptions}
      placeholder={`All ${title}`}
      placeholderClassName="text-foreground"
      searchPlaceholder={`Search ${title.toLowerCase()}...`}
      emptyMessage={`No ${title.toLowerCase()} found`}
      disabled={disabled}
      allowClear={true}
      className="w-full"
    />
  )
}

interface DateFilterHeaderProps {
  title: string
  currentFilter?: Date
  onFilterChange: (date: Date | undefined) => void
  maxDate?: Date
}

export function DateFilterHeader({
  title,
  currentFilter,
  onFilterChange,
  maxDate = new Date()
}: DateFilterHeaderProps) {
  return (
    <div className="flex items-center gap-1 w-full">
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            className="flex-1 justify-between min-w-0"
          >
            <div className="flex items-center gap-2 overflow-hidden">
              <span className="truncate">
                {currentFilter ? format(currentFilter, 'MMM dd, yyyy') : `All ${title}`}
              </span>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <ChevronsUpDown className="h-4 w-4 opacity-50" />
            </div>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto overflow-hidden p-0" align="start">
          <Calendar
            mode="single"
            selected={currentFilter}
            captionLayout="dropdown"
            disabled={(date) => date > maxDate}
            onSelect={onFilterChange}
          />
        </PopoverContent>
      </Popover>
      {currentFilter && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-9 w-9 p-0 shrink-0"
          onClick={() => onFilterChange(undefined)}
        >
          <X className="h-4 w-4 text-muted-foreground" />
        </Button>
      )}
    </div>
  )
}

interface DropdownMenuFilterHeaderProps {
  title: string
  children: React.ReactNode
  disabled?: boolean
  hasActiveFilters?: boolean
  onClearAllFilters?: () => void
}

export function DropdownMenuFilterHeader({
  title,
  children,
  disabled = false,
  hasActiveFilters = false,
  onClearAllFilters
}: DropdownMenuFilterHeaderProps) {
  const [open, setOpen] = useState(false)

  const handleClearAll = () => {
    onClearAllFilters?.()
    setOpen(false)
  }

  return (
    <div className="flex items-center gap-1 w-full">
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            className="flex-1 justify-between min-w-0"
            disabled={disabled}
          >
            <div className="overflow-hidden">
              <span className="truncate">
                {hasActiveFilters ? `${title} (Filtered)` : `All ${title}`}
              </span>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <MoreHorizontal className="h-4 w-4 opacity-50" />
            </div>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="p-4" style={{ width: 'var(--radix-dropdown-menu-trigger-width)' }}>
          <div className="space-y-2">
            {children}
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
      {hasActiveFilters && onClearAllFilters && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-9 w-9 p-0 shrink-0"
          onClick={handleClearAll}
        >
          <X className="h-4 w-4 text-muted-foreground" />
        </Button>
      )}
    </div>
  )
}

interface FilterSectionProps {
  label?: string
  children: React.ReactNode
}

export function FilterSection({ label, children }: FilterSectionProps) {
  return (
    <div>
      <label className="text-sm font-medium text-foreground">{label}</label>
      {children}
    </div>
  )
}

// ========================================
// CELL COMPONENTS (Data Display)
// ========================================

interface User {
  id: string
  email: string
  firstName?: string
  lastName?: string
  first_name?: string
  last_name?: string
  khmerFirstName?: string
  khmerLastName?: string
  khmer_first_name?: string
  khmer_last_name?: string
  avatarUrl?: string
  avatar_url?: string
}

interface UserCellProps {
  user: User
  onAvatarClick?: () => void
  showKhmerName?: boolean
  showAvatarModal?: boolean
}

export function UserCell({ user, onAvatarClick, showKhmerName = true, showAvatarModal = true }: UserCellProps) {
  const [isAvatarModalOpen, setIsAvatarModalOpen] = useState(false)

  // Handle both naming conventions (camelCase and snake_case)
  const firstName = user.firstName || user.first_name || ''
  const lastName = user.lastName || user.last_name || ''
  const khmerFirst = user.khmerFirstName || user.khmer_first_name
  const khmerLast = user.khmerLastName || user.khmer_last_name
  const avatarUrl = user.avatarUrl || user.avatar_url

  const fullName = firstName && lastName ? `${firstName} ${lastName}` : user.email || 'Unknown User'
  const initials = firstName && lastName
    ? `${firstName[0]}${lastName[0]}`
    : user.email?.slice(0, 2).toUpperCase() || 'U'

  // Create compatible user object for AvatarModal
  const modalUser = {
    id: user.id,
    firstName,
    lastName,
    khmerFirstName: khmerFirst,
    khmerLastName: khmerLast,
    avatarUrl,
    email: user.email,
    createdAt: formatISO(new Date()), // Fallback for missing createdAt
    updatedAt: formatISO(new Date()), // Fallback for missing updatedAt
  }

  const handleAvatarClick = () => {
    if (onAvatarClick) {
      onAvatarClick()
    } else if (showAvatarModal) {
      setIsAvatarModalOpen(true)
    }
  }

  return (
    <>
      <div className="flex items-center gap-3">
        <Avatar
          className={`h-8 w-8 ${(onAvatarClick || showAvatarModal) ? 'cursor-pointer hover:ring-2 hover:ring-primary/20 transition-all duration-200' : ''}`}
          onClick={handleAvatarClick}
        >
          <AvatarImage className="object-cover" src={avatarUrl} alt={fullName} />
          <AvatarFallback className="text-xs">{initials}</AvatarFallback>
        </Avatar>
        <div className="grid gap-.5">
          <div>
            {fullName}
            {showKhmerName && khmerFirst && khmerLast && (
              <span className="ml-2 text-sm font-normal">
                ({khmerLast} {khmerFirst})
              </span>
            )}
          </div>
          <div className="text-sm text-muted-foreground">{user.email}</div>
        </div>
      </div>

      {showAvatarModal && (
        <AvatarModal
          user={modalUser}
          isOpen={isAvatarModalOpen}
          onClose={() => setIsAvatarModalOpen(false)}
        />
      )}
    </>
  )
}

interface TwoLineTextCellProps {
  mainText: string
  secondaryText?: string
  mainIcon?: React.ComponentType<{ className?: string }>
  secondaryIcon?: React.ComponentType<{ className?: string }>
  mainClassName?: string
  secondaryClassName?: string
  iconClassName?: string
  spacing?: 'tight' | 'normal' | 'loose'
}

export function TwoLineTextCell({
  mainText,
  secondaryText,
  mainIcon: MainIcon,
  secondaryIcon: SecondaryIcon,
  mainClassName = "",
  secondaryClassName = "text-sm text-muted-foreground",
  iconClassName = "h-4 w-4 mr-2",
  spacing = 'tight'
}: TwoLineTextCellProps) {
  const gapClass = {
    tight: 'gap-0',
    normal: 'gap-1',
    loose: 'gap-2'
  }[spacing]

  return (
    <div className={spacing === 'tight' ? 'space-y-0.5' : 'space-y-1'}>
      <div className={`flex items-center ${gapClass} ${mainClassName}`}>
        {MainIcon && <MainIcon className={iconClassName} />}
        <span>{mainText}</span>
      </div>
      {secondaryText && (
        <div className={`flex items-center ${gapClass} ${secondaryClassName}`}>
          {SecondaryIcon && <SecondaryIcon className={iconClassName} />}
          <span>{secondaryText}</span>
        </div>
      )}
    </div>
  )
}

interface BadgeCellProps {
  value: string | undefined
  variant?: 'default' | 'secondary' | 'destructive' | 'outline'
  transform?: 'capitalize' | 'uppercase' | 'replace-underscore' | 'none'
  fallback?: string
}

export function BadgeCell({
  value,
  variant = 'secondary',
  transform = 'capitalize',
  fallback = '—'
}: BadgeCellProps) {
  if (!value) return <span className="text-muted-foreground">{fallback}</span>

  let displayValue = value
  if (transform === 'capitalize') displayValue = value.toLowerCase()
  if (transform === 'uppercase') displayValue = value.toUpperCase()
  if (transform === 'replace-underscore') displayValue = value.replace(/_/g, ' ')

  return (
    <Badge variant={variant} className={transform === 'capitalize' ? 'capitalize' : ''}>
      {displayValue}
    </Badge>
  )
}

interface RolesCellProps {
  roles: Array<{ name: string; status?: string }>
  maxDisplay?: number
}

export function RolesCell({ roles, maxDisplay = 2 }: RolesCellProps) {
  const activeRoles = roles.filter(role => !role.status || role.status === 'active')

  if (activeRoles.length === 0) {
    return <span className="text-muted-foreground">—</span>
  }

  const remainingRoles = activeRoles.slice(maxDisplay)

  return (
    <div className="flex flex-wrap gap-1">
      {activeRoles.slice(0, maxDisplay).map((role, index) => (
        <Badge key={index} variant="secondary">
          {role.name}
        </Badge>
      ))}
      {activeRoles.length > maxDisplay && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge variant="secondary" className="cursor-help">
              +{activeRoles.length - maxDisplay} more
            </Badge>
          </TooltipTrigger>
          <TooltipContent>
            {remainingRoles.map((role, index) => (
              <div key={index} className="text-xs">
                {role.name}
              </div>
            ))}
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  )
}

interface IDCellProps {
  id: string
  className?: string
  showIcon?: boolean
}

export function IDCell({ id, className = "", showIcon = true }: IDCellProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(id)
      setCopied(true)
      setTimeout(() => setCopied(false), 1000)
    } catch (err) {
      console.error('Failed to copy ID:', err)
    }
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      className={`font-mono text-left justify-start h-auto p-1 hover:bg-muted/50 transition-colors cursor-pointer group ${className}`}
      onClick={handleCopy}
    >
      <div className="flex items-center gap-2">
        <span>{id}</span>
        {showIcon && (
          copied ? (
            <Check className="h-3 w-3 text-success" />
          ) : (
            <Copy className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
          )
        )}
      </div>
    </Button>
  )
}

interface DescriptionCellProps {
  description: string | null | undefined
  maxWidth?: string
  fallback?: string
  className?: string
}

export function DescriptionCell({
  description,
  maxWidth = '35vw',
  fallback = '—',
  className = ''
}: DescriptionCellProps) {
  if (!description) {
    return <span className="text-muted-foreground">{fallback}</span>
  }

  return (
    <p
      className={`text-muted-foreground ${className}`}
      style={{
        maxWidth,
        display: '-webkit-box',
        WebkitLineClamp: 2,
        WebkitBoxOrient: 'vertical',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'normal',
      }}
    >
      {description}
    </p>
  )
}