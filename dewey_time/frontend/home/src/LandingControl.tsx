import { useState } from "react";
import { useFrappeGetCall, useFrappePostCall } from "frappe-react-sdk";
import { Card, Switch, Skeleton, EmptyState } from "@lolbikb/dewey-ui";
import { Compass } from "lucide-react";

const GET = "dewey_time.attendance_engine.landing.get_landing_state";
const SET = "dewey_time.attendance_engine.landing.set_role_landing";

interface RoleRow { role: string; enabled: boolean; user_count: number; }
interface LandingState {
  roles: RoleRow[];
  masks: { portal_home: string | null; home_page_hook: boolean; default_app: string | null };
  note: string;
}

export function LandingControl() {
  const { data, isLoading, mutate } = useFrappeGetCall<{ message: LandingState }>(GET, undefined, GET);
  const { call } = useFrappePostCall<{ message: { role: string; enabled: boolean } }>(SET);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const state = data?.message;

  async function toggle(row: RoleRow) {
    setError(null);
    if (!row.enabled && !confirm(`Make /home the landing page for everyone with the "${row.role}" role? They'll see it at their next login.`)) return;
    setBusy(row.role);
    try {
      await call({ role: row.role, enabled: !row.enabled });
      await mutate();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const masks = state?.masks;
  const maskWarnings = [
    masks?.portal_home && `Portal Settings home is "${masks.portal_home}"`,
    masks?.home_page_hook && "an app sets a home_page hook",
    masks?.default_app && `System default app is "${masks.default_app}"`,
  ].filter(Boolean) as string[];

  return (
    <div className="mx-auto max-w-3xl px-5 py-7">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Landing control</h1>
          <p className="text-sm text-muted-foreground">Choose which roles land on /home after login.</p>
        </div>
        <a href="/home/admin" className="rounded-md border border-border px-3 py-1.5 text-sm">App tiles</a>
      </div>

      {error && <div className="mb-3 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</div>}
      {state?.note && <p className="mb-3 text-xs text-muted-foreground">{state.note}</p>}
      {maskWarnings.length > 0 && (
        <div className="mb-3 rounded-md border border-brand-accent/30 bg-brand-accent/10 px-3 py-2 text-xs text-brand-accent">
          Heads up — these settings can override the landing page for some users: {maskWarnings.join("; ")}.
        </div>
      )}

      {isLoading ? (
        <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
      ) : !state?.roles.length ? (
        <EmptyState icon={Compass} title="No roles found" description="No assignable roles to configure." />
      ) : (
        <div className="space-y-2">
          {state.roles.map((r) => (
            <Card key={r.role} className="flex items-center gap-3 p-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{r.role}</p>
                <p className="text-xs text-muted-foreground">{r.user_count} desk user{r.user_count === 1 ? "" : "s"}{r.enabled ? " · lands on /home" : ""}</p>
              </div>
              <Switch checked={r.enabled} disabled={busy === r.role} onCheckedChange={() => toggle(r)} aria-label={`Land ${r.role} on /home`} />
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
