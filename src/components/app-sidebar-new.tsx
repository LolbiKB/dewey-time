import * as React from "react"
import { useLocation, Link } from "react-router-dom"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  LayoutDashboard,
  Clock,
  Users,
  Monitor,
  Settings,
  ChevronLeft,
  ChevronRight,
  Fingerprint,
} from "lucide-react"

interface NavItem {
  title: string
  href: string
  icon: React.ElementType
  description?: string
}

const mainNavItems: NavItem[] = [
  {
    title: "Overview",
    href: "/",
    icon: LayoutDashboard,
    description: "Dashboard overview",
  },
  {
    title: "Attendance Logs",
    href: "/attendance-logs",
    icon: Clock,
    description: "View attendance records",
  },
]

const managementNavItems: NavItem[] = [
  {
    title: "Users",
    href: "/users",
    icon: Users,
    description: "Manage users and biometrics",
  },
  {
    title: "Devices",
    href: "/devices",
    icon: Monitor,
    description: "Manage ZKTeco devices",
  },
]

interface AppSidebarProps {
  isOpen: boolean
  onToggle: () => void
}

export function AppSidebar({ isOpen, onToggle }: AppSidebarProps) {
  const location = useLocation()
  const pathname = location.pathname

  const NavItemComponent = ({ item, isCollapsed }: { item: NavItem; isCollapsed: boolean }) => {
    const isActive = pathname === item.href
    const Icon = item.icon

    if (isCollapsed) {
      return (
        <TooltipProvider delayDuration={0}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Link
                to={item.href}
                className={cn(
                  "flex h-10 w-10 items-center justify-center rounded-lg transition-colors",
                  "hover:bg-accent hover:text-accent-foreground",
                  isActive && "bg-primary text-primary-foreground hover:bg-primary/90"
                )}
              >
                <Icon className="h-5 w-5" />
                <span className="sr-only">{item.title}</span>
              </Link>
            </TooltipTrigger>
            <TooltipContent side="right" className="flex flex-col gap-1">
              <span className="font-medium">{item.title}</span>
              {item.description && (
                <span className="text-xs text-muted-foreground">{item.description}</span>
              )}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )
    }

    return (
      <Link
        to={item.href}
        className={cn(
          "group flex items-center gap-3 rounded-lg px-3 py-2.5 transition-all",
          "hover:bg-accent hover:text-accent-foreground",
          isActive && "bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm"
        )}
      >
        <Icon className={cn("h-5 w-5 shrink-0", isActive && "text-primary-foreground")} />
        <div className="flex flex-col gap-0.5 overflow-hidden">
          <span className={cn("text-sm font-medium truncate", isActive && "text-primary-foreground")}>
            {item.title}
          </span>
          {item.description && !isActive && (
            <span className="text-xs text-muted-foreground truncate">{item.description}</span>
          )}
        </div>
        {isActive && (
          <div className="ml-auto h-1.5 w-1.5 rounded-full bg-primary-foreground" />
        )}
      </Link>
    )
  }

  return (
    <TooltipProvider delayDuration={0}>
      <aside
        className={cn(
          "fixed left-0 top-0 z-40 flex h-screen flex-col border-r bg-background transition-all duration-300 ease-in-out",
          isOpen ? "w-64" : "w-16"
        )}
      >
        {/* Header */}
        <div className={cn("flex h-16 items-center border-b px-4", !isOpen && "justify-center px-2")}>
          {isOpen ? (
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
                <Fingerprint className="h-5 w-5" />
              </div>
              <div className="flex flex-col">
                <span className="text-sm font-bold leading-tight">ZKTeco ADMS</span>
                <span className="text-[10px] text-muted-foreground leading-tight">Bridge</span>
              </div>
            </div>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm cursor-pointer">
                  <Fingerprint className="h-5 w-5" />
                </div>
              </TooltipTrigger>
              <TooltipContent side="right">
                <span className="font-bold">ZKTeco ADMS Bridge</span>
              </TooltipContent>
            </Tooltip>
          )}
        </div>

        {/* Toggle Button */}
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            "absolute -right-3 top-20 h-6 w-6 rounded-full border bg-background shadow-md hover:bg-accent",
            "flex items-center justify-center"
          )}
          onClick={onToggle}
        >
          {isOpen ? (
            <ChevronLeft className="h-3 w-3" />
          ) : (
            <ChevronRight className="h-3 w-3" />
          )}
        </Button>

        {/* Navigation */}
        <div className="flex-1 overflow-y-auto py-4">
          <nav className={cn("grid gap-1 px-2", !isOpen && "justify-center")}>
            {/* Main Navigation */}
            <div className={cn("mb-4", !isOpen && "mb-2")}>
              {isOpen && (
                <h3 className="mb-2 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Main
                </h3>
              )}
              <div className="grid gap-1">
                {mainNavItems.map((item) => (
                  <NavItemComponent key={item.href} item={item} isCollapsed={!isOpen} />
                ))}
              </div>
            </div>

            <Separator className={cn("my-2", !isOpen && "mx-auto w-8")} />

            {/* Management Navigation */}
            <div className={cn("mb-4", !isOpen && "mb-2")}>
              {isOpen && (
                <h3 className="mb-2 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Management
                </h3>
              )}
              <div className="grid gap-1">
                {managementNavItems.map((item) => (
                  <NavItemComponent key={item.href} item={item} isCollapsed={!isOpen} />
                ))}
              </div>
            </div>
          </nav>
        </div>

        {/* Footer */}
        <div className={cn("border-t p-4", !isOpen && "p-2")}>
          {isOpen ? (
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">v1.0.0</span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8">
                    <Settings className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top">Settings</TooltipContent>
              </Tooltip>
            </div>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8 w-full">
                  <Settings className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">Settings</TooltipContent>
            </Tooltip>
          )}
        </div>
      </aside>
    </TooltipProvider>
  )
}
