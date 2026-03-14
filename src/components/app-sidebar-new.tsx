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
        <TooltipProvider delayDuration={100}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Link
                to={item.href}
                className={cn(
                  "flex h-10 w-10 items-center justify-center rounded-lg transition-colors duration-200",
                  !isActive && "hover:bg-accent hover:text-accent-foreground",
                  isActive && "bg-primary text-primary-foreground shadow-sm"
                )}
              >
                <Icon className="h-5 w-5" />
                <span className="sr-only">{item.title}</span>
              </Link>
            </TooltipTrigger>
            <TooltipContent 
              side="right" 
              className="flex flex-col gap-1"
            >
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
          "group flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors duration-200",
          "relative overflow-hidden",
          !isActive && "hover:bg-accent hover:text-accent-foreground",
          isActive && "bg-primary text-primary-foreground shadow-sm"
        )}
      >
        {/* Active indicator bar */}
        {isActive && (
          <div className="absolute left-0 top-0 bottom-0 w-1 bg-primary-foreground" />
        )}
        
        <Icon 
          className={cn(
            "h-5 w-5 shrink-0",
            isActive && "text-primary-foreground"
          )} 
        />
        <div className="flex flex-col gap-0.5 overflow-hidden flex-1">
          <span 
            className={cn(
              "text-sm font-medium truncate",
              isActive && "text-primary-foreground"
            )}
          >
            {item.title}
          </span>
          {item.description && !isActive && (
            <span className="text-xs text-muted-foreground truncate group-hover:text-accent-foreground/70">
              {item.description}
            </span>
          )}
        </div>
        {isActive && (
          <div className="ml-auto flex items-center gap-1">
            <div className="h-1.5 w-1.5 rounded-full bg-primary-foreground" />
          </div>
        )}
      </Link>
    )
  }

  return (
    <TooltipProvider delayDuration={0}>
      <aside
        className={cn(
          "fixed left-0 top-0 z-40 flex h-screen flex-col border-r bg-background transition-all duration-500 ease-[cubic-bezier(0.4,0,0.2,1)]",
          isOpen ? "w-64" : "w-16"
        )}
      >
        {/* Header */}
        <div className={cn("flex h-16 items-center border-b px-4", !isOpen && "justify-center px-2")}>
          <Tooltip>
            <TooltipTrigger asChild>
              <div 
                className="flex items-center gap-3 cursor-pointer"
                onClick={onToggle}
              >
                <div 
                  className={cn(
                    "flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm transition-all duration-500 flex-shrink-0",
                    "hover:shadow-lg hover:scale-105"
                  )}
                >
                  <Fingerprint className="h-5 w-5" />
                </div>
                
                {/* Animated text container */}
                <div 
                  className={cn(
                    "flex flex-col transition-all duration-500 ease-[cubic-bezier(0.4,0,0.2,1)] overflow-hidden",
                    isOpen 
                      ? "opacity-100 translate-x-0 w-auto" 
                      : "opacity-0 -translate-x-4 w-0"
                  )}
                >
                  <span className="text-sm font-bold leading-tight whitespace-nowrap">ZKTeco ADMS</span>
                  <span className="text-[10px] text-muted-foreground leading-tight whitespace-nowrap">Bridge</span>
                </div>
              </div>
            </TooltipTrigger>
            <TooltipContent side="right">
              <span className="font-bold">ZKTeco ADMS Bridge</span>
            </TooltipContent>
          </Tooltip>
        </div>

        {/* Navigation */}
        <div className="flex-1 overflow-y-auto py-4">
          <nav className={cn("grid gap-1 px-2", !isOpen && "justify-center")}>
            {/* Main Navigation */}
            <div className={cn("mb-4", !isOpen && "mb-2")}>
              <h3 
                className={cn(
                  "mb-2 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider",
                  "transition-all duration-500 overflow-hidden whitespace-nowrap",
                  isOpen ? "opacity-100 max-w-full" : "opacity-0 max-w-0 px-0"
                )}
              >
                Main
              </h3>
              <div className="grid gap-1">
                {mainNavItems.map((item, index) => (
                  <div 
                    key={item.href}
                    className="animate-in fade-in slide-in-from-left-2 duration-500"
                    style={{ animationDelay: `${index * 100}ms`, animationFillMode: 'backwards' }}
                  >
                    <NavItemComponent item={item} isCollapsed={!isOpen} />
                  </div>
                ))}
              </div>
            </div>

            <Separator 
              className={cn(
                "my-2 transition-all duration-500",
                !isOpen && "mx-auto w-8"
              )} 
            />

            {/* Management Navigation */}
            <div className={cn("mb-4", !isOpen && "mb-2")}>
              <h3 
                className={cn(
                  "mb-2 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider",
                  "transition-all duration-500 overflow-hidden whitespace-nowrap",
                  isOpen ? "opacity-100 max-w-full" : "opacity-0 max-w-0 px-0"
                )}
              >
                Management
              </h3>
              <div className="grid gap-1">
                {managementNavItems.map((item, index) => (
                  <div 
                    key={item.href}
                    className="animate-in fade-in slide-in-from-left-2 duration-500"
                    style={{ animationDelay: `${(index + 2) * 100}ms`, animationFillMode: 'backwards' }}
                  >
                    <NavItemComponent item={item} isCollapsed={!isOpen} />
                  </div>
                ))}
              </div>
            </div>
          </nav>
        </div>

        {/* Footer */}
        <div className={cn("border-t p-4 overflow-hidden", !isOpen && "p-2")}>
          <div className="flex items-center justify-between">
            {/* Version text - animates out when collapsed */}
            <span 
              className={cn(
                "text-xs text-muted-foreground transition-all duration-500 whitespace-nowrap",
                isOpen ? "opacity-100 max-w-full" : "opacity-0 max-w-0"
              )}
            >
              v1.0.0
            </span>
            
            {/* Settings button */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button 
                  variant="ghost" 
                  size="icon" 
                  className={cn(
                    "h-8 w-8 transition-all duration-300 hover:rotate-45",
                    !isOpen && "w-full"
                  )}
                >
                  <Settings className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side={isOpen ? "top" : "right"} className="animate-in fade-in duration-300">
                Settings
              </TooltipContent>
            </Tooltip>
          </div>
        </div>
      </aside>
    </TooltipProvider>
  )
}
