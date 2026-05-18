import { format } from "date-fns"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Calendar } from "@/components/ui/calendar"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { CloudOff, X, ChevronsUpDown, Server } from "lucide-react"
import { useUserPhoto } from "@/hooks/use-user-photo"

// ========================================
// HEADER COMPONENTS (Filters)
// ========================================

interface SelectFilterHeaderProps {
  title: string
  currentFilter?: string
  options: Array<{ value: string; label: string }>
  onFilterChange: (value: string) => void
  disabled?: boolean
}

export function SelectFilterHeader({
  title,
  currentFilter,
  options,
  onFilterChange,
  disabled = false
}: SelectFilterHeaderProps) {
  return (
    <div className="flex items-center gap-1 w-full">
      <Select
        value={currentFilter || undefined}
        onValueChange={onFilterChange}
        disabled={disabled}
      >
        <SelectTrigger className="flex-1">
          <SelectValue placeholder={`All ${title}`} />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {currentFilter && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-9 w-9 p-0 shrink-0"
          onClick={() => onFilterChange('')}
        >
          <X className="h-4 w-4 text-muted-foreground" />
        </Button>
      )}
    </div>
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

// ========================================
// CELL COMPONENTS (Data Display)
// ========================================

interface TwoLineTextCellProps {
  mainText: string
  secondaryText?: string
  mainClassName?: string
  secondaryClassName?: string
}

export function TwoLineTextCell({
  mainText,
  secondaryText,
  mainClassName = "",
  secondaryClassName = "text-sm text-muted-foreground"
}: TwoLineTextCellProps) {
  return (
    <div className="space-y-0.5">
      <div className={mainClassName}>
        <span>{mainText}</span>
      </div>
      {secondaryText && (
        <div className={secondaryClassName}>
          <span>{secondaryText}</span>
        </div>
      )}
    </div>
  )
}

interface BadgeCellProps {
  text: string
  variant?: 'default' | 'secondary' | 'destructive' | 'outline'
}

export function BadgeCell({
  text,
  variant = 'secondary'
}: BadgeCellProps) {
  return <Badge variant={variant}>{text}</Badge>
}

interface AvatarCellProps {
  photoUrl?: string | null
  hasCachedPhoto?: boolean
  userId?: string
  frappeEmployeeId?: string
  fallbackText: string
  size?: 'sm' | 'md' | 'lg'
}

export function AvatarCell({
  photoUrl,
  hasCachedPhoto,
  userId,
  frappeEmployeeId,
  fallbackText,
  size = 'md'
}: AvatarCellProps) {
  const sizeClasses = {
    sm: 'h-8 w-8 text-xs',
    md: 'h-10 w-10 text-sm',
    lg: 'h-12 w-12 text-base'
  }

  // Resolve photo URL — uses Supabase Storage URL for cached photos,
  // proxy URL for uncached private Frappe photos, or null for no photo
  const { photoUrl: displayUrl, isCached } = useUserPhoto({
    photoUrl,
    hasCachedPhoto,
    userId,
    frappeEmployeeId,
    enabled: true,
  })

  // Get initials from fallback text (max 2 characters)
  const getInitials = (text: string) => {
    return text
      .split(' ')
      .map(part => part[0])
      .filter(Boolean)
      .slice(0, 2)
      .join('')
      .toUpperCase()
  }

  const initials = getInitials(fallbackText)

  return (
    <div className="relative">
      <Avatar className={`${sizeClasses[size]} bg-gray-100`}>
        <AvatarImage
          key={displayUrl || 'no-photo'}
          src={displayUrl || undefined}
          alt={fallbackText}
          className="object-cover"
        />
        <AvatarFallback className="bg-primary/10 text-primary font-medium">
          {initials}
        </AvatarFallback>
      </Avatar>
      {/* Cloud icon indicator - photo exists in Frappe but not yet processed for devices */}
      {photoUrl && !hasCachedPhoto && (
        <div 
          className="absolute -bottom-1 -right-1 bg-background rounded-full p-0.5"
          title="Photo not processed for devices - click refresh in menu to process"
        >
          <CloudOff className="w-3 h-3 text-blue-500" />
        </div>
      )}
    </div>
  )
}

interface UserCellProps {
  photoUrl?: string | null
  hasCachedPhoto?: boolean
  userId?: string
  frappeEmployeeId?: string
  name: string
  secondaryText?: string
  avatarSize?: 'sm' | 'md' | 'lg'
}

export function UserCell({
  photoUrl,
  hasCachedPhoto,
  userId,
  frappeEmployeeId,
  name,
  secondaryText,
  avatarSize = 'sm'
}: UserCellProps) {
  return (
    <div className="flex items-center gap-3">
      <AvatarCell
        photoUrl={photoUrl}
        hasCachedPhoto={hasCachedPhoto}
        userId={userId}
        frappeEmployeeId={frappeEmployeeId}
        fallbackText={name}
        size={avatarSize}
      />
      <div className="flex flex-col">
        <span className="font-medium">{name}</span>
        {secondaryText && (
          <span className="text-sm text-muted-foreground">{secondaryText}</span>
        )}
      </div>
    </div>
  )
}

interface DeviceCellProps {
  name?: string | null
  location?: string | null
}

export function DeviceCell({
  name,
  location,
}: DeviceCellProps) {
  return (
    <div className="flex items-center gap-3">
      <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
        <Server className="h-4 w-4 text-primary" />
      </div>
      <div className="flex flex-col">
        <span className="font-medium">{name || 'Unnamed Device'}</span>
        {location && (
          <span className="text-sm text-muted-foreground">{location}</span>
        )}
      </div>
    </div>
  )
}
