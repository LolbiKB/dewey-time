import assert from "node:assert/strict";
import test from "node:test";

import {
  coverageQueryOptions, enrollmentQueryOptions, composeRefresh,
} from "@/hooks/useCoverageRegister";
import { queryKeys } from "@/lib/queryKeys";
import { getScheduleCoverage } from "@/services/coverage";
import { getEnrollmentReport } from "@/services/enrollment";

// There is no jsdom/React Testing Library in this suite, so useCoverageRegister
// itself cannot be rendered. What CAN be pinned without rendering is the two
// query configs and the refresh callback the hook builds from them — both
// exported as plain values for exactly this reason (see their doc comments in
// useCoverageRegister.ts). This mirrors enrollmentWiring.test.ts's approach of
// asserting hook wiring without a DOM, one level more directly since this
// hook's configs are importable values rather than only inline literals.

test("the coverage query uses the coverage key and the coverage queryFn, not swapped with enrollment's", () => {
  // Both query keys are `readonly string[]`, so a swap between the two useQuery
  // calls in the hook typechecks silently and would collide this cache entry
  // with useScheduleCoverage's under the wrong queryFn.
  assert.deepEqual(coverageQueryOptions.queryKey, queryKeys.coverage.all);
  assert.equal(coverageQueryOptions.queryFn, getScheduleCoverage);
});

test("the enrollment query uses the enrollment key and the enrollment queryFn, not swapped with coverage's", () => {
  assert.deepEqual(enrollmentQueryOptions.queryKey, queryKeys.enrollment.all);
  assert.equal(enrollmentQueryOptions.queryFn, getEnrollmentReport);
});

test("composeRefresh refetches BOTH feeds, not just one", () => {
  let coverageCalls = 0;
  let enrollmentCalls = 0;
  const refresh = composeRefresh(
    () => { coverageCalls += 1; },
    () => { enrollmentCalls += 1; },
  );
  refresh();
  assert.equal(coverageCalls, 1, "refresh must refetch the coverage feed");
  assert.equal(enrollmentCalls, 1, "refresh must refetch the enrollment feed");
});
