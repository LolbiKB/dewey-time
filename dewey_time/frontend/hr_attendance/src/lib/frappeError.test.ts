import assert from "node:assert/strict";
import test from "node:test";

import { extractFrappeError } from "@/lib/frappeError";

test("extractFrappeError surfaces the human message from Frappe _server_messages", () => {
  // This is the real shape frappe-react-sdk throws for a frappe.throw():
  // top-level message is the SDK's generic fallback; the real text is the
  // double-JSON-encoded _server_messages.
  const err = {
    message: "There was an error.",
    _server_messages: JSON.stringify([
      JSON.stringify({
        message:
          "No employee rows found. First column must be an employee ID (e.g. DI-0159).",
        title: "Message",
      }),
    ]),
  };
  assert.equal(
    extractFrappeError(err),
    "No employee rows found. First column must be an employee ID (e.g. DI-0159).",
  );
});

test("extractFrappeError joins multiple server messages", () => {
  const err = {
    _server_messages: JSON.stringify([
      JSON.stringify({ message: "First problem." }),
      JSON.stringify({ message: "Second problem." }),
    ]),
  };
  assert.equal(extractFrappeError(err), "First problem.; Second problem.");
});

test("extractFrappeError strips HTML out of server messages", () => {
  const err = {
    _server_messages: JSON.stringify([
      JSON.stringify({ message: "Not permitted to <b>import</b>.<br>Ask an admin." }),
    ]),
  };
  assert.equal(extractFrappeError(err), "Not permitted to import. Ask an admin.");
});

test("extractFrappeError handles a plain-string server message", () => {
  const err = { _server_messages: JSON.stringify(["Plain text message."]) };
  assert.equal(extractFrappeError(err), "Plain text message.");
});

test("extractFrappeError falls back to exception, stripping the class prefix", () => {
  const err = {
    message: "There was an error.",
    exception: "frappe.exceptions.ValidationError: No employee rows found.",
  };
  assert.equal(extractFrappeError(err), "No employee rows found.");
});

test("extractFrappeError uses message when it is not the SDK generic fallback", () => {
  assert.equal(extractFrappeError({ message: "Boom." }), "Boom.");
});

test("extractFrappeError returns the fallback when only the generic SDK message exists", () => {
  assert.equal(extractFrappeError({ message: "There was an error." }), "There was an error.");
  assert.equal(
    extractFrappeError({ message: "There was an error." }, "Failed"),
    "Failed",
  );
});

test("extractFrappeError handles non-object errors", () => {
  assert.equal(extractFrappeError("raw string"), "raw string");
  assert.equal(extractFrappeError(null), "There was an error.");
  assert.equal(extractFrappeError(undefined, "Failed"), "Failed");
});
