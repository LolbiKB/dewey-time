#!/usr/bin/env bash
#
# Create an isolated worktree for one feature, wired so that several Claude Code
# (or human) sessions can run against this repo at once without colliding.
#
#   dev/new-worktree.sh <name> <frontend> [--branch <branch>] [--from <ref>]
#                                         [--share-sandbox] [--force]
#
#   <name>      short slug; becomes .claude/worktrees/<name> and feat/<name>
#   <frontend>  hr_attendance | adms | none   (which SPA this worktree owns)
#
# Three things collide when this repo is worked on in parallel. This script
# handles all three; see dev/README-parallel.md for the reasoning.
#
#   1. Dev-server ports. Fixed per frontend (hr_attendance 8080, adms 5173),
#      because both vite.config.ts and playwright.config.ts run strictPort and
#      read PORT from the environment. A frontend is therefore owned by at most
#      one worktree at a time, and this script refuses to hand it out twice.
#   2. The Frappe sandbox. `docker compose` is invoked with no -p, and the
#      compose file sets no top-level `name:`, so the project name falls back to
#      the `sandbox` directory basename -- identical in every worktree. Sharing
#      it means two sessions share one bench whose bind mount points at whichever
#      worktree brought it up last. We set COMPOSE_PROJECT_NAME per worktree by
#      default; the variable costs nothing unless you actually run the sandbox.
#   3. Committed SPA bundles. Not handled here -- they conflict at merge time and
#      the resolution is always "take either side, rebuild, commit the rebuild".
#
set -euo pipefail

die() { printf '%s: %s\n' "${0##*/}" "$*" >&2; exit 1; }
note() { printf '  %s\n' "$*"; }

# Ports are fixed per frontend rather than scanned, so a given SPA always lives
# at the same URL no matter which worktree is serving it -- bookmarks, saved
# devtools state and muscle memory all keep working across sessions.
port_for() {
	case "$1" in
	hr_attendance) printf '8080' ;;
	adms) printf '5173' ;;
	none) printf '' ;;
	*) return 1 ;;
	esac
}

FRONTENDS='hr_attendance adms none'

name=''
frontend=''
branch=''
from='origin/main'
share_sandbox=0
force=0

while [ $# -gt 0 ]; do
	case "$1" in
	--branch) branch="${2:-}"; [ -n "$branch" ] || die '--branch needs a value'; shift 2 ;;
	--from) from="${2:-}"; [ -n "$from" ] || die '--from needs a value'; shift 2 ;;
	--share-sandbox) share_sandbox=1; shift ;;
	--force) force=1; shift ;;
	# Print the header block: every comment line after the shebang, stopping at
	# the first line of actual code. A line range here would rot on any edit.
	-h | --help) awk 'NR>1 { if (!/^#/) exit; sub(/^# ?/, ""); print }' "$0"; exit 0 ;;
	-*) die "unknown flag: $1" ;;
	*)
		if [ -z "$name" ]; then name="$1"
		elif [ -z "$frontend" ]; then frontend="$1"
		else die "unexpected argument: $1"
		fi
		shift
		;;
	esac
done

[ -n "$name" ] || die "usage: ${0##*/} <name> <frontend>   (frontend: ${FRONTENDS// /|})"
[ -n "$frontend" ] || die "which frontend does this worktree own? one of: ${FRONTENDS// /|}"
case " $FRONTENDS " in *" $frontend "*) ;; *) die "unknown frontend '$frontend' (want: ${FRONTENDS// /|})" ;; esac
case "$name" in
*[!a-zA-Z0-9._-]* | '' | -*) die "name must be [a-zA-Z0-9._-] and not start with '-': $name" ;;
esac

[ -n "$branch" ] || branch="feat/$name"

# Resolve the MAIN checkout even when invoked from inside another worktree:
# --git-common-dir always points at the primary .git directory.
git rev-parse --git-common-dir >/dev/null 2>&1 || die 'not inside a git repository'
git_common=$(cd "$(git rev-parse --git-common-dir)" && pwd -P)
repo_root=$(dirname "$git_common")
wt_path="$repo_root/.claude/worktrees/$name"

