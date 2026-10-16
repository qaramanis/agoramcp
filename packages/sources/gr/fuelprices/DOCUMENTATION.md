# `gr/fuelprices` — Παρατηρητήριο Τιμών Υγρών Καυσίμων

MCP adapter over **fuelprices.gr**, the Ministry of Development's fuel price
observatory. It reads the observatory's published bulletins — the daily price
of every fuel in every prefecture since March 2017, and the weekly bulletin
that splits a litre's price into the refinery price, taxes and the retail
margin — and answers "what does unleaded cost in Thessaloniki", "is diesel
going up in the Cyclades" and "how much of the price is tax".

| | |
|---|---|
| **Mount point** | `POST /gr/mcp/fuelprices` |
| **Upstream** | `https://www.fuelprices.gr/` — three listing pages of PDF bulletins |
| **Authentication** | None |
| **Licence** | Other (Open) — as the ministry declares it on data.gov.gr; fuelprices.gr states none |
| **Attribution** | Παρατηρητήριο Τιμών Υγρών Καυσίμων — Υπουργείο Ανάπτυξης (fuelprices.gr) |
| **Coverage** | Daily by prefecture and national from 2017-03-14; weekly from 2012-04-27 |
| **Tools** | 4 — `list_bulletins`, `get_prices`, `get_price_history`, `get_price_breakdown` |
| **Country index** | [`docs/gr-documentation.md`](../../../../docs/gr-documentation.md) — every Greek tool, one line each |

### On the licence, and why only the bulletins

