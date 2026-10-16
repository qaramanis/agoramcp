# `gr/et` — Εθνικό Τυπογραφείο, ΦΕΚ

MCP adapter over the **Government Gazette** (Εφημερίς της Κυβερνήσεως) as the
National Printing Office publishes it: the law index, every ΦΕΚ issue of every
series, the gazette's own timeline of which act amends which, and the text of
an issue from its PDF. It answers "what does ν. 4990/2022 say", "has it been
amended since", "what was published in the gazette yesterday" and "which
issues of 2026 mention wildfires".

| | |
|---|---|
| **Mount point** | `POST /gr/mcp/et` |
| **Upstream** | `https://searchetv99.azurewebsites.net/api/` (the search.et.gr backend) and the portal's PDF blob store |
| **Authentication** | None |
| **Licence** | Not stated — see below |
| **Attribution** | Εφημερίς της Κυβερνήσεως — Εθνικό Τυπογραφείο (search.et.gr) |
| **Coverage** | Series Α from 1833, Β from 1930, the others from their first year; full text from 1992; text layers from the 2000s |
| **Tools** | 4 — `search_legislation`, `search_gazette`, `get_gazette_issue`, `get_gazette_text` |
| **Country index** | [`docs/gr-documentation.md`](../../../../docs/gr-documentation.md) — every Greek tool, one line each |

### On the licence

