# `gr/admie` — ΑΔΜΗΕ, λειτουργία και αγορά ηλεκτρικής ενέργειας

MCP adapter over the **file download API of ΑΔΜΗΕ (IPTO)**, the Greek
electricity transmission system operator. It answers "how much electricity
did Greece use yesterday and what produced it", "what is tomorrow's peak
load", "how full are the reservoirs" — and, for anything else the operator
publishes, it lists the files of a type for a period and reads them cell by
cell.

| | |
|---|---|
| **Mount point** | `POST /gr/mcp/admie` |
| **Upstream** | `https://www.admie.gr/` — `getFiletypeInfo`, `getOperationMarketFilewRange`, and the files themselves |
| **Authentication** | None |
| **Licence** | Not stated — see below |
| **Attribution** | ΑΔΜΗΕ — Αρχεία Λειτουργίας & Αγοράς Ηλεκτρικής Ενέργειας (admie.gr) |
| **Coverage** | 74 file types; the daily system realisation from 2011-01-01, the ISP forecasts from 2020-10-20 |
| **Tools** | 5 — `list_file_types`, `list_files`, `read_file`, `get_daily_energy`, `get_forecast` |
| **Country index** | [`docs/gr-documentation.md`](../../../../docs/gr-documentation.md) — every Greek tool, one line each |

### On the licence

ΑΔΜΗΕ publishes no reuse licence. Its [terms of use](https://www.admie.gr/oroi-hrisis)
are a warranty disclaimer — «Τα περιεχόμενα της δικτυακής πύλης παρέχονται
«όπως ακριβώς έχουν» χωρίς καμία εγγύηση» — and one restriction, against
framing its pages. The files are posted under the operator's regulatory
transparency duties and are not on data.gov.gr. `meta.ts` says so rather than
claim a licence, as `gr/athens` does.

---

## What this answers

| The user wants to… | …via |
|---|---|
| Yesterday's (or any day's since 2011) load and production by fuel | `get_daily_energy` |
| Each hour of that | `get_daily_energy` with `hourly` |
| Tomorrow's load and renewables forecast, and its peak | `get_forecast` |
| What files exist, and what is in them | `list_file_types` |
| Border flows, reservoir levels, MV solar, ISP prices… | `list_files` → `read_file` |

---

## Read this first

### 1. The listing must always be bounded, and a typo answers `[]`

`getOperationMarketFilewRange` takes `dateStart`, `dateEnd` (`YYYY-MM-DD`) and
`FileCategory`. Without the category it returns every type (81 files for one
day, 2.4 s); without dates, the type's whole history (4.4 MB, 20 s). An
unknown category or a reversed range answers **200 `[]`** — never an error —
so `list_files` checks the code against the vocabulary first, and caps the
window at 93 days. Items do not name their type; dates are `dd.mm.yyyy`, the
publication time Greek local with no zone. File URLs cannot be built from a
date (2011–2019 files were bulk-uploaded under `2020/03/`), so a file is
always found by listing.

### 2. Versions are uploads

A file name ends `_NN`, the upload counter. A day can have two; the later is
a correction, and `list_files` keeps the highest per period unless
`allVersions` is set. Day-ahead files are listed before their day.

### 3. The core daily files are legacy .xls

The system realisation, the real-time SCADA series, MV renewables and the
reservoir levels are **BIFF8 inside an OLE2 compound file**; the ISP files are
.xlsx. `sheet.ts` reads both into plain sheets with no new dependency
beyond `fflate`: `xlsx.ts` inflates only the parts holding cells (not the
printer settings and images some files carry) and reads them with patterns;
`xls.ts` walks the compound file's FAT and DIFAT to the `Workbook` stream and
reads its records — shared strings (including a string that breaks across a
CONTINUE record and switches from one-byte to two-byte characters), LABELSST,
LABEL, NUMBER, RK, MULRK, FORMULA with its cached value and STRING, BOOLERR —
plus FORMAT and XF to tell a date from a number. Over 14 sample .xls files
from 2011 to 2026, about 38,000 cells, it agrees with `xlrd` on every one.

### 4. The day's length comes from the calendar, not the file

Recent files always carry a 25th hour column — 0 on an ordinary day, a stray
2.0 on 29 March 2026 — and older ones drop the fall-back hour. `hoursInDay`
asks Europe/Athens: 23 hours on the last Sunday of March, 25 on the last
Sunday of October.

### 5. What the realisation figures mean

- Labels were Greek until 2022 and English after: each row is found by every
  label it has carried (`ΚΑΘΑΡΟ ΦΟΡΤΙΟ` / `NET LOAD`, `ΣΥΝΟΛΟ Φ. ΑΕΡΙΟΥ` /
  `TOTAL GAS`…). The daily total is the file's own `SUM` column, not a sum
  computed here.
- **Renewables are transmission-connected only.** Most solar is connected to
  distribution and is in `RESMV` (in kWh), so this figure understates the
  renewable share. Before the 2020s the row is wind alone
  (`ΣΥΝΟΛΟ ΑΙΟΛΙΚΩΝ`), and the answer says so.
- `netExports` is exports minus imports in this file; `DailyEnergyBalanceAnalysis`
  states the opposite sign. Negative here means Greece imported more.
- The files are headed `ΣΤΟΙΧΕΙΑ SCADA ΜΗ-ΠΙΣΤΟΠΟΙΗΜΕΝΑ`: not certified.

---

## Tools

All five are read-only, idempotent and unauthenticated.

### `list_file_types`

