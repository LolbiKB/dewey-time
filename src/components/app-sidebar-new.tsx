import * as React from "react"
import { useLocation, Link } from "react-router-dom"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
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
}

const navItems: NavItem[] = [
  {
    title: "Overview",
    href: "/",
    icon: LayoutDashboard,
  },
  {
    title: "Attendance",
    href: "/attendance-logs",
    icon: Clock,
  },
  {
    title: "Users",
    href: "/users",
    icon: Users,
  },
  {
    title: "Devices",
    href: "/devices",
    icon: Monitor,
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
            <TooltipContent side="right">
              <span className="font-medium">{item.title}</span>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )
    }

    return (
      <Link
        to={item.href}
        className={cn(
          "flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors duration-200",
          "relative overflow-hidden",
          !isActive && "hover:bg-accent hover:text-accent-foreground",
          isActive && "bg-primary text-primary-foreground shadow-sm"
        )}
      >
        {isActive && (
          <div className="absolute -left-0 top-0 bottom-0 w-1 bg-primary-foreground" />
        )}
        
        <Icon 
          className={cn(
            "h-5 w-5 shrink-0",
            isActive && "text-primary-foreground"
          )} 
        />
        
        <span 
          className={cn(
            "text-sm font-medium",
            isActive && "text-primary-foreground"
          )}
        >
          {item.title}
        </span>
        
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
          "fixed left-0 top-0 z-40 flex h-screen flex-col border-r bg-background transition-all duration-500 ease-[cubic-bezier(0.4,0,0.2,1)]",
          isOpen ? "w-64" : "w-16"
        )}
      >
        {/* Header */}
        <div className={cn("flex h-16 items-center border-b px-4", !isOpen && "justify-center px-2")}>
          {!isOpen ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <div 
                  className="flex items-center gap-3 cursor-pointer"
                  onClick={onToggle}
                >
                  <div 
                    className={cn(
                      "flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm flex-shrink-0",
                      "hover:shadow-lg hover:scale-105 transition-all duration-300"
                    )}
                  >
                    <Fingerprint className="h-5 w-5" />
                  </div>
                </div>
              </TooltipTrigger>
              <TooltipContent side="right">
                <span className="font-bold">ZKTeco ADMS Bridge</span>
              </TooltipContent>
            </Tooltip>
          ) : (
            <div 
              className="flex items-center gap-3 cursor-pointer"
              onClick={onToggle}
            >
              <div 
                className={cn(
                  "flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm flex-shrink-0",
                  "hover:shadow-lg hover:scale-105 transition-all duration-300"
                )}
              >
                <Fingerprint className="h-5 w-5" />
              </div>
              
              <div className="flex flex-col">
                <span className="text-sm font-bold leading-tight whitespace-nowrap">ZKTeco ADMS</span>
                <span className="text-[10px] text-muted-foreground leading-tight whitespace-nowrap">Bridge</span>
              </div>
            </div>
          )}
        </div>

        {/* Navigation */}
        <div className="flex-1 overflow-y-auto py-4">
          <nav className={cn("grid gap-1 px-2", !isOpen && "justify-center")}>
            {navItems.map((item) => (
              <NavItemComponent key={item.href} item={item} isCollapsed={!isOpen} />
            ))}
          </nav>
        </div>

        {/* Footer */}
        <div className={cn("border-t p-4", !isOpen && "p-2")}>
          <div className="flex items-center justify-between">
            {isOpen && (
              <span className="text-xs text-muted-foreground">v1.0.0</span>
            )}
            
            <Tooltip>
              <TooltipTrigger asChild>
                <Button 
                  variant="ghost" 
                  size="icon" 
                  className={cn(
                    "h-8 w-8 hover:rotate-45 transition-transform duration-300",
                    !isOpen && "w-full"
                  )}
                >
                  <Settings className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side={isOpen ? "top" : "right"}>
                Settings
              </TooltipContent>
            </Tooltip>
          </div>
        </div>
      </aside>
    </TooltipProvider>
  )
}