import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  buildHistory,
  composeSources,
  composeVerdict,
  HISTORY_DAYS,
  summarise,
  type Check,
  type Mounted,
} from "./status-model";

const now = new Date("2026-10-16T12:05:00Z");

const vies: Mounted = { key: "gr/vies", id: "vies", country: "gr", name: "VIES", href: "/all/gr/vies" };
const noa: Mounted = { key: "gr/noa", id: "noa", country: "gr", name: "Seismoi", href: "/all/gr/noa" };

/** A check `minutesAgo` before `now`. */
function check(source: string, minutesAgo: number, outcome: "ok" | "slow" | "down" = "ok", extra: Partial<Check> = {}): Check {
  return {
    source,
    tool: "list",
    calledAt: new Date(now.getTime() - minutesAgo * 60_000).toISOString(),
    ok: outcome !== "down",
    code: outcome === "down" ? "upstream_timeout" : null,
    detail: outcome === "down" ? "upstream_timeout: VIES did not answer." : null,
    durationMs: outcome === "slow" ? 4_000 : 300,
    ...extra,
  };
}

describe("composeSources", () => {
  test("the latest check is the state, and a run of them says since when", () => {
    const checks = [check("gr/vies", 5, "down"), check("gr/vies", 15, "down"), check("gr/vies", 25, "ok"), check("gr/vies", 35, "ok")];
    const [status] = composeSources([vies], checks, [], now);
    assert.equal(status?.health, "down");
    assert.equal(status?.detail, "upstream_timeout: VIES did not answer.");
    assert.equal(status?.checks, 2);
    assert.equal(status?.since, checks[1]?.calledAt);
    assert.equal(status?.sinceOrEarlier, false);
  });

  test("an answer over the slow line is slow, not down", () => {
    const [status] = composeSources([vies], [check("gr/vies", 5, "slow")], [], now);
    assert.equal(status?.health, "slow");
    assert.equal(status?.detail, null);
  });

  test("a run that fills the whole window is a lower bound", () => {
    const checks = Array.from({ length: 144 }, (_, i) => check("gr/vies", 5 + i * 10));
    const [status] = composeSources([vies], checks, [], now);
    assert.equal(status?.checks, 144);
    assert.equal(status?.sinceOrEarlier, true);
  });

  test("no check yet, or none recent, is unknown and says which", () => {
    const [never] = composeSources([vies], [], [], now);
    assert.equal(never?.health, "unknown");
    assert.match(never?.detail ?? "", /Not checked yet/);

    const [old] = composeSources([vies], [check("gr/vies", 40)], [], now);
    assert.equal(old?.health, "unknown");
    assert.equal(old?.detail, "Not checked since 11:25 UTC, when it was answering.");
  });

  test("real calls since the check travel with the registry, and the list is by name", () => {
    const traffic = [{ source: "gr/vies", total: 9, failed: 2, lastAnsweredAt: null, lastFailedAt: now.toISOString() }];
    const statuses = composeSources([vies, noa], [check("gr/vies", 5), check("gr/noa", 5)], traffic, now);
    assert.deepEqual(statuses.map((status) => status.name), ["Seismoi", "VIES"]);
    assert.equal(statuses[1]?.traffic?.failed, 2);
    assert.equal(statuses[0]?.traffic, null);
  });
});

describe("composeVerdict", () => {
  const verdict = (checks: Check[], mounted = [vies, noa]) => composeVerdict(composeSources(mounted, checks, [], now), checks, now);

  test("all answering, some not, none", () => {
    assert.equal(verdict([check("gr/vies", 5), check("gr/noa", 5)]).state, "ok");
    assert.equal(verdict([check("gr/vies", 5, "down"), check("gr/noa", 5)]).state, "degraded");
    assert.equal(verdict([check("gr/vies", 5, "down"), check("gr/noa", 5, "down")]).state, "down");
  });

  test("the next check is due ten minutes after the latest", () => {
    const result = verdict([check("gr/vies", 5), check("gr/noa", 5)]);
    assert.equal(result.checkedAt, "2026-10-16T12:00:00.000Z");
    assert.equal(result.nextCheckBy, "2026-10-16T12:10:00.000Z");
  });

  test("a round in which our own server did not answer is about our server", () => {
    const unreachable = { code: "unreachable", tool: "", detail: "agoramcp could not be reached." };
    const result = verdict([check("gr/vies", 5, "down", unreachable), check("gr/noa", 5, "down", unreachable), check("gr/vies", 15)]);
    assert.equal(result.state, "server");
  });

  test("a monitor that has stopped is not reported as the present", () => {
    const result = verdict([check("gr/vies", 60), check("gr/noa", 60)]);
    assert.equal(result.state, "stale");
    assert.equal(result.summary, "The monitor has not checked since 11:05 UTC on 16 October 2026.");
    assert.equal(result.nextCheckBy, null);
  });

  test("nothing recorded is said as such", () => {
    assert.equal(verdict([]).state, "none");
  });
});

describe("summarise", () => {
  test("counts what is not answering against what was checked", () => {
    const statuses = composeSources([vies, noa], [check("gr/vies", 5, "down"), check("gr/noa", 5)], [], now);
    assert.equal(summarise(statuses), "1 of 2 registries is not answering.");
  });

  test("names what could not be checked beside what was", () => {
    const statuses = composeSources([vies, noa], [check("gr/vies", 5)], [], now);
    assert.equal(summarise(statuses), "The registry answered. 1 has not been checked recently.");
  });
});

describe("buildHistory", () => {
  test("a strip per mounted registry, days by their share of failures", () => {
    const rows = [
      { source: "gr/vies", day: "2026-10-16", total: 100, failed: 0 },
      { source: "gr/vies", day: "2026-10-15", total: 100, failed: 2 },
      { source: "gr/vies", day: "2026-10-14", total: 100, failed: 30 },
    ];
    const history = buildHistory(rows, ["gr/vies", "gr/noa"], now);
    const days = history["gr/vies"]?.days ?? [];
    assert.equal(days.length, HISTORY_DAYS);
    assert.deepEqual(days.slice(-3).map((day) => day.state), ["outage", "degraded", "ok"]);
    assert.equal(history["gr/vies"]?.uptime, 268 / 300);
    assert.equal(history["gr/noa"]?.uptime, null);
  });
});
