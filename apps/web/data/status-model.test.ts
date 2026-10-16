import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  buildHistory,
  composeSources,
  composeVerdict,
  HISTORY_DAYS,
  summarise,
  type Evidence,
  type Mounted,
} from "./status-model";

const now = new Date("2026-10-16T12:05:00Z");

const vies: Mounted = { key: "gr/vies", id: "vies", country: "gr", name: "VIES", href: "/all/gr/vies" };
const noa: Mounted = { key: "gr/noa", id: "noa", country: "gr", name: "Seismoi", href: "/all/gr/noa" };

const ago = (hours: number) => new Date(now.getTime() - hours * 3_600_000).toISOString();

type Latest = Evidence["latest"];

/** A registry's evidence, its newest row `hoursAgo` before `now`. */
function evidence(source: string, hoursAgo: number, latest: Partial<Latest> = {}, extra: Partial<Evidence> = {}): Evidence {
  return {
    source,
    latest: {
      at: ago(hoursAgo),
      via: "api",
      tool: "check_vat_number",
      answered: true,
      code: null,
      detail: null,
      durationMs: 300,
      ...latest,
    },
    run: { since: ago(hoursAgo + 2), count: 5, reachesBack: false },
    lastDay: { total: 5, failed: 0 },
    probe: { at: ago(8), tool: "list_member_states", ok: true, code: null, detail: null, durationMs: 420 },
    ...extra,
  };
}

const failed: Partial<Latest> = { answered: false, code: "upstream_timeout" };

describe("composeSources", () => {
  test("the newest row is the state, whoever asked, and the run says since when", () => {
    const [status] = composeSources([vies], [evidence("gr/vies", 0.1, failed)], now);
    assert.equal(status?.health, "down");
    assert.equal(status?.askedBy, "api");
    assert.equal(status?.since, ago(2.1));
    assert.equal(status?.run, 5);
    assert.equal(status?.sinceOrEarlier, false);
  });

  test("a failed real call is named by its code, the monitor's by its own sentence", () => {
    const [call] = composeSources([vies], [evidence("gr/vies", 0.1, failed)], now);
    assert.equal(call?.detail, "upstream_timeout: The registry did not answer in time.");

    const sentence = "upstream_timeout: VIES did not answer.";
    const [check] = composeSources([vies], [evidence("gr/vies", 0.1, { ...failed, via: "probe", detail: sentence })], now);
    assert.equal(check?.detail, sentence);
    assert.equal(check?.askedBy, "check");
  });

  test("only the monitor's check can be slow: a real call is as long as its question", () => {
    const [check] = composeSources([vies], [evidence("gr/vies", 0.1, { via: "probe", durationMs: 4_000 })], now);
    assert.equal(check?.health, "slow");
    assert.equal(check?.detail, null);

    const [call] = composeSources([vies], [evidence("gr/vies", 0.1, { via: "mcp", durationMs: 9_000 })], now);
    assert.equal(call?.health, "ok");
    assert.equal(call?.askedBy, "mcp");
  });

  test("nothing in the window, or nothing for a day and more, is unknown and says which", () => {
    const [never] = composeSources([vies], [], now);
    assert.equal(never?.health, "unknown");
    assert.match(never?.detail ?? "", /Not asked in the last 7 days/);
    assert.match(never?.detail ?? "", /between 04:00 and 05:00 UTC/);

    const [old] = composeSources([vies], [evidence("gr/vies", 30)], now);
    assert.equal(old?.health, "unknown");
    assert.equal(old?.detail, "Not asked since 06:05 UTC on 15 October 2026, when it was answering.");

    const [yesterday] = composeSources([vies], [evidence("gr/vies", 25)], now);
    assert.equal(yesterday?.health, "ok");
  });

  test("the monitor's check travels apart from the newest row, and the list is by name", () => {
    const statuses = composeSources([vies, noa], [evidence("gr/vies", 0.1), evidence("gr/noa", 1, {}, { probe: null })], now);
    assert.deepEqual(statuses.map((status) => status.name), ["Seismoi", "VIES"]);
    assert.deepEqual(statuses[1]?.check, { at: ago(8), tool: "list_member_states", ok: true, ms: 420 });
    assert.equal(statuses[0]?.check, null);
  });
});

describe("composeVerdict", () => {
  const verdict = (rows: Evidence[], mounted = [vies, noa]) => composeVerdict(composeSources(mounted, rows, now), now);

  test("all answering, some not, none", () => {
    assert.equal(verdict([evidence("gr/vies", 1), evidence("gr/noa", 1)]).state, "ok");
    assert.equal(verdict([evidence("gr/vies", 1, failed), evidence("gr/noa", 1)]).state, "degraded");
    assert.equal(verdict([evidence("gr/vies", 1, failed), evidence("gr/noa", 1, failed)]).state, "down");
  });

  test("it says when anything was last asked, and when the monitor last checked", () => {
    const result = verdict([evidence("gr/vies", 0.5), evidence("gr/noa", 3)]);
    assert.equal(result.askedAt, ago(0.5));
    assert.equal(result.checkedAt, ago(8));
    assert.equal(result.monitorLate, false);
  });

  test("a monitor that has missed its run is said, while real calls still count", () => {
    const late = { probe: { at: ago(30), tool: "list", ok: true, code: null, detail: null, durationMs: 300 } };
    const result = verdict([evidence("gr/vies", 0.5, {}, late), evidence("gr/noa", 1, {}, late)]);
    assert.equal(result.state, "ok");
    assert.equal(result.monitorLate, true);
  });

  test("when every registry's newest row is our own server unreachable, that is the news", () => {
    const unreachable = { via: "probe", tool: "", answered: false, code: "unreachable", detail: "agoramcp could not be reached." };
    const result = verdict([evidence("gr/vies", 8, unreachable), evidence("gr/noa", 8, unreachable)]);
    assert.equal(result.state, "server");

    // A real call recorded since is the server answering again.
    assert.equal(verdict([evidence("gr/vies", 1), evidence("gr/noa", 8, unreachable)]).state, "degraded");
  });

  test("nothing asked for a day and more is not reported as the present", () => {
    const result = verdict([evidence("gr/vies", 30), evidence("gr/noa", 40)]);
    assert.equal(result.state, "stale");
    assert.equal(result.summary, "Nothing has been asked since 06:05 UTC on 15 October 2026.");
  });

  test("nothing recorded is said as such", () => {
    assert.equal(verdict([]).state, "none");
  });
});

describe("summarise", () => {
  test("counts what did not answer against what was asked", () => {
    const statuses = composeSources([vies, noa], [evidence("gr/vies", 1, failed), evidence("gr/noa", 1)], now);
    assert.equal(summarise(statuses), "1 of 2 registries did not answer when last asked.");
  });

  test("names what was not asked beside what was", () => {
    const statuses = composeSources([vies, noa], [evidence("gr/vies", 1)], now);
    assert.equal(summarise(statuses), "The registry answered when last asked. 1 has not been asked recently.");
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
