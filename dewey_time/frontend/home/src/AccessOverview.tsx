import { useFrappeGetCall } from "frappe-react-sdk";
import { Card, Skeleton, EmptyState, Badge } from "@lolbikb/dewey-ui";
import { Users } from "lucide-react";
import { AdminNav } from "./AdminNav";

const GET = "dewey_time.attendance_engine.access.get_access_overview";

interface Row {
  user: string;
  full_name: string;
  hr: boolean;
  adms: boolean;
  desk: boolean;
  lands_on_home: boolean;
  roles: string[];
}

export function AccessOverview() {
  const { data, isLoading } = useFrappeGetCall<{ message: { users: Row[] } }>(GET, undefined, GET);
  const users = data?.message?.users ?? [];

  return (
    <div className="mx-auto max-w-3xl px-5 py-7">
      <AdminNav active="/home/admin/access" />
      <div className="mb-5">
        <h1 className="text-lg font-semibold tracking-tight">Access &amp; roles</h1>
        <p className="text-sm text-muted-foreground">
          Who holds the Dewey roles and who lands on /home. Read-only — change roles in Desk.
        </p>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : users.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No users"
          description="No one holds a Dewey-relevant role yet."
        />
      ) : (
        <div className="space-y-2">
          {users.map((u) => (
            <Card key={u.user} className="flex items-center gap-3 p-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{u.full_name}</p>
                <p className="truncate text-xs text-muted-foreground">{u.user}</p>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {u.hr && <Badge variant="secondary">HR</Badge>}
                {u.adms && <Badge variant="secondary">ADMS</Badge>}
                {u.desk && <Badge variant="secondary">Desk</Badge>}
                {u.lands_on_home && <Badge>/home</Badge>}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
