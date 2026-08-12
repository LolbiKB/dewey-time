import { Link, useLocation } from "react-router-dom";

// Both coverage views are "observed readiness" checks -- the system looks,
// rather than a human ticking a box. They share one tab-bar entry because a
// fifth top-level tab does not fit the phone bar, and because grouping them is
// the honest information architecture.
const VIEWS = [
  { href: "/hr-schedule/coverage", label: "Schedule" },
  { href: "/hr-schedule/coverage/biometrics", label: "Biometrics" },
] as const;

export function CoverageViewNav() {
  const { pathname } = useLocation();
  // Longest match wins: "/hr-schedule/coverage" is a prefix of the other.
  const active = [...VIEWS]
    .sort((a, b) => b.href.length - a.href.length)
    .find((view) => pathname.startsWith(view.href))?.href;

  return (
    <div className="flex gap-1" role="navigation" aria-label="Coverage views">
      {VIEWS.map((view) => (
        <Link
          key={view.href}
          to={view.href}
          aria-current={active === view.href ? "page" : undefined}
          className={
            active === view.href
              ? "rounded-full bg-muted px-3 py-1 text-xs font-semibold text-foreground"
              : "rounded-full px-3 py-1 text-xs font-medium text-muted-foreground hover:text-foreground"
          }
        >
          {view.label}
        </Link>
      ))}
    </div>
  );
}
