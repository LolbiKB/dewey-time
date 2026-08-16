import { frappeCall } from "@/lib/frappe";

export type LinkInvite = { employee: string; url: string; expires_at: string };

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
