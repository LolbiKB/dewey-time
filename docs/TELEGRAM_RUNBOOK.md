# Telegram employee layer — operator runbook

What this covers: an employee links their Telegram account once, and from then
on gets a message when they check in or out. There is no Mini App yet; that is
plan 2.

## One-time setup

1. Create the bot with @BotFather. Keep the token.
2. Generate a webhook secret:

   ```bash
   python3 -c "import secrets; print(secrets.token_urlsafe(32))"
   ```

3. In Desk → **Dewey Time Settings → Telegram**, fill in **Telegram Bot Token**,
   **Telegram Webhook Secret**, and **Telegram Bot Username** (no `@`).
   Leave **Enable Telegram** OFF until step 5.
4. Register the webhook with Telegram:

   ```bash
   curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook" \
     -d "url=https://<site>/api/method/dewey_time.telegram.webhook.telegram_webhook" \
     -d "secret_token=<WEBHOOK SECRET>"
   ```

   Verify: `curl "https://api.telegram.org/bot<TOKEN>/getWebhookInfo"` — `url`
   correct, `last_error_message` empty, `pending_update_count` low.
5. Turn **Enable Telegram** on.

The token and secret are `Password` fields — encrypted at rest, and they never
appear in the SPA, in logs, or in an error message. If the token is unset the
feature refuses to operate rather than falling back to an empty key.

## Linking one employee

Run `dewey_time.telegram.binding.create_link_invite` with the employee id. It
returns a `https://t.me/<bot>?start=<token>` URL. Send that link to the
employee, or print it as a QR on their onboarding slip. It is **single-use and
expires in 7 days**.

Nobody types a chat id at any point, and that is the design rather than a
convenience. A Telegram chat id is an opaque number with no checksum and no
name echoed back, so a mistyped one cannot be detected by the person typing it
or by the system — it simply belongs to somebody else, who then quietly
receives an employee's attendance while the intended recipient sees nothing to
complain about.

Only the SHA-256 of the token is stored, so reading the database — a backup, a
support session, a sandbox restore — never yields a usable link.

## Who is linked

Desk → **Telegram Link**. The list is the roster of bound accounts.

## Unlinking

Set **Enabled** to 0 on that employee's Telegram Link. Notifications stop
immediately and the resolver refuses the account. The row and its version
history are kept, so the audit trail outlives the binding.

Do this the moment someone reports receiving messages that are not theirs —
before investigating, not after.

## Rollout

Notifications only fire for employees whose branch is **LIVE** in
Dewey Time Branch Rollout. To pilot, set one branch live and link a handful of
people there. Everyone else receives nothing regardless of link state, so
coverage grows with adoption rather than switching on all at once.

## When someone blocks the bot

Telegram returns 403 and the link is disabled automatically, rather than the
job retrying forever. Re-linking needs a fresh invite.

## What employees can and cannot do

The bot's only command is `/start <token>`. It does not answer `/today`,
`/week` or anything else — reading your own attendance is the Mini App's job
(plan 2), and until that ships the bot is notify-only.

The bot **ignores every non-private chat**. Adding it to a group does nothing,
by design: otherwise one add would broadcast a person's attendance to their
colleagues.

## Privacy

Punch times, branch names and schedules transit Telegram's servers. That is a
deliberate organizational decision and it belongs in the announcement that
accompanies the rollout, stated plainly rather than buried.

Telegram is a channel, never the record. Everything it shows is reconstructible
from Frappe, so losing Telegram loses a convenience and not data.

## Troubleshooting

| Symptom | Cause |
|---|---|
| Bot never replies to `/start` | Webhook not registered, or the secret in Settings does not match the one given to `setWebhook`. Check `getWebhookInfo`. |
| "That link didn't work" | Token expired, already used, or unknown. Issue a fresh invite. The bot deliberately does not say which — that distinction is useful to someone probing tokens. |
| Linked, but no notifications | Branch not LIVE in Dewey Time Branch Rollout; or **Enable Telegram** is off; or the link's **Enabled** is 0. |
| Notifications stopped for one person | They blocked the bot — the link auto-disabled. |
| `Telegram bot token is not configured` | Expected when the field is blank. The feature fails closed instead of running with an empty key. |
