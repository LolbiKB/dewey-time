import assert from "node:assert/strict";
import test from "node:test";

import { buildProblemRows, problemsToCsv } from "@/lib/importProblems";

const FEEDBACK = [
  {
    row_number: 5,
    employee_id: "DI-0099",
    email: "",
    employee_name: "Sok Dara",
    field: "employee_id",
    code: "EMPLOYEE_NOT_FOUND",
    severity: "error",
    message: "No active employee found for 'DI-0099'.",
    suggestion: "Verify the badge exists in Frappe Employee.",
  },
];

const ROWS = [
  { row_number: 2, id_card: "DI-0004", email: "", employee_name: "Neak Mang" },
  { row_number: 3, id_card: "DI-0008", email: "a@b.co", employee_name: "Yuoen" },
  { row_number: 5, id_card: "DI-0099", email: "", employee_name: "Sok Dara" },
];

test("buildProblemRows returns parse feedback when there are no apply failures", () => {
  const result = buildProblemRows(FEEDBACK, ROWS, {});
  assert.equal(result.length, 1);
  assert.equal(result[0].code, "EMPLOYEE_NOT_FOUND");
  assert.equal(result[0].employee_id, "DI-0099");
});

test("buildProblemRows appends apply failures as APPLY_FAILED rows carrying the backend message", () => {
  const result = buildProblemRows([], ROWS, {
    1: { type: "error", message: "Active Shift Assignment exists." },
  });
  assert.equal(result.length, 1);
  const row = result[0];
  assert.equal(row.code, "APPLY_FAILED");
  assert.equal(row.severity, "error");
  assert.equal(row.field, "apply");
  assert.equal(row.row_number, 3);
  assert.equal(row.employee_id, "DI-0008");
  assert.equal(row.email, "a@b.co");
  assert.equal(row.employee_name, "Yuoen");
  assert.equal(row.message, "Active Shift Assignment exists.");
});

test("buildProblemRows ignores non-error apply statuses", () => {
  const result = buildProblemRows([], ROWS, {
    0: { type: "ok" },
    1: { type: "applying" },
    2: { type: "idle" },
  });
  assert.equal(result.length, 0);
});

test("buildProblemRows falls back to a generic message when an apply error has none", () => {
  const result = buildProblemRows([], ROWS, { 0: { type: "error", message: "" } });
  assert.equal(result.length, 1);
  assert.equal(result[0].message, "Apply failed.");
});

test("buildProblemRows merges parse + apply problems sorted by row_number", () => {
  const result = buildProblemRows(FEEDBACK, ROWS, {
    0: { type: "error", message: "Boom." },
  });
  // row 2 (apply failure) should sort before row 5 (parse feedback)
  assert.deepEqual(
    result.map((r) => [r.row_number, r.code]),
    [
      [2, "APPLY_FAILED"],
      [5, "EMPLOYEE_NOT_FOUND"],
    ],
  );
});

test("buildProblemRows defaults a missing employee_name to an empty string", () => {
  const result = buildProblemRows([], [{ row_number: 9, id_card: "DI-1", email: "" }], {
    0: { type: "error", message: "x" },
  });
  assert.equal(result[0].employee_name, "");
});

test("problemsToCsv emits a header plus one quoted line per row", () => {
  const csv = problemsToCsv([
    {
      row_number: 3,
      employee_id: "DI-0008",
      email: "a@b.co",
      employee_name: "Yuoen",
      field: "apply",
      code: "APPLY_FAILED",
      severity: "error",
      message: "Active SSA exists.",
      suggestion: "",
    },
  ]);
  const lines = csv.split("\n");
  assert.equal(
    lines[0],
    "row_number,employee_id,email,employee_name,field,code,severity,message,suggestion",
  );
  assert.equal(
    lines[1],
    '"3","DI-0008","a@b.co","Yuoen","apply","APPLY_FAILED","error","Active SSA exists.",""',
  );
});

test("problemsToCsv escapes embedded quotes and commas", () => {
  const csv = problemsToCsv([
    {
      row_number: 1,
      employee_id: "DI-1",
      email: "",
      employee_name: "",
      field: "",
      code: "X",
      severity: "error",
      message: 'He said "hi", then left',
      suggestion: "",
    },
  ]);
  const lines = csv.split("\n");
  assert.equal(
    lines[1],
    '"1","DI-1","","","","X","error","He said ""hi"", then left",""',
  );
});

test("problemsToCsv returns just the header for an empty list", () => {
  const csv = problemsToCsv([]);
  assert.equal(
    csv,
    "row_number,employee_id,email,employee_name,field,code,severity,message,suggestion",
  );
});
