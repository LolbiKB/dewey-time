import * as React from "react"
import { Home, Clock, Users, ChevronRight } from "lucide-react"
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
    icon: Clock,
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
    return items.some(item => location.pathname === item.url || (item.url === '/' && location.pathname === '/attendance-logs'))
  }

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem className="h-auto min-h-[2rem]">
            <a href="/" className="flex items-center justify-center">
              {/* Square logo for collapsed state */}
              <div className="aspect-square size-8 items-center justify-center overflow-hidden group-data-[collapsible=icon]:group-data-[state=collapsed]:flex hidden">
                <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                  <Clock className="size-4" />
                </div>
              </div>

              {/* Full logo for expanded state */}
              <div className="flex flex-col items-center justify-center w-full m-2 transition-[opacity] duration-300 ease-in-out delay-75 group-data-[collapsible=icon]:group-data-[state=collapsed]:hidden group-data-[collapsible=icon]:group-data-[state=collapsed]:opacity-0 group-data-[collapsible=icon]:group-data-[state=collapsed]:delay-0">
                <div className="flex items-center gap-2">
                  <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                    <Clock className="size-4" />
                  </div>
                  <div className="flex flex-col">
                    <span className="text-sm font-semibold">ZKTeco ADMS</span>
                    <span className="text-xs text-muted-foreground">Bridge System</span>
                  </div>
                </div>
              </div>
            </a>
          </SidebarMenuItem>
        </SidebarMenu>
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
                      <span className="truncate">{item.title}</span>
                      <ChevronRight className="ml-auto shrink-0 transition-[transform,opacity,width] duration-300 ease-in-out delay-75 group-data-[state=open]/collapsible:rotate-90 group-data-[collapsible=icon]:w-0 group-data-[collapsible=icon]:opacity-0 group-data-[collapsible=icon]:delay-0" />
                    </SidebarMenuButton>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <SidebarMenuSub>
                      {item.items?.map((subItem) => (
                        <SidebarMenuSubItem key={subItem.title}>
                          <SidebarMenuSubButton asChild isActive={location.pathname === subItem.url || (subItem.url === '/' && location.pathname === '/attendance-logs')}>
                            <Link to={subItem.url}>
                              <span>{subItem.title}</span>
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