`search` (optional). Returns `{ total, fileTypes: [{ code, process, dataType, period, frequency, timeGate, processEl, dataTypeEl, contents? }] }`.
`contents` is a plain description for the dozen most useful codes. Codes of
the old market (`DayAheadLoadForecast`, `DispatchSchedulingResults`,
`UnitProduction`, …) still exist but get no files.

### `list_files`

| Name | Type | Required | Description |
|---|---|---|---|
| `fileType` | string | yes | A code; case does not matter. |
| `from`, `to` | YYYY-MM-DD | no | Default the 7 days to tomorrow; at most 93. |
| `allVersions` | boolean | no | Every upload, not the latest per period. |

Returns `{ fileType, dataType, from, to, count, files: [{ url, fileName, version, coverageFrom, coverageTo, publishedAt, description, format }], notes? }`.

### `read_file`

| Name | Type | Required | Description |
|---|---|---|---|
| `url` | string | yes | Under `https://www.admie.gr/sites/default/files/`, ending .xls or .xlsx. |
| `sheet` | string | no | Default the first sheet that is not `XDO_METADATA` (the report generator's field list). |
| `offset` | integer | no | Non-empty rows to skip. |
| `limit` | 1–200 | no | Default 100. |

Returns `{ url, sheets: [{ name, rows, columns }], sheet, offset, count, nextOffset, rows: [{ row, cells }] }`.
Row numbers are the spreadsheet's; empty rows are left out; date-formatted
cells are ISO strings.

### `get_daily_energy`

`date` (default yesterday in Athens, from 2011-01-01), `hourly` (default
false). Returns `{ date, unit: "MWh", hoursInDay, load: { totalLoad, netLoad, atticaLoad, pumping }, generation: { lignite, gas, oil, hydro, renewables, storage }, interconnections: { imports, exports, netExports }, file, notes }`;
with `hourly`, each figure is `{ total, hourly: [...] }`. A row the file does
not have is absent; one it leaves blank is null.

`{ "date": "2026-10-14" }` → net load 117,377 MWh; renewables 88,354, gas
43,845, hydro 13,402, lignite 11,061; net exports 38,708.

### `get_forecast`

`date` (default tomorrow in Athens, from 2020-10-20). Reads the latest
versions of `ISP1DayAheadLoadForecast` and `ISP1DayAheadRESForecast` side by
side. Returns `{ date, unit: "MW", load: { version, publishedAt, url, peak: { start, mw }, low, quarterHours }, renewables, notes }`.
`quarterHours` has 96 values (92 or 100 on a clock-change day), the first for
00:00–00:15, read by the header number above each — the files have a blank
column in the middle of the run.

---

## Upstream reference

| Request | Notes |
|---|---|
| `GET getFiletypeInfo` | 74 types, Greek and English, 58 KB, 0.5 s. `description` and `code_article` are always empty; `data_type` carries HTML entities. |
| `GET getOperationMarketFilewRange?dateStart&dateEnd&FileCategory` | Files overlapping the window. 0.3–0.5 s for days; 3–20 s for years. `Cache-Control: max-age=86400`. |
| `GET sites/default/files/…` | Apache, with a length. Daily .xls 29–170 KB, ISP .xlsx 6–231 KB, offers up to 1.1 MB; 0.4–0.5 s. |

Published daily around 06:05 for the day before. The realisation has three
missing days since 2011 (2017-06-01, 2017-08-02, 2018-03-25);
`RealTimeSCADASystemLoad` has a gap from February 2018 to May 2020.

---

## Caching

Keys are namespaced `admie:*`.

| What | Held |
|---|---|
| File types | 1 day |
| A listing reaching the last two days | 15 minutes; older, 1 day |
| A read workbook, by URL | 1 day — a correction is a new URL |
| `get_daily_energy` | 1 hour |
| `get_forecast` | 30 minutes — version 2 replaces version 1 around 13:20 |

---

## Errors

| Situation | Code |
|---|---|
| Unknown file type | `invalid_input`, with close codes |
| A window over 93 days, `from` after `to`, an unreadable date | `invalid_input` |
| A URL outside ΑΔΜΗΕ's files, or not .xls/.xlsx | `invalid_input` |
| No file for the day (not yet published, or missing) | `not_found` |
| A sheet name the file does not have | `not_found`, naming its sheets |
| A workbook that cannot be read, or whose layout has changed | `upstream_error` |
| A file over 8 MB | `upstream_error` (413) |

---

## Verification

Run against the live site on 15 Oct 2026 with every tool:

- `list_file_types {search:"SCADA"}` → 4 types, 0.5 s.
- `list_files {fileType:"SystemRealizationSCADA"}` → 5 days, 0.29 s;
  `"systemrealizationscada"` for 2024-01-01 to 05 → 5 files;
  `"SystemRealisationSCADA"` → refused with the close codes.
- `read_file` on the example forecast (0.23 s) and a reservoir file
  (`ASOMATA 0.8115`); an outside URL refused.
- `get_daily_energy` for 2026-10-14 (0.39 s), 2019-06-15 (wind-only note,
  net imports of 23,686 MWh), 2011-06-15 hourly, 2026-03-29 (23 hours);
  2030-01-01 → `not_found`.
- `get_forecast` for 2026-10-14 (version 2, peak 6,170 MW at 11:15) and for
  tomorrow.
- 13 offline tests in `src/sheet.test.ts` and `src/client.test.ts`: a .xls
  built in the test as a compound file (every cell kind, a shared string
  split across CONTINUE with a change of width, a date), a broken one, an
  .xlsx with out-of-order relationships, rich and inline strings and date
  styles, serial dates, version choice, the URL check, the typo refused
  before listing, day lengths, and both parsers.
