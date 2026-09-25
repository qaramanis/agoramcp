import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, test } from "node:test";
import { RefusedAddressError, fetchUntrusted, isPublicAddress } from "./untrusted.ts";

describe("isPublicAddress", () => {
  const cases: [string, boolean][] = [
    ["8.8.8.8", true],
    ["185.8.80.1", true],
    ["127.0.0.1", false],
    ["10.1.2.3", false],
    ["172.20.0.1", false],
    ["192.168.1.1", false],
    ["169.254.169.254", false],
    ["100.64.0.1", false],
    ["0.0.0.0", false],
    ["224.0.0.1", false],
    ["255.255.255.255", false],
    ["198.18.0.1", false],
    ["::1", false],
    ["::", false],
    ["fe80::1", false],
    ["fd00::1", false],
    ["::ffff:127.0.0.1", false],
    ["::ffff:7f00:1", false],
    ["::ffff:8.8.8.8", true],
    ["64:ff9b::a00:1", false],
    ["2001:db8::1", false],
    ["2002:7f00:1::", false],
    ["2a00:1450:4001:82b::200e", true],
    ["ff02::1", false],
    ["not-an-ip", false],
  ];
  for (const [address, expected] of cases) {
    test(`${address} is ${expected ? "public" : "not public"}`, () => {
      assert.equal(isPublicAddress(address), expected);
    });
  }
});

describe("fetchUntrusted", () => {
  // A server that must never be reached: every refusal happens before a connection is made.
  let trap: Server;
  let port: number;
  let hits = 0;

  before(async () => {
    trap = createServer((_request, response) => {
      hits += 1;
      response.end("secret");
    });
    await new Promise<void>((resolve) => trap.listen(0, "::", resolve));
    port = (trap.address() as AddressInfo).port;
  });
  after(() => trap.close());

  const refused = async (url: string, message: RegExp) => {
    await assert.rejects(fetchUntrusted(url, { signal: AbortSignal.timeout(5_000) }), (error) => {
      assert.ok(error instanceof RefusedAddressError, `expected a refusal, got ${String(error)}`);
      assert.match(error.message, message);
      return true;
    });
  };

  test("refuses IP literals that are not public", async () => {
    await refused(`http://127.0.0.1:${port}/`, /127\.0\.0\.1 is not a public internet address/);
    await refused(`http://[::1]:${port}/`, /::1 is not a public/);
    await refused(`http://[::ffff:127.0.0.1]:${port}/`, /not a public/);
    await refused("http://169.254.169.254/latest/meta-data/", /169\.254\.169\.254/);
  });

  test("refuses the other spellings of loopback URL parsing accepts", async () => {
    await refused(`http://0x7f.1:${port}/`, /127\.0\.0\.1/);
    await refused(`http://2130706433:${port}/`, /127\.0\.0\.1/);
  });

  test("refuses a name that resolves to a non-public address, after DNS", async () => {
    await refused(`http://localhost:${port}/`, /^localhost \(.+\) is not a public internet address\.$/);
  });

  test("refuses what is not http or https, or not a URL", async () => {
    await refused("ftp://example.com/file.csv", /not an http or https address/);
    await refused("file:///etc/passwd", /not an http or https address/);
    await refused("not a url", /not a web address/);
  });

  test("never reached the server it refused", () => {
    assert.equal(hits, 0);
  });
});
