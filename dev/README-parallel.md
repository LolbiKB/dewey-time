# Working this repo in parallel

Several sessions (Claude Code or human) can work `dewey_time` at once, one git
worktree each. Use `dev/new-worktree.sh` — it wires up the three things that
otherwise collide.

```bash
dev/new-worktree.sh khmer-cap hr_attendance
cd .claude/worktrees/khmer-cap && source .claude/worktree-env.sh && claude
```

Parallelise **by surface** where you can — one session on Python, one on
`hr_attendance`, one on `adms`. That is the default because it makes collision 3
impossible rather than merely manageable. It is not a hard limit: two sessions
*can* share one SPA, and "Two sessions on one SPA" below is the recipe.

## 1. Dev-server ports — fixed per frontend

| frontend        | port |
| --------------- | ---- |
| `hr_attendance` | 8080 |
| `adms`          | 5173 |

`vite.config.ts` and `playwright.config.ts` both run `strictPort: true` and both
read `PORT` from the environment. It has to be a real shell variable — a `.env`
file never reaches `vite.config.ts`, because `devPort.ts` reads `process.env`
at config-load time.

Ports are fixed rather than scanned so a given SPA always lives at the same URL
whichever worktree is serving it. The **port** is the hard constraint, not the
frontend: `--port <n>` puts a second worktree on the same SPA, and only a
duplicate port is refused. Sharing a frontend merely warns, because what it
costs is collision 3 — a merge tax — not a broken session.

`strictPort` means a collision fails loudly instead of silently serving the
wrong tree. `devPort.ts` documents why (issue #72): Playwright used to read
`PORT` while Vite hardcoded 8080, so `PORT=8099 npm run test:e2e` moved the
baseURL but not the listen port and the suite pointed at nothing — which looked
like a total suite wipeout rather than a port conflict.

## 2. The Frappe sandbox — a singleton unless you rename the compose project

`frappe_sandbox/commands.py` invokes `docker compose -f <file>` with **no `-p`**,
and `docker-compose.yml` sets no top-level `name:`. Compose therefore falls back
to the compose file's parent directory basename, which is `sandbox` in every
worktree:

```
$ docker compose -f dev/sandbox/docker-compose.yml config
project name: sandbox
bench volumes: ['bench-data', '/Users/lolbikb/projects/dewey-time']
```

The project name is identical everywhere but the bind source is worktree-
absolute. Two worktrees sharing the project therefore share one bench, one
MariaDB and one set of volumes, with the source mount following whichever
worktree last ran `up`. Since `provision.sh` symlinks `apps/dewey_time` into
that mount, the losing session can be running the *other* worktree's Python.

`new-worktree.sh` sets `COMPOSE_PROJECT_NAME=sandbox-<name>` by default, which
Compose honours above the directory basename. The variable costs nothing until
you actually run the sandbox; from then on that worktree has its own containers
and its own `mariadb-data`/`bench-data`, so it also pays its own full provision
in time and disk.

Pass `--share-sandbox` to opt back into the single shared bench. Then only one
worktree may run it at a time — the others stay on the no-Docker path:

```bash
./frappe-sandbox test --backend --fast --module <m>   # sub-second, no containers
```

## 3. Committed SPA bundles — conflict at merge, resolve by rebuilding

Frappe Cloud never builds these SPAs, so the built output is committed:
`dewey_time/public/<app>/assets/index.js`, `index.css`, `build-id.txt`. Those
are fixed filenames, not content-hashed, so **any two branches that touch the
same SPA conflict in the identical paths** — in minified output no one can merge
by hand.

Never resolve these. Take either side and regenerate:

```bash
git checkout --theirs dewey_time/public/hr_attendance/
cd dewey_time/frontend/hr_attendance && npm run build
git add -A dewey_time/public/hr_attendance dewey_time/www
```

The rebuild *is* the resolution; which side you took stops mattering once it
runs.

**Nothing enforces that the committed bundle matches source.** CI runs
`npm run build` to prove the build works and that `check-fonts.mjs` passes, but
never diffs the result against what is committed — and there are no git hooks
(`core.hooksPath` unset, only samples installed). The bundle therefore has to be
correct *at deploy time*, not at every commit. That is what makes the next
section possible, and it is also the trap: **a stale bundle will not fail
anything until it is live.**

## Two sessions on one SPA

Supported, and sometimes the right call — two features on `hr_attendance` that
barely touch each other beat serialising them. Two rules:

```bash
dev/new-worktree.sh feat-one hr_attendance                # port 8080
dev/new-worktree.sh feat-two hr_attendance --port 8081    # warns, proceeds
```

1. **Different ports.** `strictPort` means the second dev server or Playwright
   run fails outright rather than degrading, so the script refuses a duplicate
   port. `--port` is the escape hatch.
2. **Do not commit built assets while the work is in flight.** Leave
   `dewey_time/public/<app>/**` untouched on both branches; land the source
   changes; then rebuild once, on `main`, and commit that:

   ```bash
   git checkout main && git pull
   cd dewey_time/frontend/hr_attendance && npm run build
   cd - && git add -A dewey_time/public/hr_attendance dewey_time/www
   git commit -m "build(hr-attendance): rebuild the bundle over <what landed>"
   ```

Rule 2 is what removes the conflict — two branches that never touch the bundle
cannot collide in it. It costs you the guarantee that every commit is
deployable, so **the rebuild is not optional**: `main` carries a stale bundle
from the moment the first source change lands until you run it. Do it before any
Frappe Cloud deploy, without exception.

## Also worth knowing

- **`node_modules` is per worktree** (gitignored), 317M for `hr_attendance` and
  442M for `adms`. The script installs only the frontend you named. Python needs
  no install — it runs off the tree.
- **The git stash stack is shared** across the main checkout and every worktree.
  Never bare `git stash` / `git stash pop`; another session may pop your entry.
  Prefer a throwaway WIP commit, or `git stash push -u -m "<unique-tag>"` and
  restore with `git stash apply <sha>`.
- **`git clean -fdx` at the repo root deletes `.claude/`**, which takes every
  worktree and every SDD ledger with it. Ledgers are recoverable from `git log`;
  uncommitted worktree changes are not.
- **SDD workspaces are already parallel-safe.** `.superpowers/` is gitignored and
  each plan owns `.superpowers/sdd/<plan-basename>/`, whose ledger names its plan
  file on line 1 so a resuming controller cannot read another plan's progress.
