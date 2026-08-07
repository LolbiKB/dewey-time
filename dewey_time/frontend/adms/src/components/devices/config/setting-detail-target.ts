import type { TerminalPlan } from '@/lib/device-option-plan'

/**
 * What the canary target picker should show after a render where `target`
 * may no longer be a terminal `plan.terminals` actually contains.
 *
 * Split into its own file for the same reason `nextDraft` is
 * (fleet-standard-draft.ts) — beyond keeping the pure decision testable on
 * its own, `SettingDetail` also exports the `SettingDetail` component itself,
 * and `react-refresh/only-export-components` refuses a second, non-component
 * export from a component file.
 *
 * `renderToStaticMarkup` renders once and cannot exercise a prop change on a
 * live instance, so this is pinned by unit tests directly rather than by
 * re-rendering the component. Two situations need it, neither of which is a
 * key switch (the terminal-serial domain is the same approved-device list
 * for every key, so a target picked under one key stays valid under the
 * next):
 *
 *   The pane mounts before terminals are available (loading, or an empty
 *   approved list) — `target` starts at `''`, which is not in the (then
 *   empty) list, so this falls through to the same "not present" branch
 *   below once terminals arrive.
 *
 *   A terminal leaves the fleet mid-session — `target` still names it, the
 *   Select would render blank (a controlled value that matches no item), and
 *   without this the Try button would stay enabled with no visible target.
 *
 * Membership is re-checked on every render rather than gated on a "did the
 * key change" flag like `nextDraft` needs — there is no separate "operator
 * typed something" state to protect here, so the check is simply idempotent:
 * once `target` is valid (or both `target` and the fallback are `''`),
 * re-running it is a no-op.
 */
export function nextCanaryTarget(target: string, terminals: TerminalPlan[]): string {
  if (terminals.some((t) => t.deviceSn === target)) return target
  return terminals[0]?.deviceSn ?? ''
}