[ -e "$wt_path" ] && die "already exists: $wt_path"
if git -C "$repo_root" show-ref --verify --quiet "refs/heads/$branch"; then
	die "branch already exists: $branch  (pass --branch <other> to pick another)"
fi

# A frontend may be claimed by only one live worktree, because its port is fixed.
# Each worktree records its claim in the env file we write below.
if [ "$frontend" != none ] && [ "$force" -eq 0 ]; then
	while IFS= read -r existing; do
		[ -n "$existing" ] || continue
		env_file="$existing/.claude/worktree-env.sh"
		[ -f "$env_file" ] || continue
		claimed=$(sed -n 's/^# frontend: //p' "$env_file" | head -1)
		if [ "$claimed" = "$frontend" ]; then
			die "$frontend is already owned by $existing (port $(port_for "$frontend")).
    Finish or remove that worktree, target a different frontend, or pass --force
    and set PORT yourself."
		fi
	done <<-EOF
		$(git -C "$repo_root" worktree list --porcelain | sed -n 's/^worktree //p')
	EOF
fi

printf '\n==> fetching %s\n' "${from%%/*}"
git -C "$repo_root" fetch --quiet "${from%%/*}" 2>/dev/null || note "fetch skipped (is '${from%%/*}' a remote?)"
git -C "$repo_root" rev-parse --verify --quiet "$from^{commit}" >/dev/null ||
	die "base ref not found: $from"

printf '==> creating worktree\n'
git -C "$repo_root" worktree add --quiet -b "$branch" "$wt_path" "$from"
note "$wt_path"
note "branch $branch off $from ($(git -C "$repo_root" rev-parse --short "$from"))"

port=$(port_for "$frontend")
if [ "$frontend" != none ]; then
	printf '==> npm ci (%s) -- only this frontend, each copy is 300-450M\n' "$frontend"
	(cd "$wt_path/dewey_time/frontend/$frontend" && npm ci --no-audit --no-fund)
fi

compose_project='sandbox'
[ "$share_sandbox" -eq 0 ] && compose_project="sandbox-$name"

mkdir -p "$wt_path/.claude"
{
	printf '# Generated by dev/new-worktree.sh -- source this before running anything here.\n'
	printf '# frontend: %s\n' "$frontend"
	printf '\n'
	if [ -n "$port" ]; then
		printf '# vite AND playwright both read this (see devPort.ts, issue #72). It has to\n'
		printf '# be a real shell variable -- a .env file never reaches vite.config.ts.\n'
		printf 'export PORT=%s\n' "$port"
	else
		printf '# Backend-only worktree: no SPA, so no port is claimed.\n'
	fi
	printf '\n'
	if [ "$share_sandbox" -eq 1 ]; then
		printf '# --share-sandbox: this worktree uses the DEFAULT compose project, so it shares\n'
		printf '# one bench with every other sharing worktree. Only one may run it at a time.\n'
		printf '# unset COMPOSE_PROJECT_NAME\n'
	else
		printf '# Own containers and volumes, so `frappe-sandbox up` here cannot remount the\n'
		printf '# bench out from under another session. Costs a full provision on first use.\n'
		printf 'export COMPOSE_PROJECT_NAME=%s\n' "$compose_project"
	fi
} >"$wt_path/.claude/worktree-env.sh"

cat <<EOF

==> ready

  worktree   $wt_path
  branch     $branch
  frontend   $frontend${port:+  (port $port)}
  sandbox    $([ "$share_sandbox" -eq 1 ] && printf 'SHARED default project -- one session at a time' || printf "isolated as '$compose_project'")

Start the session with:

  cd $wt_path && source .claude/worktree-env.sh && claude

When you are done:

  git -C $repo_root worktree remove $wt_path && git -C $repo_root worktree prune

EOF
