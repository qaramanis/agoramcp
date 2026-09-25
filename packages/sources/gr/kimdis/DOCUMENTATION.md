# `gr/kimdis` — ΚΗΜΔΗΣ

MCP adapter over the **Κεντρικό Ηλεκτρονικό Μητρώο Δημοσίων Συμβάσεων**
(ΚΗΜΔΗΣ), the Central Electronic Registry of Public Contracts. Under
ν. 4412/2016 every public purchase in Greece above a small threshold is posted
here at each step: the **request** a body files to buy something, the
**notice** inviting bids, the **contract** as signed, and the **payment**
order when money leaves the account. Each act gets an **ΑΔΑΜ** (Αριθμός
Διαδικτυακής Ανάρτησης Μητρώου) and a signed PDF.

The volume is large: in one week of August 2026, **9,041 requests, ~3,700
notices, 4,951 contracts and 11,130 payments** were posted.

| | |
|---|---|
| **Mount point** | `POST /gr/mcp/kimdis` |
| **Upstream** | `https://cerpp.eprocurement.gov.gr/khmdhs-opendata/` (the ΚΗΜΔΗΣ Open Data API on the ΕΣΗΔΗΣ platform), plus `https://diavgeia.gov.gr/opendata/organizations.json` for the register of bodies |
| **Authentication** | None. The `khmdhs-api` tree beside it is for bodies posting acts and needs credentials; it is never called. |
| **Licence** | CC-BY-4.0 (the Greek Creative Commons Attribution licence, per the API's own page) |
| **Attribution** | Κεντρικό Ηλεκτρονικό Μητρώο Δημοσίων Συμβάσεων — ΚΗΜΔΗΣ (eprocurement.gov.gr) |
| **Coverage** | Acts posted to the open-data copy, refreshed from the registry daily, 180 days per call. Pharmaceutical notices found back to 2019 on a spot check; the registry itself dates from 2013. |
| **Rate limit** | 350 requests a minute, then 429 (documented; never hit in testing) |
| **Tools** | 7 — `search_requests`, `search_notices`, `search_contracts`, `search_payments`, `get_document`, `get_document_text`, `search_organizations` |
| **Country index** | [`docs/gr-documentation.md`](../../../../docs/gr-documentation.md) — every Greek tool, one line each |

Attribution is a licence condition, not a courtesy. `apps/server/src/mcp.ts`
sends it once per session in the MCP `instructions` block, so any client that
reads instructions already has it.

---

## Contents

- [What this answers](#what-this-answers)
- [Read this first](#read-this-first)
- [Tools](#tools)
  - [`search_requests`](#search_requests)
  - [`search_notices`](#search_notices)
  - [`search_contracts`](#search_contracts)
  - [`search_payments`](#search_payments)
  - [`get_document`](#get_document)
  - [`get_document_text`](#get_document_text)
  - [`search_organizations`](#search_organizations)
- [Upstream API reference](#upstream-api-reference)
- [Reference data](#reference-data)
- [Caching](#caching)
- [Errors](#errors)
- [Verification](#verification)

---

## What this answers

In one sentence: **a user can follow any Greek public purchase from the day a
body decided to buy to the day it paid — what was bought, from which tender,
for how much, under which procedure — and read the documents themselves.**

| The user wants to… | …when they know… | …via |
|---|---|---|
| See which tenders are open, or were run, for something | a CPV code, words from the title, or a body | `search_notices` |
| Know what a body is planning to buy | the body | `search_requests` |
| See what a body contracted for, and for how much | the body, a CPV code, a period | `search_contracts` |
| See what a body actually paid | the body, a period | `search_payments` |
| Read one act in full — items, prices, VAT, procedure, funding | its ΑΔΑΜ | `get_document` |
| Walk a purchase from request to payment | any one of its ΑΔΑΜ codes — `links` on the act | `get_document` |
| Read the tender document, the contract, the payment order | its ΑΔΑΜ | `get_document_text` |
| Turn a body's name into the uid the filters take | the name or VAT number | `search_organizations` |
| Reach the Διαύγεια act behind a payment or contract | `links.diavgeia` on the act | `diavgeia_get_decision` on the country server |

Everything is Greek text as the bodies wrote it. Amounts are euros unless an
item says otherwise (a handful are in USD or CHF).

---

## Read this first

Seven things about the upstream that shape every tool here.

### 1. Searches see 180 days at a time — the *most recent* 180

Every search is bounded by posting date. A range longer than 180 days is cut
to the 180 days ending at `submittedTo` — the last 180, where Διαύγεια keeps
the first — and upstream neither says so nor errs. One bound alone means 180
days from it; no bounds means the last 180 days.

Measured with CPV 33600000-6 (pharmaceuticals): all of 2025 → 292 notices,
which is the second half; 5 July–31 December → 289; `submittedFrom`
2025-01-01 alone → 180, the first half. The adapter computes the window it
knows upstream applied and reports it as `coverage`, with a note saying where
to continue: `submittedTo: <the day before coverage.submittedFrom>`.

### 2. The date is the *posting* date, and the order is newest first

`submittedFrom`/`submittedTo` filter `submissionDate` — when the act was
posted to ΚΗΜΔΗΣ — not the day it was signed. On one day's page of 50
notices, 41 were signed that day and the rest up to seven weeks earlier. Pages
come newest posting first; page 0 is today.

### 3. A first-time query can take upstream half a minute; the same one is then instant

A search upstream has answered before comes back in 0.1–1.3 s. One it has
not — a body's whole month of notices, a CPV code over the full 180 days, an
award procedure over three months — can take it 15–60 s to compute the first
time; the same body then answers at once for as long as upstream holds the
result. On top of that, about one cheap request in twenty stalls for exactly
60 s for no reason the query explains, and answers correctly afterwards.

Upstream keeps computing after the client hangs up, so the adapter **gives up
at 15 s and asks again**, up to three times, collecting the answer as soon as
it exists. Measured on first-time queries: a body's month of notices 30 s
(then 0.1 s), a CPV over 180 days 32 s (then 1.2 s), an award procedure over
three months 16 s (then 0.9 s) — where waiting would have cost 60 s each. A
repeated query within the hour never reaches upstream at all. The attachment
endpoint stalls the same way and is handled the same way.

Two filters are genuinely broken upstream and are **not exposed**:
`totalCostFrom`/`totalCostTo` take a minute every time and once returned 31
rows of a 50-row page. Amounts are on every act; filter on `total` yourself.

### 4. Every id is Διαύγεια's

ΚΗΜΔΗΣ keys bodies, units and signers by the state's shared register of bodies
(Μητρώο Φορέων) — the same uids Διαύγεια publishes. Every organisation, unit
and signer id on a ΚΗΜΔΗΣ act resolved on `diavgeia.gov.gr/opendata/…` in
testing (7 of 7). So `organizationId` here and on Διαύγεια's tools are
interchangeable, `search_organizations` here reads Διαύγεια's register, and
acts cite Διαύγεια by ΑΔΑ: a payment's `links.diavgeia.commitment` is the
Β.1.3 commitment act, a contract's `links.diavgeia.contract` the award or
approval decision. On the country server the two registries join by id.

### 5. Five kinds of ΑΔΑΜ, four of them served

`26PROC019700906`: two digits of year, the type, nine digits. `REQ` requests,
`PROC` notices, `SYMV` contracts and `PAY` payments each have an endpoint.
`AWRD`, the award decision between notice and contract, has none — `award` is
a 500 upstream — and is only ever seen as `links.awards` on a contract or
payment. `get_document` says so rather than "not found".

A request is posted twice: as the request itself and, once approved, as its
approval record, both `REQ`. `kind` on `search_requests` picks either or both.

### 6. Empty is a 404

No matches, a page past the end and an unknown ΑΔΑΜ are all answered
`404 {"message":"No notices found for the given criteria"}`. The searches
return an empty page; `get_document` returns `not_found`.

### 7. The same link has a different name on every act

A request lists its notices under `noticeRefNo`, a contract its notice under
`noticeReferenceNumber`, a notice the notice it amends under
`amendedNoticeADAM`; some are strings, some lists, some `{code}` objects. The
adapter collects them under `links` by what the linked act *is* — `requests`,
`approvals`, `notices`, `contracts`, `payments`, `awards`, `previous`, `next`
— so a reader walks a purchase without learning the field names.

### Smaller traps

- Coded values arrive as `{key, value}` pairs and are returned as
  `{code, label}`; booleans as `Ναι`/`Όχι` pairs and are returned as booleans.
- `vat` on an item is the rate as a string — `"24"`, `"17"` on the reduced-rate
  islands, `"0"` — returned as `vatPercent`.
- Timestamps carry no zone and are Athens wall-clock time; they are kept as
  such, to the second.
- `contractNumber` is `"-"` when a body did not number the contract; returned as null.

---

## Tools

Every tool is read-only, idempotent and unauthenticated. Every handler throws
an `AgoraError` for anything the model should read as a failure; the server
turns it into a tool error.

### The four searches

`search_requests`, `search_notices`, `search_contracts` and `search_payments`
share one shape. Each returns one page of up to 50 acts — upstream's page size,
not adjustable — newest posting first.

#### Parameters common to all four

| Name | Type | Description |
|---|---|---|
| `title` | string, 2–100 | Words from the act's title, matched as a phrase. Case and accents ignored (1,295 = 1,295 = 1,295 for `ΠΡΟΜΗΘΕΙΑ`/`προμήθεια`/`προμηθεια`). |
| `organizationId` | digits | The buying body's uid, from `search_organizations`. |
| `signerId` | digits | The signing official's uid, from `signer.id` on an act. |
| `cpv` | `########-#` | One CPV code, exact. |
| `contractType` | `'9'` Υπηρεσίες, `'10'` Έργα, `'12'` Μελέτες, `'13'` Προμήθειες, `'14'` Τεχνικές υπηρεσίες | Kind of contract. |
| `submittedFrom`, `submittedTo` | `YYYY-MM-DD` | Posting-date window, inclusive; see [Read this first, 1](#1-searches-see-180-days-at-a-time--the-most-recent-180). |
| `cancelledFrom`, `cancelledTo` | `YYYY-MM-DD` | Only acts cancelled in this window — the way to list cancellations. |
| `page` | integer ≥ 0 | Zero-based. |

Per tool: `search_requests` adds `kind` (`initial` / `approval` / `all`);
`search_notices` adds `procedureType` (see [Reference data](#reference-data)),
`deadlineFrom`/`deadlineTo` (when offers are due — how to list what is still
open), `amendmentsOnly` and `fundingReference`; `search_contracts` adds
`amendmentsOnly` (modifications and extensions of earlier contracts).

#### Returns

```jsonc
{
  "type": "notice",
  "total": 292,
  "page": 0,
  "totalPages": 6,
  "size": 50,
  "returned": 50,
  "hasMore": true,
  "coverage": {
    "submittedFrom": "2025-07-04",     // the window actually searched
    "submittedTo": "2025-12-31",
    "requestedFrom": "2025-01-01",
    "requestedTo": "2025-12-31",
    "note": "ΚΗΜΔΗΣ caps a search at 180 days of posting dates and keeps the most recent, so only 2025-07-04 to 2025-12-31 was searched — not the range requested. To cover the rest, search again with submittedTo: 2025-07-03."
  },
  "documents": [
    {
      "type": "notice",
      "adam": "26PROC019686432",
      "title": "«ΠΡΟΜΗΘΕΙΑ ΦΟΡΗΤΩΝ ΦΑΡΜΑΚΕΙΩΝ …»",
      "organization": { "id": "51776", "name": "Δ.Ε.Υ.Α ΔΗΜΟΥ ΦΑΙΣΤΟΥ", "vatNumber": "099303964" },
      "submittedAt": "2026-08-27T11:02:14",
      "signedOn": "2026-08-27",
      "cancelled": false,
      "region": { "code": "EL434", "label": "Ηράκλειο" },
      "contractType": { "code": "13", "label": "Προμήθειες" },
      "procedureType": { "code": "6", "label": "Απευθείας ανάθεση" },
      "noticeType": { "code": "4", "label": "Πρόσκληση" },
      "deadline": "2026-09-03T14:00:00",      // notices only; null elsewhere
      "total": { "withVat": 1459.48, "withoutVat": 1177.0 },
      "cpvs": [{ "code": "33600000-6", "label": "Φαρμακευτικά προϊόντα" }],
      "documentUrl": "https://cerpp.eprocurement.gov.gr/khmdhs-opendata/notice/attachment/26PROC019686432"
    }
  ]
}
```

#### Examples, measured 1 Sep 2026

- `search_notices { "organizationId": "99221899", "submittedFrom": "2026-08-01", "submittedTo": "2026-08-31" }`
  → 44 notices of the Volos general hospital in August, 0.1 s.
- `search_notices { "cpv": "33600000-6" }` → 213 pharmaceutical notices in the
  last 180 days, `coverage.note` saying so, 1.2 s.
- `search_notices { "deadlineFrom": "2026-09-10", "deadlineTo": "2026-09-12" }`
  → 397 tenders with offers due those three days, 0.7 s.
- `search_notices { "cancelledFrom": "2026-08-01", "cancelledTo": "2026-09-01" }`
  → 1,037 cancellations, each with `cancelled: true`; `get_document` gives the reason.
- `search_requests { "organizationId": "5001", …August…, "kind": "initial" }`
  → 79 requests by the Region of Eastern Macedonia–Thrace; `"approval"` → 71 approvals.
- `search_contracts { "cpv": "33600000-6", …August… }` → 51 contracts, 0.8 s.
- `search_contracts { "amendmentsOnly": true, …one week… }` → 575 amendments.
- `search_payments { "organizationId": "5001", …August… }` → 263 payment orders, 6 pages.
- `search_notices { "organizationId": "1", … }` → `total: 0`, no error.

#### What they cannot do

- Filter by amount (see [Read this first, 3](#3-a-first-time-query-can-take-upstream-half-a-minute-the-same-one-is-then-instant)).
- Change the page size, or sort by anything but posting date.
- Search award decisions, or the text inside the PDFs.
- Take several CPV codes or bodies at once — upstream can, the tools take one
  each; call again for the next.

---

### `get_document`

One act by ΑΔΑΜ, whichever of the four types it is.

| Name | Type | Required | Description |
|---|---|---|---|
| `adam` | ΑΔΑΜ | yes | e.g. `26PROC019700906`; case-insensitive. |

Returns the summary fields above plus everything the record carries,
normalised to one shape across the four types. Abridged, from the notice
`26PROC019700906`:

```jsonc
{
  "type": "notice",
  "adam": "26PROC019700906",
  "title": "Προμήθεια ανταλλακτικών και ελαστικών μεταφορικών μέσων μηχανημάτων ΔΕ Καλλονής …",
  "organization": { "id": "100049040", "name": "ΔΗΜΟΣ ΔΥΤΙΚΗΣ ΛΕΣΒΟΥ", "vatNumber": "996959690" },
  "unit":   { "id": "100062636", "name": "ΔΙΕΥΘΥΝΣΗ ΚΑΘΑΡΙΟΤΗΤΑΣ" },
  "signer": { "id": "100049561", "name": "ΤΑΞΙΑΡΧΗΣ ΒΕΡΡΟΣ - Δήμαρχος" },
  "submittedAt": "2026-08-31T23:45:40",
  "signedOn": "2026-08-31",
  "updatedAt": null,
  "cancelled": false,
  "cancellation": null,               // { at, type, reason, ada } when cancelled
  "region": { "code": "EL411", "label": "Λέσβος, Λήμνος" },
  "regions": [ … ],
  "city": "ΚΑΛΛΟΝΗ", "postCode": "81107", "country": { "code": "GR", "label": "Ελλάδα" },
  "contractType": { "code": "13", "label": "Προμήθειες" },
  "contractTypes": [ … ],             // the first is contractType; "additional" ones follow
  "mixedContract": false,
  "procedureType": { "code": "6", "label": "Απευθείας ανάθεση" },
  "awardProcedure": null,
  "criteria": { "code": "2", "label": "Βάσει τιμής" },
  "legalContext": { "code": "5", "label": "ν.4412/2016 - Βιβλίο Ι – κάτω των ορίων" },
  "conducting": { "code": "2", "label": "Μη ηλεκτρονική διαδικασία" },
  "digitalPlatform": null,            // "ΕΣΗΔΗΣ ΠΥ", "iSupplies", … on electronic tenders
  "authorityType": { "code": "9", "label": "ΝΠΔΔ" },
  "classification": { "code": "2", "label": "ΟΤΑ" },
  "activity": { "code": "1", "label": "Γενικές δημόσιες υπηρεσίες" },
  "centralizedMarkets": [{ "code": "8", "label": "Δεν χρησιμοποιείται" }],
  "centralGovernment": false, "socialContract": false, "assignedContract": false,
  "aaht": "1007.E87417.0001",         // the body's own file reference
  "protocolNumber": null,
  "budget": null, "commitmentNo": null,
  "funding": { "publicFundingRef": null, "…": null, "regularBudgetRef": null },
  "total": { "withVat": 31915.08, "withoutVat": 27277.85 },
  "items": [{
    "description": "Αφορά τις δαπάνες προμήθειας ανταλλακτικών και ελαστικών …",
    "quantity": 1,
    "unit": { "code": "AG-001", "label": "Μελέτη" },
    "costWithoutVat": 27277.85,
    "vatPercent": 17,
    "currency": "EUR",
    "cpvs": [{ "code": "34300000-0", "label": "Μέρη και εξαρτήματα για αυτοκίνητα οχήματα και για τους κινητήρες τους" }, …]
  }],
  "links": {
    "previous": null, "next": null,
    "requests": ["26REQ019683729"],   // the approved request this notice executes
    "approvals": [], "notices": [], "contracts": [], "payments": [], "awards": [],
    "amendedNotice": null, "frameworkNotice": null,
    "diavgeia": { "commitment": null, "approval": null, "decision": null, "contract": [], "payment": null, "other": null }
  },
  "request": null,
  "notice": {
    "publishedAt": null,
    "sections": 5,
    "amendsPrevious": false,
    "offersValid": { "amount": 3, "unit": { "code": "3", "label": "Μήνες" } },
    "duration":    { "amount": 4, "unit": { "code": "3", "label": "Μήνες" } },
    "biddingWebsite": null,
    "systemicNumbers": [],            // ΕΣΗΔΗΣ system numbers on electronic tenders
    "maxContractors": null,
    "optionRight": { "allowed": false, "description": null },
    "abortReason": null
  },
  "contract": null, "payment": null,
  "cpvs": [ … ], "deadline": "2026-09-08T14:00:00",
  "documentUrl": "https://cerpp.eprocurement.gov.gr/khmdhs-opendata/notice/attachment/26PROC019700906",
  "extra": {}                         // fields this adapter does not map, verbatim
}
```

The type-specific block is the one that is not null:

- `request`: `deliveryDate`, `approved` (true on the approval record),
  `preApproval`, `approvalCommitmentCode`.
- `contract`: `contractNumber`, `startsOn`, `endsOn`, `openEnded`, `duration`,
  `contractBudget`, `bidsSubmitted`, `maxBids`; `links.awards` names the
  award decision, `links.next` an amendment that superseded it,
  `links.diavgeia.contract` the Διαύγεια act(s) cited.
- `payment`: `credit` (a credit note rather than a payment);
  `links.contracts` the contract settled, `links.diavgeia.commitment` the
  Β.1.3 commitment act on Διαύγεια — measured: `26PAY019700903` →
  `9ΦΛΓΟΞΓ5-ΓΘΣ`, which `diavgeia_get_decision` resolves to the commitment of
  the same body for the same purpose.

`{ "adam": "26AWRD019694224" }` → `not_found`: *… is an award decision (AWRD).
The open-data API serves requests, notices, contracts and payments, not
awards …*. `{ "adam": "26PROC000000001" }` → `not_found`.

---

### `get_document_text`

The text of the signed PDF behind an act, page by page — the same paging and
limits as Διαύγεια's `get_decision_text`.

| Name | Type | Required | Description |
|---|---|---|---|
| `adam` | ΑΔΑΜ | yes | e.g. `26PAY019700903`. |
| `fromPage` | integer ≥ 1 | no | Default 1. |
| `maxPages` | integer 1–50 | no | Default 10. Never more than 40,000 characters per call; `nextPage` continues. |

Returns `{ adam, type, pageCount, fromPage, toPage, characters, truncated, nextPage, note?, documentUrl, pages: [{ page, text }] }`.
A scanned PDF comes back with empty pages and a note. Files over 30 MB are
refused with the download link.

Measured: the payment order `26PAY019700903` (374 KB) → 1 page, 859
characters, 0.15 s; the notice `26PROC019700906` (700 KB) → 3 pages; the
request `26REQ019700907` (894 KB) → 3 pages, 3,409 characters. Requests,
notices, contracts and payments all have attachments.

---

### `search_organizations`

Find a body by name or VAT number and get the uid the filters take. Reads
Διαύγεια's register of bodies (5,838, 2.7 MB, ~19 s), which is the register
ΚΗΜΔΗΣ keys by; held a week, refreshed in the background after a day, filled
at boot by `warm`.

| Name | Type | Required | Description |
|---|---|---|---|
| `query` | string, 2–120 | yes | Part of the name in Greek, or a VAT number matched whole. Case and accents ignored. |
| `includeInactive` | boolean | no | Include dissolved or merged bodies. Default false. |
| `limit` | integer 1–100 | no | Default 20. |

Returns `{ query, total, returned, hasMore, organizations: [{ id, name, abbreviation, vatNumber, category, status }] }`.
`{ "query": "νοσοκομείο βόλου" }` → `99221899 ΝΟΜ.ΓΕΝ. ΝΟΣΟΚΟΜΕΙΟ ΒΟΛΟΥ 'ΑΧΙΛΛΟΠΟΥΛΕIO'`;
`{ "query": "997687965" }` → `5001 ΠΕΡΙΦΕΡΕΙΑ ΑΝΑΤΟΛΙΚΗΣ ΜΑΚΕΔΟΝΙΑΣ - ΘΡΑΚΗΣ`.

On the country server `diavgeia_search_organizations` answers the same
question from the same register; either uid works on both registries.

---

## Upstream API reference

What the adapter calls, so a reader can reproduce any answer by hand.
Documented at <https://cerpp.eprocurement.gov.gr/khmdhs-opendata/help>.

### The Open Data API — `https://cerpp.eprocurement.gov.gr/khmdhs-opendata/`

Every search is `POST {type}?page=N` with a JSON body and
`accept: application/json`. The envelope is Spring's page:
`{ content[], totalElements, totalPages, size: 50, number, numberOfElements, first, last, empty }`.

| Endpoint | Documented | Used by | Notes |
|---|---|---|---|
| `POST request?page=N` | yes | `search_requests`, `get_document` | Body fields below plus `isInitial`, `isApproved`, `isApproval` (default true). `isApproval=false` keeps the requests themselves (4,649 of 9,041 in a week); `isInitial=false` keeps the approvals (4,392). |
| `POST notice?page=N` | yes | `search_notices`, `get_document` | Plus `procedureType` (int), `finalDateFrom/To` (`yyyy-MM-dd HH:mm` — an ISO `T` is a 400 after a 60 s wait), `isModified`, `aaht`, `publicFundingRefNum`. |
| `POST contract?page=N` | **no** | `search_contracts`, `get_document` | Same body. ΑΔΑΜ `..SYMV..`. |
| `POST payment?page=N` | **no** | `search_payments`, `get_document` | Same body. ΑΔΑΜ `..PAY..`. |
| `POST award` | — | — | 500. Award decisions are not served. |
| `GET {type}/attachment/{ΑΔΑΜ}` | request, notice | `get_document_text` | `application/pdf`. Contract and payment attachments exist too. |

Body fields honoured on every type: `title`, `referenceNumber`
(`##REQ#########` etc.), `organizations: [int]`, `signer: int`, `cpvItems:
["########-#"]`, `contractType: "9"|"10"|"12"|"13"|"14"`, `dateFrom`/`dateTo`
(`YYYY-MM-DD`, posting date, 180-day cap), `cancelDateFrom`/`cancelDateTo`,
`totalCostFrom`/`totalCostTo` (broken, see above). Filters AND together; a
`referenceNumber` with a non-matching `organizations` is a 404.

Answers: `200` with a page; `404 {"message":"No notices found for the given
criteria","status":404}` for nothing matched or a page past the end; `400`
for an unparseable date; `429` past 350 requests a minute (documented). The
open-data copy is refreshed from the registry every 24 hours.

### The register of bodies — `https://diavgeia.gov.gr/opendata/organizations.json?status=all`

The whole register in one document, as Διαύγεια's own `search_organizations`
reads it. See that source's documentation for the endpoint; here it is only
the uid lookup.

---

## Reference data

Measured 1 Sep 2026 from the acts themselves.

**Contract types** (`contractType`): `9` Υπηρεσίες · `10` Έργα · `12` Μελέτες ·
`13` Προμήθειες · `14` Τεχνικές και λοιπές συναφείς επιστημονικές υπηρεσίες.

**Award procedures** (`procedureType`, notices June–August 2026): `1` Ανοιχτή
διαδικασία 6,993 · `2` Κλειστή διαδικασία 344 · `4` Ανταγωνιστικός διάλογος
7 · `6` Απευθείας ανάθεση 53,421 · `7` Ανταγωνιστική διαδικασία με
διαπραγμάτευση 336 · `12` Διαπραγμάτευση χωρίς προηγούμενη δημοσίευση 1,195 ·
`13` Διαπραγμάτευση με προηγούμενη προκήρυξη διαγωνισμού (αρ. 266
ν. 4412/2016) 223 · `18` Διαδικασία άρθρου 128 ν. 4412/16 1,124 · `11`
documented but unused.

**Notice types** (`noticeType`): `2` Προκήρυξη · `3` Διακήρυξη · `4` Πρόσκληση
— on a page of 50, 39 were invitations for direct awards.

**Award criteria**: `1` Βάσει κόστους – βέλτιστη σχέση ποιότητας – τιμής ·
`2` Βάσει τιμής · `4` Βάσει κόστους – άλλο. **Legal context**: `4`/`5`
ν. 4412/2016 Βιβλίο Ι above/below the thresholds · `7` Βιβλίο ΙΙ below.
**Classification**: `1` Κεντρική Κυβέρνηση · `2` ΟΤΑ · `4` Εκτός Γενικής
Κυβέρνησης. **Digital platforms**: `3` ΕΣΗΔΗΣ ΠΥ · `6` iSupplies.
**Units of measure on items**: `C62` Τεμάχιο · `E48` Υπηρεσία · `AG-001` Μελέτη.
**VAT rates seen**: 24, 17, 13, 9, 6, 4, 0 and 8.875 (%).

**Volumes**, one week (25–31 Aug 2026): 9,041 requests · ~3,700 notices
(15,857 in August) · 4,951 contracts · 11,130 payments.

---

## Caching

Keys are namespaced `gr/kimdis:*`. TTLs live in `meta.ts`.

| What | Key | Held | Notes |
|---|---|---|---|
| One search page | `search_{type}` | 1 hour (`default`) | keyed by the full query, page included |
| One act | `get_document` | 6 hours | |
| One PDF's text | `document_text` | 1 day | the file is immutable |
| The register of bodies | `organization_register` | 7 days, refreshed after 1 | `warm` fills it at boot (19.6 s measured); a host without a boot pays it on the first name search |

`warm` is the register only. Nothing else is worth prefetching: every search
is a fresh question.

---

## Errors

| Situation | Code | Message |
|---|---|---|
| `submittedFrom` after `submittedTo` (likewise cancelled, deadline) | `invalid_input` | submittedFrom (…) is after submittedTo (…). |
| Malformed ΑΔΑΜ, uid, CPV or date | schema validation | rejected before the handler runs |
| ΑΔΑΜ of an award decision | `not_found` | … is an award decision (AWRD). The open-data API serves requests, notices, contracts and payments, not awards … |
| Unknown ΑΔΑΜ | `not_found` | No act is registered under ΑΔΑΜ "…". Check the code, or search for the act instead. |
| Nothing matched | none | an empty page, `total: 0` |
| No PDF, or not a PDF | `not_found` | No PDF is published for ΑΔΑΜ "…". |
| PDF over 30 MB | `upstream_error` (413) | … too large to read here. It can be downloaded from … |
| `fromPage` past the end | `invalid_input` | fromPage (…) is past the last page: the PDF has …. |
| Three 15 s timeouts in a row | `upstream_timeout` | … did not respond within 15000ms. Ask again — the answer is usually ready by then. |
| 429 | `rate_limited` | from the shared HTTP client |

---

## Verification

Run against a server on `:3010` with every tool exercised, 1 Sep 2026:

- `tools/list` on `/gr/mcp/kimdis` → 7 tools; on `/gr/mcp` → 31, the seven
  prefixed `kimdis_`, no collision with the other sources'
  `search_organizations`.
- `warm.ok` 19,598 ms (the register).
- 21 searches across the four types and every filter, all correct: 0.02–1.3 s
  for queries upstream had seen, 15–32 s for four first-time ones under the
  15 s timeout-and-retry policy (60 s each without it), then 0.1 s on repeat.
- `get_document` on one act of each type, lower-case ΑΔΑΜ, an award, an
  unknown code and a malformed one; `get_document_text` on a payment, a
  notice, a request and a contract.
- Every example on `GET /` validates against its schema at boot, as
  `defineSource` requires.
