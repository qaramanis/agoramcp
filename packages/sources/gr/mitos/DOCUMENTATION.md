# `gr/mitos` — ΜΗΤΟΣ

MCP adapter over the **Εθνικό Μητρώο Διοικητικών Διαδικασιών «Μίτος»**, the
National Registry of Administrative Procedures: the state's own catalogue of
everything a person or a business can ask it for, and how. Each procedure is
one record — what it is, who owns and provides it, the documents it needs, its
cost, the steps in person and online, the deadlines, and the law behind it.
The services on gov.gr are these records; Μίτος is the register they are drawn
from.

**4,387 procedures** are published (1 Sep 2026), owned by 39 bodies, filed
under 122 life events and addressed to 189 audiences. The register is edited
continuously: 2,390 records changed in August 2026 alone.

| | |
|---|---|
| **Mount point** | `POST /gr/mcp/mitos` |
| **Upstream** | `https://api.digigov.grnet.gr/v1/` (the public API) and `https://mitos.gov.gr/api.php` (the registry's own MediaWiki) |
| **Authentication** | None today. The API's own page says a key will be required in a later phase; nothing here needs `requiresEnv` yet. |
| **Licence** | CC-BY-SA-4.0 |
| **Attribution** | Εθνικό Μητρώο Διοικητικών Διαδικασιών «Μίτος» (mitos.gov.gr) |
| **Coverage** | Every procedure published in the registry's `ΔΔ` namespace. Drafts are not public data and are not served. |
| **Tools** | 7 — `search_procedures`, `get_procedure`, `list_life_events`, `list_audiences`, `list_recent_procedures`, `search_organizations`, `get_organization` |
| **Country index** | [`docs/gr-documentation.md`](../../../../docs/gr-documentation.md) — every Greek tool, one line each |

Attribution is a licence condition, not a courtesy, and this licence is
*share-alike*: a work that redistributes the registry's content is expected to
carry the same licence. `apps/server/src/mcp.ts` sends the attribution once per
session in the MCP `instructions` block, so any client that reads instructions
already has it.

---

## Contents

- [What this answers](#what-this-answers)
- [Read this first](#read-this-first)
- [Tools](#tools)
  - [`search_procedures`](#search_procedures)
  - [`get_procedure`](#get_procedure)
  - [`list_life_events`](#list_life_events)
  - [`list_audiences`](#list_audiences)
  - [`list_recent_procedures`](#list_recent_procedures)
  - [`search_organizations`](#search_organizations)
  - [`get_organization`](#get_organization)
- [Upstream API reference](#upstream-api-reference)
- [Reference data](#reference-data)
- [Caching](#caching)
- [Errors](#errors)
- [Verification](#verification)

---

## What this answers

In one sentence: **a user can find out how to get anything from the Greek
state — what to bring, where to go, what it costs, how long it takes and which
law says so — given nothing but a description of what they need.**

| The user wants to… | …when they know… | …via |
|---|---|---|
| Find the procedure for a need | words for it: "birth certificate", "open a café", "driving licence" | `search_procedures` |
| See every procedure of one kind | a life event, an audience, or the body that owns them | `search_procedures` with `lifeEvent`, `audience` or `organizationId` |
| Know what to bring, where to go, what it costs, how long it takes | the procedure's id | `get_procedure` |
| Do it online rather than in person | the procedure's id — `digitalSteps`, `servicePoints.digital`, `govgr` | `get_procedure` |
| Cite the law behind a procedure | the procedure's id — `legalBasis` | `get_procedure` |
| Name a life event or audience exactly | part of the name | `list_life_events`, `list_audiences` |
| See what the registry changed recently | a date | `list_recent_procedures` |
| Identify the body behind a procedure, or find its contact details | its name, VAT number or id | `search_organizations`, `get_organization` |

Everything is Greek text as the registry's editors wrote it. Roughly one
procedure in seven also carries an English title.

---

## Read this first

Six things about the upstream that shape every tool here.

### 1. The public API has no search — the registry's wiki does the searching

`GET /v1/services` accepts `search`, `q` and `title` and **ignores all three**;
the response is the same page of the same list whatever you pass. The API is
a list and a record fetch, nothing more.

Μίτος itself is a Semantic MediaWiki, and its `api.php` is open. Two of its
actions are used here: `list=search`, a full-text search over the published
procedures — titles, descriptions, document lists, step text — and `ask`, a
query over the semantic properties every record carries (life events,
audiences, owner). Neither is documented as part of the "API", but both are
what the site's own search box and category pages run on.

`search_procedures` therefore does three things and joins them: matches the
query against the titles it holds, asks the wiki's full-text search for the
rest, and applies any facet filter from the semantic index. A hit from the
wiki is joined to the API's list **by title**, which held for 70 of 70 hits in
testing; a page whose title the list spells differently is dropped and counted
in `fullText.unmatched`.

### 2. A full record costs upstream seconds the first time

`GET /v1/services/{id}` answers in about 0.1 s but writes bare ids where a
reader needs names — document types as `3070`, the owner as `46278`.
`GET /v1/services-extended/{id}` fills every one of them in and is what
`get_procedure` reads. Upstream assembles it on demand: **2.6–8 s measured on
first fetch, up to 13 s seen**, then 0.1 s for as long as its own cache holds
the record. The adapter caches the result for six hours, so the wait is paid
once per procedure per instance.

### 3. Facets are swept, held, and refreshed behind the caller

Life events, audiences and owners are not on the API's list. They are read
from the wiki's semantic index with one `ask` query over the `ΔΔ` namespace,
500 rows at a time — nine pages, three in flight, about 3.5 s in all. The page
size matters: 500 rows come back in 0.9 s, 1,000 in 5.7 s, 5,000 in 31 s.

The result is held for a week and refreshed in the background once it is a
day old, so it never expires onto a caller. On a host that boots (`pnpm start`,
Railway) the `warm` hook fills it before the first request. On a host that
does not (Vercel) the first call that **filters** by a facet, or lists them,
pays the sweep; a plain `query` search never touches the index and stays a
0.1–0.3 s call from cold.

### 4. Three kinds of id, and none of them is Διαύγεια's

- A **procedure id** is its registration code (ΜΑΚ) — `106576` — which is
  also the number in its permanent address `https://id.mitos.gov.gr/106576`.
  The wiki's own page ids (`10352`) are a different numbering and appear
  nowhere in these tools.
- An **organisation id** is the procedures registry's own — `46278` for the
  Ministry of Interior — and is **not** the uid Διαύγεια gives the same body
  (`99221912`). The two registers cannot be joined by id; join them by name or
  VAT number. Some ids keep leading zeros (`01017`); the wiki drops them, so
  every comparison here is numeric and `1017` finds `01017`.
- A **gov.gr code** (`15725`) names the service page on gov.gr and comes back
  on `govgr` with its URL.

### 5. Only `ΔΔ` is published

The wiki has seven custom namespaces. `ΔΔ` (Δημόσιες Διαδικασίες) holds the
published procedures and is the only one the API lists; `ΥΕ`, `ΠΔ`, `ΠΕ` and
`ΠΑ` hold drafts and templates. Every wiki query here is pinned to `ΔΔ`, and a
listing from the API in any other namespace is dropped.

### 6. The API is in beta, and its editors add fields

The API's own page calls it a trial ("δοκιμαστική λειτουργία") and reserves
the right to change. Two consequences here: `get_procedure` maps every field
observed across a spread of records and hands anything it does not recognise
through untouched under `extra`, and the raw shapes in `client.ts` treat every
field as optional. Step flags arrive as booleans on most records and as `"t"`
/ `"f"` on older ones; Gazette numbers as numbers or strings; both are
normalised.

### Two smaller traps

- **Titles are not identical across endpoints.** The list says `Ληξιαρχική
  πράξη γέννησης`, the record's `official_title` says `Ληξιαρχική Πράξη
  Γέννησης`. `get_procedure` returns both; searches fold case and accents.
- **A body may carry several VAT numbers**, comma-separated in one field
  (`099323477,090270402,090056250` for the Ministry of Interior). VAT search
  matches the field whole.

---

## Tools

Every tool is read-only, idempotent and unauthenticated. Every handler throws
an `AgoraError` for anything the model should read as a failure; the server
turns it into a tool error.

### `search_procedures`

Find procedures by words, by life event, by audience or by owning body.

The usual first step when the user describes a need rather than names a
procedure. `query` is matched three ways in one call: against titles (Greek
and English) it holds locally, then against the full text of the records via
the wiki's search, in the wiki's relevance order. Facet filters narrow the set
first; a query is optional when any filter is given.

#### Parameters

| Name | Type | Required | Description |
|---|---|---|---|
| `query` | string, 2–200 | no* | Words from the procedure's name or its text. Accents and case ignored; words ANDed by the full-text search. |
| `lifeEvent` | string | no* | Exact life-event name from `list_life_events`, e.g. `Γέννηση`. Case and accents ignored. |
| `audience` | string | no* | Exact audience name from `list_audiences`, e.g. `Πολίτες`. |
| `organizationId` | digits | no* | The owning body's id, from `search_organizations` or `owner.id` on a procedure. |
| `limit` | integer 1–100 | no | Default 20. |

\* At least one of the four is required; with none the tool returns an
`invalid_input` error.

#### Returns

```jsonc
{
  "query": "ληξιαρχική πράξη γέννησης",
  "lifeEvent": null,
  "audience": null,
  "organizationId": null,
  "total": 54,                // every match, title and text together
  "returned": 5,
  "hasMore": true,
  "fullText": {               // null when no query was given
    "totalHits": 220,         // what the wiki's search matched in all
    "considered": 50,         // how many of those were joined to the list
    "unmatched": 0            // hits whose title the list does not carry
  },
  "note": "The full-text search matched 220 records and the 50 most relevant were considered; add words to the query to narrow it.",
  "procedures": [
    {
      "id": "106576",
      "title": "Ληξιαρχική πράξη γέννησης",
      "titleEn": null,
      "updatedAt": "2026-08-07T09:20:51+03:00",
      "url": "https://id.mitos.gov.gr/106576",
      "matchedBy": "title",   // "title" or "text"
      "snippet": null         // the matching passage, on text matches
    }
  ]
}
```

Order: exact title, then title prefix, then title substring (shorter first),
then text matches in the wiki's relevance order. A procedure matched both ways
appears once, as a title match.

#### Examples

**A need, in plain words.** `{ "query": "ληξιαρχική πράξη γέννησης", "limit": 5 }`
→ 54 matches in 0.30 s; the first is the birth certificate itself, then its
corrections and amendments.

**Inflection is handled by the text search, not the title match.**
`{ "query": "φορολογική ενημερότητα" }` → `Αποδεικτικό φορολογικής
ενημερότητας` first, `matchedBy: "text"` with the snippet, because the title
carries the genitive.

**English works where the record has English.** `{ "query": "driving licence" }`
→ 10 procedures, all with English titles.

**A whole life event.** `{ "lifeEvent": "Γέννηση", "limit": 5 }` → 28
procedures, alphabetical, in 0.01 s once the index is held.

**Filters combine.** `{ "organizationId": "46278", "lifeEvent": "Οικογενειακή κατάσταση" }`
→ 34 of the Ministry of Interior's 358 procedures.

**A filter and a query.** `{ "lifeEvent": "Γέννηση", "query": "πιστοποιητικό" }`
→ 1: `Πιστοποιητικό γέννησης`. The wiki matched 1,998 records for the word;
only the one filed under the life event survives the filter.

**An unknown facet value is said, not swallowed.** `{ "audience": "Δεν υπάρχει" }`
→ 0 results with `note: No procedure is addressed to an audience named
"Δεν υπάρχει". list_audiences gives the names in use.`

#### What it cannot do

- Rank by anything but title strength and the wiki's relevance.
- Search by text *and* return facets on each row: results carry the list
  fields only, so a plain query stays cheap on a cold host. `get_procedure`
  has everything.
- See drafts, or procedures the API does not list.

---

### `get_procedure`

One procedure in full, by id.

#### Parameters

| Name | Type | Required | Description |
|---|---|---|---|
| `id` | digits | yes | The registration code, e.g. `106576`. |

#### Returns

The record normalised to one shape, every field present (null or empty where
the editors left it blank). Abridged, from `106576`:

```jsonc
{
  "id": "106576",
  "url": "https://id.mitos.gov.gr/106576",
  "pageUrl": "https://mitos.gov.gr/index.php/ΔΔ:Ληξιαρχική_πράξη_γέννησης",
  "updatedAt": "2026-08-07T09:20:51+03:00",
  "title": "Ληξιαρχική πράξη γέννησης",
  "titleEn": null,
  "officialTitle": "Ληξιαρχική Πράξη Γέννησης",
  "alternativeTitles": ["Χορήγηση αντιγράφου ή αποσπάσματος Ληξιαρχικής Πράξης Γέννησης"],
  "description": "Η διαδικασία αφορά στη χορήγηση αντιγράφου ή αποσπάσματος …",
  "remarks": "Σύμφωνα με τον αρ. αρμοδιότητας 1.3.12 …",
  "owner": { "id": "46278", "name": "ΥΠΟΥΡΓΕΙΟ ΕΣΩΤΕΡΙΚΩΝ", "nameEn": "MINISTRY OF INTERIOR" },
  "ownerIsPrivate": false,
  "ownerDirectorates": [{ "id": "528385", "name": "ΔΙΕΥΘΥΝΣΗ ΑΣΤΙΚΗΣ ΚΑΙ ΔΗΜΟΤΙΚΗΣ ΚΑΤΑΣΤΑΣΗΣ", "nameEn": null }],
  "providedBy": [
    { "id": "1461", "name": "Δήμοι", "nameEn": "Municipalities" },
    { "id": "9916", "name": "ΚΕΠ", "nameEn": "KEP (ΚΕΠ)" }
  ],
  "providedByDirectorates": [],
  "providedRemotelyBy": [{ "id": "8256", "name": "myKEPlive", "nameEn": "myKEPlive" }],
  "servicePoints": {
    "inPerson": [{ "title": "Δήμοι", "url": null }, { "title": "ΚΕΠ", "url": "https://www.kep.gov.gr/" }],
    "digital": [{ "title": "Ενιαία Ψηφιακή Πύλη δημόσιας διοίκησης (ΕΨΠ - gov.gr)", "url": "https://www.gov.gr/ipiresies/…" }],
    "remote": [{ "title": "myKEPlive", "url": "https://www.gov.gr/ipiresies/…" }]
  },
  "digitalLocations": [{ "title": "Ενιαία Ψηφιακή Πύλη δημόσιας διοίκησης (ΕΨΠ - gov.gr)", "url": "https://www.gov.gr/…", "description": null }],
  "govgr": [{ "id": "15725", "name": "Ληξιαρχική πράξη γέννησης", "nameEn": "Get a birth registration certificate", "url": "https://www.gov.gr/ipiresies/…" }],
  "audiences": ["Πολίτες"],
  "lifeEvents": ["Γέννηση", "Οικογενειακή κατάσταση"],
  "type": "Εξωστρεφής",
  "triggers": ["Αιτούμενη", "Αυτεπάγγελτη", "Συνέχεια άλλης διαδικασίας"],
  "triggerTypes": ["Αίτηση (έντυπο)", "Αίτηση (ψηφιακά)", "Βιντεοκλήση", "…"],
  "usage": ["Δικαιολογητικό", "Είσοδος σε άλλη διαδικασία", "Ψηφιακό δικαιολογητικό"],
  "outputTypes": ["Διοικητική πράξη", "Παραγωγή εγγράφου", "…"],
  "deliveryTypes": [],
  "taxTypes": ["Πιστοποιητικά"],
  "cost": { "summary": "Παρέχεται χωρίς κόστος", "min": null, "max": null, "fees": [] },
  "documents": {
    "summary": "0 έως 1",
    "count": 1,
    "items": [{
      "n": 1,
      "type": { "id": "3070", "name": "Εξουσιοδότηση", "nameEn": "Enabling act" },
      "description": "Εξουσιοδότηση ή συμβολαιογραφικό πληρεξούσιο τρίτου προσώπου …",
      "note": null,
      "providedBy": ["Φυσικά πρόσωπα"],
      "submission": ["Επίδειξη από τον αιτούντα", "Κατάθεση από τον αιτούντα (αποκλειστικά δια ζώσης)", "Κατάθεση από τον αιτούντα (ψηφιακή)"],
      "conditional": true,                  // needed only when a condition of these types applies
      "conditionTypes": ["Διοικητικές"],
      "alternative": false,
      "alternativeOf": null,
      "issuedBy": [{ "id": "621658", "name": "Εξουσιοδότηση και ηλεκτρονική εξουσιοδότηση", "nameEn": null }],
      "url": "https://www.gov.gr/…"
    }]
  },
  "identification": ["Ταυτοποίηση με κωδικούς TAXISnet", "Ταυτοποιητικό έγγραφο"],
  "duration": {
    "summary": "10 λεπτά",
    "digitalSummary": "2 λεπτά",
    "inPerson": { "min": { "iso": "PT9M", "text": "9 minutes" }, "max": { "iso": "PT24M", "text": "24 minutes" } },
    "digital":  { "min": { "iso": "PT1M40S", "text": "1 minute 40 seconds" }, "max": { "iso": "PT1M50S", "text": "1 minute 50 seconds" } },
    "implementation": { "min": null, "max": { "iso": "PT10M", "text": "10 minutes" } },
    "deadline": null,                       // the legal deadline for the body to answer, e.g. P10D
    "validity": { "set": null, "duration": null }
  },
  "application": {
    "type": "Αίτηση",
    "description": "Αίτηση για Ληξιαρχική πράξη γέννησης",
    "note": "Ο αιτών πρέπει να γνωρίζει σε ποιο Ληξιαρχείο απευθύνεται",
    "submission": ["Κατάθεση από τον αιτούντα (αποκλειστικά δια ζώσης)", "Κατάθεση από τον αιτούντα (ψηφιακή)"],
    "applicants": ["Φυσικά πρόσωπα"],
    "url": null
  },
  "conditions": [{ "n": 1, "type": "Διοικητικές", "text": "Να έχει συνταχθεί η ληξιαρχική πράξη γέννησης.", "url": null, "alternative": false, "alternativeOf": null }],
  "steps": [{                               // the in-person route, 18 steps
    "n": 1, "title": "Φυσική ταυτοποίηση πολίτη", "description": "…", "note": null,
    "by": "Αρμόδιος Υπάλληλος", "method": "Χειροκίνητη ενέργεια",
    "duration": { "min": { "iso": "PT2M", "text": "2 minutes" }, "max": { "iso": "PT5M", "text": "5 minutes" } },
    "exit": false, "child": false, "previous": null, "url": null, "coOrganization": null
  }],
  "digitalSteps": [{ "n": 1, "title": "Αυθεντικοποίηση χρήστη με κωδικούς Taxisnet", "by": "Λογισμικό συναρμόδιου φορέα", "method": "Είσοδος δεδομένων σε λογισμικό", "…": "…" }],
  "legalBasis": [{                          // 17 rules
    "type": "Ευρωπαϊκός Κανονισμός", "number": "2016/1191", "year": "2016", "article": null,
    "description": "Τα δημόσια έγγραφα που εκδίδονται από τα Ληξιαρχεία …",
    "gazette": null, "ada": null,
    "url": "https://eur-lex.europa.eu/legal-content/EL/TXT/PDF/?uri=CELEX:32016R1191&rid=1"
  }],
  "usefulLinks": [{ "title": "Οι Ληξιαρχικές Πράξεις βήμα - βήμα", "url": "https://howto.gov.gr/mod/book/view.php?id=266" }],
  "seeAlso": [],
  "outputRegistries": [],
  "crossBorder": null,                      // EU Single Digital Gateway data, on cross-border procedures
  "extra": {}                               // fields this adapter does not map, verbatim
}
```

Notes on reading it:

- `steps` and `digitalSteps` are two routes, not one sequence. A step with
  `child: true` is a branch of step `previous` — the refusal path, usually —
  and `exit: true` marks where the procedure can end.
- `documents.items[].conditional` with `conditionTypes` says the document is
  needed only when a condition of that type applies; `alternative` with
  `alternativeOf` says it stands in for another document.
- `cost.min`/`cost.max` are euros where the editors entered a figure;
  `cost.fees` itemises παράβολα and e-παράβολα with how they are paid.
  `cost.summary` is always present.
- `legalBasis[].gazette` is the ΦΕΚ issue and number; `ada` is the act's
  Διαύγεια code where the rule is a decision published there, and can be
  handed to `diavgeia_get_decision` on the country server.
- `crossBorder` appears on procedures offered under the EU Single Digital
  Gateway: the SDG code, NACE codes and the source register (`EU-GO`).
- Durations are ISO 8601 as upstream writes them, with a reading beside each.

#### Examples

`{ "id": "525354" }` (Επίδομα Γέννησης) → 12 documents, 7 steps, 6 rules;
8.06 s cold, then 0.01 s.

`{ "id": "435858" }` → a cross-border one: `crossBorder.sdgCodes` `N2 —
Κοινοποίηση διασυνοριακών δραστηριοτήτων`, NACE `71.1`, and a €20 fee for
registration with the Technical Chamber.

`{ "id": "1" }` → `not_found`: *No procedure is registered under id "1"…*

#### Cost and limits

- First fetch of a record: 2.6–8 s measured, 13 s seen once. Cached six hours.
- A record is 15–30 KB from upstream and about the same normalised; there is
  no paging — a procedure is read whole.

---

### `list_life_events`

The 122 life events procedures are filed under, with how many each has.

| Name | Type | Required | Description |
|---|---|---|---|
| `query` | string | no | Part of a name, to find the exact spelling. Omit for all. |

Returns `{ query, total, lifeEvents: [{ name, procedures }] }`, most procedures
first. `{ "query": "επιχείρ" }` → 8, led by `Επιχειρηματική δραστηριότητα`
(185). Without a query the top are `Αδειοδοτήσεις και συμμόρφωση` (1,076),
`Απασχόληση στο δημόσιο τομέα` (567), `Ναυτιλία` (230). 35 procedures carry no
life event at all.

Reads the facet index (see [Read this first, 3](#3-facets-are-swept-held-and-refreshed-behind-the-caller)).

---

### `list_audiences`

The 189 audiences procedures are addressed to, with how many each has.

| Name | Type | Required | Description |
|---|---|---|---|
| `query` | string | no | Part of a name. Omit for all. |

Returns `{ query, total, audiences: [{ name, procedures }] }`. `{ "query": "φοιτητ" }`
→ `Φοιτητές/σπουδαστές` (81). The largest are `Επιχειρήσεις` (714), `Νομικά
Πρόσωπα – Νομικές Οντότητες` (577), `Δημόσιους φορείς` (403), `Πολίτες` (255).
Audience names are in the accusative, as the registry addresses them.

---

### `list_recent_procedures`

Procedures by when their record was last edited, newest first.

| Name | Type | Required | Description |
|---|---|---|---|
| `since` | `YYYY-MM-DD` | no | Only records edited on or after this day, inclusive (Athens time). |
| `limit` | integer 1–100 | no | Default 20. |

Returns `{ since, total, returned, hasMore, procedures: [ProcedureListing] }`.
`{ "since": "2026-08-30", "limit": 3 }` → 14 in total. An edit is any change
to the record; the registry does not say what changed. Reads the list only, so
it is cheap everywhere.

---

### `search_organizations`

Find a body in the procedures registry's own list of organisations, and get
the id `search_procedures` takes as `organizationId`.

| Name | Type | Required | Description |
|---|---|---|---|
| `query` | string, 2–120 | yes | Part of the name in Greek or English, or a VAT number or id matched whole. Case and accents ignored. |
| `limit` | integer 1–100 | no | Default 20. |

Returns `{ query, total, returned, hasMore, organizations: [{ id, name, nameEn, vatId, parentId, parentName, status }] }`,
exact VAT/id first, then exact name, prefix, substring, shorter names first.

`{ "query": "υπουργείο εσωτερικών" }` → 1: `46278 ΥΠΟΥΡΓΕΙΟ ΕΣΩΤΕΡΙΚΩΝ`.
`{ "query": "999722328" }` → `01017 ΠΕΡΙΦΕΡΕΙΑΚΗ ΔΙΕΥΘΥΝΣΗ … ΑΤΤΙΚΗΣ`.
`{ "query": "ministry of interior" }` → the same ministry by its English name.

The register holds 2,762 bodies; only 39 own procedures. The rest are
providers, directorates and subordinate bodies, so most matches will have
nothing under `search_procedures` — that is the register, not a fault.

---

### `get_organization`

One body's full record, by id.

| Name | Type | Required | Description |
|---|---|---|---|
| `organizationId` | digits | yes | e.g. `46278`. Leading zeros optional. |

Returns the register row plus `parent: { id, name }` and `subOrganizations:
[{ id, name }]`:

```jsonc
{
  "id": "46278",
  "name": "ΥΠΟΥΡΓΕΙΟ ΕΣΩΤΕΡΙΚΩΝ",
  "nameEn": "MINISTRY OF INTERIOR",
  "vatId": "099323477,090270402,090056250",
  "parentId": null,
  "status": "active",
  "address": null,
  "postCode": null,
  "email": "dioikisi@ypes.gr",
  "telephone": "213 136 4964-66",
  "website": null,
  "typeCode": 25,                // upstream's numeric type; no vocabulary is published
  "foundedOn": null,
  "foundingGazette": null,
  "terminatedOn": null,
  "updatedOn": "2025-11-13",
  "parent": null,
  "subOrganizations": [ /* 372 */ ]
}
```

`{ "organizationId": "1017" }` finds `01017`. `{ "organizationId": "0" }` →
`not_found`.

---

## Upstream API reference

What the adapter calls, so a reader can reproduce any answer by hand.

### The public API — `https://api.digigov.grnet.gr/v1/`

Documented at <https://api.mitos.gov.gr/info/>. JSON, no key today, every
endpoint `GET`. Envelope: `{ data, total, next_page, current_page, limit, success }`.

| Endpoint | Used by | Notes |
|---|---|---|
| `services?page&limit` | `search_procedures`, `list_recent_procedures`, the facet sweep | `id`, `title {el,en}`, `ns`, `last_updated` only. Any `limit` is honoured; 2,000 a page here. `search`/`q`/`title` are ignored. |
| `services/{id}` | — | The record with bare ids. 0.1 s. Not used: see `services-extended`. |
| `services-extended/{id}` | `get_procedure` | The record with every reference resolved to `{ id, title }`. 2.6–13 s cold, 0.1 s warm. |
| `organizations?page&limit` | `search_organizations`, `get_organization` | 2,762 rows; `limit` up to 1,000, above that a 400. No lookup by id (`organizations/{id}` is a 404) and no search (`search` is a 400). |
| `registry?page&limit` | — | 846 registries, **10 a page whatever `limit` says**; 85 calls to read. Not exposed. |

Unknown ids answer `404 {"data":{"message":"Not found."},"success":false}`.
Record timestamps carry the Athens offset (`+03:00`).

### The registry's MediaWiki — `https://mitos.gov.gr/api.php`

MediaWiki 1.3x with Semantic MediaWiki. Anonymous reads; every request here
sends `format=json`. Errors come back as `200` with an `error` envelope, which
the adapter turns into an `upstream_error`.

| Action | Used by | Notes |
|---|---|---|
| `action=query&list=search&srsearch=…&srnamespace=9002&srprop=snippet` | `search_procedures` | Full-text over the `ΔΔ` namespace (id 9002). Words ANDed; `intitle:` restricts to titles. `srlimit` up to 500; 50 here. |
| `action=ask&query=[[Process ns::ΔΔ]]|?Process id|?Process life events|?Process provided to|?Process org owner|limit=500|offset=N` | the facet sweep | Semantic query with printouts; results keyed by page title. `format=count` is not available through the API. |
| `action=browsebysubject&subject=ΔΔ:…` | — | Every semantic property of one page (98 on a typical record). Used to discover the property names above; not called at run time. |

Property values worth knowing: `Process id` is the API's id as a string;
`Process org owner` is numeric, which is why leading zeros go missing;
`Process life events` and `Process provided to` are pages, whose `fulltext`
is the name. Namespaces: `ΔΔ` 9002 (published), `ΥΕ` 9006, `ΠΕ` 9008, `ΠΔ`
9010, `ΠΑ` 9018 (drafts and templates), `Meta` 9014, `AN` 9016.

The wiki's `Category:Γεγονότα Ζωής` holds twelve broad groups (Οικογένεια,
Εκπαίδευση, Επιχειρηματική δραστηριότητα, …) above the 122 life events. They
are not on the API and not exposed; the life events are the level the records
themselves carry.

---

## Reference data

Measured 1 Sep 2026.

| | |
|---|---|
| Procedures published (`ΔΔ`) | 4,387 — the API list and the wiki's index agree exactly |
| With an English title | 591 |
| Owner bodies | 39; the largest are `40151` (448), `23371` (391), `46278` ΥΠΕΣ (358), `85324` (328), `80136` (321) |
| Life events | 122; 35 procedures carry none |
| Audiences | 189; every procedure carries at least one |
| Bodies in the organisation register | 2,762 |
| Records edited in August 2026 | 2,390; in July, 1,937 |

Life events, the ten largest: Αδειοδοτήσεις και συμμόρφωση 1,076 ·
Απασχόληση στο δημόσιο τομέα 567 · Ναυτιλία 230 · Πολίτες άλλων κρατών 193 ·
Επιχειρηματική δραστηριότητα 185 · Θέματα εκπαίδευσης 159 · Ελεύθεροι
επαγγελματίες 159 · Συνταξιοδότηση 155 · Γεωργική επιχειρηματικότητα 68 ·
Φορολογία επιχειρήσεων 68.

Vocabularies that appear as free text on records (no endpoint lists them):
`type` is `Εξωστρεφής` or `Εσωστρεφής`; `trigger` is drawn from `Αιτούμενη`,
`Αυτεπάγγελτη`, `Συνέχεια άλλης διαδικασίας`; step `method` from `Χειροκίνητη
ενέργεια`, `Ενέργεια μέσω λογισμικού`, `Έλεγχος`, `Είσοδος δεδομένων σε
λογισμικό`, `Αλληλεπίδραση λογισμικών (διαλειτουργικότητα)`, …; condition
`type` from `Διοικητικές`, `Ηλικιακές`, `Κατοχής κωδικών για είσοδο σε
λογισμικό`, …; document `submission` from `Κατάθεση από τον αιτούντα
(ψηφιακή)`, `Κατάθεση από τον αιτούντα (αποκλειστικά δια ζώσης)`, `Επίδειξη
από τον αιτούντα`, `Αυτεπάγγελτη (ψηφιακά)`, ….

---

## Caching

Keys are namespaced `gr/mitos:*`. TTLs live in `meta.ts`; the indices have
their own.

| What | Key | Held | Filled by |
|---|---|---|---|
| The procedure list (4,387 rows, ~1 MB) | `procedure_list` | 1 day | first search or recent-changes call; `warm` |
| The facet index (id → life events, audiences, owner) | `facets` | 7 days, refreshed in the background after 1 day | `warm`; else the first facet filter or vocabulary call (~3.5 s) |
| The organisation register (2,762 rows) | `organizations` | 1 day | `warm`; else the first body lookup (~0.7 s) |
| One wiki full-text search | `wiki_search` | 1 hour (`default`) | each distinct query |
| One procedure | `get_procedure` | 6 hours | each distinct id |

`warm` runs the list, the facet sweep and the register together: 3.6 s
measured at boot. Where there is no boot, every tool still works — it just
pays its own index on the first call.

---

## Errors

| Situation | Code | Message |
|---|---|---|
| `search_procedures` with no query and no filter | `invalid_input` | Give a query, or at least one of lifeEvent, audience and organizationId. |
| `query` shorter than 2 characters, id not digits, date not `YYYY-MM-DD` | schema validation | rejected before the handler runs |
| Unknown procedure id | `not_found` | No procedure is registered under id "…". Ids come from search_procedures; the code is also the number in a procedure's id.mitos.gov.gr address. |
| Unknown organisation id | `not_found` | No body is registered under id "…". Search for it by name with search_organizations. |
| Unknown life event or audience | none — empty result | `note` names the value and points at the vocabulary tool |
| Wiki error envelope | `upstream_error` | mitos.gov.gr rejected the request: … |
| API 5xx, timeout, unreachable | `upstream_error` / `upstream_timeout` / `upstream_unavailable` | from the shared HTTP client, after its retries |

---

## Verification

Run against a server on `:3010` with every tool exercised, 1 Sep 2026:

- `tools/list` on `/gr/mcp/mitos` → 7 tools; on `/gr/mcp` → 24, the seven
  prefixed `mitos_`, no name collision with Διαύγεια's `search_organizations`.
- `warm.ok` 3,612–3,674 ms on two boots.
- Searches 0.10–0.32 s; facet-only searches 0.00–0.02 s once held.
- `get_procedure` cold 2.56 s, 6.60 s, 8.06 s on three untouched ids; 0.00–0.09 s repeated.
- Every example on `GET /` validates against its schema at boot, as `defineSource` requires.

Probe scripts and raw responses are not checked in; the numbers above are what
they measured.
