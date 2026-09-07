# `gr/vies` — VIES, Έλεγχος ΑΦΜ

MCP adapter over the **VAT Information Exchange System**, the European
Commission's front door to the 27 national VAT registers plus Northern
Ireland. It answers one question — *is this VAT number a live registration,
and whose is it?* — and for Greece it answers the second half too, returning
the name and address the ΑΦΜ is registered to.

This is the **join** the other Greek sources are missing. ΚΗΜΔΗΣ names the
contractor that won an award by its ΑΦΜ, Διαύγεια records expenditure against
an ΑΦΜ, Μίτος lists a body's ΑΦΜ — and none of them says which company that
is. This does.

| | |
|---|---|
| **Mount point** | `POST /gr/mcp/vies` |
| **Upstream** | `https://ec.europa.eu/taxation_customs/vies/rest-api/` |
| **Authentication** | None. The service rate-limits by IP instead. |
| **Licence** | Not stated — see below |
| **Attribution** | VIES — European Commission, DG TAXUD (ec.europa.eu/taxation_customs/vies)· τα ελληνικά στοιχεία προέρχονται από το μητρώο ΦΠΑ της ΑΑΔΕ |
| **Coverage** | The EU-27 and `XI` (Northern Ireland). Validity everywhere; name and address only where the member state discloses them. |
| **Tools** | 2 — `check_vat_number`, `list_member_states` |
| **Country index** | [`docs/gr-documentation.md`](../../../../docs/gr-documentation.md) — every Greek tool, one line each |

### On the licence

Every other source here names an SPDX identifier or a portal's terms page.
This one says "not stated", and the reason is worth recording rather than
rediscovering.

The Commission's reuse decision (2011/833/EU, which puts Commission content
under CC-BY-4.0) covers *Commission documents* and explicitly excepts
third-party works. An answer from VIES is neither: **VIES holds no register of
its own.** It forwards the question to the member state that issued the number
and relays the reply, so the content belongs to that state's tax
administration — ΑΑΔΕ for Greece — which publishes no reuse licence for it.
Claiming CC-BY here would be claiming a licence over data the Commission does
not own. `meta.ts` therefore reports the fact and attributes both parties, the
same call `gr/athens` makes for a portal that records no licence at all.

---

## Contents

