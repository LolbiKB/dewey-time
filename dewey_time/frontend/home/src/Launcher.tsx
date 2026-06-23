import { useFrappeGetCall } from "frappe-react-sdk";
import { Card } from "@lolbikb/dewey-ui";
import type { LauncherData } from "./types";

const METHOD = "dewey_time.attendance_engine.launcher.get_launcher";
const DIAL = "/assets/dewey_time/images/dewey-time-animated.svg";

export function Launcher() {
  const { data, error, isLoading } = useFrappeGetCall<{ message: LauncherData }>(
    METHOD, undefined, METHOD
  );
  const launcher = data?.message;

  if (isLoading) return <Shell><p className="text-muted-foreground text-sm">Loading…</p></Shell>;

  if (error) {
    return (
      <Shell>
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <p className="text-sm text-muted-foreground">Couldn't load your apps.</p>
          <div className="flex gap-2">
            <button className="rounded-md border border-border px-3 py-1.5 text-sm"
              onClick={() => location.reload()}>Retry</button>
            <a className="rounded-md border border-border px-3 py-1.5 text-sm" href="/desk">Go to Desk</a>
            <a className="rounded-md border border-border px-3 py-1.5 text-sm" href="/api/method/logout">Log out</a>
          </div>
        </div>
      </Shell>
    );
  }

  const apps = launcher?.apps ?? [];
  return (
    <Shell user={launcher?.user}>
      <p className="mb-3 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">Your apps</p>
      {apps.length === 0 ? (
        <p className="py-12 text-center text-sm text-muted-foreground">
          No apps assigned yet — contact your administrator.
        </p>
      ) : (
        <div className="grid gap-3.5" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(186px,1fr))" }}>
          {apps.map((a) => (
            <a key={a.name} href={a.route} className="block">
              <Card className="relative flex flex-col items-center gap-3 p-6 text-center transition-colors hover:bg-muted/40">
                {a.admin && (
                  <span className="absolute right-3 top-3 rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                    Admins
                  </span>
                )}
                <div className="flex size-[62px] items-center justify-center rounded-2xl border border-border bg-muted">
                  <img src={a.logo} alt="" className="size-9" />
                </div>
                <p className="text-[15px] font-semibold tracking-tight">{a.title}</p>
              </Card>
            </a>
          ))}
        </div>
      )}
    </Shell>
  );
}

function Shell({ children, user }: { children: React.ReactNode; user?: LauncherData["user"] }) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="flex items-center justify-between border-b border-border px-5 py-3.5">
        <div className="flex items-center gap-2.5">
          <img src={DIAL} alt="" className="size-7" />
          <span className="text-base font-semibold tracking-tight">Dewey<span className="text-primary">·</span>Time</span>
        </div>
        {user && (
          <div className="flex size-8 items-center justify-center rounded-full border border-border bg-muted text-[11px] font-semibold text-muted-foreground">
            {user.initials}
          </div>
        )}
      </header>
      <main className="mx-auto max-w-3xl px-5 py-7">
        {user && <p className="mb-5 text-lg font-semibold tracking-tight">Good day, {user.full_name}</p>}
        {children}
      </main>
    </div>
  );
}
