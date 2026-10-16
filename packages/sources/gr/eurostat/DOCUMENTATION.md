# `gr/eurostat` — Eurostat

MCP adapter over **Eurostat's dissemination API**: the European Union's
statistics, harmonised so that one country can be set beside another. It is
mounted under Greece and defaults to Greece (`EL`), but its point is the
comparison — Greek unemployment next to the euro area's, Attica's GDP per
head next to the EU's — so any country, aggregate or region can be asked for.

| | |
|---|---|
| **Mount point** | `POST /gr/mcp/eurostat` |
| **Upstream** | `https://ec.europa.eu/eurostat/api/dissemination/` (statistics 1.0, catalogue) |
| **Authentication** | None |
| **Licence** | `CC-BY-4.0` — with exceptions, see below |
| **Attribution** | Source: Eurostat (ec.europa.eu/eurostat); each answer carries the dataset's DOI citation |
| **Coverage** | About 7,560 datasets and tables; EU-27, EFTA, candidate countries, some others; NUTS regions |
| **Tools** | 3 — `search_datasets`, `get_dataset_structure`, `get_data` |
| **Country index** | [`docs/gr-documentation.md`](../../../../docs/gr-documentation.md) — every Greek tool, one line each |

### On the licence

From Eurostat's [copyright notice](https://ec.europa.eu/eurostat/help/copyright-notice):
"Reuse of statistical data, metadata, publications, and other dissemination
tools published on this website for commercial or non-commercial purposes is
authorised provided the source is acknowledged", under the Commission's reuse
decision of 12 December 2011, and its editorial content "is licensed under
the Creative Commons Attribution 4.0 International licence". `meta.ts`
declares `CC-BY-4.0` on that basis.

The notice lists exceptions that are non-commercial only: data belonging to
sources other than Eurostat; data on countries other than the EU, EFTA and
the official candidates; and some Swiss, Liechtenstein and Austrian trade
data. `get_data` adds a note when its rows include a country of the second
kind — the UK, the US and Japan all appear in common datasets.

Eurostat asks to be cited as "Source: [DOI of the dataset], [access date]".
Every structure and data answer carries that line in `citation`, built from
the DOI in the dataset's own annotations (`10.2908/UNE_RT_M`).

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
| Find the dataset behind a figure | `search_datasets` |
| Know a dataset's breakdowns and codes | `get_dataset_structure` |
| Greek unemployment, inflation, GDP growth, population | `get_data` |
| Greece against the EU or euro area | `get_data` with `geo: "EL,EU27_2020,EA"` |
| A Greek region | `get_data` with a NUTS code: `EL30` Attiki, `EL52` Kentriki Makedonia |

---

## Read this first

### 1. Greece is `EL`, and a wrong code fails silently

Eurostat writes Greece as `EL`. Asked for `geo=GR`, upstream answers **200
with an empty `geo` dimension and no values** — not an error. The same holds
for every unknown code in every dimension, while an unknown dimension name is
a 400. So `get_data` reads the dataset's structure first and checks every
filter against it: `GR` gets an `invalid_input` naming `EL`, and any other
unknown code gets the first fifteen valid ones and a pointer to
`get_dataset_structure`.

### 2. `lastTimePeriod` counts the dataset's periods, not each series'

`une_rt_m` with `geo=EL&lastTimePeriod=1` once came back **empty**: September
was out for other countries and not yet for Greece, and "the last period" is
the dataset's. `get_data` asks for a few more than wanted — 3 years, 4
quarters, 6 months, 10 days — and keeps each series' own latest N.

### 3. Upstream will stream any size

There is no 413 and no asynchronous answer on this endpoint: an unfiltered
`nama_10_gdp` streamed 18.5 MB in 32 s with a 200, and `demo_r_d2jan` was
still sending at 60 s. `get_data` estimates the selection before asking —
the product of every dimension's filtered or full size, times the periods —
and refuses anything over 20,000 cells, naming the dimensions left open and
their sizes. Bodies are also read through `readCapped` at 8 MB.

