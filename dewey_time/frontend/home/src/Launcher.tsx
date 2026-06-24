import { useState } from "react";
import { useFrappeGetCall, useFrappeAuth } from "frappe-react-sdk";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuItem,
} from "@lolbikb/dewey-ui";
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
    <Shell user={launcher?.user} canManageTiles={launcher?.user?.can_manage_tiles ?? false}>
      <div className="rounded-2xl bg-muted/40 p-5">
        <p className="mb-4 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">Your apps</p>
        {apps.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            No apps assigned yet — contact your administrator.
          </p>
        ) : (
          <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, 124px)" }}>
            {apps.map((a) => (
              <a key={a.name} href={a.route} className="group block">
                <div className="relative flex aspect-square w-full flex-col items-center justify-center gap-2.5 rounded-[18px] bg-card shadow-sm transition duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] hover:-translate-y-0.5 hover:shadow-lg">
                  {a.admin && (
                    <span className="absolute right-2.5 top-2.5 size-1.5 rounded-full bg-brand-accent" aria-label="Admin app" />
                  )}
                  <span className="flex size-11 items-center justify-center rounded-xl bg-muted">
                    <img src={a.logo} alt="" className="size-6" />
                  </span>
                  <span className="px-1.5 text-center text-xs font-semibold leading-tight tracking-tight">{a.title}</span>
                </div>
              </a>
            ))}
          </div>
        )}
      </div>
    </Shell>
  );
}

function UserAvatar({ user }: { user: LauncherData["user"] }) {
  const [imgError, setImgError] = useState(false);

  const initials = (
    <div className="flex size-8 items-center justify-center rounded-full border border-border bg-muted text-[11px] font-semibold text-muted-foreground">
      {user.initials}
    </div>
  );

  if (!user.image_url || imgError) return initials;

  return (
    <img
      src={user.image_url}
      alt=""
      className="size-8 rounded-full object-cover"
      onError={() => setImgError(true)}
    />
  );
}

function Shell({ children, user, canManageTiles }: { children: React.ReactNode; user?: LauncherData["user"]; canManageTiles?: boolean }) {
  const { logout } = useFrappeAuth();

  const handleLogout = async () => {
    try {
      await logout();
    } finally {
      window.location.href = "/login";
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="flex items-center justify-between border-b border-border px-5 py-3.5">
        <div className="flex items-center gap-2.5">
          <img src={DIAL} alt="" className="size-7" />
          <span className="text-base font-semibold tracking-tight">Dewey<span className="text-primary">·</span>Time</span>
        </div>
        {user && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                aria-label="User menu"
              >
                <UserAvatar user={user} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuLabel className="font-normal">
                <span className="block text-sm font-semibold text-foreground">{user.full_name}</span>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => { window.location.href = "/app/user-profile"; }}>
                Profile / account
              </DropdownMenuItem>
              {canManageTiles && (
                <DropdownMenuItem onSelect={() => { window.location.href = "/home/admin"; }}>
                  Manage tiles
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onSelect={handleLogout}>
                Log out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </header>
      <main className="mx-auto max-w-3xl px-5 py-7">
        {user && <p className="mb-5 text-lg font-semibold tracking-tight">Good day, {user.full_name}</p>}
        {children}
      </main>
    </div>
  );
}
