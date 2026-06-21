import * as React from "react"
import { useLocation } from "react-router-dom"

import { NavMain } from "@/components/nav-main"
import { NavUser } from "@/components/nav-user"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar"

import { useAuth } from "@/hooks/use-auth"
import { getVisibleSidebarItems } from "@/config/sidebar-config"

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const { user } = useAuth()
  const location = useLocation()

  if (!user) {
    return null
  }

  // Get visible sidebar sections using the new permission system
  const visibleSections = getVisibleSidebarItems(user.permissions || [])

  // Determine active section based on current route
  const currentPath = location.pathname

  const navMainItems = Object.values(visibleSections).map(section => ({
    title: section.title,
    url: section.sections[0]?.url || '#',
    icon: section.icon,
    isActive: section.sections.some(subsection =>
      currentPath.startsWith(subsection.url.split('/').slice(0, 2).join('/'))
    ),
    items: section.sections.map(subsection => ({
      title: subsection.title,
      url: subsection.url,
      badge: subsection.badge,
      isActive: currentPath === subsection.url
    }))
  }))

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem className="h-auto min-h-[2rem]">
            <a href="/dashboard" className="flex items-center justify-center">
              {/* Square logo for collapsed state */}
              <div className="aspect-square size-8 items-center justify-center overflow-hidden group-data-[collapsible=icon]:group-data-[state=collapsed]:flex hidden">
                <img
                  src="/icons/DIU-Square-120-lossless.webp"
                  alt="DIU Logo"
                  className="size-8 object-contain"
                />
              </div>

              {/* Horizontal logo for expanded state */}
              <div className="flex flex-col items-center justify-center w-full m-2 group-data-[collapsible=icon]:group-data-[state=collapsed]:hidden">
                <img
                  src="/icons/DIU-Horizontal-240w-lossless.webp"
                  alt="DIU Logo"
                  className="h-12 w-auto object-contain mb-1"
                />
                <span style={{ fontFamily: 'Monaco, monospace' }} className="italic text-muted-foreground/80 tracking-wide">
                  manage
                </span>
              </div>
            </a>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <NavMain items={navMainItems} />
      </SidebarContent>

      <SidebarFooter>
        <NavUser />
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  )
}