### 4. Structure is a data query for a period that cannot exist

`data/{code}?sinceTimePeriod=2999` returns every dimension with all its codes
and English labels, and no values: 4–45 KB in under a second, even for a
cube of nine million observations. That replaces the SDMX structure
endpoints, which are XML and, for all dataflows, 7 MB.

### 5. Discontinued datasets still answer

`prc_hicp_manr`, the old monthly inflation rate, answers with data to
December 2025 and is no longer in the catalogue; its description says it is
"discontinued and replaced by dataset prc_hicp_minr". Both
`get_dataset_structure` and `get_data` read that and say so, naming the
replacement. HICP moved to ECOICOP ver. 2: dimension `coicop18`, all-items
`TOTAL` (formerly `CP00`), units `I25`, `I15`, `RCH_M`, `RCH_A`.

### 6. English, French or German only

`lang=EL` is a 400. Titles and labels are English, so `search_datasets`
searches English words.

---

## Tools

All three are read-only, idempotent and unauthenticated.

### `search_datasets`

| Name | Type | Required | Description |
|---|---|---|---|
| `query` | string | yes | English words, all of which must appear in the title, code or folder path. |
| `type` | `dataset` \| `table` | no | Full cubes or curated tables. |
| `limit` | 1–50 | no | Default 20. |

Searches the table of contents locally. Ranked by how many words are in the
title or code (a code typed exactly comes first), then tables before
datasets, then the most recent data. Returns
`{ total, truncated, datasets: [{ code, title, type, path, lastUpdate, dataStart, dataEnd, observations }] }`.

`{ "query": "unemployment monthly" }` → 12 results, `ei_lmhu_m`,
`ei_lmhr_m`, `une_rt_m`, …

### `get_dataset_structure`

| Name | Type | Required | Description |
|---|---|---|---|
| `dataset` | string | yes | e.g. `une_rt_m`. |
| `dimension` | string | no | Only this dimension, up to 1,000 codes. |
| `search` | string | no | Words or codes to find among the codes. |

Returns `{ code, title, updated, observations, period: { oldest, latest }, doi, citation, discontinued, replacedBy, description, dimensions: [{ id, label, size, matching?, codes: [{ code, label }], truncated? }], notes }`.
100 codes per dimension unless one is named. `description` is the dataset's
own, HTML stripped, at most 800 characters.

### `get_data`

| Name | Type | Required | Description |
|---|---|---|---|
| `dataset` | string | yes | e.g. `une_rt_m`. |
| `filters` | string | no | `dimension=code`, codes by commas, filters by semicolons: `unit=PC_ACT; sex=T`. Case-insensitive; checked against the structure. |
| `geo` | string | no | Countries or regions, comma-separated: `EL,EU27_2020,EA`. Default `EL` where the dataset has Greece. |
| `startPeriod`, `endPeriod` | period | no | `2025`, `2025-S1`, `2025-Q2`, `2025-09`, `2025-W41`, `2025-10-14`. |
| `lastPeriods` | 1–60 | no | Each series' latest N. Not with a window. Default 1 with no window. |
| `limit` | 1–1000 | no | Rows. Default 200. |

Returns:

| Field | Description |
|---|---|
| `dataset` | `{ code, title, updated, doi }` |
| `constant` | Dimensions with one code in the answer, `{ id: { code, label } }` — the unit, the sex, the adjustment the rows all share. |
| `labels` | For the dimensions that vary, `{ id: { code: label } }`, only the codes present. |
| `rows` | `{ <varying dimension codes>, time, value, flag }`. `value` is null where only a flag exists (`|C`, confidential). |
| `flags` | The flags used, with their meanings: `p` provisional, `e` estimated, `b` break in series… |
| `citation`, `count`, `truncated`, `notes` | |

`{ "dataset": "une_rt_m", "filters": "unit=PC_ACT; sex=T; age=TOTAL; s_adj=SA", "geo": "EL,EA21,EU27_2020", "lastPeriods": 3 }`
→ nine rows, three months for each of Greece, the euro area and the EU.