Neither API publishes terms. The portal's terms of use
([§2.4](https://search.et.gr/el/oroi-xrisis/)) claim its content for the
Presidency of the Government (ΠτΚ) and forbid its reproduction «για εμπορικούς
σκοπούς ή/και για μη προσωπική χρήση» without permission. Against that,
**ν. 2121/1993, άρθρο 2 παρ. 5** puts official texts outside copyright
altogether: «Η προστασία του παρόντος νόμου δεν εκτείνεται σε επίσημα κείμενα
με τα οποία εκφράζεται η άσκηση πολιτειακής αρμοδιότητας και ιδίως σε
νομοθετικά, διοικητικά ή δικαστικά κείμενα». The laws and decisions are the
second kind; the portal's index and metadata arguably the first. `meta.ts`
reports both facts in its licence line and attributes the gazette, the call
`gr/vies` makes for a source whose terms do not settle the question.

### The search backend is undocumented

`searchetv99.azurewebsites.net` is not published anywhere: its address is in
the portal's JavaScript bundle (`main.8cd00f75.js`, `getApiEndpoint`). It is
the only index there is — `api.et.gr` serves PDFs by number and nothing else —
so this source stands on it, and it can change without notice. Should it
move, `SEARCH_URL` in `client.ts` is the one line to change, and the bundle is
where to find the new one.

---

## Contents

- [What this answers](#what-this-answers)
- [Read this first](#read-this-first)
- [Tools](#tools)
- [Upstream API reference](#upstream-api-reference)
- [Caching](#caching)
- [Errors](#errors)
- [Verification](#verification)

---

## What this answers

| The user wants to… | …via |
|---|---|
| Find a law by its number and year | `search_legislation` |
| Find the laws of a year about a subject | `search_legislation` with `year` and `words` |
| Know whether a law has been amended, and by what | `get_gazette_issue` → `actedOnBy` |
| Read a law or a ministerial decision | `get_gazette_text` |
| See what the gazette published on a day | `search_gazette` with `releasedFrom` |
| Find the issues of a year that mention something | `search_gazette` with `year` and `text` |

---

## Read this first

### 1. Every date is month first

The backend writes every date `MM/DD/YYYY HH:mm:ss`: "11/09/2022" is the
ninth of November. `usDate` turns them into ISO dates; read any other way, a
third of all dates would be wrong and the rest impossible.

### 2. Answers are JSON inside JSON

Every answer is `{ status, message, data }` with `data` a JSON **string**, so
it is parsed twice. Not found is `data: "[]"` with a 200. A malformed body is
a 400 `"Operation error"`; an unknown catalogue id a 500 with no body.

### 3. The law index must be bounded

`searchlegislation` with neither a year nor a number streamed **51 MB** for
presidential decrees and **46 MB** for royal decrees, and was still going at
60 s. `search_legislation` refuses that call and caps a year range at eleven
years (laws 2016–2026: 987 rows, 1.7 MB, 1.9 s). Numbering restarted in
different eras — law 2121 is four laws, of 1892, 1920, 1952 and 1993 — so a
number without a year is allowed and returns them all.

### 4. Text search is a phrase search, from 1992, and incomplete

`simplesearch` with `searchText` stems and folds accents server-side, but
several words must stand **next to each other**: "δασικές πυρκαγιές" finds one
issue, "προστασία καταγγελλόντων" none. Nothing before 1992 is indexed, hits
stop at 1,500, and the index is not complete: law 4990/2022 is not among the
2022 Α hits for "καταγγελλόντων". Every text search says so in its notes. A
text search with no year took 3–8 s and up to 5 MB, so one is required.

Each hit carries its matching passage, base64 of the index's lower-case,
accent-stripped text, decoded into `snippet`. One extra element,
`{ search_stemmedQuery }`, is slipped into the array; it is dropped and
quoted in the notes.

### 5. A law's PDF is its whole issue, and some are huge or scanned

`api.et.gr/apiLAW/1/2022/4990/pdf` and the blob for ΦΕΚ Α 210/2022 are the
same 380,190 bytes. The blob path is
`fek/{series:2}/{year}/{year}{series:2}{number:5}.pdf`. The store answers HEAD
with a length, so law 4600/2019 — 228 pages, 43.8 MB — is refused before
anything moves; the cap is 30 MB, as for Διαύγεια. The store sends
`application/octet-stream`, so the type is not checked. Issues from 1931,
1993 and 1999 are scans with no text layer; 2005 and later have one. The
2022 issues set ΕΦΗΜΕΡΙ∆Α with ∆, U+2206, which `tidyText` turns back into Δ.

---

## Tools

All four are read-only, idempotent and unauthenticated.

### `search_legislation`

| Name | Type | Required | Description |
|---|---|---|---|
| `kind` | enum | no | `law` (default), `presidential_decree`, `legislative_content_act`, `royal_decree`, `legislative_decree`, `legislative_presidential_decree`, `emergency_law`. |
| `number` | string | no | The act's own number. |
| `year` | integer | no | Year published. |
| `fromYear`, `toYear` | integer | no | A range of up to 11 years. Not with `year`. |
| `words` | string | no | All must appear in the title; accents and case ignored. Filtered locally: the index cannot search titles. |
| `limit` | 1–100 | no | Default 20, newest first. |

A year or a number is required. Returns
`{ kind, total, truncated, acts: [{ id, kind, number, title, gazette: { series, number, year, label }, issueDate, releaseDate, pages, pdfUrl, pageUrl }], notes }`.

`{ "kind": "law", "number": "4990", "year": 2022 }` → one act, ΦΕΚ Α 210/2022, 0.48 s.

### `search_gazette`

| Name | Type | Required | Description |
|---|---|---|---|
| `series` | string | no | `Α`, `Β`, `Γ`, `Δ`, `Υ.Ο.Δ.Δ.`… or Latin `A`, `B`, `D`, or the id. |
| `year` | integer | no | |
| `number` | integer | no | Issue number; needs `series`. |
| `text` | string | no | A word or phrase. Needs `year` or a date range. |
| `issuedFrom`, `issuedTo` | date | no | On the date printed on the issue. |
| `releasedFrom`, `releasedTo` | date | no | On the release day. One alone is that day. |
| `limit` | 1–200 | no | Default 50. |

A year or a date range is required; ranges span at most 31 days. Returns
`{ total, truncated, issues: [{ id, series, number, year, label, issueDate, releaseDate, pages, pdfUrl, pageUrl, snippet?, rank? }], notes }`,
by rank for a text search, otherwise by release date. Issues other than laws
carry no title upstream.

### `get_gazette_issue`

`id`, or `series` + `year` + `issue`. Five requests side by side. Returns
`{ id, series, number, year, label, issueDate, releaseDate, reReleaseDate, pages, topic, publishers, mentions, tags, actedOnBy, actsOn, pdfUrl, pageUrl, notes }`.
`actedOnBy` (timeline direction 0) lists later acts that act on this one,
`actsOn` (direction 1) earlier acts it acts on; each
`{ id, label, relation, relationEl }`, the relation one of Modification
(Τροποποίηση), Expansion, Reference, Invalidation (Ακύρωση), Identity,
Replacement or Reinstatement. The thematic subjects the backend also returns
are left out: they read as noise.

`{ "id": "627362" }` → law 4990/2022, published by the Ministry of Justice,
amended since by twenty-odd acts, the newest ΦΕΚ Α 114/2026.

### `get_gazette_text`

| Name | Type | Required | Description |
|---|---|---|---|
| `id` | string | one of | An issue id. |
| `series`, `issue`, `year` | | one of | ΦΕΚ Β 6227/2026. |
| `lawNumber`, `year`, `kind` | | one of | ν. 4990/2022. |
| `fromPage` | integer | no | Default 1. |
| `maxPages` | 1–50 | no | Default 10. |

Returns `{ gazette, id, pageCount, fromPage, toPage, characters, truncated, nextPage, note?, pages: [{ page, text }], pdfUrl }`,
at most 40,000 characters a call, as `diavgeia_get_decision_text` does. The
whole text is cached on first read, so paging costs one download.

---

## Upstream API reference

`https://searchetv99.azurewebsites.net/api/` — Kestrel, no auth, no
rate-limit headers.

| Request | Body / path | Measured |
|---|---|---|
| `POST searchlegislation` | `{ legislationCatalogues, legislationNumber, selectYear: [] }`, all keys required | number + year 0.46 s; a year of laws 0.64 s, 150 KB |
| `POST simplesearch` | `{ selectYear, selectIssue, documentNumber, searchText, datePublished, dateReleased }`; dates `"YYYY-MM-DD YYYY-MM-DD"` (`datePublished` filters the issue date, `dateReleased` the release) | one issue 0.4 s; a day's releases 0.1–0.5 s; a year of Β 6,238 rows, 2.5 MB, 1.4 s; text + year 1.1–4.6 s |
| `POST searchbydate` | `{ datePublished }` — filters the release day despite its name | Not used: `simplesearch` with `dateReleased` does the same. |
| `GET documententitybyid/{id}` | | the issue record, topic, publisher id, subjects. 0.3 s |
| `GET namedentity/{id}` | | publisher (`Publish`) and bodies named (`GenericReference`). 0.3 s |
| `GET tagsbydocumententity/{id}` | | tags. 0.3 s |
| `GET timeline/{id}/{0\|1}` | | 0 later acts on this one, 1 earlier ones it acts on. Without the direction, 404. |

Catalogue ids: 1 Νόμος, 2 ΠΔ, 3 ΠΝΠ, 102 ΒΔ, 301 ΝΔ, 501 ΝΠΔ, 101 Αναγκαστικός
Νόμος. Series ids: 1 Α, 2 Β, 3 Γ, 4 Δ, 5 Ν.Π.Δ.Δ., 6 Α.Π.Σ., 7 ΠΑΡΑΡΤΗΜΑ,
8 Δ.Ε.Β.Ι., 9 Α.ΕΙ.Δ., 10 Α.Σ.Ε.Π., 11 ΠΡΑ.Δ.Ι.Τ., 12 Δ.Δ.Σ., 13 Ο.Π.Κ.,
14 Υ.Ο.Δ.Δ., 15 Α.Α.Π. The human page of an issue is
`https://search.et.gr/el/fek/?fekId={id}`.

PDFs: `https://ia37rg02wpsa01.blob.core.windows.net/fek/{series:2}/{year}/{year}{series:2}{number:5}.pdf`,
0.7–1.6 s for 0.4–1.6 MB. `api.et.gr/apiLAW/{1|2}/{year}/{number}/pdf` and
`apiFEK/{series}/{year}/{number}/pdf` serve the same files; HEAD there is a
404, so the blob store is used.

---

## Caching

Keys are namespaced `et:*`. TTLs live in `meta.ts`, and the tools hold a
search over periods that have closed for a day.

| What | Held |
|---|---|
| Legislation search (`default`) | 1 hour; years all past, 1 day |
| Gazette search | 15 minutes; dates all past, 1 day |
| One issue with its timeline | 6 hours — an amendment can land any week |
| An issue's text | 1 day |

---

## Errors

| Situation | Code |
|---|---|
| Legislation search with no year and no number; a range over 11 years | `invalid_input` |
| Gazette search with no year or date range; a range over 31 days; `number` without `series`; unknown series | `invalid_input` |
| No issue by that id, series/year/number or law number | `not_found` |
| No PDF at the blob path | `not_found` |
| PDF over 30 MB | `upstream_error` (413) with the PDF's address |
| A search answer over 8 MB | `upstream_error` (413) |
| Backend 400 | `invalid_input` |
| 5xx, timeout, unreachable | `upstream_*` from the shared client |

---

## Verification

Run against the live services on 15 Oct 2026 with every tool:

- `search_legislation`: the example → ν. 4990/2022 in ΦΕΚ Α 210/2022, 0.48 s.
  `{number:"2121"}` → four laws, 1993 first. `{year:2026, words:"ενεργεια"}`
  → four laws, accents ignored. Presidential decrees of 2026 → 64.
  `{kind:"royal_decree"}` → refused, nothing sent.
- `search_gazette`: the example (series Α, 2026, "πυρκαγιές") → 9 issues
  with snippets, 1.4 s. ΦΕΚ Β 6227/2026 by number, 0.14 s. Released on
  14 Oct 2026 → 116 issues; on Sunday 11 Oct → none, with the note. A text
  search with no year → refused.
- `get_gazette_issue`: `627362` → 0.39 s, publisher, 20+ later amending acts;
  Α 209/2022 by series, year and issue; id `999999999` → `not_found`.
- `get_gazette_text`: ν. 4990/2022 pages 1–2 in 1.1 s; pages 3 onward
  stopped at 40,000 characters with `nextPage` 10, from cache. ΦΕΚ Β
  6227/2026 page 1. ν. 2121/1993 → 24 empty pages and the scan note.
  ν. 4600/2019 → refused at 42 MB from HEAD alone.
- 10 offline tests in `src/client.test.ts` cover US dates, series aliases,
  the blob path, snippet decoding and ∆, the refusals that would otherwise
  pull tens of MB, the double-encoded answer, the stemmed-query element, and
  the size check before download.
