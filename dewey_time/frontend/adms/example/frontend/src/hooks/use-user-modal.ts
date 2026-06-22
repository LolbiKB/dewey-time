import { useState } from "react"

export function useUserModal() {
  const [isOpen, setIsOpen] = useState(false)
  const [mode, setMode] = useState<"create" | "edit">("create")
  const [selectedUserId, setSelectedUserId] = useState<string | undefined>(undefined)

  const openCreate = () => {
    setMode("create")
    setSelectedUserId(undefined)
    setIsOpen(true)
  }

  const openEdit = (userId: string) => {
    setMode("edit")
    setSelectedUserId(userId)
    setIsOpen(true)
  }

  const close = () => {
    setIsOpen(false)
    // Reset state after modal closes to prevent flash of old content
    setTimeout(() => {
      setSelectedUserId(undefined)
      setMode("create")
    }, 150)
  }

  return {
    isOpen,
    mode,
    selectedUserId,
    openCreate,
    openEdit,
    close
  }
}