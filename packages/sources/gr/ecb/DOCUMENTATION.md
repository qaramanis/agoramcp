# `gr/ecb` — ECB Data Portal

MCP adapter over the **European Central Bank's Data Portal**, the ECB's SDMX
statistics service. It is mounted under Greece because that is how it is
meant to be asked: what the euro buys today, what Greek banks charge and pay,
how much Greek households and firms hold and owe, the Bank of Greece's TARGET
balance, the 10-year bond yield, inflation, flat prices, non-performing loans
and government debt. Every other ECB series is reachable by its key.

| | |
|---|---|
| **Mount point** | `POST /gr/mcp/ecb` |
| **Upstream** | `https://data-api.ecb.europa.eu/service/` (SDMX 2.1 REST) |
| **Authentication** | None |
| **Licence** | ESCB statistics reuse policy — free reuse, source quoted, statistics unmodified |
| **Attribution** | Source: ECB statistics (ECB Data Portal, data.ecb.europa.eu) |
| **Coverage** | 105 ECB flows, 89 published subsets (ECB.DISS) and the Eurostat and IMF flows the ECB republishes |
| **Tools** | 5 — `get_exchange_rate`, `list_greek_indicators`, `search_dataflows`, `find_series`, `get_series` |
| **Country index** | [`docs/gr-documentation.md`](../../../../docs/gr-documentation.md) — every Greek tool, one line each |

### On the licence

