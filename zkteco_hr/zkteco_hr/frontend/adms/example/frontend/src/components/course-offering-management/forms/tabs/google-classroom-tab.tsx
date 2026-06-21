import type { UseFormReturn } from "react-hook-form"
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  CheckCircle2,
  AlertCircle,
  ExternalLink,
} from "lucide-react"
import type { CourseOfferingFormData } from "@/schemas/course-offering-validation"

interface GoogleClassroomTabProps {
  form: UseFormReturn<CourseOfferingFormData>
  isLoading?: boolean
  mode?: 'create' | 'edit'
}

/**
 * Extracts Google Classroom ID from a URL or returns the input if it's already just an ID
 * Handles formats like:
 * - https://classroom.google.com/c/abc123def456
 * - classroom.google.com/c/abc123def456
 * - abc123def456 (just the ID)
 */
function extractClassroomId(input: string): string {
  if (!input) return ''

  const trimmed = input.trim()

  // Try to extract ID from URL patterns
  const patterns = [
    /classroom\.google\.com\/c\/([a-zA-Z0-9_-]+)/,  // Standard classroom URL
    /classroom\.google\.com\/u\/\d+\/c\/([a-zA-Z0-9_-]+)/,  // URL with user selector
  ]

  for (const pattern of patterns) {
    const match = trimmed.match(pattern)
    if (match && match[1]) {
      return match[1]
    }
  }

  // If no URL pattern matched, return as-is (assuming it's already the ID)
  return trimmed
}

/**
 * Generates a Google Classroom URL from an ID
 */
function getClassroomUrl(id: string): string {
  return `https://classroom.google.com/c/${id}`
}

export function GoogleClassroomTab({
  form,
  isLoading = false,
  mode = 'create'
}: GoogleClassroomTabProps) {
  const googleClassroomId = form.watch('google_classroom_id')
  const hasClassroom = !!googleClassroomId

  /**
   * Handle input change - extract ID if user pastes a full URL
   */
  const handleInputChange = (
    value: string,
    onChange: (value: string | null) => void
  ) => {
    const extractedId = extractClassroomId(value)
    onChange(extractedId || null)
  }

  /**
   * Open classroom in new tab for manual verification
   */
  const handleOpenClassroom = () => {
    if (googleClassroomId) {
      window.open(getClassroomUrl(googleClassroomId), '_blank', 'noopener,noreferrer')
    }
  }

  return (
    <div className="space-y-6">
      {/* Mode: Create */}
      {mode === 'create' && (
        <Card>
          <CardContent>
            <FormField
              control={form.control}
              name="google_classroom_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Google Classroom ID (Optional)</FormLabel>
                  <FormControl>
                    <div className="flex gap-2">
                      <Input
                        placeholder="Paste URL or ID (e.g., abc123def456)"
                        disabled={isLoading}
                        value={field.value || ""}
                        onChange={(e) => handleInputChange(e.target.value, field.onChange)}
                        onBlur={field.onBlur}
                        name={field.name}
                        ref={field.ref}
                      />
                      {hasClassroom && (
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          onClick={handleOpenClassroom}
                          title="Open classroom to verify"
                        >
                          <ExternalLink className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </FormControl>
                  <FormDescription>
                    Paste the full Google Classroom URL or just the ID. The ID will be extracted automatically.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
        </Card>
      )}

      {/* Mode: Edit - Show Connection Status */}
      {mode === 'edit' && (
        <div className="space-y-4">
          {hasClassroom ? (
            <>
              {/* Connected State */}
              <Alert>
                <CheckCircle2 className="h-4 w-4" />
                <AlertTitle>Connected to Google Classroom</AlertTitle>
                <AlertDescription className="flex items-center gap-2">
                  <code className="text-sm font-mono">{googleClassroomId}</code>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2"
                    onClick={handleOpenClassroom}
                  >
                    <ExternalLink className="h-3 w-3 mr-1" />
                    Verify
                  </Button>
                </AlertDescription>
              </Alert>

              {/* Allow updating the ID */}
              <Card>
                <CardContent>
                  <FormField
                    control={form.control}
                    name="google_classroom_id"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Google Classroom ID</FormLabel>
                        <FormControl>
                          <div className="flex gap-2">
                            <Input
                              placeholder="Paste URL or ID"
                              disabled={isLoading}
                              value={field.value || ""}
                              onChange={(e) => handleInputChange(e.target.value, field.onChange)}
                              onBlur={field.onBlur}
                              name={field.name}
                              ref={field.ref}
                            />
                            {hasClassroom && (
                              <Button
                                type="button"
                                variant="outline"
                                size="icon"
                                onClick={handleOpenClassroom}
                                title="Open classroom to verify"
                              >
                                <ExternalLink className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        </FormControl>
                        <FormDescription>
                          Update or clear to remove the link. Paste a URL and the ID will be extracted.
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </CardContent>
              </Card>
            </>
          ) : (
            <>
              {/* Not Connected State */}
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>No Google Classroom Connected</AlertTitle>
                <AlertDescription>
                  Link an existing Google Classroom below
                </AlertDescription>
              </Alert>

              <Card>
                <CardContent>
                  <FormField
                    control={form.control}
                    name="google_classroom_id"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Google Classroom ID (Optional)</FormLabel>
                        <FormControl>
                          <div className="flex gap-2">
                            <Input
                              placeholder="Paste URL or ID (e.g., abc123def456)"
                              disabled={isLoading}
                              value={field.value || ""}
                              onChange={(e) => handleInputChange(e.target.value, field.onChange)}
                              onBlur={field.onBlur}
                              name={field.name}
                              ref={field.ref}
                            />
                            {field.value && (
                              <Button
                                type="button"
                                variant="outline"
                                size="icon"
                                onClick={handleOpenClassroom}
                                title="Open classroom to verify"
                              >
                                <ExternalLink className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        </FormControl>
                        <FormDescription>
                          Paste the full Google Classroom URL or just the ID.
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </CardContent>
              </Card>
            </>
          )}
        </div>
      )}
    </div>
  )
}
