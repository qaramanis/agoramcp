# `gr/diavgeia` — Διαύγεια

MCP adapter over the Greek Transparency Programme (Πρόγραμμα ΔΙΑΥΓΕΙΑ), the
register in which every Greek public body must publish its administrative acts
before they take legal effect (ν. 3861/2010, consolidated by ν. 4305/2014).

Roughly **3 million acts** are in force at any time and about **12,000 are added
each working day**: appointments, budget commitments, payments, contract awards,
tender notices and regulatory decisions. Each act gets an **ΑΔΑ** (Αριθμός
Διαδικτυακής Ανάρτησης) — a permanent public identifier — and a signed PDF.

| | |
|---|---|
| **Mount point** | `POST /gr/mcp/diavgeia` |
| **Upstream** | `https://diavgeia.gov.gr/opendata/` |
| **Authentication** | None. No API key, no registration, no `requiresEnv`. |
| **Licence** | CC-BY-4.0 |
| **Attribution** | Πρόγραμμα ΔΙΑΥΓΕΙΑ (diavgeia.gov.gr) |
| **Coverage** | 2010 → today |
| **Tools** | 17 — `search_decisions`, `search_decisions_advanced`, `get_decision`, `get_decision_text`, `get_decision_history`, `list_decision_types`, `get_decision_type`, `search_organizations`, `get_organization`, `list_organization_units`, `get_unit`, `list_organization_signers`, `get_signer`, `list_positions`, `list_thematic_categories`, `list_dictionaries`, `search_dictionary` |
| **Country index** | [`docs/gr-documentation.md`](../../../../docs/gr-documentation.md) — every Greek tool, one line each |

Attribution is a licence condition, not a courtesy. `apps/server/src/mcp.ts`
sends it once per session in the MCP `instructions` block, so any client that
reads instructions already has it.

---

## Contents