The ECB's reuse policy for statistics is not one of the published licences,
so `meta.ts` names it rather than an SPDX identifier. In its own words: "All
publicly available ESCB statistics may be reused free of charge on the
condition that the source is quoted (e.g. "Source: ECB statistics.") and that
the statistics (including metadata) are not modified"
([usage policy](https://www.ecb.europa.eu/stats/ecb_statistics/governance_and_quality_framework/html/usage_policy.en.html)).
The site's [disclaimer](https://www.ecb.europa.eu/services/using-our-site/disclaimer/html/index.en.html)
adds that a user who modifies the data, "e.g. by seasonal adjustment of
statistical data or calculation of growth rates", must say so.

Two consequences shape the tools:

- **Nothing is derived.** No inverse rates, no growth rates, no averages.
  Values come back exactly as published, and every answer carries a note
  saying that anything computed from them must be called derived.
- **Third-party data is flagged.** "The right of free reuse does not apply to
  third-party data without a prior permission from the originator." Market
  series whose `PROVIDER_FM` is not the ECB's own `4F` (Euribor is
  Refinitiv's), the `DCM` flow (Dealogic's) and the IMF's flows each carry a
  note saying so; Eurostat's flows say they are Eurostat's.

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
| Know what a euro buys in dollars, pounds, lira | `get_exchange_rate` |
| Know the rate on a past date, or over a period | `get_exchange_rate` with `date`, or `startDate`/`endDate` |
| Get a picture of the Greek economy in one call | `list_greek_indicators` |
| Know what Greek banks charge on a new mortgage | `list_greek_indicators`, or `get_series` on `MIR` |
| Compare Greek bond yields with Italy's and Portugal's | `get_series` with `M.GR+IT+PT.L.L40.CI.0000.EUR.N.Z` on `IRS` |
| Find a series nobody has named yet | `search_dataflows` → `find_series` → `get_series` |

---

## Read this first

### 1. Data is SDMX-JSON; structure is XML only

The data endpoint answers `format=jsondata` with SDMX-JSON 1.0. The structure
endpoints — the list of flows, the dimensions of one — answer **only**
SDMX-ML: a JSON `Accept` header is a 406 and `format=structurejson` is
ignored. `client.ts` reads the few things it needs from the XML (a flow's id,
agency, English name and structure; a structure's dimensions and their
positions) with patterns, as `gr/noa` does for QuakeML.

SDMX-JSON keeps everything by position: a series is keyed `"0:3:0:0:0"`,
each number an index into one dimension's values; its attributes are indexes
into each attribute's values; each observation is
`{ "<time index>": [value, OBS_STATUS, OBS_CONF, OBS_PRE_BREAK, OBS_COM] }`.
`decodeMessage` undoes all of it into named series.

### 2. A malformed query is answered with an "access blocked" page

A key with the wrong number of parts, a period it cannot read, a start after
the end, or **a `startPeriod` after today** is answered **400 with a 12 KB
HTML page** reading "Your access has been blocked due to security concerns".
It is not a block — the next valid call answers — but it is not worth
provoking. Keys are counted against the flow's structure and periods are read
before anything is sent; an end in the future is fine and is let through.
Should one slip past, it becomes `invalid_input`, not an upstream error.

### 3. Empty is three different answers

| Upstream says | Meaning | Becomes |
|---|---|---|
| 200 with a **0-byte body** | the key matches, the window holds nothing (a Sunday, a month not yet published) | an empty `series` with a note |
| 404 problem+json "No Series was returned" | nothing matches the key | `not_found` |
| 404 problem+json "No results found." | no such dataflow | `not_found` naming `search_dataflows` |

The shared client throws on an empty body where JSON is expected, so the data
path reads text and decides itself.

### 4. Some flows answer for years after they stopped

`ICP` stops at December 2025 — inflation lives in `HICP` now, with the suffix
`4D0`. `GST` is ESA 95 and ends in 2013–2014; government finance is `GFS`.
`ST1`, national balance of payments, ends in 2014. Each still answers with a
confident last value. Every series in a `get_series` answer carries `stale`,
true when its last observation is older than its frequency allows (30 days
daily, 270 monthly, 400 quarterly, 900 annual), and these three flows carry a
note naming their successor wherever they appear.

### 5. Codes are case-sensitive; every code is upper case

`d.usd.eur.sp00.a` is a 404. Every code seen is upper case, digits or
underscores (`_Z`, `4D0`, `XDC_R_B1GQ`), so flows and keys are upper-cased
before they are sent.

### 6. Dimension order differs per flow

`REF_AREA` is the second part in most ECB flows, the third in `GFS`, and
`EXR` has none (`FREQ.CURRENCY.CURRENCY_DENOM.EXR_TYPE.EXR_SUFFIX`). That is
why `find_series` reads the structure first and puts `GR` where the flow
wants it, and returns the dimensions in key order with the codes in use.

---

## Tools

All five are read-only, idempotent and unauthenticated.

### `get_exchange_rate`

The euro reference rate for 1–10 currencies: units of each currency per euro.

| Name | Type | Required | Description |
|---|---|---|---|
| `currencies` | string | no | ISO 4217 codes, comma-separated, up to 10: `USD,GBP`. Default `USD`. `EUR` is refused. |
| `date` | YYYY-MM-DD | no | The rate in force that day: the last set on or before it (10 days back). |
| `startDate` | YYYY-MM-DD | no | Start of a window. Default 30 days before `endDate`. |
| `endDate` | YYYY-MM-DD | no | End of a window. Default today. At most 366 days in all. |

Returns `{ base: "EUR", meaning, rates: [{ currency, name, date, rate, comment? }], window?, history?, missing, notes }`.
`history` (windows only) holds every daily rate per currency. A currency with
no rate is listed in `missing`; one whose last rate is more than 14 days old
is reported as discontinued with its final rate (`GRD` → 340.75 on
2000-12-29). A `date` with no rate of its own (weekend, TARGET holiday) says
which day's rate answered it.

`{ "currencies": "USD" }` →
`{ "rates": [{ "currency": "USD", "name": "US dollar", "date": "2026-10-15", "rate": 1.1208 }], … }`

### `list_greek_indicators`

No input. Latest and previous value of 18 pinned series, four requests at a
time:

| Id | Flow | Key |
|---|---|---|
| `bond_yield_10y` | IRS | `M.GR.L.L40.CI.0000.EUR.N.Z` |
| `inflation`, `core_inflation`, `energy_inflation`, `food_inflation` | HICP | `M.GR.N.{000000,XEF000,NRGY00,FOOD00}.4D0.ANR` |
| `mortgage_rate` | MIR | `M.GR.B.A2C.AM.R.A.2250.EUR.N` |
| `business_loan_rate` | MIR | `M.GR.B.A2A.A.R.A.2240.EUR.N` |
| `household_term_deposit_rate` | MIR | `M.GR.B.L22.F.R.A.2250.EUR.N` |
| `household_overnight_deposit_rate` | MIR | `M.GR.B.L21.A.R.A.2250.EUR.N` |
| `household_deposits` | BSI | `M.GR.N.A.L20.A.1.U2.2250.Z01.E` |
| `business_loans`, `household_loans` | BSI | `M.GR.N.A.A20.A.1.U2.{2240,2250}.Z01.E` |
| `target_balance` | TGB | `M.GR.N.A094T.U2.EUR.E` |
| `flat_prices` | RESR | `Q.GR._T.N.RTF.TVAL.GR2.TB.N.IX` |
| `sovereign_stress` | CISS | `D.GR.Z0Z.4F.EC.SOV_CIN.IDX` |
| `npl_ratio` | SUP | `Q.GR.W0._Z.I7000._T.ALL._Z._Z._Z.PCT.C` |
| `government_debt` | GFS | `A.N.GR.W0.S13.S1.C.L.LE.GD.T._Z.XDC_R_B1GQ._T.F.V.N._T` |
| `government_balance` | GFS | `A.N.GR.W0.S13.S1._Z.B.B9._Z._Z._Z.XDC_R_B1GQ._Z.S.V.N._T` |

Each row: `{ indicator, label, flow, key, period, value, status?, previousPeriod, previousValue, unit, unitMultiplier, stale }`.
A series that fails carries `error` instead, and the other seventeen still
answer. Values can be `null` with a status — the NFC loan rate for August
2026 is `Q`, suppressed.

### `search_dataflows`

| Name | Type | Required | Description |
|---|---|---|---|
| `words` | string | no | All must appear in the id or English name. |
| `limit` | 1–250 | no | Default 50. |

Returns `{ total, truncated, dataflows: [{ id, agency, name, note? }] }`. `note`
marks a superseded flow and its successor, or a flow compiled by Eurostat or
the IMF.

### `find_series`

| Name | Type | Required | Description |
|---|---|---|---|
| `flow` | string | yes | e.g. `MIR`. |
| `words` | string | no | All must appear in the key, `TITLE`, `TITLE_COMPL` or a dimension label. |
| `refArea` | string | no | Default `GR`; `""` for every country. Ignored, with a note, where the flow has no `REF_AREA`. |
| `key` | string | no | A partial key, overriding `refArea`. |
| `limit` | 1–100 | no | Default 25. |

Reads the flow's series list (`detail=nodata`, no observations) and filters it
locally — the API cannot search titles. Returns
`{ flow, name, agency, key, total, truncated, dimensions: [{ id, position, codes: [{ code, name, series }] }], series: [{ key, title, titleComplement, unit, frequency }], notes }`.
`dimensions` lists, in key order, the codes in use among the matches (30 at
most each), which is what refining a key needs. Greek series lists run from
3 KB (IRS) to 1.6 MB (BSI, 2,974 series); titles are in `TITLE`, and in some
flows (GST, SHI, MPD) only in `TITLE_COMPL`, so both are searched.

### `get_series`

| Name | Type | Required | Description |
|---|---|---|---|
| `flow` | string | yes | e.g. `IRS`. |
| `key` | string | yes | One part per dimension; empty parts are wildcards, `+` joins codes. Every part empty is refused. |
| `startPeriod` | period | no | `2025`, `2025-S1`, `2025-Q2`, `2025-09`, `2025-W41`, `2025-10-14`. Not after today. |
| `endPeriod` | period | no | Same formats. |
| `lastObservations` | 1–2000 | no | Latest N per series, inside the window if one is given. Default 12 when there is no window. |

Returns `{ flow, name, key, count, series: [{ key, title, titleComplement, unit, unitMultiplier, decimals, source, dimensions, firstPeriod, lastPeriod, stale, observations: [{ period, value, status?, comment? }] }], notes }`.
At most 20 series and 2,000 observations come back, the most recent kept, with
a note when either cap bit. `status` appears only where it is not `A`
(normal): `E` estimated, `P` provisional, `Q` suppressed, `L` not collected,
`M` cannot exist, `H` holiday.

---

## Upstream API reference

`https://data-api.ecb.europa.eu/service/` — no auth, no rate-limit headers, no
compression, chunked bodies with no `content-length`, `cache-control: max-age=30`.

| Path | Format | Notes |
|---|---|---|
| `dataflow` | SDMX-ML | Every flow of every agency: ECB 105, ECB.DISS 89, ESTAT 11, EUROSTAT 6, IMF 4. 147 KB, 0.4 s. |
| `dataflow/all/{flow}/latest?references=datastructure` | SDMX-ML | The flow and its structure: `<str:Dimension id=… position=…>` with a codelist `Ref`. About 33 KB, 0.34 s. |
| `data/{flow}/{key}?format=jsondata` | SDMX-JSON 1.0 | `startPeriod`, `endPeriod`, `lastNObservations` (combinable with a window), `firstNObservations`, `detail=nodata`/`serieskeysonly`. Agency optional: `data/GFS/…` resolves Eurostat's flow. |
| `data/{flow}/{key}?format=csvdata` | CSV | One row per observation with every attribute. Not used. |
| `codelist/ECB/{id}` | SDMX-ML | e.g. `CL_AREA`, 906 codes, 155 KB. Not used: data answers carry their own labels. |

The old host `sdw-wsrest.ecb.europa.eu` does not answer. Bodies are read
through `readCapped` at 8 MB: the dollar's whole daily history is 1.1 MB and
the unfiltered BSI series list 2 MB.

---

## Caching

Keys are namespaced `ecb:*`. TTLs live in `meta.ts`.

| What | Held | Why |
|---|---|---|
| The flow list, each flow's structure | 1 day | Structure changes a few times a year. |
| A series list (`find_series`) | 1 day | Same. |
| Data (`get_series`, `default`) | 6 hours | Monthly and quarterly series change once a release. |
| Exchange rates | 1 hour; a window closed over a week ago, 1 day | Set once a working day around 16:00 CET. |
| `list_greek_indicators` | 3 hours | Eighteen requests; all but the stress index monthly or slower. |

No `warm` hook: the one list worth holding, the flows, is a single 150 KB
request.

---

## Errors

| Situation | Code |
|---|---|
| Key with the wrong number of parts, every part empty, or bad characters | `invalid_input`, naming the flow's dimensions |
| Period unreadable, start after end, or start after today | `invalid_input` |
| `EUR` as a currency; `date` with a window; a window over 366 days | `invalid_input` |
| No series matches the key | `not_found` |
| No such dataflow | `not_found` |
| Upstream's "access blocked" 400 | `invalid_input` |
| Body over 8 MB | `upstream_error` (413) asking for a narrower key |
| 5xx, timeout, unreachable | `upstream_*` from the shared client, after its retries |

---

## Verification

Run against the live API on 15 Oct 2026 with every tool:

- `get_exchange_rate {currencies:"USD"}` → 1.1208 for 2026-10-15, 0.25 s cold.
- `{currencies:"USD,GBP,GRD,XXX", date:"2026-10-11"}` (a Sunday) →
  USD 1.1206 and GBP 0.84763 from 2026-10-09 with a note each; GRD and XXX in
  `missing`. `{currencies:"GRD"}` → 340.75 from 2000-12-29, reported as discontinued.
- `{currencies:"TRY", startDate:"2026-10-01", endDate:"2026-10-15"}` → 11 working days, 0.21 s.
- `list_greek_indicators` → 18 rows, 3.9 s cold: 10-year yield 4.22 (2026-09),
  inflation 5.1 (estimated), all `stale: false`.
- `search_dataflows {words:"interest"}` → 8 flows, 0.29 s; `"government"`
  marks GST superseded and the ESTAT flows as Eurostat's.
- `find_series {flow:"MIR", words:"house purchase"}` → 29 Greek series, 1.2 s.
  `{flow:"exr", refArea:"GR"}` → the note that EXR has no country dimension.
- `get_series` on IRS (0.32 s), `HICP M.GR+DE…` (two countries), `ICP`
  (`stale: true`, last 2025-12, the successor note), FM Euribor (the
  Refinitiv note), EXR on a Sunday (empty, with the note), `.GR` on MIR
  (`invalid_input` listing the 10 dimensions), `startPeriod: 2030-01`
  (`invalid_input`, nothing sent), flow `NOPE` (`not_found`).
- 11 offline tests in `src/client.test.ts` cover period bounds and the
  refusals that spare upstream its 400 page, key normalisation, the XML
  readers, the SDMX-JSON decoder, staleness, empty and error answers, and the
  weekend rate.
