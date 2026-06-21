import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import { User, Info, X } from "lucide-react"
import { useState, useRef, useEffect, useMemo } from "react"

import { AvatarCropModal } from "@/components/ui/avatar-crop-modal"
import { Button } from "@/components/ui/button"
import { DatePickerInput } from "@/components/ui/date-picker-input"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import type { CreateUserData } from "@/services/user-service"
import { userFormSchema, transformFormDataForAPI, type UserFormValues } from "@/schemas/user-validation"

interface UserFormProps {
  defaultValues?: Partial<UserFormValues> & { avatarUrl?: string }
  onSubmit: (values: CreateUserData & { clearAvatar?: boolean }) => void | Promise<void>
  isLoading?: boolean
  formId?: string
  onChangesDetected?: (hasChanges: boolean) => void
}

export function UserForm({
  defaultValues,
  onSubmit,
  isLoading = false,
  formId,
  onChangesDetected
}: UserFormProps) {
  // Initialize avatar preview with existing avatar URL if available
  const [avatarPreview, setAvatarPreview] = useState<string | null>(
    defaultValues?.avatarUrl || null
  )
  const [showCropModal, setShowCropModal] = useState(false)
  const [selectedImageSrc, setSelectedImageSrc] = useState<string>("")
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [previousAvatar, setPreviousAvatar] = useState<{ file: File; preview: string } | null>(null)
  const [clearAvatar, setClearAvatar] = useState(false) // Track if user wants to clear existing avatar
  const [avatarChanged, setAvatarChanged] = useState(false) // Track avatar changes for change detection
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleCropComplete = async (processedFile: File, previewUrl: string) => {
    // Save the new cropped image as the "previous" for future cancel operations
    setPreviousAvatar({ file: processedFile, preview: previewUrl })

    form.setValue('avatar', processedFile)
    setAvatarPreview(previewUrl)

    // Mark avatar as changed for change detection
    setAvatarChanged(true)

    // Reset clear flag since user is uploading a new avatar
    setClearAvatar(false)

    setShowCropModal(false)
    setSelectedImageSrc("")
    setSelectedFile(null)
  }

  const handleCropCancel = () => {
    setShowCropModal(false)
    setSelectedImageSrc("")
    setSelectedFile(null)

    // Smart reset: restore previous avatar if it exists, otherwise clear everything
    if (previousAvatar) {
      // User was replacing an existing image - restore the previous one
      form.setValue('avatar', previousAvatar.file)
      setAvatarPreview(previousAvatar.preview)
      // Don't reset file input - user should see that they have an avatar file selected
    } else {
      // First time upload - clear everything
      form.setValue('avatar', undefined)
      setAvatarPreview(null)
      // Reset the file input element only when clearing everything
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

  const handleClearAvatar = () => {
    form.setValue('avatar', undefined)
    setAvatarPreview(null)
    setPreviousAvatar(null)  // Clear previous avatar state

    // Mark avatar as changed for change detection
    setAvatarChanged(true)

    // If there was an existing avatar URL, mark it for clearing
    if (defaultValues?.avatarUrl) {
      setClearAvatar(true)
    }

    // Reset the file input element
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const form = useForm<UserFormValues>({
    resolver: zodResolver(userFormSchema),
    defaultValues: {
      email: "",
      firstName: "",
      lastName: "",
      khmerFirstName: "",
      khmerLastName: "",
      gender: undefined,
      phone: "",
      dateOfBirth: undefined,
      address: "",
      avatar: undefined,
      ...defaultValues,
    },
  })

  // Track form changes
  const { isDirty } = form.formState

  // Calculate if there are any changes
  const hasChanges = useMemo(() => {
    return isDirty || avatarChanged || clearAvatar
  }, [isDirty, avatarChanged, clearAvatar])

  // Report changes back to parent modal
  useEffect(() => {
    if (onChangesDetected) {
      onChangesDetected(hasChanges)
    }
  }, [hasChanges, onChangesDetected])

  // Reset avatar change tracking when defaultValues change (new user loaded)
  useEffect(() => {
    setAvatarChanged(false)
    setClearAvatar(false)
  }, [defaultValues?.avatarUrl])

  const handleSubmit = async (values: UserFormValues) => {
    // Transform form values to match API format
    const userData = transformFormDataForAPI(values) as CreateUserData & { clearAvatar?: boolean }

    // Add clearAvatar flag if user cleared existing avatar
    if (clearAvatar && !values.avatar) {
      userData.clearAvatar = true
    }

    await onSubmit(userData)
  }

  return (
    <>
      <Form {...form}>
        <form
          id={formId}
          onSubmit={form.handleSubmit(handleSubmit)}
          className="space-y-6"
          noValidate
        >
          <div className="space-y-6">
            {/* Basic Information Section */}
            <div className="space-y-4">
              <h3 className="text-lg font-medium">Basic Information</h3>

              <FormField
                control={form.control}
                name="avatar"
                render={({ field: { onChange } }) => (
                  <FormItem>
                    <FormLabel>Profile Picture</FormLabel>
                    <FormControl>
                      <div className="flex items-start gap-4">
                        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted overflow-hidden border-2 border-dashed border-muted-foreground/25">
                          {avatarPreview ? (
                            <img
                              src={avatarPreview}
                              alt="Avatar preview"
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <User className="h-6 w-6 text-muted-foreground" />
                          )}
                        </div>
                        <div className="flex-1 space-y-2">
                          <div className="flex gap-2">
                            <Input
                              ref={fileInputRef}
                              type="file"
                              accept="image/jpeg,image/png,image/webp"
                              disabled={isLoading}
                              onChange={(e) => {
                                const file = e.target.files?.[0]
                                if (file) {
                                  setSelectedFile(file)
                                  const reader = new FileReader()
                                  reader.onloadend = () => {
                                    setSelectedImageSrc(reader.result as string)
                                    setShowCropModal(true)
                                  }
                                  reader.readAsDataURL(file)
                                } else {
                                  onChange(undefined)
                                  setAvatarPreview(null)
                                }
                              }}
                            />
                            {avatarPreview && (
                              <Button
                                type="button"
                                variant="outline"
                                onClick={handleClearAvatar}
                                disabled={isLoading}
                                className="shrink-0"
                              >
                                Clear
                              </Button>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground">
                            JPEG, PNG, or WebP. Max 5MB.
                          </p>
                        </div>
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="flex items-center gap-2">
                      Email Address *
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Info className="h-4 w-4 text-muted-foreground cursor-help" />
                        </TooltipTrigger>
                        <TooltipContent>
                          <p className="max-w-xs">
                            Must be a valid DIU email address ending with @diu.edu.kh
                          </p>
                        </TooltipContent>
                      </Tooltip>
                    </FormLabel>
                    <FormControl>
                      <Input
                        placeholder="user@diu.edu.kh"
                        type="email"
                        disabled={isLoading}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="firstName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        First Name *
                      </FormLabel>
                      <FormControl>
                        <Input placeholder="John" disabled={isLoading} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="lastName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        Last Name *
                      </FormLabel>
                      <FormControl>
                        <Input placeholder="Doe" disabled={isLoading} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="khmerFirstName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Khmer First Name</FormLabel>
                      <FormControl>
                        <Input placeholder="ជន" disabled={isLoading} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="khmerLastName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Khmer Last Name</FormLabel>
                      <FormControl>
                        <Input placeholder="ដូ" disabled={isLoading} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="gender"
                  render={({ field }) => {
                    const currentGenderValue = form.watch('gender') || ""

                    return (
                      <FormItem>
                        <FormLabel>Gender</FormLabel>
                        <div className="flex gap-2">
                          <Select
                            onValueChange={(value) => field.onChange(value || undefined)}
                            value={currentGenderValue}
                            disabled={isLoading}
                          >
                            <FormControl>
                              <SelectTrigger className="flex-1">
                                <SelectValue placeholder="Select gender" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="male">male</SelectItem>
                              <SelectItem value="female">female</SelectItem>
                              <SelectItem value="other">other</SelectItem>
                            </SelectContent>
                          </Select>
                          {currentGenderValue && (
                            <Button
                              type="button"
                              variant="outline"
                              size="icon"
                              onClick={() => {
                                form.setValue('gender', undefined, {
                                  shouldDirty: true,
                                  shouldValidate: true,
                                  shouldTouch: true
                                })
                              }}
                              disabled={isLoading}
                              className="shrink-0"
                            >
                              <X className="h-4 w-4 text-muted-foreground" />
                            </Button>
                          )}
                        </div>
                        <FormMessage />
                      </FormItem>
                    )
                  }}
                />
              </div>
            </div>

            {/* Contact Information Section */}
            <div className="space-y-4">
              <h3 className="text-lg font-medium">Contact Information</h3>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="phone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center gap-2">
                        Phone Number
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Info className="h-4 w-4 text-muted-foreground cursor-help" />
                          </TooltipTrigger>
                          <TooltipContent>
                            <p className="max-w-xs">
                              Use international format like +855123456789 (8-15 digits)
                            </p>
                          </TooltipContent>
                        </Tooltip>
                      </FormLabel>
                      <FormControl>
                        <Input placeholder="+855 12 345 678" disabled={isLoading} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="dateOfBirth"
                  render={({ field }) => (
                    <FormItem className="flex flex-col">
                      <FormLabel>Date of Birth</FormLabel>
                      <FormControl>
                        <DatePickerInput
                          value={field.value}
                          onChange={field.onChange}
                          placeholder="dd/mm/yyyy"
                          dateFormat="dd/MM/yyyy"
                          disabled={isLoading}
                          maxDate={new Date()}
                          minDate={new Date("1900-01-01")}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="address"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Address</FormLabel>
                    <FormControl>
                      <Input placeholder="123 Street, City, Province" disabled={isLoading} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </div>
        </form>
      </Form>

      {selectedFile && (
        <AvatarCropModal
          isOpen={showCropModal}
          imageSrc={selectedImageSrc}
          originalFile={selectedFile}
          onCropComplete={handleCropComplete}
          onClose={handleCropCancel}
        />
      )}
    </>
  )
}