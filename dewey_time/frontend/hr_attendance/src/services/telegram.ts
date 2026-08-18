import { frappeCall } from "@/lib/frappe";

export type LinkInvite = {
  employee: string;
  url: string;
  expires_at: string;
  /**
   * Seconds from receipt, not a timestamp.
   *
   * `expires_at` is a naive site-local datetime string. A browser cannot turn
   * that into an instant without knowing the site's timezone, so a countdown
   * driven from it is wrong by whatever the two differ by. A duration needs
   * neither a timezone nor a synchronised clock.
   */
  expires_in_seconds: number;
};

export type LinkRevocation = {
  employee: string;
  unlinked: number;
  tokens_revoked: number;
};

/**
 * Mint a single-use Telegram link for one employee.
 *
 * POST, and that is load-bearing rather than stylistic. The response body IS a
 * credential — whoever opens the URL binds their Telegram account to this
 * employee's record — and a GET would put the employee id in the query string
 * of every access log, proxy log and browser history entry between here and
 * the bench. The whitelist on the Python side pins `methods=["POST"]` for the
 * same reason; this is the client half of that agreement.
 */
export function createLinkInvite(employee: string) {
  return frappeCall<LinkInvite>(
    "dewey_time.telegram.binding.create_link_invite",
    { employee },
    { method: "POST" },
  );
}

/**
 * Unbind an employee's Telegram account, and kill any link still in flight.
 *
 * POST for the same reason as `createLinkInvite`: the employee id names whose
 * access is being destroyed, and a GET would leave it in every access log,
 * proxy log and browser history entry on the way to the bench.
 */
export function revokeLink(employee: string) {
  return frappeCall<LinkRevocation>(
    "dewey_time.telegram.binding.revoke_link",
    { employee },
    { method: "POST" },
  );
}
