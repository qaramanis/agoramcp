import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { REQUESTER_ID, requesterId, requesterKey, secretMatches } from "./requester.ts";

describe("requesterKey", () => {
  const cases: [string, string, string][] = [
    ["IPv4 whole", "94.66.10.20", "94.66.10.20"],
    ["surrounding space", "  94.66.10.20 ", "94.66.10.20"],
    ["IPv6 by its /64", "2a02:0587:1234:5600:1111:2222:3333:4444", "2a02:587:1234:5600::/64"],
    ["another host in the same /64", "2a02:587:1234:5600:dead:beef::1", "2a02:587:1234:5600::/64"],
    ["the next /64", "2a02:587:1234:5601::1", "2a02:587:1234:5601::/64"],
    ["compression inside the prefix", "2001:db8::1", "2001:db8:0:0::/64"],
    ["upper case", "2A02:587:1234:5600::1", "2a02:587:1234:5600::/64"],
    ["brackets", "[2a02:587:1234:5600::1]", "2a02:587:1234:5600::/64"],
    ["a zone id", "fe80::1%en0", "fe80:0:0:0::/64"],
    ["IPv4-mapped, dotted", "::ffff:94.66.10.20", "94.66.10.20"],
    ["IPv4-mapped, hex", "::ffff:5e42:a14", "94.66.10.20"],
    ["not an address", "unknown", "unknown"],
  ];
  for (const [label, address, key] of cases) {
    test(label, () => assert.equal(requesterKey(address), key));
  }
});

describe("requesterId", () => {
  test("is one id per person: a mapped IPv4 is its IPv4, a /64 is one household", () => {
    assert.equal(requesterId("::ffff:94.66.10.20", "s"), requesterId("94.66.10.20", "s"));
    assert.equal(requesterId("2a02:587:1234:5600::1", "s"), requesterId("2a02:587:1234:5600:ffff::9", "s"));
  });

  test("depends on the salt, and has the shape a header is checked against", () => {
    assert.notEqual(requesterId("94.66.10.20", "s"), requesterId("94.66.10.20", "t"));
    assert.match(requesterId("94.66.10.20", "s"), REQUESTER_ID);
  });
});

describe("secretMatches", () => {
  test("only the exact secret matches, whatever its length", () => {
    const secret = "p".repeat(40);
    assert.equal(secretMatches(secret, secret), true);
    assert.equal(secretMatches("q".repeat(40), secret), false);
    assert.equal(secretMatches("p", secret), false);
    assert.equal(secretMatches(undefined, secret), false);
  });
});
