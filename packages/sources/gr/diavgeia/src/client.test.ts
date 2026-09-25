import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { MAX_WINDOW_DAYS, addDays, buildSearchQuery, issueWindow } from "./client.ts";

const base = { status: "all" as const, page: 0, size: 10 };

describe("buildSearchQuery", () => {
  test("each filter is a quoted phrase, and a quote or backslash cannot close it", () => {
    assert.equal(
      buildSearchQuery({ ...base, text: 'σύμβαση "έργου"', organizationId: "99221922", signerId: "a\\b" }),
      'q:"σύμβαση \\"έργου\\"" AND organizationUid:"99221922" AND signerUid:"a\\\\b"',
    );
  });

  test("issuedTo means the whole day it names, not its first hours", () => {
    assert.equal(
      buildSearchQuery({ ...base, issuedFrom: "2026-08-01", issuedTo: "2026-08-20" }),
      "issueDate:[DT(2026-08-01T00:00:00) TO DT(2026-08-20T23:59:59)]",
    );
  });

  test("status is spelled the way the index spells it", () => {
    assert.equal(buildSearchQuery({ ...base, status: "published" }), 'status:"Αναρτημένη"');
    assert.equal(buildSearchQuery({ ...base, status: "revoked" }), 'status:"Ανακληθείσα"');
    assert.equal(buildSearchQuery(base), "");
  });
});

describe("issueWindow", () => {
  test("issuedTo alone is the widest window upstream honours, ending there", () => {
    assert.deepEqual(issueWindow({ issuedTo: "2026-08-20" }), { from: addDays("2026-08-20", -MAX_WINDOW_DAYS), to: "2026-08-20" });
  });

  test("neither bound leaves the window to upstream", () => {
    assert.equal(issueWindow({}), null);
  });
});

describe("addDays", () => {
  test("counts calendar days across months, years and a leap day", () => {
    assert.equal(addDays("2026-01-31", 1), "2026-02-01");
    assert.equal(addDays("2026-12-31", 1), "2027-01-01");
    assert.equal(addDays("2028-02-28", 1), "2028-02-29");
    assert.equal(addDays("2026-03-01", -1), "2026-02-28");
    assert.equal(addDays("2026-08-20", -180), "2026-02-21");
  });
});
