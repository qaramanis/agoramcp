import { InvalidInputError, NotFoundError, UpstreamError } from "@agoramcp/core";
import assert from "node:assert/strict";
import { createServer, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, test } from "node:test";
import { createCkanClient, type CkanClient } from "./client.ts";

/** A CKAN action API that records what it was asked and answers from `reply`. */
describe("createCkanClient", () => {
  let server: Server;
  let client: CkanClient;
  let asked: URL[] = [];
  let reply: (response: ServerResponse) => void = () => {};
  const signal = () => AbortSignal.timeout(5_000);
  const json = (status: number, body: unknown) => (response: ServerResponse) => {
    response.statusCode = status;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify(body));
  };
  const search = { sort: "relevance" as const, page: 0, size: 5 };

  before(async () => {
    server = createServer((request, response) => {
      asked.push(new URL(request.url ?? "/", "http://ckan.test"));
      reply(response);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    client = createCkanClient({ baseUrl: `http://127.0.0.1:${port}`, name: "test.gov.gr", namespace: "gr/test", defaultLicence: null });
  });
  after(() => server.close());

  test("quotes and escapes every filter value, so it cannot break out of its term", async () => {
    asked = [];
    reply = json(200, { success: true, result: { count: 0, results: [] } });
    await client.search({ ...search, organization: 'min"istry', tag: "back\\slash", format: "CSV", licence: "cc-by" }, signal());

    const url = asked[0]!;
    assert.equal(url.pathname, "/api/3/action/package_search");
    assert.equal(
      url.searchParams.get("fq"),
      'organization:"min\\"istry" AND tags:"back\\\\slash" AND res_format:"CSV" AND license_id:"cc-by"',
    );
  });

  test("a theme is reduced to the letters of its code", async () => {
    asked = [];
    reply = json(200, { success: true, result: { count: 0, results: [] } });
    await client.search({ ...search, theme: 'regi" OR *:*' }, signal());
    assert.equal(asked[0]!.searchParams.get("fq"), "theme:*data-theme/REGIOR*");
  });

  test("no text searches everything, and the page becomes rows and start", async () => {
    asked = [];
    reply = json(200, { success: true, result: { count: 42, results: [] } });
    const result = await client.search({ ...search, page: 2, size: 10 }, signal());
    const params = asked[0]!.searchParams;
    assert.deepEqual([params.get("q"), params.get("rows"), params.get("start"), params.get("fq")], ["*:*", "10", "20", null]);
    assert.equal(result.total, 42);
  });

  test("CKAN's 409 is the caller's query, and says so", async () => {
    reply = json(409, { success: false, error: { __type: "Search Error", message: "Search error: bad query" } });
    await assert.rejects(client.search({ ...search, text: "title:(" }, signal()), (error) => {
      assert.ok(error instanceof InvalidInputError);
      assert.match(error.message, /test\.gov\.gr rejected the request/);
      return true;
    });
  });

  test("CKAN's 404 is not_found", async () => {
    reply = json(404, { success: false, error: { __type: "Not Found Error", message: "Δεν βρέθηκε" } });
    await assert.rejects(client.fetchDataset("nope", signal()), (error) => error instanceof NotFoundError && error.message === "Δεν βρέθηκε");
  });

  test("an envelope without a result is an upstream error", async () => {
    reply = json(200, { success: false, error: { message: "broken" } });
    await assert.rejects(client.fetchDataset("x", signal()), (error) => error instanceof UpstreamError && /without a result/.test(error.message));
  });

  test("an empty body is an upstream error, not a crash", async () => {
    reply = (response) => response.end("");
    await assert.rejects(client.fetchDataset("x", signal()), (error) => error instanceof UpstreamError);
  });
});
