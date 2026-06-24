/**
 * Extract a human-readable message from a frappe-react-sdk error.
 *
 * For a server-side `frappe.throw(...)`, Frappe returns the actual text in
 * `_server_messages` (a JSON-encoded list of JSON-encoded `{message, title}`
 * objects) — NOT in the top-level `message`, which frappe-react-sdk fills with
 * its generic "There was an error." So a naive `err.message` read hides every
 * real error. This unwraps `_server_messages` first, then `exception`, then a
 * non-generic `message`, and finally the caller's fallback.
 */

const GENERIC_SDK_MESSAGE = "There was an error.";

function stripHtml(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, " ") // line breaks -> space
    .replace(/<[^>]*>/g, "") // other tags -> remove (no stray spaces before punctuation)
    .replace(/\s+/g, " ")
    .trim();
}

function stripExceptionPrefix(exception: string): string {
  // "frappe.exceptions.ValidationError: No employee rows found." -> "No employee rows found."
  const match = exception.match(/^[\w.]+(?:Error|Exception)\s*:\s*([\s\S]+)$/);
  return (match ? match[1] : exception).trim();
}

function parseServerMessages(raw: string): string[] {
  let outer: unknown;
  try {
    outer = JSON.parse(raw);
  } catch {
    return [stripHtml(raw)].filter(Boolean);
  }
  if (!Array.isArray(outer)) return [];

  const messages: string[] = [];
  for (const item of outer) {
    let text = "";
    if (typeof item === "string") {
      try {
        const inner = JSON.parse(item);
        text =
          inner && typeof inner === "object" && "message" in inner
            ? String((inner as { message: unknown }).message)
            : item;
      } catch {
        text = item;
      }
    } else if (item && typeof item === "object" && "message" in item) {
      text = String((item as { message: unknown }).message);
    }
    text = stripHtml(text);
    if (text) messages.push(text);
  }
  return messages;
}

export function extractFrappeError(
  err: unknown,
  fallback: string = GENERIC_SDK_MESSAGE,
): string {
  if (err == null) return fallback;
  if (typeof err === "string") return err.trim() || fallback;
  if (typeof err !== "object") return String(err) || fallback;

  const obj = err as Record<string, unknown>;

  const serverMessages = obj._server_messages;
  if (typeof serverMessages === "string" && serverMessages.trim()) {
    const parsed = parseServerMessages(serverMessages);
    if (parsed.length) return parsed.join("; ");
  }

  const exception = obj.exception;
  if (typeof exception === "string" && exception.trim()) {
    const stripped = stripExceptionPrefix(exception);
    if (stripped) return stripped;
  }

  const message = obj.message;
  if (
    typeof message === "string" &&
    message.trim() &&
    message.trim() !== GENERIC_SDK_MESSAGE
  ) {
    return message.trim();
  }

  return fallback;
}
