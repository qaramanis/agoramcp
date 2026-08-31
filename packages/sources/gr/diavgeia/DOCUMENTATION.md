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
| **Tools** | `search_decisions`, `get_decision`, `list_decision_types`, `search_organizations`, `get_organization`, `list_organization_units`, `get_signer`, `list_thematic_categories` |

Attribution is a licence condition, not a courtesy. `apps/server/src/mcp.ts`
sends it once per session in the MCP `instructions` block, so any client that
reads instructions already has it.

---

## Contents

- [What this answers](#what-this-answers)
- [Read this first](#read-this-first)
- [Tools](#tools)
  - [`search_decisions`](#search_decisions)
  - [`get_decision`](#get_decision)
  - [`list_decision_types`](#list_decision_types)
  - [`search_organizations`](#search_organizations)
  - [`get_organization`](#get_organization)
  - [`list_organization_units`](#list_organization_units)
  - [`get_signer`](#get_signer)
  - [`list_thematic_categories`](#list_thematic_categories)
- [Upstream API reference](#upstream-api-reference)
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
| List everything a public body decided in a period | the body's id and a date range | `search_decisions` |
| Find decisions about a topic | a Greek word likely to appear in the subject | `search_decisions` |
| See only contract awards, appointments or payments | which kind of act they mean | `list_decision_types`, then `search_decisions` |
| Find who supplied or was paid for something | a topic or a body, plus a date range | `search_decisions` (read `counterparty`) |
| Get the signed original of a decision | its ΑΔΑ, or a search that finds it | either tool (follow `documentUrl`) |
| Turn a body's **name** into the id every filter needs | the name, however they spell it | `search_organizations` |
| Look a public body up in the register | its numeric id | `get_organization` |
| Narrow a search to one office inside a ministry | the body's id | `list_organization_units`, then `search_decisions` |
| Find out **who signed** an act | the `signerIds` on a decision | `get_signer` |
| Filter by subject area rather than act type | which topic they mean | `list_thematic_categories`, then `search_decisions` |

Some questions this genuinely answers, phrased as a person would ask them:

- *"What did the General Hospital of Kalamata decide last year?"* — the user
  supplies the hospital's id and the year, and gets back all 3,722 acts it
  published in 2025, 100 per page, newest first.
- *"Which contracts did the government award this year, and for how much?"* —
  the user supplies the award type code `Δ.1` and a start date, and gets back
  146,121 awards, each with the amount it was awarded at.
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
acts that share an [expense basis](#expense-bases).

---

## Read this first

Five upstream behaviours will produce silently wrong answers if you do not know
about them. All five were confirmed by probing the live API on 2026-08-29.

### 1. A search covers at most six months of issue dates — always

This is a hard cap, not just a default, and it is the single easiest way to get
a confidently wrong answer out of this API.

- **No dates given** → the last six months are searched, not the register.
- **A range longer than six months** → upstream silently truncates it to the
  first six months from `issuedFrom` and returns a `total` for that half only.
  `issuedTo` is discarded without a word.
- **A range of six months or less** → honoured exactly.

Measured on 2026-08-31, asking for all of 2025 from one hospital:

```
requested  issuedFrom=2025-01-01  issuedTo=2025-12-31
executed   issueDate:[DT(2025-01-01...) TO DT(2025-06-30...)]   total: 3722
```

That 3,722 is January to June, and nothing in the raw response says so — it
looks exactly like a complete answer for the year.

`search_decisions` therefore reads the window back out of the Lucene query
upstream echoes and reports **that** as `coverage.issuedFrom` / `coverage.issuedTo`,
keeping what was asked for alongside as `requestedFrom` / `requestedTo` and
adding a `coverage.note` whenever the two differ. To cover a longer period,
issue consecutive six-month searches and sum them yourself.

### 2. `q=` is accepted and then ignored

The obvious parameter name does nothing. Upstream returns HTTP 200, the same
result count, and a Lucene query with no text clause in it. The two parameters
that actually bind are `term` (whole record) and `subject` (subject line only),
exposed here as `text` and `subject`. Every response echoes the executed Lucene
query in `upstreamQuery`, which is how to tell a filter apart from a typo.

### 3. Unknown parameters fail silently

Upstream ignores anything it does not recognise and answers 200. A misspelled
filter therefore returns a plausible, unfiltered result set. This adapter sends
only parameters it has verified bind, and `upstreamQuery` lets you confirm it.

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

### Two smaller traps

**`url` is not a link you can open.** Upstream's `url` field is its internal
`https://diavgeia.gov.gr/luminapi/api/decisions/{ada}` endpoint. The viewable
page is `https://diavgeia.gov.gr/decision/view/{ada}`, which upstream never
returns. This adapter builds `pageUrl` from the ΑΔΑ and keeps the internal one
as `apiUrl`.

**Status is spelled two ways.** Records carry `status: "PUBLISHED"`, but the
Lucene filter upstream applies uses the Greek `status:"Αναρτημένη"`. They mean
the same thing; do not filter on the value you see in a record.

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

| Parameter | Type | Default | Constraints | Upstream param |
|---|---|---|---|---|
| `text` | string | — | 1–200 chars | `term` |
| `subject` | string | — | 1–200 chars | `subject` |
| `organizationId` | string | — | non-empty | `org` |
| `unitId` | string | — | non-empty | `unit` |
| `signerId` | string | — | non-empty | `signer` |
| `decisionType` | string | — | non-empty | `type` |
| `thematicCategory` | string | — | non-empty | `tag` |
| `issuedFrom` | string | — | `YYYY-MM-DD` | `from_issue_date` |
| `issuedTo` | string | — | `YYYY-MM-DD` | `to_issue_date` |
| `includeRevoked` | boolean | `false` | — | `status=all` |
| `page` | integer | `0` | ≥ 0 | `page` |
| `size` | integer | `20` | 1–100 | `size` |

**`text` vs `subject`.** `text` searches the whole indexed record; `subject`
matches only the act's subject line. For the same term, `text` returned
1,001,755 hits where `subject` returned 348,812 — use `subject` when you want
precision and `text` when you want recall.

**Dates** filter on the *issue* date (when the act was signed), not the
publication date. Both bounds are inclusive. `issuedFrom` after `issuedTo` is
rejected before any request is made.

**`includeRevoked`** defaults to false, which returns only acts currently in
force. Setting it true adds revoked and superseded acts (≈470 more across the
whole register at the time of writing).

**`size`** is capped at 100 here. Upstream accepts up to 500 and silently
clamps anything larger, but a 500-act page is not a useful model payload.

#### Returns

```jsonc
{
  "total": 12090,          // matches across the whole query, not this page
  "page": 0,
  "size": 3,
  "returned": 3,
  "hasMore": true,
  "coverage": {
    "issuedFrom": "2026-08-01",
    "issuedTo": "2026-08-10"
    // "note" appears only when both dates were omitted — see gotcha 1
  },
  "upstreamQuery": "subject:\"προμήθεια\" AND submissionTimestamp:[...] AND ...",
  "decisions": [ /* DecisionSummary */ ]
}
```

A `DecisionSummary`:

```jsonc
{
  "ada": "9ΓΓ346ΝΨ2Ν-Β5Τ",
  "subject": "Μισθοδοσία μηνός Αυγούστου 2026",
  "protocolNumber": "16Μ-2026",
  "issuedOn": "2026-08-03",              // YYYY-MM-DD
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

**What comes back:** 12,090 matching acts, of which the first 3 are returned and
`hasMore` is true. The first is a board resolution from the General Hospital of
Kalamata approving an off-contract purchase; the second is a €122.59 commitment
by the Lesvos Chamber of Commerce for local soap and olive oil.

Note that the first result carries **no amount**. Matching on a subject word
returns approving, authorising and reporting acts alongside the financial ones,
and only the financial ones declare money. If the user wants amounts on every
row, filter by a financial `decisionType` instead — example 3.

---

**2. "Show me everything the General Hospital of Kalamata published last year."**

The user is able to retrieve a body's complete output for a period when given
that body's numeric id and two dates. The id comes from `organization.id` on any
earlier result — there is no search-by-name, so the usual route is one topic
search to find the body, then this to enumerate it.

```json
{ "organizationId": "99221912", "issuedFrom": "2025-01-01", "issuedTo": "2025-12-31", "size": 100, "page": 0 }
```

**What comes back:** 3,722 acts and the first 100 of them, newest first — but
for **January to June 2025 only**. The requested year is longer than the
six-month cap, so `coverage` reports the truncated window and carries a note
saying so. Covering the whole year means a second call for `2025-07-01` to
`2025-12-31`. Every row names the hospital as `organization`, because the filter
is on the issuer.

---

**3. "Which contracts were awarded this year, and for how much?"**

The user is able to retrieve one specific kind of act, with its amount attached,
when given the type code for that kind. `Δ.1` is *ΑΝΑΘΕΣΗ ΕΡΓΩΝ / ΠΡΟΜΗΘΕΙΩΝ /
ΥΠΗΡΕΣΙΩΝ / ΜΕΛΕΤΩΝ* — the act that awards a contract. Codes come from
`list_decision_types`; see also [decision types](#decision-types).

```json
{ "decisionType": "Δ.1", "issuedFrom": "2026-01-01", "size": 3 }
```

**What comes back:** 146,121 awards — for January to June 2026, not the whole
year to date, because of the six-month cap. Because every act of this
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

**What comes back:** 5,095 appointments this year — a fixed-term recruitment
notice from the Greek agricultural insurance organisation, a nursing appointment
at the Papanikolaou hospital in Thessaloniki. These are non-financial acts, so
`expenses` is null on every row; the substance is in the subject and the PDF.

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
see [gotcha 1](#1-searches-default-to-the-last-six-months).

#### What it cannot do

- **No full-text search inside the PDFs.** Only act metadata is indexed. A
  supplier named in the body of a contract but not in the subject line is not
  findable this way.
- **No aggregation.** There is no "total spend by ministry" — that means paging
  through results and summing client-side, respecting `expenses.basis`.
- **No sorting.** Results are always newest-first. Upstream accepts a `sort`
  parameter but rejects every value except `recent` with an HTTP 500
  (`SEARCH-003 / IndexReadException`), so the adapter does not expose it.

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
published, and names an earlier version when this act supersedes one. `redacted`
tells the user whether the body withheld content for privacy reasons, which
explains an act that looks emptier than expected.

**"That code doesn't work."**

Two different failures, distinguished deliberately. A code of the wrong *shape*
(`not-an-ada`) is rejected by the schema before any network request. A
well-formed code that no act carries returns `No decision published under ΑΔΑ
"…". Check the code, or search for the act instead.` — the second is worth
retrying with a corrected code, the first is not.

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
      "supervisorName": "ΠΕΡΙΦΕΡΕΙΑ ΑΤΤΙΚΗΣ"
    }
  ]
}
```

No match is an empty list, not an error — a name that is not in the register is
an answer.

#### Cost

Upstream has **no name search**: `organizations.json` ignores every filter
parameter and returns the entire 2.5 MB register regardless. Searching by name
therefore means holding the register and matching locally. That is only
tolerable because it is cached for a day — the first caller waits 17–19 s,
everyone after pays nothing. The timeout is raised to 60 s for this one call,
since 17–19 s sits inside the shared 20 s budget by luck rather than margin.

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
itself return.

**Dissolved units are excluded by default** but remain worth asking for: they
still appear as the signing unit on the older acts they issued, so a search
covering 2015 may well need one.

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
    { "unitId": "100076979", "positionId": "POS_10006",
      "positionLabel": "Διευθύνων Σύμβουλος", "from": null, "until": null }
  ],
  "organization": { "id": "100076956", "name": "ΑΝΑΠΤΥΞΙΑΚΟΣ ΟΡΓΑΝΙΣΜΟΣ ΔΗΜΟΥ ΛΑΡΙΣΑΙΩΝ …", … }
}
```

`postings` is where the substance is: which post the person holds, in which
unit. `canSignForOrganization` distinguishes an official who binds the whole
body from one who signs only for their own unit.

**Open-ended dates read as null.** Upstream writes "still serving" as a
year-3000 sentinel (`32503672800481`). Passed through, every serving official
would appear to leave in the year 3000, so anything past 2200 is reported as
`null`.

The uid is also a valid `signerId` filter on `search_decisions`, so this doubles
as the way to check whose acts you are about to list.

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
`dictionaries.json` indexes. The client's `fetchDictionary` is generic, so the
other 18 — `ORG_CATEGORY`, `CPV`, `FEKTYPES` — cost only a tool definition each
should they be wanted.

---

## Upstream API reference

The four `opendata` endpoints this adapter uses. All are unauthenticated GETs
returning JSON.

| Endpoint | Used by | Notes |
|---|---|---|
| `GET /opendata/search.json` | `search_decisions` | Page size capped at 500 |
| `GET /opendata/decisions/{ada}.json` | `get_decision` | 404 on unknown ΑΔΑ |
| `GET /opendata/organizations/{uid}.json` | issuer resolution | ~450 B, ~250 ms |
| `GET /opendata/types.json` | `list_decision_types` | 43 types, 5.7 KB |
| `GET /opendata/organizations.json` | `search_organizations` | Whole register: 5,421 bodies, 2.5 MB, 17-19 s |
| `GET /opendata/organizations/{uid}/units.json` | `list_organization_units` | 404 on unknown uid |
| `GET /opendata/signers/{uid}.json` | `get_signer` | ~370 B; 404 on unknown uid |
| `GET /opendata/dictionaries/{name}.json` | `list_thematic_categories` | `THK`; ~1.9 KB |

### Parameter translation

Tool argument → upstream parameter → the Lucene field it becomes:

| Tool argument | Upstream | Lucene field |
|---|---|---|
| `text` | `term` | `q` |
| `subject` | `subject` | `subject` |
| `organizationId` | `org` | `organizationUid` |
| `unitId` | `unit` | `unitUid` |
| `signerId` | `signer` | `signerUid` |
| `decisionType` | `type` | `decisionTypeUid` |
| `thematicCategory` | `tag` | `thematicCategoryUid` |
| `issuedFrom` / `issuedTo` | `from_issue_date` / `to_issue_date` | `issueDate` |
| `includeRevoked: true` | `status=all` | *(status clause removed)* |

Verified non-binding (accepted, HTTP 200, no effect): `q`, `query`, `text`,
`afm`, `sort` (any value but `recent`), and any unrecognised name.

### Issuer name resolution

Search results carry only a numeric `organizationId`. Upstream has no bulk
lookup — `organizations.json` returns the **entire 2.5 MB register** whatever
`size` and `page` you pass, and takes long enough to time out a 15 s client.

So this adapter resolves per-uid instead: `organizations/{uid}.json` is ~450 B
and ~250 ms, deduplicated within a page, issued in parallel, and cached for 24
hours. Twenty parallel lookups complete in ~0.3 s, so a cold page costs roughly
one extra round trip and a warm one costs nothing.

### Other `opendata` endpoints (not used)

| Endpoint | Size | Why not |
|---|---|---|
| `positions.json` | 1.6 MB | Every position title in the state; the per-body form under `organizations/{uid}/positions.json` is 329 B |
| `dictionaries/CPV.json` | 1.2 MB | EU procurement vocabulary; too big to return whole, and no search over it |
| `dictionaries.json` | 1.6 KB | Index of the 19 vocabularies. `THK` is exposed; the rest are one tool definition each |

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
include `MINISTRY`, `NPDD` (public-law legal entity), `OTA1` / `OTA2` (local
government tiers 1 and 2), `INDEPENDENT_AUTHORITY` and `OTHERTYPE`.

---

## Caching

Configured in `src/meta.ts` and applied by `apps/server/src/mcp.ts`.

| Key | TTL | Why |
|---|---|---|
| `default` | 300 s | ~12,000 acts land daily; five minutes keeps "what was posted today" honest |
| `get_decision` | 3,600 s | A published act is immutable — a correction arrives as a new ΑΔΑ |
| `list_decision_types` | 86,400 s | The vocabulary changes when the law does |
| `list_thematic_categories` | 86,400 s | Same — a controlled vocabulary |
| `search_organizations` | 86,400 s | Also keeps the 2.5 MB register fetch to ~once a day |
| `get_organization` | 86,400 s | Bodies are renamed and merged over months, not minutes |
| `list_organization_units` | 86,400 s | Same |
| `get_signer` | 86,400 s | Officials change post on the order of years |
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
| Unknown ΑΔΑ | `not_found` | `No decision published under ΑΔΑ "…". Check the code, or search for the act instead.` |
| Unknown organization uid | `not_found` | `No public body is registered under uid "…". Search for it by name with search_organizations.` |
| Unknown signer uid | `not_found` | `No signer is registered under uid "…". Signer uids come from the signerIds on a decision.` |
| Non-numeric uid | schema | Rejected before any request is made |
| `query` under 2 chars | schema | `Too small: expected string to have >=2 characters` |
| No organization matches | *(not an error)* | `total: 0` and an empty list |
| Malformed ΑΔΑ | schema | Rejected before any request is made |
| Bad date format | schema | `Use YYYY-MM-DD.` |
| `issuedFrom` > `issuedTo` | handler | `issuedFrom (…) is after issuedTo (…).` |
| `size` > 100 | schema | `Too big: expected number to be <=100` |
| Upstream 5xx | `upstream_error` | Retried twice with jittered backoff first |
| Upstream slow | `upstream_timeout` | 20 s per attempt |

An organization lookup that fails is **not** an error: `organization.name` comes
back `null` and the search succeeds.

---

## Verification

Every claim above was checked against the live API on **2026-08-29**, and the
register tools, the six-month cap and the corrected example totals re-checked on
**2026-08-31** — not taken from documentation. To re-verify after an upstream change, the useful trick is
that `info.query` echoes the Lucene query actually executed — add a parameter
and see whether a clause appears:

```bash
curl -s 'https://diavgeia.gov.gr/opendata/search.json?size=1&subject=προμήθεια' \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["info"]["query"])'
```

If the clause is missing, the parameter did not bind — regardless of the 200.