fuelprices.gr publishes no reuse licence; its [terms](https://www.fuelprices.gr/terms.html)
are a disclaimer that the prices are posted «μόνο στην πληρέστερη, καλύτερη
και συνεχή ενημέρωση του καταναλωτή και στην συλλογή χρήσιμων στατιστικών
στοιχείων». The ministry lists the observatory on data.gov.gr
(`parathrhthrio-timwn-ygrwn-kaysimwn`) as `other-open`, "Other (Open)", with
no licence text, and that declaration is what this source stands on.

The site's per-station price search is behind a CAPTCHA that the site says is
there to keep data-collecting robots out. This source does not touch it, or
the live statistics page beside it: it reads only the bulletins, which are
the files the ministry declares open.

---

## Contents

- [What this answers](#what-this-answers)
- [Read this first](#read-this-first)
- [Tools](#tools)
- [Upstream reference](#upstream-reference)
- [Caching](#caching)
- [Errors](#errors)
- [Verification](#verification)

---

## What this answers

| The user wants to… | …via |
|---|---|
| Today's fuel prices in a prefecture or island | `get_prices` with `prefecture` |
| Every prefecture, ranked by a fuel | `get_prices` with `fuel` |
| Prices on a past date | `get_prices` with `date` |
| Whether prices are rising | `get_price_history` |
| How much of a litre is tax | `get_price_breakdown` |
| Which days have bulletins | `list_bulletins` |

---

## Read this first

### 1. Windows-1253, https only, and missing files that answer 200

The listing pages are served as `charset=Cp1253` and decoded with
`TextDecoder("windows-1253")`; read as UTF-8, every Greek word is mojibake.
Plain `http://` answers 301. A bulletin that does not exist is **not** a 404:
the server answers **200 `text/html`** with a ~500-byte debug page, so the
content type is checked and anything but `application/pdf` is `not_found`.
The server ignores `Accept-Encoding`, so the daily listing is 543 KB every
time it is read.

### 2. File names are read, not built

Bulletins are `IMERISIO_DELTIO_ANA_NOMO_dd_mm_yyyy.pdf` (by prefecture),
`IMERISIO_DELTIO_PANELLINIO_…` (national) and `EBDOM_DELTIO_…` (weekly,
Fridays). The day and month are not always padded (`6_11_2025` beside
`06_10_2026`), and some dates carry a dead twin next to the real link —
`… - ??????????.pdf`, `… (2).pdf`, a name with a trailing space — that
answers with the error page. `parseListing` keeps the clean name and falls
back to an odd one only when it is the only link for its date
(`EBDOM_DELTIO_05_01_2018..pdf` is, and works).

### 3. The PDFs are read by position, not by text

Joined into text, a bulletin loses what matters:

- **A blank cell disappears.** `ΝΟΜΟΣ ΑΡΤΗΣ 1,533 1,713 1,288 1,010 0,879` in
  2017 is five prices for six columns. So every price is placed by its x
  against the column headers' centres; 2019 prints `0,000` in an empty cell
  instead, which reads as null.
- **The columns change.** Super until 2022; heating oil only from 15 October
  to 30 April, and moved after autogas from 2022; motor and heating diesel
  both headed "Diesel", told apart by the word under each. Columns are found
  on every page that repeats the header.
- **The stream is not in reading order** (2017 starts at ΚΑΡΔΙΤΣΗΣ), so rows
  are grouped by baseline.
- **Text arrives in pieces.** A price split in two (`1,` `917`; `1,70` `4`;
  `0` `,859`) is rejoined from fragments that touch; header words come as
  `Αμόλσβ` over `δη 95`, `Diese` `l`, `(Autoga`; names as `ΝΟΜΟ Σ ΑΡΓΟΛΙΔΟΣ`,
  so they are compared with spaces removed. A 2017 row drawn twice over
  itself is read once. A long name wraps (`ΝΟΜΟΣ ΑΙΤΩΛΙΑΣ ΚΑΙ` over
  `ΑΚΑΡΝΑΝΙΑΣ 1,645 …`), and so does the national row, whose prices can sit
  on a line of their own between `ΠΑΝΕΛΛΗΝΙΟΣ ΣΤΑΘΜΙΣΜΕΝΟΣ` and `Μ.Ο.`.

A bulletin whose headers cannot be found, or from which fewer than 40
prefectures are read, is refused as `upstream_error` rather than answered
with misplaced prices.

### 4. Some 2018–2020 bulletins have a broken Greek font

Their font maps letters to the wrong code points: ΑΤΤΙΚΗΣ extracts as
`ΑΣΣΗΚΖ΢`, in two variants (Σ→΢, Τ→Σ, Υ→Τ; and Δ→Γ, Ε→Δ … Η→Ζ, Ι→Η, Χ→Υ).
Every mistake moves a letter to its alphabetical neighbour, so `garbleFold`
folds each run of neighbours — ΓΔΕΖΗΙ, and ΣΤΥΧ with ΢ — into one class.
The 51 names stay unique under it, and garbled and true names compare equal.
Digits are never affected.

### 5. Prefectures are the old 51, and people name towns

Attica is one row; the rest are the pre-2011 prefectures, printed in the
genitive (`ΑΡΤΗΣ`). `prefectures.ts` holds each one's nominative, Greeklish
and the towns and islands people ask about instead (Santorini → Κυκλάδες,
Heraklion → Ηράκλειο, Lemnos → Λέσβος, Ithaca → Κεφαλληνία).

### 6. The weekly breakdown is read from sentences

The weekly bulletin states the refinery price (Thursday's), taxes, the
retail price (Friday's) and the margin in hand-typed sentences: the verb
takes "στα", "στο" or nothing, the € sign comes and goes, and a sentence can
break across a page with a chart's labels in between. Each figure is found
from its own anchor phrase, a missing one is null, and `consistent` says
whether refinery + taxes + margin equals the retail price to half a cent —
true in every bulletin read, 2013 to 2026.

---

## Tools

All four are read-only, idempotent and unauthenticated. Prices are € per
litre with VAT.

### `list_bulletins`

| Name | Type | Required | Description |
|---|---|---|---|
| `type` | `daily` \| `daily_national` \| `weekly` | no | Default `daily`. |
| `year`, `month` | integer | no | A month needs its year. |
| `limit` | 1–400 | no | Default 31. |

Returns `{ type, first, latest, count, truncated, bulletins: [{ date, url }] }`, newest first.

### `get_prices`

| Name | Type | Required | Description |
|---|---|---|---|
| `date` | YYYY-MM-DD | no | Default the latest. A day with none → the last before it, within 7 days, with a note. |
| `prefecture` | string | no | Greek or Greeklish, name or town; several comma-separated. Default all 51. |
| `fuel` | enum | no | `unleaded95`, `unleaded100`, `diesel`, `autogas`, `heating_oil`, `super`. |

Returns `{ date, unit, fuels: [{ fuel, name }], national, prefectures: [{ name, nameLatin, prices }], bulletinUrl, notes }`.

`{ "prefecture": "Thessaloniki" }` → 14 Oct 2026: unleaded 95 2.182, diesel
2.101, against national averages of 2.203 and 2.120.

### `get_price_history`

| Name | Type | Required | Description |
|---|---|---|---|
| `fuel` | enum | no | Default `unleaded95`. |
| `prefecture` | string | no | Default the national average. |
| `startDate`, `endDate` | YYYY-MM-DD | no | Up to 31 days; default the last 14 bulletins. |

Reads one bulletin a day, three at a time, each kept for a week. Returns
`{ fuel, fuelName, area, unit, startDate, endDate, first, last, series: [{ date, price }], missing, notes }`.
Days with no bulletin are listed in `missing`, not filled. `first` and `last`
are two published figures, not a computed change.

### `get_price_breakdown`

`date` (optional): the week whose Friday is on or before it. Returns
`{ week, unit, fuels: [{ fuel, name, refineryPrice, taxes, retailPrice, margin, shares: { refinery, taxes, margin }, consistent }], bulletinUrl, notes }`.

`{}` → week of 9 Oct 2026: unleaded 95 is 0.8862 refinery + 1.1448 taxes +
0.1700 margin = 2.2010; taxes are 52.01% of the price.

---

## Upstream reference

| Request | Notes |
|---|---|
| `GET deltia_dn.view` | Daily by prefecture; 3,400 links back to 2017-03-14; 543 KB, 0.5 s. |
| `GET deltia_d.view` | Daily national; same period; 549 KB. |
| `GET deltia.view` | Weekly; 753 links back to 2012-04-27; 130 KB, 0.2 s. |
| `GET files/deltia/{name}.pdf` | `application/pdf` with a length; 0.4–1.1 MB daily, up to 1.6 MB weekly; 0.1–0.7 s. Missing → 200 HTML. |

A day's bulletin is signed around 12:30 Athens time the day after. Weekend
bulletins exist from mid-2017; gaps remain (2019-12-28/29, 2022-01-25,
twenty-odd days in February–July 2023, 2024-01-27/28). Heating oil is
reported from 15 October to 30 April; the national average is weighted by
sales volumes of 2019 (2017 in older bulletins). `robots.txt` is a 404.

---

## Caching

Keys are namespaced `fuelprices:*`.

| What | Held | Why |
|---|---|---|
| A listing page | 1 hour | A new bulletin appears once a day. |
| A parsed bulletin, by URL | 7 days | A published bulletin does not change; a re-upload gets a new name. |
| Tool answers (`default`) | 1 hour | "Latest" moves once a day. |

No `warm` hook.

---

## Errors

| Situation | Code |
|---|---|
| Unknown prefecture | `invalid_input`, with examples |
| Unreadable date; a range over 31 days; a month with no year | `invalid_input` |
| No bulletin on or within 7 days before the date | `not_found` |
| A date after the latest bulletin | `not_found`, naming the latest |
| A missing file (HTML instead of PDF) | `not_found` |
| A bulletin whose headers or rows cannot be read | `upstream_error` |
| A fuel the bulletin has no column for | a note, and null |

---

## Verification

Run against the live site on 15 Oct 2026, and the reader against 61
bulletins on disk, one a quarter from 2017 to 2026 plus the edge cases:

- All 61 read all 51 prefectures and the national row, with no prefecture
  left without prices. That includes both broken-font variants (2019-01-14,
  2020-01-15), the April 2019 split headers, the 2021–2022 dash cells and
  split prices, and the 2017 out-of-order stream with its doubled row.
- `list_bulletins {}` → 3,396 daily bulletins, 2017-03-14 to 2026-10-14, 0.48 s.
- `get_prices {prefecture:"Thessaloniki"}` → 0.33–0.46 s cold. 2017-03-14 for
  "Άρτα, Αθήνα" → six fuels, Super blank for Arta. 2026-01-15 for Santorini
  → Κυκλάδες with heating oil. 2017-03-12, 2030-01-01 and "Atlantis" refused.
- `get_price_history` on the example → seven days for the Cyclades, 0.64 s.
- `get_price_breakdown` for 2026-10-09, 2026-01-16 (three fuels with heating
  oil), 2019-01-18 and 2013-06-14 → `consistent: true` for every fuel.
- 9 offline tests in `src/client.test.ts` cover placing by column, a split
  and a doubled price, the garbled font, a wrapped name and national row,
  refusing an unknown layout, the 51 folded names, prefecture aliases, the
  listing's dead twins and odd names, the 200-HTML missing file, and the
  weekly sentences.
