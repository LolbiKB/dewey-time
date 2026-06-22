import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Card, CardContent } from "@/components/ui/card"

interface UserInfoCardProps {
  // User information
  firstName: string
  lastName: string
  khmerFirstName?: string
  khmerLastName?: string
  email: string
  avatarUrl?: string

  // ID information
  idLabel: string // "ID:" or "Student ID:" or "Employee ID:"
  idValue: string // The actual ID value

  // Optional additional info
  additionalInfo?: React.ReactNode
}

export function UserInfoCard({
  firstName,
  lastName,
  khmerFirstName,
  khmerLastName,
  email,
  avatarUrl,
  idLabel,
  idValue,
  additionalInfo
}: UserInfoCardProps) {
  return (
    <Card>
      <CardContent>
        <div className="flex items-center gap-3">
          <Avatar className="h-10 w-10">
            <AvatarImage
              className="object-cover"
              src={avatarUrl}
              alt={`${firstName} ${lastName}`}
            />
            <AvatarFallback className="text-sm">
              {firstName?.[0]}{lastName?.[0]}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1">
            <p className="font-medium">
              {firstName} {lastName}
              {khmerLastName && khmerFirstName && (
                <span className="ml-2 font-normal text-muted-foreground">
                  ({khmerLastName} {khmerFirstName})
                </span>
              )}
            </p>
            <p className="text-sm text-muted-foreground">
              {idLabel} {idValue} • {email}
            </p>
            {additionalInfo && (
              <div className="mt-1">
                {additionalInfo}
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