---

## Upstream API reference

| Request | Notes |
|---|---|
| `GET statistics/1.0/data/{code}?format=JSON&lang=EN&{dim}={code}…` | JSON-stat 2.0. Time by `sinceTimePeriod`/`untilTimePeriod` or `lastTimePeriod`, never both (400). Repeated parameters for several codes. Codes and dataset ids are case-insensitive. 0.2–1 s for a filtered query. |
| `GET catalogue/toc/txt?lang=en` | Tab-separated, quoted: title (indented 4 spaces per folder level), code, type (`folder`/`dataset`/`table`), last update, last structure change, data start, data end, values. 1.97 MB, 4–8 s, no compression, no cache headers. 12,248 rows, about 7,560 distinct codes. |
| `GET catalogue/toc/xml` | 23 MB, 88 s. Not used. |

Errors are `{ "error": [{ "status", "id", "label" }] }` for every status: an
unknown dataset is 404 `ERR_NOT_FOUND_4 … is not available for
dissemination`, an unknown dimension 400 `INVALID_QUERY_DIMENSION`. JSON-stat
`value` and `status` are sparse maps from a row-major flat index, time
fastest; `extension.status.label` names the flags; `extension.annotation`
holds the DOI, `OBS_COUNT` and the overall oldest and latest periods.
Datasets are updated at 11:00 and 23:00 CET.

---

## Caching

Keys are namespaced `eurostat:*`. TTLs live in `meta.ts`.

| What | Held | Why |
|---|---|---|
| Table of contents | 6 hours | 2 MB and 4–8 s to fetch; `search_datasets` answers from it locally. |
| A dataset's structure | 6 hours | Changes with a release at most. |
| Data (`default`) | 1 hour | Releases twice a day. |

The source has a `warm` hook that loads the table of contents at boot, so the
first `search_datasets` does not wait 8 s for it.

---

## Errors

| Situation | Code |
|---|---|
| `GR` for Greece | `invalid_input` naming `EL` |
| Unknown dimension or code | `invalid_input` listing valid ones |
| `time` as a filter; a window with `lastPeriods`; an unreadable period | `invalid_input` |
| Selection over 20,000 cells | `invalid_input` naming the open dimensions |
| Unknown dataset | `not_found` |
| Other upstream 400 | `invalid_input` with Eurostat's label |
| Body over 8 MB | `upstream_error` (413) |
| 5xx, timeout, unreachable | `upstream_*` from the shared client |

---

## Verification

Run against the live API on 15 Oct 2026 with every tool:

- `search_datasets {query:"unemployment monthly"}` → 12 results; 8.2 s cold
  (the table of contents), 24 ms after. `"tps00001"` → that table alone.
- `get_dataset_structure {dataset:"une_rt_m"}` → six dimensions, DOI
  `10.2908/UNE_RT_M`, 0.26 s. `prc_hicp_minr` with `dimension:"coicop18"`,
  `search:"electricity"` → the matching codes of 555, 0.13 s.
  `prc_hicp_manr` → `discontinued: true`, `replacedBy: "prc_hicp_minr"`.
- `get_data` on the example → nine rows, 0.5 s. `prc_hicp_minr` Greece and
  euro area, last 2 → September 5.1 for Greece and 3.8 for the euro area,
  both flagged `e`. `tps00001` → Greece's population 2024–2026, the last
  flagged `ep`. `namq_10_gdp` from 2025-Q1 → six quarters, flagged `p`.
- Refusals before any data request: `geo:"GR"`, `filters:"country=EL"`,
  `nama_10_gdp` from 1995 (38,688 cells; names `unit` and `na_item`),
  `sbs_ovw_act` unfiltered (176,640 cells). `nosuchdataset` → `not_found`.
- 7 offline tests in `src/client.test.ts` cover the catalogue's indentation,
  the structure reader and its discontinued detection, JSON-stat decoding
  with a flag and no value, period arithmetic, code checks that spare a data
  request, the per-series latest with the monthly slack, and a 404.