- [What this answers](#what-this-answers)
- [Read this first](#read-this-first)
- [Tools](#tools)
  - [`search_decisions`](#search_decisions)
  - [`search_decisions_advanced`](#search_decisions_advanced)
  - [`get_decision`](#get_decision)
  - [`get_decision_text`](#get_decision_text)
  - [`get_decision_history`](#get_decision_history)
  - [`list_decision_types`](#list_decision_types)
  - [`get_decision_type`](#get_decision_type)
  - [`search_organizations`](#search_organizations)
  - [`get_organization`](#get_organization)
  - [`list_organization_units`](#list_organization_units)
  - [`get_unit`](#get_unit)
  - [`list_organization_signers`](#list_organization_signers)
  - [`get_signer`](#get_signer)
  - [`list_positions`](#list_positions)
  - [`list_thematic_categories`](#list_thematic_categories)
  - [`list_dictionaries`](#list_dictionaries)
  - [`search_dictionary`](#search_dictionary)
- [Upstream API reference](#upstream-api-reference)
  - [Lucene fields](#lucene-fields)
- [Reference data](#reference-data)
- [Caching](#caching)
- [Errors](#errors)

---

## What this answers

In one sentence: **a user can find out what any Greek public body decided, when
it decided it, and what it cost — given nothing but a name, a date range or a
document code.**

Concretely, each tool turns a question into an answer like this:

| The user wants to… | …when they know… | …via |
|---|---|---|
| Read one specific decision in full | its ΑΔΑ code | `get_decision` |
| Read what an act **actually says** — the text of the signed PDF | its ΑΔΑ code | `get_decision_text` |
| Get the annexes filed with an act — a tender document, a price table | its ΑΔΑ code | `get_decision` (`attachments`) |
| List everything a public body decided in a period | the body's id and a date range | `search_decisions` |
| Find decisions about a topic | a Greek word likely to appear in the subject | `search_decisions` |
| See only contract awards, appointments or payments | which kind of act they mean | `list_decision_types`, then `search_decisions` |
| Find who supplied or was paid for something | a topic or a body, plus a date range | `search_decisions` (read `counterparty`) |
| Get the signed original of a decision | its ΑΔΑ, or a search that finds it | either tool (follow `documentUrl`) |
| Turn a body's **name** into the id every filter needs | the name, however they spell it | `search_organizations` |
| Identify a body that **no longer exists** but issued older acts | its old name | `search_organizations` (`includeInactive`) |
| Decode a **position code**, or list the posts a body has | the code, or the body's id | `list_positions` |
| Look a public body up in the register | its numeric id | `get_organization` |
| Narrow a search to one office inside a ministry | the body's id | `list_organization_units`, then `search_decisions` |
| Find out **who signed** an act | the `signerIds` on a decision | `get_signer` |
| Find out **who runs** a body, or who may sign for it | the body's id | `list_organization_signers` |
| Name the **office** that issued an act | the `unitIds` on a decision | `get_unit` |
| Filter by subject area rather than act type | which topic they mean | `list_thematic_categories`, then `search_decisions` |
| See what a body **published on a given day**, or find an act by its **reference number** | the body's id, plus a date or a protocol number | `search_decisions` (`publishedFrom`, `protocolNumber`) |
| List the acts a body **withdrew** | a body or a period | `search_decisions` (`status: "revoked"`) |
| Find out whether an act was **corrected or revoked**, when, and why | its ΑΔΑ | `get_decision_history` |
| Ask for **either of two types**, a **headcount range**, or a **CPV code** | the Lucene field names | `search_decisions_advanced` |
| Understand the **type-specific fields** on an act, or learn what can be searched | the type code | `get_decision_type` |
| Decode a **CPV code**, a body category, a Gazette issue type, a region | the code, or a word | `search_dictionary` (and `list_dictionaries`) |

Some questions this genuinely answers, phrased as a person would ask them:

- *"What did the General Hospital of Kalamata decide last year?"* — the user
  supplies the hospital's id and the year, and gets back the 3,740 acts it
  issued in the first half of 2025, 100 per page, newest first, with a note
  saying the second half needs a second call — see gotcha 1.
- *"Which contracts did the government award this year, and for how much?"* — the
  user supplies the award type code `Δ.1` and a start date, and gets back
  147,791 awards for January to June, each with the amount it was awarded at.
- *"Is this decision still valid?"* — the user supplies the ΑΔΑ and
  `get_decision_history` answers `REVOKED`, with the version that withdrew it
  and the reason the body gave.
- *"Who runs the Ministry of Health?"* — the user supplies the ministry's id and
  `list_organization_signers` puts the Minister at the top of the 75 people
  registered to sign for it.
- *"Show me this decision — someone sent me the code ΨΕ1Ψ46ΨΧΞ5-ΝΝΖ."* — the
  user supplies only the ΑΔΑ and gets the whole act: subject, issuing body,
  signers, budget lines and a link to the signed PDF.
- *"Who did the ministry buy from in August, and what did it pay?"* — the user
  supplies a topic word and a date range, then reads `counterparty` and
  `expenses` off each result.

And the shape of a question it **cannot** answer, so you know the edge:
*"What did Greece spend on healthcare in total last year?"* — the register
publishes individual acts, not totals, and it does not index the text inside
the PDFs. Totals have to be assembled by paging and summing, and only across
acts that share an [expense basis](#expense-bases). (`get_decision_text` reads
any one PDF once the act is found; what it cannot do is *search* them.)

---

## Read this first

Six upstream behaviours will produce silently wrong answers if you do not know
about them. All six were confirmed by probing the live API, on 2026-08-29 and
again on 2026-09-01.

### 1. A search covers at most six months of issue dates — always

This is a hard cap, not just a default, and it is the single easiest way to get
a confidently wrong answer out of this API.

- **No dates given** → the last six months are searched, not the register.
- **A range longer than 180 days** → upstream silently cuts it to
  `issuedFrom + 180 days` and returns a `total` for that part only. `issuedTo`
  is discarded without a word. It is a fixed 180 days, not six calendar months:
  2026-01-01 runs to 2026-06-30, 2025-07-01 to 2025-12-28.
- **A range of 180 days or less** → honoured exactly.

Measured on 2026-09-01, asking for all of 2025 from one hospital:

```
requested  issuedFrom=2025-01-01  issuedTo=2025-12-31
executed   issueDate:[DT(2025-01-01T00:00:00) TO DT(2025-06-30T23:59:59)]   total: 3740
```

That 3,740 is January to June, and nothing in the raw response says so — it
looks exactly like a complete answer for the year.

`search_decisions` therefore reads the window back out of the Lucene query
upstream echoes and reports **that** as `coverage.issuedFrom` / `coverage.issuedTo`,
keeping what was asked for alongside as `requestedFrom` / `requestedTo` and
adding a `coverage.note` whenever the two differ — a note that names the day
the next call should start from. To cover a longer period, issue consecutive
searches from that day and sum them yourself.

### 2. On `search.json`, `q=` is accepted and then ignored

The obvious parameter name does nothing on the simple endpoint. Upstream returns
HTTP 200, the same result count, and a Lucene query with no text clause in it.
The parameters that bind there are `term` (whole record) and `subject` (subject
line only). This adapter now writes the Lucene query itself and sends it to
`search/advanced.json`, where `q:"…"` *is* the whole-record field — but the
lesson stands: every response echoes the executed query in `upstreamQuery`,
which is how to tell a filter apart from a typo.

### 3. Unknown parameters fail silently

On `search.json`, upstream ignores anything it does not recognise and answers
200, so a misspelled filter returns a plausible, unfiltered result set. On
`search/advanced.json` most unknown field names are a 400 — but a few that
happen to parse (`organizationId`, `privateData`) return 200 and zero hits.
`search_decisions` sends only fields verified to bind; `search_decisions_advanced`
passes your query through, and `upstreamQuery` lets you confirm it.

### 4. `organizationId` is the issuer; `extraFieldValues.org` is not

`extraFieldValues.org` is the **counterparty** — the supplier, payee or
beneficiary named on an expenditure act — not the body that issued it. On a
procurement act the two are different legal entities, and treating the
counterparty as the issuer attributes a payment to the company that received it.

This adapter keeps them apart: `organization` is resolved from the top-level
`organizationId`, and `counterparty` carries `extraFieldValues.org`.

### 5. Money lives in a different field per act type

There is no single amount field. See [expense bases](#expense-bases) — the four
kinds of figure are **not comparable** and must never be summed together.

### 6. `to_issue_date` on the simple endpoint drops the day it names

`search.json?to_issue_date=2026-08-20` becomes `TO 2026-08-20T00:00+03:00` —
the first second of the day, not the last. And issue dates are stamped at
midnight in two different zones: most acts at UTC midnight (03:00 in Athens),
a few at Athens midnight. So that bound admits only the second kind:

```
to_issue_date=2026-08-20  (simple)                          459 acts
issueDate:[… TO DT(2026-08-20T23:59:59)]  (advanced)     12,164 acts
```

Ninety-six per cent of the day, gone without a word. This is why the adapter
runs `search/advanced.json` and writes `T00:00:00` and `T23:59:59` itself — see
[why not `search.json`](#why-searchadvancedjson-and-not-searchjson). The same
two midnights mean `issuedOn` is computed in Athens time, not UTC: read in UTC,
an act stamped at Athens midnight lands on the previous day.

### Two smaller traps

**`url` is not a link you can open.** Upstream's `url` field is its internal
`https://diavgeia.gov.gr/luminapi/api/decisions/{ada}` endpoint. The viewable
page is `https://diavgeia.gov.gr/decision/view/{ada}`, which upstream never
returns. This adapter builds `pageUrl` from the ΑΔΑ and keeps the internal one
as `apiUrl`.

**Status is spelled two ways.** Records carry `status: "PUBLISHED"` or
`"REVOKED"`, but the Lucene filter wants the Greek — `status:"Αναρτημένη"`,
`status:"Ανακληθείσα"`. They mean the same thing; do not filter on the value you
see in a record. `search_decisions` translates its `status` argument;
`search_decisions_advanced` leaves the clause to you, and adds none by default —
so revoked acts are included there unless you say otherwise. See
[status values](#status-values).

---

## Tools

### `search_decisions`

Search the register. Filters combine with **AND**; every filter is optional, and
a call with no filters returns the most recently published acts.

**In plain terms.** The user is able to retrieve a list of administrative acts —
each with its subject, the body that issued it, the date, any money it declares
and a link to the signed PDF — when given any combination of a topic word, an
issuing body, a kind of act and a date range. Nothing is required: the fewer
filters given, the broader the answer, and every filter narrows it further.

Think of it as the question *"what was decided about ___, by ___, between ___
and ___?"* where any blank may be left unfilled.

#### Parameters

| Parameter | Type | Default | Constraints | Lucene clause |
|---|---|---|---|---|
| `text` | string | — | 1–200 chars | `q:"…"` |
| `subject` | string | — | 1–200 chars | `subject:"…"` |
| `protocolNumber` | string | — | 1–60 chars | `protocolNumber:"…"` |
| `organizationId` | string | — | non-empty | `organizationUid:"…"` |
| `unitId` | string | — | non-empty | `unitUid:"…"` |
| `signerId` | string | — | non-empty | `signerUid:"…"` |
| `decisionType` | string | — | non-empty | `decisionTypeUid:"…"` |
| `thematicCategory` | string | — | non-empty | `thematicCategoryUid:"…"` |
| `issuedFrom` / `issuedTo` | string | — | `YYYY-MM-DD` | `issueDate:[DT(fromT00:00:00) TO DT(toT23:59:59)]` |
| `publishedFrom` / `publishedTo` | string | — | `YYYY-MM-DD` | `publishTimestamp:[…]`, same shape |
| `status` | `published` \| `revoked` \| `all` | `published` | — | `status:"Αναρτημένη"` / `status:"Ανακληθείσα"` / none |
| `page` | integer | `0` | ≥ 0 | — |
| `size` | integer | `20` | 1–100 | — |

Values are quoted as Lucene phrases with `"` and `\` escaped, so a subject
containing a quote is searched for rather than breaking the query (it breaks
`search.json`: HTTP 400). The clauses are joined with `AND`.

**`text` vs `subject`.** `text` searches the whole indexed record; `subject`
matches only the act's subject line. For the same term, `text` returned
1,001,755 hits where `subject` returned 348,812 — use `subject` when you want
precision and `text` when you want recall.

**`issuedFrom` / `issuedTo`** filter on the *issue* date — when the act was
signed. Both bounds are inclusive, because the adapter writes them as whole
Athens-time days (gotcha 6). Only `issuedFrom` means from there to today, which
the cap then cuts to 180 days; only `issuedTo` means the 180 days ending there.
`issuedFrom` after `issuedTo` is rejected before any request is made.

**`publishedFrom` / `publishedTo`** filter on when the act appeared on Διαύγεια,
which is usually within a day of signing but can be weeks later. This window is
not capped — but the issue-date window applies alongside it, and with no issue
dates given that is the default last six months. So *"published this week"*
misses an act published this week but signed seven months ago; `coverage.note`
says so, and `issuedFrom` widens it.

**`protocolNumber`** is the body's own reference for the act (αριθμός
πρωτοκόλλου), matched exactly. Bodies number independently, so `27681` alone
finds acts from several of them; combine with `organizationId`.

**`status`** defaults to `published`, which returns only acts currently in
force. `revoked` returns only acts their issuer has withdrawn (471 in the last
six months at the time of writing); `all` returns both.

**`size`** is capped at 100 here. Upstream accepts up to 500 and silently
clamps anything larger, but a 500-act page is not a useful model payload.

#### Returns

```jsonc
{
  "total": 14029,          // matches across the whole query, not this page
  "page": 0,
  "size": 3,
  "returned": 3,
  "hasMore": true,
  "coverage": {
    "issuedFrom": "2026-08-01",      // the window actually searched
    "issuedTo": "2026-08-10",
    "requestedFrom": "2026-08-01",   // the window asked for
    "requestedTo": "2026-08-10",
    "publishedFrom": null,
    "publishedTo": null,
    "status": "published"
    // "note" appears whenever searched ≠ requested, or no dates were given,
    // and names the day the next call should start from — see gotcha 1
  },
  "upstreamQuery": "subject:\"προμήθεια\" AND issueDate:[DT(2026-08-01T00:00:00) TO DT(2026-08-10T23:59:59)] AND status:\"Αναρτημένη\"",
  "decisions": [ /* DecisionSummary */ ]
}
```

A `DecisionSummary`:

```jsonc
{
  "ada": "9ΓΓ346ΝΨ2Ν-Β5Τ",
  "subject": "Μισθοδοσία μηνός Αυγούστου 2026",
  "protocolNumber": "16Μ-2026",
  "issuedOn": "2026-08-03",              // YYYY-MM-DD, Athens time
  "publishedAt": "2026-08-27T18:05:49.231Z",
  "status": "PUBLISHED",
  "decisionTypeId": "Β.2.2",
  "thematicCategoryIds": ["20"],
  "organization": {                       // the issuing body
    "id": "100076956",
    "name": "ΑΝΑΠΤΥΞΙΑΚΟΣ ΟΡΓΑΝΙΣΜΟΣ ΔΗΜΟΥ ΛΑΡΙΣΑΙΩΝ ΜΟΝΟΠΡΟΣΩΠΗ Α Ε",
    "abbreviation": null,
    "vatNumber": "801719225",
    "category": "NPDD",
    "status": "active"
  },
  "counterparty": {                       // supplier/payee, or null
    "name": "ΑΝΑΠΤΥΞΙΑΚΟΣ ΟΡΓΑΝΙΣΜΟΣ ΔΗΜΟΥ ΛΑΡΙΣΑΙΩΝ ΜΟΝ/ΠΗ ΑΕ",
    "vatNumber": "801719225"
  },
  "signerIds": ["100090423"],
  "unitIds": ["100076979"],
  "expenses": {
    "basis": "payment",
    "totals": [{ "currency": "EUR", "amount": 2087.86 }],
    "items": [
      { "amount": 1738.0,  "currency": "EUR", "kae": "04.30.60.01" },
      { "amount": 349.86,  "currency": "EUR", "kae": "04.30.60.02" }
    ]
  },
  "pageUrl": "https://diavgeia.gov.gr/decision/view/9ΓΓ346ΝΨ2Ν-Β5Τ",
  "apiUrl": "https://diavgeia.gov.gr/luminapi/api/decisions/9ΓΓ346ΝΨ2Ν-Β5Τ",
  "documentUrl": "https://diavgeia.gov.gr/doc/9ΓΓ346ΝΨ2Ν-Β5Τ"
}
```

`organization.name` is `null` only when the uid cannot be resolved — a lookup
failure degrades one field rather than failing the search.

#### Examples

Each example below states the question in words, then the arguments, then what
actually came back when it was run on 2026-08-29.

---

**1. "What did the state decide about procurement in the first ten days of August?"**

The user is able to retrieve acts on a topic when given a Greek word that
appears in the subject line and a date range. Here `subject` is used rather than
`text` because the user wants acts *about* procurement, not every act that
happens to mention the word somewhere.

```json
{ "subject": "προμήθεια", "issuedFrom": "2026-08-01", "issuedTo": "2026-08-10", "size": 3 }
```

**What comes back:** 14,029 matching acts, of which the first 3 are returned and
`hasMore` is true. (An earlier version of this adapter reported 12,090 for the
same call: 10 August was being dropped — gotcha 6.) The first is a board resolution from the General Hospital of
Kalamata approving an off-contract purchase; the second is a €122.59 commitment
by the Lesvos Chamber of Commerce for local soap and olive oil.

Note that the first result carries **no amount**. Matching on a subject word
returns approving, authorising and reporting acts alongside the financial ones,
and only the financial ones declare money. If the user wants amounts on every
row, filter by a financial `decisionType` instead — example 3.

---

**2. "Show me everything the General Hospital of Kalamata published last year."**

The user is able to retrieve a body's complete output for a period when given
that body's numeric id and two dates. The id comes from `search_organizations`,
or from `organization.id` on any earlier result.

```json
{ "organizationId": "99221912", "issuedFrom": "2025-01-01", "issuedTo": "2025-12-31", "size": 100, "page": 0 }
```

**What comes back:** 3,740 acts and the first 100 of them, newest first — but
for **January to June 2025 only**. The requested year is longer than the
180-day cap, so `coverage` reports the truncated window and carries a note
saying so, ending *"search again from 2025-07-01"*. Covering the whole year
means that second call, for `2025-07-01` to `2025-12-31`. Every row names the
hospital as `organization`, because the filter is on the issuer.

---

**3. "Which contracts were awarded this year, and for how much?"**

The user is able to retrieve one specific kind of act, with its amount attached,
when given the type code for that kind. `Δ.1` is *ΑΝΑΘΕΣΗ ΕΡΓΩΝ / ΠΡΟΜΗΘΕΙΩΝ /
ΥΠΗΡΕΣΙΩΝ / ΜΕΛΕΤΩΝ* — the act that awards a contract. Codes come from
`list_decision_types`; see also [decision types](#decision-types).

```json
{ "decisionType": "Δ.1", "issuedFrom": "2026-01-01", "size": 3 }
```

**What comes back:** 147,791 awards — for January to June 2026, not the whole
year to date, because of the 180-day cap. Because every act of this
type declares a value, **every row carries an amount** — €36 from the Ministry
of Citizen Protection for a single ferry ticket, €2,400 from the Ministry of
National Defence for an unnamed assignment. Each is `"basis": "award"`, meaning
the price the contract was struck at, not money that has yet been paid.

---

**4. "Who is the public sector hiring?"**

The same move as example 3, with a different code. `Γ.3.3` is *ΔΙΟΡΙΣΜΟΣ* —
appointment to a post.

```json
{ "decisionType": "Γ.3.3", "issuedFrom": "2026-01-01", "size": 3 }
```

**What comes back:** 5,127 appointments for January to June — a university
appointing an assistant professor, fixed-term hires at municipalities. These are
non-financial acts, so `expenses` is null on every row; the substance is in the
subject and the PDF.

---

**5. "What has been published in the last few minutes?"**

The user is able to retrieve the newest acts across the whole state by giving no
filters at all. Results are always newest-first.

```json
{ "size": 10 }
```

**What comes back:** the 10 most recently published acts, out of roughly 3
million currently in force. The response also carries a `coverage.note`, because
no dates were given and upstream therefore searched only the last six months —
see [gotcha 1](#1-a-search-covers-at-most-six-months-of-issue-dates--always).

---

**6. "What did the Ministry of Health publish yesterday?"**

The user is able to see a body's output by the day it *appeared*, rather than
the day it was signed, when given the body's id and a publication date.

```json
{ "organizationId": "100010899", "publishedFrom": "2026-08-31", "publishedTo": "2026-08-31", "size": 3 }
```

**What comes back:** 35 acts published on 31 August 2026. `coverage` carries
two notes: no issue dates were given, so the default six-month issue window
applies; and because of that, an act published yesterday but signed before
March would not be here. For a ministry that is a hypothetical; for a body
clearing a backlog it is not, and `issuedFrom` is the fix.

---

**7. "Which acts were withdrawn this year?"**

The user is able to list revoked acts — normally invisible, because every other
search returns only acts in force — by asking for that status.

```json
{ "status": "revoked", "issuedFrom": "2026-01-01", "size": 3 }
```

**What comes back:** 369 revoked acts for January to June 2026; the first is a
travel-expense approval its issuer withdrew. Each row carries
`status: "REVOKED"`. Why it was withdrawn is not in the record —
`get_decision_history` has the reason the body gave.

---

**8. "Find the act with protocol number 27681 from this body."**

The user is able to find an act from the reference number printed on the
paperwork, when given the number and the body it belongs to.

```json
{ "protocolNumber": "27681", "organizationId": "55400", "issuedFrom": "2026-07-01", "size": 3 }
```

**What comes back:** 2 acts — both €3,800 awards by the Attica social-welfare
centre, issued the same day under the same number. Without `organizationId`
the same number returns 3, one of them from the Municipality of Ilion: protocol
numbers are per body, not per register.

#### What it cannot do

- **No full-text search inside the PDFs.** Only act metadata is indexed. A
  supplier named in the body of a contract but not in the subject line is not
  findable this way. Once an act *is* found, `get_decision_text` reads its PDF.
- **No aggregation.** There is no "total spend by ministry" — that means paging
  through results and summing client-side, respecting `expenses.basis`.
- **No sorting.** Results are always newest-first. Upstream accepts a `sort`
  parameter but rejects every value except `recent` with an HTTP 500
  (`SEARCH-003 / IndexReadException`), so the adapter does not expose it.
- **No OR, no ranges, no type-specific fields.** Every filter here is one value,
  ANDed. `search_decisions_advanced` lifts that; `NOT` and wildcards are rejected
  upstream on both.

---

### `search_decisions_advanced`

Search with a Lucene query written by hand.

**In plain terms.** The user is able to ask the questions the fixed filters
cannot phrase — *"awards **or** tender results from this hospital"*,
*"appointments of ten or more people"*, *"contracts under this CPV code"* — by
writing the query themselves. Everything else is the same as `search_decisions`:
the same envelope, the same issuer resolution, the same 180-day cap.

The fixed filters cover most questions and are the safer tool: they escape
values, apply a status and write the dates. Reach for this one when the question
has an OR in it, a numeric range, or a type-specific field.

#### Parameters

| Parameter | Type | Default | Constraints |
|---|---|---|---|
| `query` | string | — | 1–2,000 chars, Lucene |
| `page` | integer | `0` | ≥ 0 |
| `size` | integer | `20` | 1–100 |

#### Syntax

What upstream's parser accepts, each checked live on 2026-09-01:

| Works | Rejected (HTTP 400) |
|---|---|
| `field:"phrase"` — quote every value; `\"` and `\\` inside | a bare term with no field |
| `AND`, `OR`, parentheses | `NOT`, `-field:…`, `!field:…` |
| `field:[a TO b]` with both bounds | open ranges `[a TO *]`, `*:*` |
| `DT(YYYY-MM-DDTHH:MM:SS)` in a range, Athens time | a bare date in a range |
| — | wildcards: `προμηθ*` |

#### Fields

On every act: `q` (whole record), `subject`, `ada`, `protocolNumber`,
`organizationUid`, `unitUid`, `signerUid`, `decisionTypeUid`,
`thematicCategoryUid`, `status`, `documentType`, `issueDate`,
`publishTimestamp`, `submissionTimestamp`.

Per type: whatever `get_decision_type` lists as `searchField` — `cpv` and
`assignmentType` on Δ.1, `numberOfPeople` and `employerOrg` on Γ.3.3,
`textFinancialYear` on Β.1.\*, `kaeNumber` on Β.4, `municipality` on 2.4.6.1.
The full list is under [Lucene fields](#lucene-fields). Amounts are **not**
indexed — no `awardAmount`, no `amount`, no way to ask for contracts over a
threshold.

#### Two things upstream does on its own

1. **The 180-day cap applies here too.** No `issueDate` clause means the last
   six months; a longer one is cut at `from + 180 days`. `coverage` reports what
   ran, exactly as in `search_decisions`, and `requestedFrom`/`requestedTo` are
   read from your query.
2. **No status filter is added.** `search_decisions` appends
   `status:"Αναρτημένη"` for you; here nothing is, so revoked acts are included
   until you write the clause. `coverage.note` reminds you.

#### Returns

The `search_decisions` envelope.

#### Examples

**"Awards or tender results from the Kalamata hospital, first half of 2026."**

```json
{ "query": "(decisionTypeUid:\"Δ.1\" OR decisionTypeUid:\"Δ.2.2\") AND organizationUid:\"99221912\" AND status:\"Αναρτημένη\" AND issueDate:[DT(2026-01-01T00:00:00) TO DT(2026-06-30T23:59:59)]", "size": 3 }
```

**What comes back:** 198 acts; the first three are medical-consumable supply
contracts signed on 30 June.

**"Pharmaceutical contracts awarded this year."** CPV `33600000-6` is
*ΦΑΡΜΑΚΕΥΤΙΚΑ ΠΡΟΙΟΝΤΑ* — `search_dictionary` says so.

```json
{ "query": "cpv:\"33600000-6\" AND decisionTypeUid:\"Δ.1\" AND status:\"Αναρτημένη\" AND issueDate:[DT(2026-01-01T00:00:00) TO DT(2026-06-30T23:59:59)]", "size": 3 }
```

**What comes back:** 319 awards, each with `expenses.basis: "award"` — a €491.40
first-aid-kit purchase by the Municipality of Lemnos, a drug supply from Viatris
Hellas.

**"Who hired ten or more people at once?"**

```json
{ "query": "decisionTypeUid:\"Γ.3.3\" AND numberOfPeople:[10 TO 1000] AND status:\"Αναρτημένη\" AND issueDate:[DT(2026-01-01T00:00:00) TO DT(2026-06-30T23:59:59)]", "size": 3 }
```

**What comes back:** 109 acts — seasonal camp staff for the Municipality of
Volvi, fixed-term hires elsewhere. Note the closed upper bound: `[10 TO *]` is
rejected.

**"That query doesn't work."** A malformed query comes back as an
`invalid_input` tool error carrying upstream's own message and the failing
position — `Διαύγεια rejected the query: Syntax error at input position
(line 1, pos 26): awardAmount:[1000 TO 2000] AND …` — and is not retried.

---

### `get_decision`

Fetch one act by its ΑΔΑ.

**In plain terms.** The user is able to retrieve the complete record of a single
decision — subject, issuing body, signers, budget lines, amounts, attachments
and the signed PDF — when given only its ΑΔΑ code.

The ΑΔΑ is the point of the whole programme: it is printed on Greek official
paperwork, quoted in news reports and cited in other decisions, precisely so
that anyone holding the code can pull up the original. This tool is that lookup.
A user who has a code uses this; a user who does not uses `search_decisions`
first and reads the code off a result.

#### Parameters

| Parameter | Type | Required | Constraints |
|---|---|---|---|
| `ada` | string | yes | `/^[0-9A-ZΑ-Ω]{4,}-[0-9A-ZΑ-Ω]{3}$/u` |

An ΑΔΑ is Greek capitals and digits, a hyphen, then a three-character checksum:
`9ΓΓ346ΝΨ2Ν-Β5Τ`. The segment before the hyphen has varied in length over the
programme's history, so only the shape is enforced. Malformed input is rejected
by the schema before any request; a well-formed but unknown ΑΔΑ returns a
`not_found` tool error.

#### Returns

Everything in `DecisionSummary`, plus:

| Field | Type | Meaning |
|---|---|---|
| `versionId` | string | UUID of this revision of the act |
| `documentChecksum` | string \| null | Checksum of the signed PDF |
| `attachmentCount` | integer | Number of attached files |
| `attachments` | Attachment[] | Each file filed alongside the PDF: `id`, `filename`, `description`, `mimeType`, `size` in bytes, `checksum`, and `url` — the file itself |
| `correctedVersionId` | string \| null | Set when this act corrects an earlier one |
| `redacted` | boolean | Upstream withheld the body for privacy reasons |
| `extraFields` | object | Type-specific fields, verbatim |

**`extraFields`** keys vary by `decisionTypeId` and upstream documents no schema
for them, so they are passed through rather than flattened into a shape that
would silently drop the unexpected ones. `org` and `sponsor` are removed because
they are already promoted onto `counterparty` and `expenses`; the other money
fields are left in place so their extra detail (budget remainders, CPV codes) is
not lost. Observed keys include:

| Key | Appears on | Meaning |
|---|---|---|
| `documentType` | most | `ΠΡΑΞΗ`, `ΝΟΜΟΣ`, … |
| `relatedDecisions` | most | ΑΔΑs of related acts |
| `financialYear` | Β.* | Budget year |
| `budgettype` | Β.* | `Τακτικός Προϋπολογισμός`, … |
| `amountWithKae` | Β.1.3 | Per-budget-line split, with remaining credit |
| `cpv` | Δ.* | EU Common Procurement Vocabulary codes |
| `assignmentType` | Δ.1 | How the contract was assigned |
| `fek` | Α.2 | Government Gazette reference |

`get_decision_type` describes every key an act of a given type carries — what
it means, whether it is required, and which vocabulary it draws from.

#### Examples

**"Someone quoted ΑΔΑ 9ΓΓ346ΝΨ2Ν-Β5Τ at me — what is it?"**

The user is able to resolve a bare code into a full, citable record by supplying
nothing else.

```json
{ "ada": "9ΓΓ346ΝΨ2Ν-Β5Τ" }
```

**What comes back:** the August 2026 payroll finalisation of the Development
Organisation of the Municipality of Larissa. It is a `Β.2.2` act, so the money
is a **payment** — €2,087.86 actually leaving the account, split across two
budget lines (€1,738.00 on `04.30.60.01`, €349.86 on `04.30.60.02`). The
response also carries `pageUrl` for a person to open and `documentUrl` for the
signed PDF, plus the type-specific `extraFields` for this act family.

**"Is this decision still the current version?"**

The same call answers this: `correctedVersionId` is null when the act stands as
published, and names an earlier version when this act supersedes one; `status`
reads `REVOKED` when the body has withdrawn it. For the sequence of versions and
the reason given, `get_decision_history`. `redacted` tells the user whether the
body withheld content for privacy reasons, which explains an act that looks
emptier than expected.

**"What came with this tender?"**

```json
{ "ada": "ΡΚΛΧΩΡΓ-Ο7Υ" }
```

**What comes back:** a tender notice (`Δ.2.1`) from the Municipality of Zitsa
with one attachment — the full tender document, a 1.4 MB PDF named in
`filename`, downloadable from `url`. Most acts have none; `attachmentCount` is
0 and `attachments` is empty. The record carries this metadata itself, so it
costs no extra request.

**"That code doesn't work."**

Two different failures, distinguished deliberately. A code of the wrong *shape*
(`not-an-ada`) is rejected by the schema before any network request. A
well-formed code that no act carries returns `No decision published under ΑΔΑ
"…". Check the code, or search for the act instead.` — the second is worth
retrying with a corrected code, the first is not.

---

### `get_decision_text`

The text of the signed PDF.

**In plain terms.** The user is able to read what an act *says* — the
reasoning, the articles, the tables, the names — rather than the record around
it. Every other tool returns metadata; the substance of a Greek administrative
act is in its PDF, and this is the only tool that opens one.

Text is extracted from the PDF's own text layer with [`unpdf`](https://github.com/unjs/unpdf)
(pdf.js). Acts are produced from word processors and carry a clean layer:
a 19-page recruitment notice comes out as 50,704 characters of readable Greek
in about 200 ms. A *scanned* act — a photocopy filed as a PDF — has no layer,
and comes back empty with a note saying so rather than as an error.

#### Parameters

| Parameter | Type | Default | Constraints |
|---|---|---|---|
| `ada` | string | — | same shape as `get_decision` |
| `fromPage` | integer | `1` | ≥ 1; past the last page is an error |
| `maxPages` | integer | `10` | 1–50 |

A call never returns more than **40,000 characters**; if the pages asked for
run past that, the last one is cut and `truncated` is true. `nextPage` always
says where to continue — the next page, or the cut one to re-read.

#### Returns

```jsonc
{
  "ada": "ΨΕ1Ψ46ΨΧΞ5-ΝΝΖ",
  "subject": "ΑΝΑΚΟΙΝΩΣΗ υπ' αριθμ. ΣΟΧ 3/2026 …",
  "pageCount": 19,
  "fromPage": 1,
  "toPage": 2,
  "characters": 5027,
  "truncated": false,
  "nextPage": 3,                        // null once the last page is returned
  "redacted": false,                    // the body withheld content for privacy
  "documentUrl": "https://diavgeia.gov.gr/doc/ΨΕ1Ψ46ΨΧΞ5-ΝΝΖ",
  "pages": [
    { "page": 1, "text": "Σελίδα 1 από 19\nΑθήνα 14 - 5 - 2026\nΓενική Διεύθυνση\n…" },
    { "page": 2, "text": "…" }
  ]
}
```

Whitespace is tidied — runs of spaces collapsed, blank runs to one blank line
— and nothing else is touched: line breaks are the PDF's own, which is what
keeps a table readable.

#### Examples

**"What does this recruitment notice say?"** `{ "ada": "ΨΕ1Ψ46ΨΧΞ5-ΝΝΖ" }` —
the ΕΛΓΑ fixed-term hiring notice: 19 pages, the first 10 returned (28,177
characters), `nextPage: 11`. A second call with `fromPage: 11` returns the rest
and `nextPage: null`.

**"Read me the tender."** `{ "ada": "ΡΚΛΧΩΡΓ-Ο7Υ", "maxPages": 1 }` — a
69-page tender from the Municipality of Zitsa; the first page comes back in a
second. The whole text is cached once extracted, so paging through the other
68 costs nothing more upstream.

**"That code doesn't exist."** The record is fetched first — it gives a proper
404 where the document endpoint would redirect to the old site — so the error
is the same `not_found` as `get_decision`.

#### Cost and limits

The PDF is downloaded whole and parsed in memory, then only its text is kept,
for an hour. Files over 30 MB are refused with the download link instead — a
scanned annex can run to hundreds of MB and would buy nothing. The attachments
filed alongside an act are **not** read; `get_decision` lists them with their
download URLs.

---

### `get_decision_history`

Every version filed under one ΑΔΑ.

**In plain terms.** The user is able to find out whether an act still stands —
and if not, what happened to it and why — from the code alone. `get_decision`
shows the current version; this shows how it got there.

Two things happen to a published act. A **correction** keeps the ΑΔΑ and files
a new version whose `correctedVersionId` names the one it replaces. A
**revocation** files a version in `PENDING_REVOCATION` and then one in
`REVOKED`, usually with the reason as `note` — *"Λόγω διπλής ανάρτησης"*, posted
twice, is the common one.

#### Parameters

| Parameter | Type | Required | Constraints |
|---|---|---|---|
| `ada` | string | yes | same shape as `get_decision` |

#### Returns

```jsonc
{
  "ada": "630ΜΩ1Ρ-ΤΧΝ",
  "organization": { "id": "6265", "name": "ΔΗΜΟΣ ΡΟΔΟΥ", … },
  "status": "REVOKED",                    // of the latest version
  "currentVersionId": "836e1ae7-…",
  "corrected": false,                     // does any version correct another
  "versions": [
    { "versionId": "ccb2c4b2-…", "at": "2026-09-01T05:56:29.657Z", "status": "PUBLISHED",
      "correctedVersionId": null, "note": null, "current": false },
    { "versionId": "27808fa7-…", "at": "2026-09-01T06:00:20.654Z", "status": "PENDING_REVOCATION",
      "correctedVersionId": null, "note": "Λόγω διπλής ανάρτησης (ΑΔΑ: 6Ν7ΞΩ1Ρ-ΨΤΛ)", "current": false },
    { "versionId": "836e1ae7-…", "at": "2026-09-01T06:00:20.925Z", "status": "REVOKED",
      "correctedVersionId": null, "note": "Λόγω διπλής ανάρτησης (ΑΔΑ: 6Ν7ΞΩ1Ρ-ΨΤΛ)", "current": true }
  ],
  "pageUrl": "https://diavgeia.gov.gr/decision/view/630ΜΩ1Ρ-ΤΧΝ"
}
```

`status` and `currentVersionId` are read off the log, not the cached record, so
a revocation shows within five minutes of being filed even if `get_decision` was
called an hour before. Upstream's `creator` (`{org}_{user}`, an internal account
id) is not surfaced.

#### Examples

**"Is 630ΜΩ1Ρ-ΤΧΝ still valid?"** No — revoked four minutes after publication
because the same contract had been posted under 6Ν7ΞΩ1Ρ-ΨΤΛ, which the note
names.

**"Was ΡΡ3Υ46ΝΚΠΔ-5ΓΨ ever changed?"** `corrected: true`, two versions: the
Ministry of Education filed a correction fifteen hours after the original.
`get_decision` returns the corrected one.

**"That code doesn't exist."** Upstream answers an unknown ΑΔΑ on this endpoint
with an HTML 500, which would read as an outage. The adapter fetches the record
first, which does give a 404, so the error is the same `not_found` as
`get_decision`.

---

### `list_decision_types`

The controlled vocabulary for `search_decisions.decisionType`. Call it before
filtering by type rather than guessing a code.

**In plain terms.** The user is able to discover what kinds of decision exist —
and the exact code for each — before narrowing a search to one of them.

This exists because the useful `search_decisions` filters are codes, not words.
A user who wants "contract awards" cannot ask for that in English or Greek; they
need `Δ.1`. This tool is how they find that out, and it is why the two tools are
usually called in sequence: list the vocabulary, pick a code, then search.

#### Parameters

| Parameter | Type | Default | Meaning |
|---|---|---|---|
| `includeGroups` | boolean | `false` | Include the 8 grouping nodes that cannot be assigned to an act |

#### Returns

```jsonc
{
  "total": 35,
  "omittedGroups": 8,
  "types": [
    {
      "code": "Β.2.2",
      "label": "ΟΡΙΣΤΙΚΟΠΟΙΗΣΗ ΠΛΗΡΩΜΗΣ",
      "parent": "2.4.2",
      "parentLabel": "ΠΡΑΞΕΙΣ ΟΙΚΟΝΟΜΙΚΟΥ ΠΕΡΙΕΧΟΜΕΝΟΥ",
      "assignable": true
    }
  ]
}
```

`parentLabel` is resolved against the *full* list, so a filtered response still
names its parents instead of pointing at codes it omitted.

#### Examples

**"What kinds of decision can I filter by?"**

```json
{}
```

**What comes back:** all 35 usable codes, from `Α.1.1` (ΝΟΜΟΣ — a law) through
the financial `Β.*` family to the procurement `Δ.*` family, each with its Greek
label and the group it belongs to. `omittedGroups: 8` says that eight
higher-level grouping nodes were left out because they cannot be used as a
filter — asking for one returns nothing rather than an error, which is exactly
the silent-failure this tool exists to prevent.

**"Show me the full hierarchy, groups included."**

```json
{ "includeGroups": true }
```

**What comes back:** all 43 entries. Each grouping node has
`assignable: false` — read that as *"do not pass this to `decisionType`"*. The
groups are useful for explaining the taxonomy to a person (the eight families of
Greek administrative act), not for querying.

**Typical sequence.** A user asking *"how much has the state awarded in
contracts this year?"* is answered in two calls: `list_decision_types` to learn
that awards are `Δ.1`, then `search_decisions` with that code and a start date.
To learn what an act of a type contains, `get_decision_type`.

---

### `get_decision_type`

What an act of one type carries.

**In plain terms.** The user is able to understand the type-specific part of a
decision — the `extraFields` block that `get_decision` passes through verbatim —
and to learn which of those fields can be searched. It is the schema upstream
does not otherwise publish.

#### Parameters

| Parameter | Type | Required |
|---|---|---|
| `code` | string | yes — from `list_decision_types` |

#### Returns

```jsonc
{
  "code": "Δ.1",
  "label": "ΑΝΑΘΕΣΗ ΕΡΓΩΝ / ΠΡΟΜΗΘΕΙΩΝ / ΥΠΗΡΕΣΙΩΝ / ΜΕΛΕΤΩΝ",
  "parent": "2.4.4",
  "parentLabel": "ΠΡΑΞΕΙΣ ΑΝΑΘΕΣΕΩΝ ΠΡΟΜΗΘΕΙΩΝ ΚΑΙ ΔΙΑΓΩΝΙΣΜΩΝ - ΔΗΜΟΣΙΩΝ ΣΥΜΒΑΣΕΩΝ",
  "assignable": true,
  "searchableFields": ["assignmentType", "cpv", "textRelatedADA", "documentType"],
  "fields": [
    { "key": "assignmentType", "label": "Κατηγορία", "help": "Εισάγετε την κατηγορία",
      "type": "string", "required": true, "multiple": false, "dictionary": null,
      "allowedValues": ["Έργα", "Υπηρεσίες", "Προμήθειες", "Μελέτες"], "searchField": "assignmentType" },
    { "key": "cpv", "label": "CPV", "type": "string", "multiple": true,
      "dictionary": "CPV", "searchField": "cpv", … },
    { "key": "awardAmount", "label": "Ποσό", "type": "object", "searchField": null, … }
  ]
}
```

`key` is the key in `extraFields`; `searchField` is the Lucene field for
`search_decisions_advanced`, or null when upstream does not index it — which is
the case for every amount. `dictionary` names the vocabulary a value comes from,
so `search_dictionary` can decode it. `parent` is resolved from `types.json`,
because the detail endpoint reports `null` for every type. A grouping node
(`2.4.2`) answers with `assignable: false` and no fields.

#### Example

**"What's in a payment act?"** `{ "code": "Β.2.2" }` — six fields: `org` (the
payee), `sponsor` (the beneficiaries and their amounts), `skipVatReason` (from
the `SKIP_VAT_REASON` vocabulary), `relatedEkgrisiDapanis`, `relatedDecisions`
and `documentType`. Only `skipVatReason` (as `receiverNoVATOrg`) and
`documentType` are searchable. `org` and `sponsor` are already promoted to
`counterparty` and `expenses` on every result.

---

### `search_organizations`

Find a public body by name and get the numeric uid every other filter needs.

**In plain terms.** The user is able to go from *"the Municipality of Athens"* —
a name, typed however they happen to type it — to the id that `search_decisions`
needs, without knowing that ids exist.

This closes the gap the other tools leave open. `search_decisions` filters by
`organizationId`, and until now the only way to learn one was to run a topic
search and read an id off a result, which fails whenever the body publishes
nothing about that topic.

#### Parameters

| Parameter | Type | Default | Constraints |
|---|---|---|---|
| `query` | string | — | 2–120 chars; name fragment or exact VAT number |
| `category` | string | — | e.g. `MINISTRY`, `NPDD`, `MUNICIPALITY` |
| `includeInactive` | boolean | `false` | Also bodies dissolved or merged (414), and pending registration (2) |
| `limit` | integer | `20` | 1–100 |

**Matching folds accents and case.** Register labels are shouted and unaccented
(`ΝΟΜ.ΓΕΝ. ΝΟΣΟΚΟΜΕΙΟ ΚΑΛΑΜΑΤΑΣ`) while a person types `Καλαμάτας`. The query
and the label are both decomposed, stripped of combining marks and uppercased,
which also folds final `ς` onto `Σ`. So `Καλαμάτας`, `καλαματα` and
`ΚΑΛΑΜΑΤΑΣ` all match the same body.

**A VAT number matches whole.** A substring of an ΑΦΜ is not a weaker match, it
is a different taxpayer.

**Ranking** is exact name, then prefix, then substring, then shortest first.
Without it `δήμος αθηναίων` answers with a municipal software subsidiary ahead
of the municipality itself, purely because it sorts earlier in the register.

#### Returns

```jsonc
{
  "query": "δήμος αθηναίων",
  "total": 2, "returned": 2, "hasMore": false,
  "organizations": [
    {
      "id": "6013",                       // this is what search_decisions wants
      "name": "ΔΗΜΟΣ ΑΘΗΝΑΙΩΝ",
      "abbreviation": null,
      "vatNumber": "090025537",
      "category": "MUNICIPALITY",
      "status": "active",                 // or "inactive", "pending"
      "supervisorName": "ΠΕΡΙΦΕΡΕΙΑ ΑΤΤΙΚΗΣ"
    }
  ]
}
```

No match is an empty list, not an error — a name that is not in the register is
an answer.

**Dissolved bodies** are hidden by default and worth asking for: an act from
2014 names its issuer by a uid that may no longer be active, and the old
regional authority `ΠΕΡΙΦΕΡΕΙΕΣ` (`22887`) is found only with
`includeInactive: true`. Each match carries its `status`.

#### Cost

Upstream has **no name search**: `organizations.json` honours a `status`
filter and nothing else, and returns the whole register — 5,838 bodies,
2.7 MB, 17–19 s. Searching by name therefore means holding the register and
matching locally, and that is made to cost the caller nothing:

- The server **fetches it at boot**, off the request path (`warm` on the
  source; 17.3 s measured), so the first name search already has it.
- It is **held for a week and refreshed after a day**: a caller who finds it
  a day old gets the copy in hand and triggers one refresh in the background,
  so the 19 s is never on a request again.
- The same copy names the issuer on every search page, so a cold page no
  longer makes twenty per-uid lookups.

Only a server that starts and is asked for a name inside its first ~20 s ever
waits, and even then the fetch is deduplicated across callers.

---

### `get_organization`

The full register record for one body.

**In plain terms.** The user is able to find out what a public body actually
*is* — its official name, who supervises it, whether it still exists — from
nothing but the id on a decision.

#### Parameters

| Parameter | Type | Required | Constraints |
|---|---|---|---|
| `organizationId` | string | yes | digits only |

#### Returns

```jsonc
{
  "id": "99221912",
  "name": "ΝΟΜ.ΓΕΝ. ΝΟΣΟΚΟΜΕΙΟ ΚΑΛΑΜΑΤΑΣ",
  "abbreviation": null,
  "vatNumber": "998995401",
  "category": "NPDD",
  "status": "active",
  "latinName": "gen_nosokomeio_kalamatas",
  "website": "http://www.nosokomeiokalamatas.gr",
  "supervisor": { "id": "100010899", "name": "ΥΠΟΥΡΓΕΙΟ ΥΓΕΙΑΣ ΚΑΙ ΚΟΙΝΩΝΙΚΩΝ ΑΣΦΑΛΙΣΕΩΝ" },
  "fek": { "number": "3499", "issue": "fektype_B", "year": "2012" }
}
```

`supervisor` is what makes the state's shape legible: a hospital reports to a
ministry, a municipal company to its municipality. `fek` is the Government
Gazette issue that established the body, and is `null` — not a row of zeroes —
for bodies that have none. An unknown uid is a `not_found` tool error.

The six fields a search result already embeds are deliberately not the whole
record: repeated on every row of a 100-act page, the rest would be dead weight.

---

### `list_organization_units`

The departments and directorates inside one body.

**In plain terms.** The user is able to narrow a search from *"the ministry"* to
*"the procurement department of the ministry"*, which is the difference between
40,000 acts and 400.

#### Parameters

| Parameter | Type | Default | Constraints |
|---|---|---|---|
| `organizationId` | string | — | digits only, required |
| `includeInactive` | boolean | `false` | — |

#### Returns

```jsonc
{
  "organizationId": "99221912",
  "total": 5,
  "omittedInactive": 4,
  "units": [
    {
      "id": "75159",                       // valid `unitId` for search_decisions
      "label": "ΠΡΟΜΗΘΕΙΩΝ",
      "abbreviation": null,
      "category": "DEPARTMENT",
      "active": true,
      "activeFrom": "2017-12-05",
      "activeUntil": null,
      "parentId": "100025263",
      "parentLabel": "TMHMA OIKONOMIKOY"
    }
  ]
}
```

**Units nest.** `parentId` points at the containing unit, or at the body itself
for a top-level one — above, the procurement department sits inside the finance
department, which sits inside the administration. `parentLabel` is resolved
against the *full* list, so a filtered response still names parents it did not
itself return, and a top-level unit's `parentLabel` is the body's name.
`get_unit` resolves one uid the other way round, without the body.

Upstream answers an unknown numeric uid with `{"units": []}`, not a 404, so an
empty list is checked against the register before it is reported: `0` is a
`not_found` error, a body with no registered units is `total: 0`.

**Dissolved units are excluded by default** but remain worth asking for: they
still appear as the signing unit on the older acts they issued, so a search
covering 2015 may well need one.

---

### `get_unit`

One unit by uid.

**In plain terms.** The user is able to name the office that issued an act — a
decision carries `unitIds` and nothing else — without first working out which
body it belongs to and listing that body's structure.

#### Parameters

| Parameter | Type | Required | Constraints |
|---|---|---|---|
| `unitId` | string | yes | digits only |

#### Returns

```jsonc
{
  "id": "75159",
  "label": "ΠΡΟΜΗΘΕΙΩΝ",
  "abbreviation": null,
  "category": "DEPARTMENT",
  "active": true,
  "activeFrom": "2017-12-05",
  "activeUntil": null,
  "parentId": "100025263",
  "parent": { "id": "100025263", "label": "TMHMA OIKONOMIKOY", "kind": "unit" }
}
```

`parent` costs one more lookup: a unit's parent is either another unit or the
body itself, and nothing in the record says which. The unit endpoint is tried
first; a 404 there means the uid is a body's, and `kind` becomes
`"organization"` — for the Kalamata hospital's `ΔΙΟΙΚΗΤΗΣ` unit (`75177`) the
parent is the hospital. An unknown uid is a `not_found` tool error.

---

### `list_organization_signers`

Everyone registered to sign for one body.

**In plain terms.** The user is able to answer *"who runs this?"* — the
Minister, the hospital's Διοικητής, the mayor — and *"who can sign for it?"*,
from the body's id. It is `get_signer` in reverse.

#### Parameters

| Parameter | Type | Default | Constraints |
|---|---|---|---|
| `organizationId` | string | — | digits only, required |
| `includeInactive` | boolean | `false` | — |

#### Returns

```jsonc
{
  "organization": { "id": "99221912", "name": "ΝΟΜ.ΓΕΝ. ΝΟΣΟΚΟΜΕΙΟ ΚΑΛΑΜΑΤΑΣ", … },
  "total": 5,
  "omittedInactive": 0,
  "signers": [
    {
      "id": "100062255",
      "name": "ΕΛΕΝΗ ΑΛΕΙΦΕΡΗ",
      "active": true, "activeFrom": "2020-10-08", "activeUntil": null,
      "canSignForOrganization": true,
      "postings": [
        { "unitId": "99221912", "unitLabel": "ΝΟΜ.ΓΕΝ. ΝΟΣΟΚΟΜΕΙΟ ΚΑΛΑΜΑΤΑΣ",
          "positionId": "POS_10017", "positionLabel": "Διοικητής", "from": null, "until": null }
      ]
    }
  ]
}
```

Sorted so that whoever binds the whole body comes first, then by name: the head
of the body is at the top rather than wherever the register happens to put
them. `unitLabel` is filled from the body's unit list; a posting on the body's
own uid is the top-level one and is labelled with the body's name.

Upstream answers an unknown numeric uid with an empty list, not a 404, so an
empty list is checked against the register before it is reported: `0` is a
`not_found` error, a body with nobody registered is `total: 0`.

#### Example

**"Who runs the Ministry of Health?"** `{ "organizationId": "100010899" }` — 75
signers; the first two are the Minister (`Υπουργός`,
`canSignForOrganization: true`), who appears under two uids because the register
carries him twice.

---

### `get_signer`

Resolve a signer uid into a person.

**In plain terms.** The user is able to answer *"who signed this?"* — a question
a decision record cannot answer on its own, because it names its signers only by
number.

#### Parameters

| Parameter | Type | Required | Constraints |
|---|---|---|---|
| `signerId` | string | yes | digits only |

#### Returns

```jsonc
{
  "id": "100090423",
  "firstName": "ΧΑΡΑΛΑΜΠΟΣ",
  "lastName": "ΓΙΟΝΤΖΗΣ",
  "name": "ΧΑΡΑΛΑΜΠΟΣ ΓΙΟΝΤΖΗΣ",
  "active": true,
  "activeFrom": "2024-03-01",
  "activeUntil": null,
  "organizationId": "100076956",
  "canSignForOrganization": false,
  "postings": [
    { "unitId": "100076979", "unitLabel": "ΑΝΑΠΤΥΞΙΑΚΟΣ ΟΡΓΑΝΙΣΜΟΣ ΔΗΜΟΥ ΛΑΡΙΣΑΙΩΝ ΜΟΝΟΠΡΟΣΩΠΗ ΑΕ",
      "positionId": "POS_10006", "positionLabel": "Διευθύνων Σύμβουλος", "from": null, "until": null }
  ],
  "organization": { "id": "100076956", "name": "ΑΝΑΠΤΥΞΙΑΚΟΣ ΟΡΓΑΝΙΣΜΟΣ ΔΗΜΟΥ ΛΑΡΙΣΑΙΩΝ …", … }
}
```

`postings` is where the substance is: which post the person holds, in which
unit. `unitLabel` is filled from the body's unit list (a day-long cache shared
with `list_organization_units`); a posting on the body's own uid is labelled
with the body's name. `canSignForOrganization` distinguishes an official who
binds the whole body from one who signs only for their own unit.

**Open-ended dates read as null.** Upstream writes "still serving" as a
year-3000 sentinel (`32503672800481`). Passed through, every serving official
would appear to leave in the year 3000, so anything past 2200 is reported as
`null`.

The uid is also a valid `signerId` filter on `search_decisions`, so this doubles
as the way to check whose acts you are about to list.
`list_organization_signers` goes the other way, from a body to everyone who
signs for it.

---

### `list_positions`

Position titles, for the whole state or for one body.

**In plain terms.** The user is able to decode a `positionId` — `POS_10017`
is *Διοικητής* — and to see which posts a body has. Mostly a lookup: the signer
tools already carry the title beside the code.

#### Parameters

| Parameter | Type | Default | Constraints |
|---|---|---|---|
| `organizationId` | string | — | digits only; omit for every title in the state |
| `query` | string | — | 1–120 chars; a code or part of a title |
| `limit` | integer | `50` | 1–300 |

#### Returns

```jsonc
{
  "organizationId": "99221912", "query": null,
  "total": 5, "returned": 5, "hasMore": false,
  "positions": [
    { "id": "POS_10017", "label": "Διοικητής" },
    { "id": "POS_10024", "label": "Αναπληρωτής Διοικητής" }
  ]
}
```

#### Examples

- `{ "organizationId": "99221912" }` → the five posts at the Kalamata hospital.
- `{ "query": "Διοικητής" }` → three titles across the state: Διοικητής,
  Υποδιοικητής, Αναπληρωτής Διοικητής.
- `{ "query": "POS_10017" }` → the one title behind that code.
- `{}` → all 233 titles, 50 at a time.

#### Cost

Upstream's state-wide list repeats each title once per body that uses it —
25,154 rows for 233 titles, 1.6 MB, ~14 s — and is collapsed and held for a
day. A body's own list is 300 bytes.

---

### `list_thematic_categories`

The controlled vocabulary for `search_decisions.thematicCategory`.

**In plain terms.** The user is able to filter by *subject* — health, transport,
public finance — rather than by the kind of paperwork.

A thematic category says what an act is **about**; a decision type says what
kind of act it **is**. They are independent and combine: `Δ.1` + `10007` is
contract awards in healthcare.

#### Parameters

None.

#### Returns

```jsonc
{
  "total": 25,
  "categories": [
    { "code": "04",    "label": "ΠΟΛΙΤΙΚΗ ΖΩΗ", "parent": null },
    { "code": "10007", "label": "ΥΓΕΙΑ",        "parent": null }
  ]
}
```

25 categories, all flat — `parent` is null on every one today, and is carried
because the dictionary shape allows nesting. Codes are zero-padded strings
(`"04"`, not `4`) and must be sent as strings.

Backed by `dictionaries/THK.json`, one of the 19 vocabularies
`dictionaries.json` indexes; `search_dictionary` reaches the other 18, and shares
this one's cache.

---
### `list_dictionaries`

The 19 controlled vocabularies.

**In plain terms.** The user is able to find out which vocabulary a code they
have been handed belongs to, and what `search_dictionary` can be pointed at.

#### Parameters

None.

#### Returns

```jsonc
{ "total": 19, "dictionaries": [ { "code": "CPV", "label": "Κωδικοί CPV" }, … ] }
```

The full list, with sizes, is under [dictionaries](#dictionaries).

---

### `search_dictionary`

Look up entries in one vocabulary.

**In plain terms.** The user is able to decode a code — *"what is CPV
33600000-6?"* — and to go the other way, from a word to the codes it appears in
— *"which CPV codes mention φάρμακα?"*. For the one nested vocabulary, the
Kallikratis regions and municipalities, `parent` lists a region's
municipalities.

#### Parameters

| Parameter | Type | Default | Constraints |
|---|---|---|---|
| `dictionary` | string | — | a code from `list_dictionaries`, case-insensitive |
| `query` | string | — | 1–120 chars; a code or part of a label |
| `parent` | string | — | only entries filed under this code |
| `limit` | integer | `50` | 1–500 |

Matching folds case and accents like `search_organizations`. Ranking: exact
code, code prefix, exact label, label prefix, label substring, code substring —
so `33600000-6` returns its own entry first, not the codes that merely contain
the digits. With no `query` the vocabulary is returned in upstream's own order,
which for CPV is hierarchical by code.

#### Returns

```jsonc
{
  "dictionary": "ADMIN_STRUCTURE_KALLIKRATIS",
  "label": "Δομή Καλλικρατικών Περιφερειών και Δήμων",
  "query": "θεσσαλονίκης", "parent": null,
  "total": 1, "returned": 1, "hasMore": false,
  "entries": [
    { "code": "0701", "label": "ΔΗΜΟΣ ΘΕΣΣΑΛΟΝΙΚΗΣ", "parent": "112", "parentLabel": "ΠΕΡΙΦΕΡΕΙΑ ΚΕΝΤΡΙΚΗΣ ΜΑΚΕΔΟΝΙΑΣ" }
  ]
}
```

#### Examples

- `{ "dictionary": "CPV", "query": "33600000-6" }` → one entry, *ΦΑΡΜΑΚΕΥΤΙΚΑ ΠΡΟΙΟΝΤΑ*.
- `{ "dictionary": "CPV", "query": "φάρμακα", "limit": 3 }` → 41 matches, *ΔΙΑΦΟΡΑ ΦΑΡΜΑΚΑ* first.
- `{ "dictionary": "ADMIN_STRUCTURE_KALLIKRATIS", "parent": "111" }` → the 22 municipalities of Eastern Macedonia and Thrace.
- `{ "dictionary": "ORG_CATEGORY" }` → all 22 categories a body can have: `ΝΠΔΔ`, `ΔΕΚΟ`, …
- `{ "dictionary": "NOPE" }` → `not_found`, pointing at `list_dictionaries`.

#### Cost

CPV is 1.2 MB and 10,357 entries, fetched in about half a second and held for
a day; the other 18 are a few kilobytes each. Filtering is local.

---


## Upstream API reference

The `opendata` endpoints this adapter uses. All are unauthenticated GETs
returning JSON.

| Endpoint | Used by | Notes |
|---|---|---|
| `GET /opendata/search/advanced.json?q=` | `search_decisions`, `search_decisions_advanced` | Lucene; page size capped at 500; HTTP 400 on bad syntax |
| `GET /opendata/decisions/{ada}.json` | `get_decision`, `get_decision_history`, `get_decision_text` | 404 on unknown ΑΔΑ; carries attachment metadata |
| `GET /opendata/decisions/{ada}/document` | `get_decision_text` | The signed PDF; **302** to the old site on unknown ΑΔΑ; 406 unless `accept: */*` |
| `GET /opendata/decisions/{ada}/attachments/{id}/document` | linked from `get_decision` | An attached file; `…/attachments/{id}` alone is its metadata |
| `GET /opendata/decisions/{ada}/versionlog.json` | `get_decision_history` | ~250 B; HTML **500** on unknown ΑΔΑ |
| `GET /opendata/organizations/{uid}.json` | issuer resolution (fallback), `get_organization` | ~450 B, ~250 ms; 404 on unknown uid |
| `GET /opendata/organizations.json?status=all` | `search_organizations`, issuer resolution, `warm` | Whole register: 5,838 bodies, 2.7 MB, 17-19 s; only `status` binds |
| `GET /opendata/organizations/{uid}/units.json` | `list_organization_units`, unit labels | Empty list on unknown numeric uid |
| `GET /opendata/organizations/{uid}/signers.json` | `list_organization_signers` | 1.8 KB for a hospital, 41 KB for a ministry; empty list on unknown numeric uid |
| `GET /opendata/units/{uid}.json` | `get_unit` | ~190 B; 404 on unknown uid |
| `GET /opendata/signers/{uid}.json` | `get_signer` | ~370 B; 404 on unknown uid |
| `GET /opendata/positions.json` | `list_positions` | 25,154 rows for 233 titles, 1.6 MB, ~14 s |
| `GET /opendata/organizations/{uid}/positions.json` | `list_positions` | ~300 B; 404 on unknown uid |
| `GET /opendata/types.json` | `list_decision_types`, `get_decision_type` | 43 types, 5.7 KB |
| `GET /opendata/types/{uid}/details.json` | `get_decision_type` | 404 on unknown code; `parent` always null |
| `GET /opendata/dictionaries.json` | `list_dictionaries`, `search_dictionary` | 19 vocabularies, 1.6 KB |
| `GET /opendata/dictionaries/{name}.json` | `list_thematic_categories`, `search_dictionary` | `THK` 1.9 KB … `CPV` 1.2 MB; 404 on unknown name |

### Why `search/advanced.json` and not `search.json`

Both run the same Lucene query and echo it in `info.query`; the simple endpoint
builds it from named parameters (`term`, `subject`, `org`, `unit`, `signer`,
`type`, `tag`, `protocol`, `ada`, `from_issue_date`, `to_issue_date`,
`from_date`, `to_date`, `status`). This adapter used it until 2026-09-01 and
switched for one reason: it writes `to_issue_date` as *midnight* of the day
named, which drops nearly the whole day (gotcha 6). The advanced endpoint takes
the bounds as written, so `T23:59:59` can be spelled out.

Everything else is identical — the 180-day cap, the 500 page clamp, the
newest-first order — and totals for the same window match exactly: 4,145 and
4,145 for `q:"προμήθεια υλικών"` over 1–21 August 2026. The simple endpoint
also adds a `submissionTimestamp` window and a `status:"Αναρτημένη"` clause of
its own; the adapter now writes the status clause itself and omits the
submission window, which changed no total beyond the window's edges.

### Lucene fields

On every act:

| Field | Meaning | `search_decisions` argument |
|---|---|---|
| `q` | whole record, full text | `text` |
| `subject` | subject line | `subject` |
| `ada` | the ΑΔΑ | — (`get_decision`) |
| `protocolNumber` | the body's own reference | `protocolNumber` |
| `organizationUid` | issuing body | `organizationId` |
| `unitUid` | issuing unit | `unitId` |
| `signerUid` | signing official | `signerId` |
| `decisionTypeUid` | type code | `decisionType` |
| `thematicCategoryUid` | thematic category code | `thematicCategory` |
| `issueDate` | signing date; `DT()` range, capped at 180 days | `issuedFrom` / `issuedTo` |
| `publishTimestamp` | publication; `DT()` range, not capped | `publishedFrom` / `publishedTo` |
| `submissionTimestamp` | submission by the body; `DT()` range | — |
| `status` | `Αναρτημένη` / `Ανακληθείσα` | `status` |
| `documentType` | `ΠΡΑΞΗ`, `ΝΟΜΟΣ`, … | — |

Per type — the `searchTerm` of each field in `types/{uid}/details.json`, which
`get_decision_type` returns as `searchField`. The ones that carry a value in
practice:

| Field | Types | Meaning |
|---|---|---|
| `cpv` | Δ.1, Δ.2.1 | CPV code |
| `assignmentType` | Δ.1 | `Έργα` / `Υπηρεσίες` / `Προμήθειες` / `Μελέτες` |
| `textRelatedADA` | Δ.1, Δ.2.1, Δ.2.2, Γ.3.1, Γ.3.2 | ΑΔΑ of the related commitment |
| `textFinancialYear` | Β.1.1, Β.1.2, Β.1.3 | budget year |
| `financialYear` | Β.3 | budget year |
| `textBudgetType` | Β.1.1, Β.1.2, Β.1.3 | budget type |
| `kaeNumber` | Β.4 | budget line |
| `employerOrg` | Γ.3.3, 100 | employing body, as text |
| `numberOfPeople` | Γ.3.3, Γ.3.4 | headcount — an integer range works |
| `eidosPraxis` | 100, Γ.2, Γ.3.1, Γ.3.4, Γ.3.5, Β.3 | sub-kind of act |
| `municipality` | 2.4.6.1 | Kallikratis code |
| `contestProgressType`, `manifestContractType`, `manifestSelectionCriterion`, `orgBudgetCode` | Δ.2.1 | tender attributes |
| `primaryOfficer`, `secondaryOfficer` | Β.1.2 | officers named on a warrant |
| `receiverNoVATOrg` | Β.2.2 | the `skipVatReason` code |

Not indexed at all: every amount (`awardAmount`, `estimatedAmount`,
`amountWithVAT`, `sponsor`), `org`, `person`, `fek`, `relatedDecisions`. A name
that happens to parse but is not a field (`organizationId`, `privateData`)
returns 200 and zero hits; most unknown names are a 400.

### Issuer name resolution

Search results carry only a numeric `organizationId`. Upstream has no bulk
lookup — `organizations.json` returns the **entire 2.7 MB register** whatever
`size` and `page` you pass, and takes long enough to time out a 15 s client.

So the register is held whole (fetched at boot, see the `search_organizations`
cost note) and every issuer on a page is named from it, dissolved bodies
included. Only a uid the register lacks — a body registered since the last
refresh — goes to `organizations/{uid}.json`: ~450 B, ~250 ms, cached for 24
hours. Twenty such lookups run in parallel in ~0.3 s, so even the fallback
costs roughly one round trip.

### Other `opendata` endpoints (not used)

| Endpoint | Size | Why not |
|---|---|---|
| `search.json` | — | Superseded by `search/advanced.json`, above |
| `types/{uid}.json` | 154 B | One type's label and parent — `types.json` has them all, `details.json` has more |
| `decisions/{ada}/attachments.json` | — | The same attachment metadata the record already carries |

---

## Reference data

### Expense bases

`expenses.basis` names what kind of figure the amount is. **They are not
comparable.** The same euro appears at up to four stages of its life, and
summing across bases double-counts it.

| `basis` | Upstream field | Act types | Meaning |
|---|---|---|---|
| `estimate` | `estimatedAmount` | Δ.2.1 | What a tender was expected to cost |
| `award` | `awardAmount` | Δ.1 | What the contract was awarded at |
| `commitment` | `amountWithVAT`, `amountWithKae` | Β.1.3 | Money set aside against a budget line |
| `payment` | `sponsor[].expenseAmount` | Β.2.1, Β.2.2 | Money actually leaving the account |

`totals` is summed **per currency** rather than into a single number — acts
occasionally mix currencies, and adding them would produce a total that is
confidently wrong. `items[].kae` is the budget line (Κωδικός Αριθμός Εξόδου)
the amount is charged to, where the act declares one.

Acts with no financial content return `expenses: null`.

### Decision types

35 assignable types in 8 groups. Grouping codes (`2.4.*`) are returned only with
`includeGroups: true` and are **not** valid `decisionType` filters.

| Code | Label |
|---|---|
| `Α.1.1` | ΝΟΜΟΣ |
| `Α.1.2` | ΠΡΑΞΗ ΝΟΜΟΘΕΤΙΚΟΥ ΠΕΡΙΕΧΟΜΕΝΟΥ |
| `Α.2` | ΚΑΝΟΝΙΣΤΙΚΗ ΠΡΑΞΗ |
| `Α.3` | ΕΓΚΥΚΛΙΟΣ |
| `Α.4` | ΓΝΩΜΟΔΟΤΗΣΗ |
| `Α.5` | ΠΡΑΚΤΙΚΑ (Νομικού Συμβουλίου του Κράτους) |
| `Α.6` | ΕΚΘΕΣΗ ΑΠΟΤΙΜΗΣΗΣ ΝΟΜΟΘΕΣΙΑΣ |
| `Α.7` | ΕΚΘΕΣΗ ΚΕΝΤΡΙΚΗΣ ΕΠΙΤΡΟΠΗΣ ΚΩΔΙΚΟΠΟΙΗΣΗΣ |
| `Β.1.1` | ΕΓΚΡΙΣΗ ΠΡΟΥΠΟΛΟΓΙΣΜΟΥ |
| `Β.1.2` | ΕΠΙΤΡΟΠΙΚΟ ΕΝΤΑΛΜΑ |
| `Β.1.3` | ΑΝΑΛΗΨΗ ΥΠΟΧΡΕΩΣΗΣ |
| `Β.2.1` | ΕΓΚΡΙΣΗ ΔΑΠΑΝΗΣ |
| `Β.2.2` | ΟΡΙΣΤΙΚΟΠΟΙΗΣΗ ΠΛΗΡΩΜΗΣ |
| `Β.3` | ΙΣΟΛΟΓΙΣΜΟΣ – ΑΠΟΛΟΓΙΣΜΟΣ |
| `Β.4` | ΔΩΡΕΑ - ΕΠΙΧΟΡΗΓΗΣΗ |
| `Β.5` | ΠΑΡΑΧΩΡΗΣΗ ΧΡΗΣΗΣ ΠΕΡΙΟΥΣΙΑΚΩΝ ΣΤΟΙΧΕΙΩΝ |
| `Β.6` | ΠΡΟΓΡΑΜΜΑΤΙΚΗ ΣΥΜΦΩΝΙΑ ΟΙΚΟΝΟΜΙΚΗΣ ΥΠΟΣΤΗΡΙΞΗΣ |
| `Γ.2` | ΠΡΑΞΗ ΣΥΛΛΟΓΙΚΟΥ ΟΡΓΑΝΟΥ / ΕΠΙΤΡΟΠΗΣ |
| `Γ.3.1` | ΠΡΟΚΗΡΥΞΗ ΠΛΗΡΩΣΗΣ ΘΕΣΕΩΝ |
| `Γ.3.2` | ΠΙΝΑΚΕΣ ΕΠΙΤΥΧΟΝΤΩΝ, ΔΙΟΡΙΣΤΕΩΝ & ΕΠΙΛΑΧΟΝΤΩΝ |
| `Γ.3.3` | ΔΙΟΡΙΣΜΟΣ |
| `Γ.3.4` | ΣΥΜΒΑΣΗ |
| `Γ.3.5` | ΥΠΗΡΕΣΙΑΚΗ ΜΕΤΑΒΟΛΗ |
| `Γ.3.6` | ΑΘΩΩΤΙΚΗ ΠΕΙΘΑΡΧΙΚΗ ΑΠΟΦΑΣΗ |
| `Δ.1` | ΑΝΑΘΕΣΗ ΕΡΓΩΝ / ΠΡΟΜΗΘΕΙΩΝ / ΥΠΗΡΕΣΙΩΝ / ΜΕΛΕΤΩΝ |
| `Δ.2.1` | ΠΕΡΙΛΗΨΗ ΔΙΑΚΗΡΥΞΗΣ / ΔΙΑΚΗΡΥΞΗ |
| `Δ.2.2` | ΚΑΤΑΚΥΡΩΣΗ |
| `Ε.1` | ΠΡΑΞΗ ΥΠΑΓΩΓΗΣ ΕΠΕΝΔΥΣΕΩΝ |
| `Ε.2` | ΣΥΜΒΑΣΗ-ΠΡΑΞΕΙΣ ΑΝΑΠΤΥΞΙΑΚΩΝ ΝΟΜΩΝ |
| `Ε.3` | ΑΠΟΦΑΣΗ ΕΝΑΡΞΗΣ ΠΑΡΑΓΩΓΙΚΗΣ ΛΕΙΤΟΥΡΓΙΑΣ ΕΠΕΝΔΥΣΗΣ |
| `Ε.4` | ΑΛΛΗ ΠΡΑΞΗ ΑΝΑΠΤΥΞΙΑΚΟΥ ΝΟΜΟΥ |
| `Ζ.1` | ΔΗΜΟΣΙΑ ΠΡΟΤΥΠΑ ΕΓΓΡΑΦΑ |
| `100` | ΠΡΑΞΗ ΘΕΣΗΣ ΓΕΝΙΚΟΥ/ΕΙΔΙΚΟΥ ΓΡΑΜΜΑΤΕΑ |
| `2.4.6.1` | ΠΡΑΞΕΙΣ ΧΩΡΟΤΑΞΙΚΟΥ - ΠΟΛΕΟΔΟΜΙΚΟΥ ΠΕΡΙΕΧΟΜΕΝΟΥ |
| `2.4.7.1` | ΛΟΙΠΕΣ ΑΤΟΜΙΚΕΣ ΔΙΟΙΚΗΤΙΚΕΣ ΠΡΑΞΕΙΣ |

### Organization categories

`organization.category` uses upstream's own taxonomy. Values seen in practice
include `MINISTRY`, `NPDD` (public-law legal entity), `MUNICIPALITY`, `OTA1` /
`OTA2` (local government tiers 1 and 2), `INDEPENDENT_AUTHORITY` and
`OTHERTYPE`. All 22, with labels: `search_dictionary` with `ORG_CATEGORY`.

### Status values

| In a record | In a Lucene clause | Meaning |
|---|---|---|
| `PUBLISHED` | `status:"Αναρτημένη"` | In force. `search_decisions` asks for this by default |
| `REVOKED` | `status:"Ανακληθείσα"` | Withdrawn by its issuer. `status: "revoked"` |
| `PENDING_REVOCATION` | — | Seen only in the version log, between the two |

### Dictionaries

The 19 vocabularies `dictionaries.json` indexes, as `search_dictionary` reaches
them. Entry counts measured 2026-09-01.

| Code | Label | Entries |
|---|---|---|
| `ADMIN_STRUCTURE_KALLIKRATIS` | Δομή Καλλικρατικών Περιφερειών και Δήμων | 340 — 14 top-level regions, 326 municipalities under them |
| `CPV` | Κωδικοί CPV | 10,357 |
| `CURRENCY` | Currencies available | 124 |
| `EE_MEMBER` | Κράτος - μέλος της ΕΕ | 28 |
| `FA` | Ενέργειες διαχείρισης των επισημάνσεων | 2 |
| `FE` | Λόγοι επισήμανσης | 4 |
| `FEKTYPES` | Τύποι τευχών ΦΕΚ | 15 |
| `KANONISTIKI_PRAXI_TYPE` | Τύποι Κανονιστικών Πράξεων | 20 |
| `LAW_EXCEPTION` | Εξαίρεση σύμφωνα με το άρθρο 5 του νόμου 3861/2010 | 6 |
| `NO_VAT_ORGS` | Οργανισμοί χωρίς ΑΦΜ | 54 |
| `ORG_CATEGORY` | Κατηγορίες οργανισμών | 22 |
| `ORG_DOMAIN` | Πεδία αρμοδιότητος φορέων | 176 |
| `ORG_UNIT_CATEGORY` | Τύποι Οργανωτικών μονάδων | 25 |
| `PUBLIC_DOC_TYPES` | Τύποι δημόσιων πρότυπων εγγράφων | 3 |
| `REVOCATION_REASON` | Αιτιολογία Ανάκλησης Πράξεων | 3 |
| `SKIP_VAT_REASON` | Αιτίες παράλειψης της καταχώρησης πολλαπλών ΑΦΜ | 3 |
| `THK` | Τύπος Θεματικής Κατηγορίας | 25 — also `list_thematic_categories` |
| `VAT_TYPE` | Τύποι ΑΦΜ | 5 |
| `XOROTAXIKI_PRAXI_TYPE` | Τύποι Πράξεων Χωροταξικού - Πολεοδομικού Περιεχομένου | 17 |

Only `ADMIN_STRUCTURE_KALLIKRATIS` nests; `parent` is null everywhere else.

---

## Caching

Configured in `src/meta.ts` and applied by `apps/server/src/mcp.ts`.

| Key | TTL | Why |
|---|---|---|
| `default` | 300 s | ~12,000 acts land daily; five minutes keeps "what was posted today" honest. Applies to `search_decisions`, `search_decisions_advanced`, `get_decision_history` |
| `get_decision` | 3,600 s | An act changes only when corrected or revoked, which is rare and never urgent; `get_decision_history` is the fresh view |
| `get_decision_text` | 3,600 s | The PDF is immutable for a version; the extracted text of the whole document is one entry, so paging is free |
| `list_decision_types`, `get_decision_type` | 86,400 s | The vocabulary changes when the law does |
| `list_thematic_categories`, `list_dictionaries`, `search_dictionary` | 86,400 s | Same — controlled vocabularies. THK is one cache entry however it is reached |
| `search_organizations` | 86,400 s, held 7 days | The register is fetched at boot by `warm`, served stale past a day while one background refresh replaces it, and never simply expires — `loadRegister` in `client.ts`. Issuer resolution reads the same copy |
| `list_positions` | 86,400 s | The state-wide list is 1.6 MB and ~14 s; the per-body one is trivial |
| `get_organization` | 86,400 s | Bodies are renamed and merged over months, not minutes |
| `list_organization_units`, `get_unit` | 86,400 s | Same. One body's unit list is one entry, shared with the signer tools for labels |
| `list_organization_signers`, `get_signer` | 86,400 s | Officials change post on the order of years |
| *(organizations)* | 86,400 s | Not a tool TTL — set in `client.ts` as `ORGANIZATION_TTL_SECONDS` |

Cache keys are namespaced per tool and hashed over the full argument object with
sorted keys, so argument order does not fragment the cache. `withCache` also
deduplicates concurrent misses on the same key, so a burst of identical
questions becomes one upstream request.

---

## Errors

Tool errors are returned as MCP results with `isError: true`, not as JSON-RPC
faults, so the model sees the message and can correct its own arguments.

| Condition | Error | Message |
|---|---|---|
| Unknown ΑΔΑ (`get_decision`, `get_decision_history`) | `not_found` | `No decision published under ΑΔΑ "…". Check the code, or search for the act instead.` |
| Unknown organization uid (any body tool) | `not_found` | `No public body is registered under uid "…". Search for it by name with search_organizations.` |
| Unknown unit uid | `not_found` | `No unit is registered under uid "…". Unit uids come from unitIds on a decision or from list_organization_units.` |
| Unknown signer uid | `not_found` | `No signer is registered under uid "…". Signer uids come from the signerIds on a decision.` |
| Unknown decision type code | `not_found` | `No decision type has the code "…". Call list_decision_types for the valid codes.` |
| Unknown dictionary | `not_found` | `No dictionary named "…". Call list_dictionaries for the valid names.` |
| Malformed Lucene query | `invalid_input` | `Διαύγεια rejected the query: Syntax error at input position (line 1, pos N): …` — not retried |
| PDF over 30 MB, by its declared length or counted as it arrives | `upstream_error` (413) | `The PDF for ΑΔΑ "…" is N MB — too large to read here. It can be downloaded from …` (`is over 30 MB` when no length was declared) |
| No PDF behind a known ΑΔΑ | `not_found` | `No PDF is published for ΑΔΑ "…".` |
| `fromPage` past the last page | `invalid_input` | `fromPage (30) is past the last page: the PDF has 19.` |
| Scanned PDF, no text layer | *(not an error)* | Empty pages and a `note` saying so |
| Non-numeric uid | schema | Rejected before any request is made |
| `query` under 2 chars | schema | `Too small: expected string to have >=2 characters` |
| No organization or dictionary matches | *(not an error)* | `total: 0` and an empty list |
| Malformed ΑΔΑ | schema | Rejected before any request is made |
| Bad date format | schema | `Use YYYY-MM-DD.` |
| `issuedFrom` > `issuedTo`, `publishedFrom` > `publishedTo` | `invalid_input` | `issuedFrom (…) is after issuedTo (…).` |
| `size` > 100 | schema | `Too big: expected number to be <=100` |
| Upstream 5xx | `upstream_error` | Retried twice with jittered backoff first |
| Upstream slow | `upstream_timeout` | 20 s per attempt; 60 s for the register and the dictionaries; the whole call stopped at the server's `TOOL_TIMEOUT_MS` (60 s), PDF reading included |

An organization lookup that fails is **not** an error: `organization.name` comes
back `null` and the search succeeds.

---

## Verification

Every claim above was checked against the live API — on **2026-08-29** at
first, and on **2026-09-01** for the switch to `search/advanced.json`, the nine
tools added that day, the date-bound and timezone fixes, the register warm-up,
and every number cited in the examples. None of it is taken from documentation; upstream publishes
none for the parts that matter.

To re-verify after an upstream change, the useful trick is that `info.query`
echoes the Lucene query actually executed — write a clause and see whether it
comes back, and whether the window came back as you wrote it:

```bash
curl -s 'https://diavgeia.gov.gr/opendata/search/advanced.json' \
  --data-urlencode 'q=subject:"προμήθεια" AND issueDate:[DT(2025-01-01T00:00:00) TO DT(2025-12-31T23:59:59)]' \
  --data-urlencode 'size=1' -G \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["info"]["query"])'
```

The echoed `issueDate` range ends on 2025-06-30, not 2025-12-31: that is the cap.
