# Telegram employee layer — operator runbook

What this covers: an employee links their Telegram account once. From then on
they get a message when they check in or out, and can open a Mini App with two
tabs — **Today**, their timeline for a day plus a month calendar to reach any
past one, and **Profile**, what HR's record says about them alongside their
rostered week.

## One-time setup

1. Create the bot with @BotFather. Keep the token.
2. Generate a webhook secret:

   ```bash
   python3 -c "import secrets; print(secrets.token_urlsafe(32))"
   ```

   **Use exactly this generator.** Telegram allows only `A-Z a-z 0-9 _ -`
   (1–256 chars) in `secret_token`. `openssl rand -base64 32` emits `+`, `/`
   and `=` and will be refused, and a trailing newline picked up when copying
   the value out of a terminal will be refused too — both produce
   `Bad Request: secret token contains unallowed characters` from
   `setWebhook`. Dewey Time validates the same rule when it reads the field,
   so a bad value fails at configure time rather than silently 403-ing every
   update later.

3. In Desk → **Dewey Time Settings → Telegram**, fill in **Telegram Bot Token**,
   **Telegram Webhook Secret**, and **Telegram Bot Username** (the `@`, and a
   pasted `https://t.me/…` profile URL, are both stripped — the deep link is
   built from the bare name, which is the one place Telegram rejects the `@`).
   Leave **Enable Telegram** OFF until step 6.
4. Set **Telegram Mini App URL** to `https://<site>/hr-me` if the site is
   reached at a different hostname than it reports for itself (a proxy, a
   vanity domain). Otherwise leave it blank — the URL is derived. Https is
   required either way; Telegram refuses a web_app button on plain http.
5. Tell Telegram everything it has to be told, in one call:

   ```
   bench --site <site> execute dewey_time.telegram.transport.setup_telegram
   ```

   This registers three pieces of state that live on **Telegram's servers**,
   not in this site: the webhook (with the update shapes the bot reads —
   messages AND `callback_query`, the button presses on the language
   chooser), the chat menu button beside the message box (the permanent way
   into the Mini App), and the command menu (`/language`). Idempotent.

   **Re-run it after any deploy that changes what the webhook handles.**
   Telegram keeps its previous settings until told otherwise — in particular
   a webhook registered without `callback_query` silently DISCARDS every
   button press: no error, no pending count, just a spinner that times out
   under the employee's thumb. Do not register the webhook with a raw
   `setWebhook` curl for the same reason; a curl that omits `allowed_updates`
   leaves the previous list in place.

   Verify: `bench --site <site> execute dewey_time.telegram.transport.diagnostics`
   — `webhook.url` correct, `webhook.last_error` empty,
   `webhook.delivers_button_presses` true, `commands.listed` includes
   `language`, `menu_button.is_miniapp` true.
6. Turn **Enable Telegram** on.

The token and secret are `Password` fields — encrypted at rest, and they never
appear in the SPA, in logs, or in an error message. If the token is unset the
feature refuses to operate rather than falling back to an empty key.

## Linking: two paths

**Start at Coverage.** `/hr-schedule/coverage` has a Telegram column and a
Telegram filter. Narrow to **Not linked** — optionally by branch, to work one
site at a time — and the list is the job. The column reports three states:

| Column says | What it means | What to do |
|---|---|---|
| Linked | a binding exists | nothing |
| ID on file | their Telegram id was already recorded on the Employee record | tell them to open the bot — no link needed |
| Not linked | neither | issue a link from the row |
| — | the lookup failed; not a claim that anyone is unlinked | check the error log |

### They open the bot (no link at all)

If `Employee.custom_telegram_chat_id` holds their numeric Telegram user id,
they just open the bot and press Start. Nothing to issue, forward or expire.

This trusts that the recorded id belongs to the person it is recorded against.
Possession of the account is proved — the id comes off the authenticated
update, never from anything the sender typed — so the only way this binds the
wrong person is if the wrong id was recorded. Every ambiguous case refuses
instead of guessing: no match, two employees sharing an id, an employee already
bound to another account, or a link that was revoked. All of them fall back to
the instruction below, and the bot never says which — the distinction is useful
to someone probing ids.

A revoked link is **not** restored by this path. Disabling a link stays
disabled until HR issues a fresh invite.

### You issue a link

For everyone else: press **Issue link** on their row, or run
`dewey_time.telegram.binding.create_link_invite` with the employee id. It
returns a `https://t.me/<bot>?start=<token>` URL. Send that link to the
employee, or print it as a QR on their onboarding slip. It is **single-use and
expires in 24 hours**. Issuing a new link revokes every outstanding one for
that employee first, so a Regenerate never leaves two live credentials.

The link is live while it is on screen: whoever opens it first is bound to that
employee's record. Send it to the person directly, never to a group.

Only the SHA-256 of the token is stored, so reading the database — a backup, a
support session, a sandbox restore — never yields a usable link.

### Why HR is never asked to type a chat id

Neither path asks anyone to enter one, and that is the design rather than a
convenience. A Telegram chat id is an opaque number with no checksum and no
name echoed back, so a mistyped one cannot be detected by the person typing it
or by the system — it simply belongs to somebody else, who then quietly
receives an employee's attendance while the intended recipient sees nothing to
complain about.

The recorded-id path is not an exception to that rule but the reason it
matters. It reads ids that were already on the Employee records when this
feature arrived — on production they are uniformly 9–10 digits with no
handles and no duplicates, which is what machine-captured data looks like
rather than hand-typed. **If you ever populate that column by hand, you are
taking on exactly the risk described above**, and a wrong digit binds a
stranger silently. Issue a link instead; it costs one click and the employee
proves the account themselves.

