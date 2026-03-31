import * as React from "react"
import { Home, CalendarCheck, Users, ChevronRight, Fingerprint } from "lucide-react"
import { Link, useLocation } from "react-router-dom"

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail,
} from "@/components/ui/sidebar"

const menuItems = [
  {
    title: "Dashboard",
    url: "#",
    icon: Home,
    items: [
      {
        title: "Overview",
        url: "/",
      },
    ],
  },
  {
    title: "Attendance",
    url: "#",
    icon: CalendarCheck,
    items: [
      {
        title: "Attendance Logs",
        url: "/attendance-logs",
      },
    ],
  },
  {
    title: "Management",
    url: "#",
    icon: Users,
    items: [
      {
        title: "User Management",
        url: "/users",
      },
      {
        title: "Device Management",
        url: "/devices",
      },
    ],
  },
]

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const location = useLocation()

  // Determine which section should be open based on current route
  const getDefaultOpen = (items: typeof menuItems[0]['items']) => {
    return items.some(item => location.pathname === item.url)
  }

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader className="p-2">
        <a href="/" className="flex items-center justify-center h-10 relative">
          {/* Collapsed: just icon - fades out when expanded */}
          <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground absolute transition-all duration-200 ease-out group-data-[state=expanded]:opacity-0 group-data-[state=expanded]:scale-75">
            <Fingerprint className="size-4" />
          </div>
          {/* Expanded: full logo - fades in when expanded */}
          <div className="flex items-center gap-2 absolute transition-all duration-200 ease-out opacity-0 scale-75 group-data-[state=expanded]:opacity-100 group-data-[state=expanded]:scale-100">
            <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Fingerprint className="size-4" />
            </div>
            <div className="flex flex-col overflow-hidden">
              <span className="text-sm font-bold whitespace-nowrap">ZKTeco ADMS</span>
              <span className="text-xs text-muted-foreground whitespace-nowrap">Bridge System</span>
            </div>
          </div>
        </a>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Platform</SidebarGroupLabel>
          <SidebarMenu>
            {menuItems.map((item) => (
              <Collapsible
                key={item.title}
                asChild
                defaultOpen={getDefaultOpen(item.items)}
                className="group/collapsible"
              >
                <SidebarMenuItem>
                  <CollapsibleTrigger asChild>
                    <SidebarMenuButton tooltip={item.title}>
                      {item.icon && <item.icon />}
                      <span className="min-w-0 flex-1">{item.title}</span>
                      <ChevronRight className="ml-auto shrink-0 transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90 group-data-[collapsible=icon]:hidden" />
                    </SidebarMenuButton>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-none">
                    <SidebarMenuSub className="border-l-0 px-0">
                      {item.items?.map((subItem) => (
                        <SidebarMenuSubItem key={subItem.title}>
                          <SidebarMenuSubButton asChild isActive={location.pathname === subItem.url}>
                            <Link to={subItem.url} className="min-w-0">
                              <span className="min-w-0">{subItem.title}</span>
                            </Link>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                      ))}
                    </SidebarMenuSub>
                  </CollapsibleContent>
                </SidebarMenuItem>
              </Collapsible>
            ))}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <div className="flex items-center gap-2 px-2 py-2 text-xs text-muted-foreground">
              <span className="group-data-[collapsible=icon]:hidden">
                v1.0.0
              </span>
            </div>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  )
}
