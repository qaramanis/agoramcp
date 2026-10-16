import { createLogger, createMemoryCache, type ToolContext } from "@agoramcp/core";
import assert from "node:assert/strict";
import { describe, test } from "node:test";

/** Nothing here may reach the real site. */
globalThis.fetch = async () => {
  throw new Error("no network in tests");
};

const { AREAS } = await import("./areas.ts");
const { BORDERS, EXPECTED_LEGEND, HEIGHT, LIGHTNING_BOX, SWATCH_ROWS, SWATCH_X, WIDTH, classify, parseArchive, riskAt, toPixel } =
  await import("./client.ts");
const { getFireRiskTool } = await import("./tools.ts");

/**
 * A map drawn here on the template: white sea, the legend in its swatches,
 * black at every border check point, and each area's sample discs painted in
 * a category of the test's choosing.
 */
function drawMap(categoryOf: (id: number) => number, options: { lightning?: boolean } = {}) {
  const data = new Uint8Array(WIDTH * HEIGHT * 3).fill(255);
  const paint = (x: number, y: number, rgb: readonly number[]) => {
    const i = (y * WIDTH + x) * 3;
    data[i] = rgb[0] ?? 0;
    data[i + 1] = rgb[1] ?? 0;
    data[i + 2] = rgb[2] ?? 0;
  };
  for (const [category, [top, bottom]] of Object.entries(SWATCH_ROWS)) {
    for (let y = top; y <= bottom; y += 1) for (let x = SWATCH_X[0]; x <= SWATCH_X[1]; x += 1) paint(x, y, EXPECTED_LEGEND[Number(category)] ?? []);
  }
  for (const [x, y] of BORDERS) paint(x, y, [0, 0, 0]);
  for (const area of AREAS) {
    const colour = EXPECTED_LEGEND[categoryOf(area.id)] ?? [];
    for (const [cx, cy, r] of area.samples) {
      for (let dy = -r - 3; dy <= r + 3; dy += 1) for (let dx = -r - 3; dx <= r + 3; dx += 1) paint(cx + dx, cy + dy, colour);
    }
  }
  if (options.lightning) {
    for (let y = LIGHTNING_BOX.y0; y < LIGHTNING_BOX.y0 + 20; y += 1) for (let x = LIGHTNING_BOX.x0; x < LIGHTNING_BOX.x0 + 300; x += 1) paint(x, y, [0, 0, 0]);
  }
  return data;
}

describe("classify", () => {
  test("reads every area's category, and the lightning advisory", () => {
    const pick = (id: number) => (id % 5) + 1;
    const read = classify(drawMap(pick, { lightning: true }), WIDTH, HEIGHT, "2026-08-13", "u");
    assert.equal(read.areas.length, 148);
    for (const entry of read.areas) assert.equal(entry.category, pick(entry.area.id), entry.area.place);
    assert.equal(read.lightningAdvisory, true);
    assert.equal(classify(drawMap(pick), WIDTH, HEIGHT, "d", "u").lightningAdvisory, false);
  });

  test("refuses a map that is not the calibrated template, rather than read it wrongly", () => {
    assert.throws(() => classify(new Uint8Array(830 * 872 * 3), 830, 872, "2022-07-25", "u"), /830×872/);
    // Borders gone: the template has moved.
    const moved = drawMap(() => 1);
    for (const [x, y] of BORDERS) moved.fill(255, (y * WIDTH + x) * 3, (y * WIDTH + x) * 3 + 3);
    assert.throws(() => classify(moved, WIDTH, HEIGHT, "d", "u"), /does not match the template/);
  });
});

describe("a point", () => {
  test("projects onto the template, and finds its area by flooding its own colour", () => {
    const athens = AREAS.find((area) => area.place === "Αθήνα");
    assert.ok(athens);
    const [sx, sy] = athens.samples[0] ?? [0, 0, 0];
    const data = drawMap((id) => (id === athens.id ? 5 : 1));
    // A point two pixels off the disc's centre, still inside the painted patch.
    const risk = riskAt(data, WIDTH, HEIGHT, sx + 2, sy + 1);
    assert.equal(risk?.category, 5);
    assert.equal(risk?.area?.place, "Αθήνα");
    // Open sea has no category.
    assert.equal(riskAt(data, WIDTH, HEIGHT, 1211, 1000), null);
  });

  test("Athens's coordinates land in the Athens area's pixels", () => {
    const athens = AREAS.find((area) => area.place === "Αθήνα");
    const [x, y] = toPixel(37.9755, 23.7348);
    const [sx, sy] = athens?.samples[0] ?? [0, 0, 0];
    assert.ok(Math.hypot(x - sx, y - sy) < 15, `${x},${y} vs ${sx},${sy}`);
  });
});

describe("the archive", () => {
  test("reads each tile's image and the date it is valid for, newest first", () => {
    const html =
      '<a href="/sites/default/files/2026-07/260801.jpg" class="maps_tile" data-sub-html="01/08/2026"><img></a>' +
      '<a href="/sites/default/files/2026-10/261016.jpg" class="maps_tile" data-sub-html="16/10/2026">' +
      '<a class="maps_tile">';
    assert.deepEqual(parseArchive(html), [
      { date: "2026-10-16", url: "https://civilprotection.gov.gr/sites/default/files/2026-10/261016.jpg" },
      { date: "2026-08-01", url: "https://civilprotection.gov.gr/sites/default/files/2026-07/260801.jpg" },
    ]);
  });
});

describe("the season", () => {
  test("a date outside 1 May to 31 October is answered, not looked up", async () => {
    const context: ToolContext = { cache: createMemoryCache(), logger: createLogger({ level: "error" }), ttl: 60, signal: new AbortController().signal, env: {} };
    const result = (await getFireRiskTool.handler({ date: "2026-12-01" }, context)) as { issued: boolean };
    assert.equal(result.issued, false);
  });
});