## Opening the app

Two ways in, both permanent: the **menu button** beside the chat's message box
(set up in step 5) and the **Main Mini App button** on the bot's profile. The
link-confirmation message deliberately carries no button — it scrolls out of
the chat and never comes back, so nothing that matters rides on it.

The app matches Telegram's light or dark theme automatically and will not
close when scrolled.

## Message language

Every message the bot sends an employee arrives in **one language: Khmer by
default, English if they chose it**. Right after linking, the bot asks with
two buttons (ខ្មែរ / English); the `/language` command — listed in the bot's
command menu — reopens the chooser at any time. The choice is stored on the
employee's **Telegram Link** row (**Language**, `km`/`en`; blank also means
Khmer), so HR can read or change it in Desk, and the change history shows on
the row's versions.

The only bilingual messages left are the ones that can arrive **before** a
choice can exist: the linking replies and the chooser itself.

## Who is linked

Desk → **Telegram Link**. The list is the roster of bound accounts.

## Unlinking

Set **Enabled** to 0 on that employee's Telegram Link. Notifications stop
immediately and the resolver refuses the account. The row and its version
history are kept, so the audit trail outlives the binding.

Do this the moment someone reports receiving messages that are not theirs —
before investigating, not after.

## Rollout

**The link is the whole permission.** A linked employee gets check-in messages
whatever their branch's phase in Dewey Time Branch Rollout — the message
carries punch facts and roster facts, no engine determination, and the
employee opted in personally by linking. The rollout phase still governs what
the **engine** concludes (flags, absences) for that branch; it just no longer
silences a person who asked to be messaged. To pilot, link a handful of
people: coverage grows with adoption because linking IS the switch.

## When someone blocks the bot

Telegram returns 403 and the link is disabled automatically, rather than the
job retrying forever. Re-linking needs a fresh invite.

## What employees can and cannot do

The bot answers two commands. `/start` with a token redeems that token; bare,
it tries the Telegram id recorded on the Employee record. `/language` opens
the message-language chooser (see **Message language** above). It does not
answer `/today`, `/week` or anything else, and that is deliberate: reading
your own attendance is the Mini App's job, so the bot stays a notifier and a
door.

The Mini App is READ-ONLY. There is nothing in it an employee can submit,
change or delete — not their contact details, not an explanation of a flag.

It DOES show attendance flags, which it did not when this runbook was first
written. Two rules keep that honest, and an operator fielding "why does it say
that?" should know both:

- **Only nine codes reach a phone**, and only the ones about the person's own
  day. Infrastructure failures and cover-shift notices are not an employee's
  business (`miniapp_api.EMPLOYEE_FLAG_CODES`).
- **A provisional flag is withheld until it is certain.** The engine deletes
  and re-writes AUTO flags on every punch, so one can appear at 09:00 and be
  gone by closeout; showing those would make the app an accusation that
  withdraws itself. HR's decision, when there is one, is shown as an outcome
  and a date — never a reason.

The same principle governs Profile's enrolment block: "not set up" and "we
have not heard from the fingerprint devices" are separate states, so nobody is
told they are unenrolled on the strength of a missing snapshot.

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
| "Use the link or QR code HR gave you" after a bare `/start` | No usable recorded id: none on file, two employees share it, they are already bound to another account, or their link was revoked. Issue a link instead. |
| Invite link opens "user not found" in Telegram | **Telegram Bot Username** names a bot that does not exist. The `@` and a pasted profile URL are stripped, and anything that cannot be a username is refused when the link is created — so what is left is a real typo, or a username belonging to a different bot than the token. `transport.diagnostics()` reports `invite_username` beside `bot` and flags `invite_username_mismatch` when they disagree. |
| Coverage shows "—" for the whole Telegram column | The backend lookup failed. Check the error log; the register reports silence rather than guessing everyone is unlinked. |
| Linked, but no notifications | **Enable Telegram** is off, or the link's **Enabled** is 0. The branch's rollout phase is NOT a factor — a link is the whole permission, because the employee opted in by sending `/start` and the message carries no engine determination. Run `transport.diagnostics(employee="DI-1234")` to see every gate at once. |
| Notifications stopped for one person | They blocked the bot — the link auto-disabled. |
| Language buttons spin, then nothing | Telegram is not delivering button presses: the webhook's `allowed_updates` predates the chooser. `diagnostics()` → `webhook.delivers_button_presses` false. Re-run `setup_telegram`. |
| `/language` not in the bot's command menu | `set_bot_commands` never ran against this bot — `diagnostics()` → `commands.listed`. Re-run `setup_telegram`. The command still works typed by hand. |
| Everyone gets Khmer; a tap on English does nothing visible | Code deployed, **Migrate not run** — the `language` column does not exist yet. Messages keep sending (the read degrades to the Khmer default) and taps refuse rather than confirm a change that cannot persist. `delivery_gates()` / `diagnostics()` → `language_column` false. Run Migrate. |
| `Telegram bot token is not configured` | Expected when the field is blank. The feature fails closed instead of running with an empty key. |
| `setWebhook` → "secret token contains unallowed characters" | The secret is outside `A-Za-z0-9_-`. Usually a trailing newline from copying it, or `openssl rand -base64`. Regenerate with `secrets.token_urlsafe` and update BOTH Settings and the curl. |
| `Telegram webhook secret must be 1-256 characters...` | Same cause, caught earlier — the value in Settings is one Telegram would never send. |