- [What this answers](#what-this-answers)
- [Read this first](#read-this-first)
- [Tools](#tools)
  - [`check_vat_number`](#check_vat_number)
  - [`list_member_states`](#list_member_states)
- [Upstream API reference](#upstream-api-reference)
- [Caching](#caching)
- [Errors](#errors)
- [Verification](#verification)

---

## What this answers

| The user wants to… | …when they know… | …via |
|---|---|---|
| Name the company behind a contract award | the contractor's ΑΦΜ from ΚΗΜΔΗΣ | `check_vat_number` |
| Name the counterparty of an expenditure decision | the ΑΦΜ on a Διαύγεια act | `check_vat_number` |
| Confirm a company is still trading | its ΑΦΜ | `check_vat_number` — `registered` |
| Check a supplier in another member state | its VAT number and country | `check_vat_number` with `countryCode` |
| Tell a typo from an unregistered number | the ΑΦΜ | `check_vat_number` — the check digit is tested first |
| Know whether a failed lookup was the number or the register | — | `list_member_states` |

It does **not** search by name: there is no way to ask VIES "which ΑΦΜ belongs
to this company". The question only runs in the direction number → name. For
name → body within the public sector, use `mitos_search_organizations` or
`diavgeia_search_organizations`.

---

## Read this first

### 1. Greece is `EL`, not `GR`

EU VAT has always written Greece as `EL`, and VIES rejects `GR` outright. This
is the single most common way a caller gets a Greek lookup wrong, so
`countryCode` defaults to `EL` and naming `GR` produces an `invalid_input`
that says so in as many words rather than an opaque upstream refusal.

### 2. The API answers `200` to everything, including its own failures

There is no error status anywhere in this API. An unregistered number, a
malformed one, a member state that is down, and a rate-limit block all come
back **HTTP 200** with the outcome in a `userError` string. Reading `isValid`
without reading `userError` would report "not registered" for a register that
simply did not answer — a false statement about a real company.

`client.ts` therefore switches on `userError` and never on the status code:

| `userError` | Meaning | Becomes |
|---|---|---|
| `VALID` | live registration | `registered: true` |
| `INVALID` | not a live registration | `registered: false` |
| `INVALID_INPUT` | not well formed for that country | `invalid_input` |
| `MS_UNAVAILABLE`, `MS_MAX_CONCURRENT_REQ(_TIME)` | that member state's register is down or throttling | `upstream_unavailable` |
| `SERVICE_UNAVAILABLE`, `TIMEOUT`, `GLOBAL_MAX_CONCURRENT_REQ(_TIME)` | VIES itself | `upstream_unavailable` |
| `VAT_BLOCKED`, `IP_BLOCKED` | we are blocked | `upstream_error` (403) |
| anything else | unrecognised | `upstream_error`, rather than trusting `isValid` alone |

### 3. Upstream cannot tell a typo from an unregistered number — the check digit can

`094014202` (a mistyped National Bank) and a real-but-unregistered ΑΦΜ both
return exactly `INVALID`. Reporting both as "not registered" would state, of a
number the caller simply fat-fingered, that the company does not exist.

A Greek ΑΦΜ carries a check digit: weight the first eight digits by descending
powers of two, sum, `% 11`, then `% 10`, and the result is the ninth digit.
`normalizeVat` tests it **before** calling upstream, so a mistyped number
returns `invalid_input` — *"it fails the check-digit test, so it has been
mistyped or transposed"* — and a well-formed one that upstream rejects returns
`registered: false` with a note saying the number is well formed and this is
upstream's answer.

The implementation was checked against the **836 distinct ΑΦΜ in the Μίτος
register of bodies**: 827 pass, 8 are two comma-joined numbers in one field
rather than one number, and the single genuine failure — `090300767` — VIES
*also* rejects. Zero false rejections, so the pre-check never turns away a
number the register would have accepted.

### 4. Not every member state discloses the name

Greece returns the registered name and address. Germany and several others
confirm validity and return `"---"` for both — a deliberate policy of that
state, not an empty record and not something a retry will fix.

`nameDisclosed` reports which happened: `true` (name returned), `false`
(registered but withheld, with a note naming the country), or `null` when the
number is not registered and the question does not arise.

### 5. Two upstream shapes that would otherwise leak

- **Multiple trade names arrive in one string, joined by `||`** —
  `EPSILON TELEDATA ΙΚΕ||EPSILON TELE DATA`. The first is the legal name;
  `name` carries it and `alsoKnownAs` carries the rest.
- **Registers pad fields to fixed columns**, so an address arrives as
  `ΑΙΟΛΟΥ 86        10559 - ΑΘΗΝΑ`. Runs of whitespace are collapsed; the
  content is unchanged.
- `"---"` is upstream's null for *every* string field and never reaches a
  caller — it becomes `null`.

### 6. This is a research lookup, not a formal consultation

VIES can issue a **consultation number** (`requestIdentifier`) that is legal
proof a trader validated a counterparty on a given date. Obtaining one
requires the requester's own VAT number, which a shared read-only server has
no business holding, so these tools never request one and `requestIdentifier`
comes back empty. The tool description says so. Do not present an answer here
as evidence of due diligence for an invoice or a tax filing.

The approximate-match service (supply a name, ask how well it matches) is
optional for member states and **Greece has not implemented it**: a POST with
`traderName` returns `NOT_PROCESSED` on every match field. There is no tool
for it because there is nothing behind it.

---

## Tools

Both tools are read-only, idempotent and unauthenticated.

### `check_vat_number`

Turn a VAT number into the name and address it is registered to.

#### Parameters

| Name | Type | Required | Description |
|---|---|---|---|
| `vatNumber` | string, 1–32 | yes | With or without country prefix, any spacing: `094014201`, `EL094014201`, `EL 094-014.201`. |
| `countryCode` | 2 letters | no | Issuing member state. Default `EL`. One of the 28 in `MEMBER_STATES`. |

Input is normalised before anything is sent: separators (` . - _ /`) are
dropped, a country prefix on the number is honoured (and refused if it
contradicts `countryCode`), and a Greek number of exactly eight digits is
padded back to nine — the leading zero a spreadsheet ate is the most common
corruption of an ΑΦΜ and the only reversible one. Any repair is reported in
`notes`; all forms of one number share a cache entry.

#### Returns

| Field | Type | Description |
|---|---|---|
| `countryCode` | string | As resolved, e.g. `EL`. |
| `vatNumber` | string | The bare number after normalisation. |
| `fullVatNumber` | string | `EL094014201` — as written on an invoice. |
| `registered` | boolean | Whether it is a live VAT registration today. |
| `name` | string \| null | Registered legal name, or null if unregistered or withheld. |
| `alsoKnownAs` | string[] | Further trade names; usually empty. |
| `address` | string \| null | Registered address, whitespace collapsed. |
| `checkedAt` | string \| null | When the member state's register answered. |
| `nameDisclosed` | boolean \| null | True / false / null as in §4. |
| `notes` | string[] | Repairs made and caveats that apply. |

#### Example

`{ "vatNumber": "094014201" }` →

```json
{
  "countryCode": "EL",
  "vatNumber": "094014201",
  "fullVatNumber": "EL094014201",
  "registered": true,
  "name": "ΤΡΑΠΕΖΑ ΕΘΝΙΚΗ ΤΗΣ ΕΛΛΑΔΟΣ ΑΝΩΝΥΜΗ ΕΤΑΙΡΕΙΑ",
  "alsoKnownAs": [],
  "address": "ΑΙΟΛΟΥ 86 10559 - ΑΘΗΝΑ",
  "checkedAt": "2026-09-07T16:06:38.855Z",
  "nameDisclosed": true,
  "notes": []
}
```

An unregistered number keeps the shape and explains itself:

```json
{
  "fullVatNumber": "EL068888676",
  "registered": false,
  "name": null,
  "nameDisclosed": null,
  "notes": ["EL068888676 is not a live VAT registration in EL today. The number is well formed, so this is upstream's answer rather than a typo."]
}
```

### `list_member_states`

The 28 registers VIES can reach, and whether each is answering right now.

Takes no arguments. Call it when `check_vat_number` reports a register
unavailable: this says whether the outage is that one country or the whole
service, and therefore whether retrying is worth anything.

#### Returns

| Field | Type | Description |
|---|---|---|
| `serviceAvailable` | boolean | Whether VIES-on-the-Web itself is up. |
| `total` | number | Registers listed — 28. |
| `unavailableCount` | number | How many are not answering. |
| `unavailable` | string[] | Their country codes, e.g. `["LV"]`. |
| `memberStates` | object[] | `{ countryCode, available, availability }` for each, sorted by code. `availability` keeps upstream's own word so an unforeseen third value is not lost. |

At least one register is usually down: `LV` was unavailable throughout
testing on 7 Sep 2026 while the other 27 answered.

---

## Upstream API reference

`https://ec.europa.eu/taxation_customs/vies/rest-api/`

| Path | Method | Notes |
|---|---|---|
| `ms/{countryCode}/vat/{vatNumber}` | GET | The lookup. Always 200; outcome in `userError`. 0.3–1.1 s. |
| `check-status` | GET | `{ vow: { available }, countries: [{ countryCode, availability }] }`. 0.1 s. |
| `check-vat-number` | POST | Same answer, plus approximate name matching. Uses `valid` where the GET uses `isValid`. **Not used** — Greece returns `NOT_PROCESSED` for every match field. |

There is no documented rate limit; the service blocks by IP
(`IP_BLOCKED`) when pushed. The shared HTTP client's 20 s timeout and two
retries apply.

---

## Caching

Keys are namespaced `vies:*`. TTLs live in `meta.ts`.

| What | Key | Held | Why |
|---|---|---|---|
| One VAT number | `vies:check` on `fullVatNumber` | 1 hour (`default`) | A registration changes on the order of years, and the join this source exists for asks about the same handful of contractors repeatedly within one session. An hour absorbs that without letting a registration go stale enough to mislead. |
| Service status | `vies:status` | 5 minutes (`list_member_states`) | Availability is a live status that flips minute to minute, and reporting it stale would defeat the tool. |

Because normalisation runs before the cache key is built, `094014201`,
`EL094014201`, `EL 094-014.201` and `94014201` are one entry.

There is no `warm` hook: both tools are a single small request and there is no
register to pull down. VIES answers a question rather than serving a catalogue.

---

## Errors

| Situation | Code | Message |
|---|---|---|
| `countryCode` not an EU VAT code (`GR`, `US`) | `invalid_input` | "GR" is not an EU VAT country code. Greece is EL, not GR; the codes in use are … |
| Greek number failing its check digit | `invalid_input` | … is not a well-formed ΑΦΜ: it fails the check-digit test … not a statement that it is unregistered. |
| Greek number not 8 or 9 digits | `invalid_input` | A Greek ΑΦΜ is nine digits; "…" has N. |
| Prefix contradicts `countryCode` | `invalid_input` | The number is written for EL but countryCode says DE. |
| Upstream `INVALID_INPUT` | `invalid_input` | … is not a well-formed VAT number for that country. |
| Member state down or throttling | `upstream_unavailable` | The VAT register of XX is not answering VIES right now … list_member_states shows which registers are up. |
| VIES itself down or throttling | `upstream_unavailable` | VIES itself is unavailable or throttling requests. |
| Blocked by IP or VAT | `upstream_error` (403) | VIES has blocked this request … too many lookups in too short a time. |
| Unrecognised `userError` | `upstream_error` | VIES answered with an unrecognised status "…". |
| 5xx, timeout, unreachable | `upstream_*` | from the shared HTTP client, after its retries |

A number that is well formed but unregistered is **not** an error: it returns
`registered: false` with a note.

---

## Verification

Run against a server on `:8791` with every tool and every branch exercised,
7 Sep 2026:

- `tools/list` on `/gr/mcp/vies` → 2 tools; on `/gr/mcp` → 47, the two
  prefixed `vies_`, no collision with the other five sources.
- `check_vat_number` cold 0.36 s and 0.52 s on two untouched numbers; 0.001 s
  repeated. `list_member_states` 0.08 s cold, 0.001 s repeated.
- `094014201`, `EL 094-014.201` and `94014201` returned one identical record
  with the same `checkedAt`, confirming they share a cache entry; the
  eight-digit form carried the leading-zero note.
- `094014202` (transposed check digit) → `invalid_input`, before any upstream call.
- `068888676` (well formed, a public body with no VAT registration) →
  `registered: false` with the note.
- `DE811193231` → `registered: true`, `nameDisclosed: false`, name withheld.
- `countryCode=GR` → `invalid_input` naming `EL`.
- `EL094014201` with `countryCode=DE` → `invalid_input` on the contradiction.
- `999999993` → `EPSILON TELEDATA ΙΚΕ` with `alsoKnownAs: ["EPSILON TELE DATA"]`
  and the padded address collapsed, exercising both upstream string quirks.
- The check-digit routine was run over the 836 distinct ΑΦΜ in the Μίτος
  register: 827 pass, 8 are comma-joined pairs, 1 fails and is also rejected
  by VIES.
- Both examples on `GET /` validate against their schemas at boot, as
  `defineSource` requires.
