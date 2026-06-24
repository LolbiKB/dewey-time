const LINKS = [
  { href: "/home/admin", label: "App tiles" },
  { href: "/home/admin/landing", label: "Landing" },
  { href: "/home/admin/access", label: "Access" },
];

export function AdminNav({ active }: { active: string }) {
  return (
    <nav className="mb-5 flex items-center gap-1.5">
      <a
        href="/home"
        className="rounded-md px-2.5 py-1.5 text-sm text-muted-foreground hover:bg-muted/60 hover:text-foreground"
        aria-label="Back to launcher"
      >
        ‹ Launcher
      </a>
      <span className="mx-0.5 h-4 w-px bg-border" aria-hidden="true" />
      {LINKS.map((l) => (
        <a
          key={l.href}
          href={l.href}
          className={
            "rounded-md px-3 py-1.5 text-sm " +
            (l.href === active
              ? "bg-muted font-medium text-foreground"
              : "text-muted-foreground hover:bg-muted/60 hover:text-foreground")
          }
        >
          {l.label}
        </a>
      ))}
    </nav>
  );
}
