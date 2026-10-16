# `gr/noa` — Σεισμοί, Γεωδυναμικό Ινστιτούτο ΕΑΑ

MCP adapter over the earthquake catalogue of the **Γεωδυναμικό Ινστιτούτο του
Εθνικού Αστεροσκοπείου Αθηνών**, the Institute of Geodynamics of the National
Observatory of Athens. It is the register of record for Greek seismicity: the
Institute runs the Hellenic Unified Seismic Network (HUSN), locates what it
records, and an analyst reviews the solution rather than leaving the automatic
one standing.

Greece is the most seismically active country in Europe, and the register shows
it — **445 earthquakes in the seven days to 7 September 2026**, about sixty a
day, almost all of them far too small to feel. The catalogue opens on **1
February 2011** and its first entry is `11F00205`, a magnitude 1.4 in the
southern Peloponnese at one minute past midnight.

| | |
|---|---|
| **Mount point** | `POST /gr/mcp/noa` |
| **Upstream** | `https://eida.gein.noa.gr/fdsnws/event/1/` — FDSN `fdsnws-event` 1.2.4 |
| **Authentication** | None. No key, no registration, no quota published. |
| **Licence** | CC-BY-4.0 |
| **Attribution** | Γεωδυναμικό Ινστιτούτο, Εθνικό Αστεροσκοπείο Αθηνών — Ελληνικό Ενοποιημένο Σεισμολογικό Δίκτυο (eida.gein.noa.gr) |
| **Coverage** | 1 February 2011 to now. Greece and its surroundings — the network also locates events in Albania, North Macedonia, Bulgaria, Turkey and the wider Aegean. |
| **Tools** | 3 — `search_earthquakes`, `get_earthquake`, `list_recent_earthquakes` |
| **Country index** | [`docs/gr-documentation.md`](../../../../docs/gr-documentation.md) — every Greek tool, one line each |

### On the licence

The node that serves this API states it on its own front page: *"The content
shared from our services is licensed under a Creative Commons Attribution 4.0
International License. Copyright © Institute of Geodynamics — National
Observatory of Athens."* That is a plain CC-BY-4.0 grant from the publisher of
the data, on the same host that answers the queries, so `meta.ts` records it as
`CC-BY-4.0` without qualification.

Attribution is the licence's one condition. `apps/server/src/mcp.ts` sends it
once per session in the MCP `instructions` block and the HTTP API repeats it in
every response envelope, so a client that reads either already has it.

### Why this source does not fall back to EMSC

The obvious companion is the Euro-Mediterranean Seismological Centre, whose
`seismicportal.eu` service answers the wide queries this one cannot: twelve
months of Greece above magnitude 4 comes back in 0.69 s with 214 events, where
the same question here returns nothing at all. It was the intended fallback,
and it is not used, for two reasons found while building this.

**The licence does not allow it.** EMSC's terms open with *"All rights
reserved"* and permit reproduction *"for personal, academic, educational,
non-commercial research or other non-commercial use"*. Only *some* of its
datasets are CC-BY-4.0, and the event service is not named among them. Relaying
its records through a public API is not obviously inside that grant, and a
source that mixed a CC-BY-4.0 upstream with an all-rights-reserved one could
not honestly state a licence in `meta.ts`.

**It is also a different catalogue, not a copy of this one.** Over the same two
days and a wider box, this register held 135 events and EMSC held 94 — and none
of EMSC's were authored by NOA, they came from EMSC's own automatic solutions
plus AFAD in Turkey, IGEO and Thessaloniki. EMSC does carry NOA's reviewed
solutions, but they arrive later. Silently answering from it would have changed
both the completeness and the magnitudes of the answer while the response still
said Greece's national catalogue.

So this source is one upstream, one licence, one catalogue, and it refuses the
questions it cannot answer well rather than answering them from somewhere else.

---

## Contents

- [What this answers](#what-this-answers)
- [Read this first](#read-this-first)
- [Tools](#tools)
  - [`search_earthquakes`](#search_earthquakes)
  - [`get_earthquake`](#get_earthquake)
  - [`list_recent_earthquakes`](#list_recent_earthquakes)
- [Upstream API](#upstream-api)
- [Caching](#caching)
- [Errors](#errors)
- [Verification](#verification)

---

## What this answers

| The user wants to… | …when they know… | …via |
|---|---|---|
| Know whether something just happened | nothing at all | `list_recent_earthquakes` |
| See only what people would have felt | roughly magnitude 3 and up | `list_recent_earthquakes` with `minMagnitude` |
| Find earthquakes near a place | a latitude, a longitude and a radius | `search_earthquakes` with `latitude`, `longitude`, `radiusKm` |
| Find earthquakes in a region | the corners of a box | `search_earthquakes` with the four edge arguments |
| Find the largest of a period | a window of up to 31 days | `search_earthquakes` with `orderBy: "magnitude"` |
| Follow an aftershock sequence | when the mainshock was, and where | `search_earthquakes` with a radius and a window |
| Separate shallow from deep seismicity | a depth in kilometres | `search_earthquakes` with `minDepthKm` / `maxDepthKm` |
| Know how well an event is located | its id | `get_earthquake` |
| Know whether a solution is still automatic | its id — `quality.evaluationMode` | `get_earthquake` |

It does not answer what an earthquake did: there is no shaking intensity, no
felt report, no damage, and no fault or focal mechanism in this service.

---

## Read this first

### 1. The cost is in the window, and the window is capped at 31 days

This is one node serving the whole Greek record, and it scans the entire
requested window before it answers anything. Measured on 7 September 2026:

| Window | Filter | Result | Time |
|---|---|---|---|
| 7 days | `limit=20` | 20 events | **0.25 s** |
| 7 days | none | 445 events | 6.5 s |
| 30 days | `minmagnitude=3`, `limit=100` | 40 events | 2.4 s |
| 30 days, one region | none | 464 events | 16 s |
| 90 days | `limit=50` | 50 events | 9.7 s |
| 12 months | `minmagnitude=4`, `limit=50` | **nothing** | timed out at 90 s |

`limit` is always sent and it genuinely helps — with the default newest-first
ordering the node can stop early — but it does not rescue a wide window, as the
last row shows. Worse, that twelve-month attempt left the service returning
**503 to every caller for several minutes** afterwards, which is a cost paid by
everyone rather than by the caller who asked.

So `search_earthquakes` refuses a window longer than **31 days** outright, with
a message that says to walk the window back in instalments. A refusal in a
millisecond is a better answer than a timeout in ninety seconds that also takes
the service down.

Older windows are the slow end even inside the cap: a month of 2014 took 21 s
where a month of last summer took 5 s. Narrow windows are cheap in every era.

### 2. There are two catalogues in here, and they differ in more than age

The register changed software somewhere between 2012 and 2015, and the seam is
visible in the records:

| | Atlas era | Current era |
|---|---|---|
| Ids | `11F00205`, `01F07929` | `noa2020vipzs`, `noa2026rnaeb` |
| `Contributor` / agency | `NOAreg-Atlas` | `NOAIG`, solutions by `NOAreg1` |
| Earth model | `NOA-model_2` | `AK135` |
| Magnitude uncertainty | absent | present |
| `horizontalUncertainty` | absent | present |
| Station distances | **kilometres** | **degrees of arc** |

The id shapes matter to a caller: nothing validates ids against a pattern here
beyond "could be an id at all", because upstream does not keep one. The unit
change matters more, and is the subject of the next section.

### 3. Three fields are deliberately not reported

Every other field the upstream QuakeML carries is passed through. These three
are dropped, because no single unit reads them correctly across the register:

- **`minimumDistance` / `maximumDistance`** — distance to the nearest and
  furthest station used. The QuakeML spec says degrees of arc and the modern
  records agree: the 2026 Albanian event gives `0.4485`, a station 50 km out,
  which is what a network this dense looks like. The Atlas-era records do not:
  the 2012 event `01F07929` gives `55`, which is a plausible 55 km read as
  kilometres and an impossible 6,116 km read as degrees.
- **`latitude`/`longitude` uncertainty** — read as degrees these put the Samos
  epicentre out by 97 and 135 km, in a record whose own `horizontalUncertainty`
  says 1.9 km.
- **`confidenceEllipsoid`** — its `semiMajorAxisLength` for that same event is
  `5693539`, which is 5,693 km as metres.

A guessed unit here would produce a number that looks like evidence. The fields
that *are* reported — `horizontalUncertaintyKm`, `depthUncertaintyKm`,
`azimuthalGapDegrees`, `rmsSeconds`, the station and phase counts — read sanely
in every record checked, across both eras.

### 4. Magnitudes are MLh, and will not match a global agency

Every magnitude in this catalogue is on the **MLh** local scale, calibrated for
Greek crust and Greek station distances. The 30 October 2020 Samos earthquake
is **6.7** here; the moment magnitude the global agencies publish for it is
7.0. Neither is wrong — they measure different things — but quoting one against
the other as a discrepancy is. `get_earthquake` says so in its notes on every
event.

### 5. Nothing found, no such event and a silent catalogue are the same 204

The service answers **204 No Content with an empty body** for an empty result,
and for an id that does not exist. `search_earthquakes` reads that as an empty
list; `get_earthquake` reads it as `not_found`.

It also answers 204 to everything when its catalogue has gone, and nothing else
about it changes. On **28 September 2026** every window tried, from 2011 to
that morning, every event id and every filter came back 204 in about 50 ms,
where a month of 2014 had taken 21 s to scan. `version` still answered, so did
the station service on the same host, and the Institute's website was listing
that morning's events. Nothing had failed, so every empty list read as a quiet
period, and the Samos earthquake came back `not_found`.

So an empty answer is not believed on its own. The adapter then asks for one
hour that cannot be empty, 11:00 to 12:00 UTC on 30 October 2020, which holds
the Samos mainshock, and holds the verdict for two minutes, so a run of empty
answers costs the node one extra request rather than one each. If that hour is
empty too:

- `search_earthquakes` and `list_recent_earthquakes` still return the empty
  list, with a note first in `notes`: the catalogue is answering everything
  with nothing, so the list says nothing about the window. That answer is not
  cached, where a settled window otherwise would be for a day.
- `get_earthquake` answers `upstream_unavailable` rather than `not_found`,
  because it cannot tell a missing id from a missing catalogue.

A check that itself fails proves nothing, and the empty answer then stands as
it came. A window that closes before the catalogue opens is empty by right, and
is not checked.

Ids are matched exactly. `noa2026rnaeb` returns the event and `NOA2026RNAEB`
returns 204 — a wrong-case id looks exactly like a deleted one.

### 6. A bad argument comes back as a bare Apache 400

There is no error document. `?minmagnitude=abc` produces the stock
*"Your browser sent a request that this server could not understand"* page from
Apache 2.4.29, carrying no hint of which argument was wrong. Every argument is
therefore validated in this adapter before the call, and a 400 that still gets
through is reported as a fault in the adapter rather than in the question,
because that is what it is.

### 7. The tabular format omits the UTC marker

The `text` format writes origin times as `2026-09-06T23:40:27.528601` — no
zone, no `Z`. The same event in `csv` and in QuakeML carries the `Z`. They are
UTC in all three; only this one leaves it off, and anything parsing the tabular
rows as local time would shift every event in the catalogue by the reader's
offset. The adapter puts the marker back.

Times *given* to the tools are read as UTC for the same reason, whether or not
they carry a zone.

### Two smaller things

- **Magnitudes and depths arrive at ten decimal places** — `1.765451175`.
  That is the solver's working precision, not a claim about the earthquake,
  whose depth in that record is uncertain by ±1.6 km. They are reported to one
  decimal, as a seismological bulletin does.
- **A very fresh event may have no `eventType`** yet. The column is empty for
  the first minutes; it is reported as `null` rather than assumed to be an
  earthquake.

---

## Tools

Every tool is read-only, needs no credential, and returns plain data.

### `search_earthquakes`

Earthquakes by when, how big, how deep and where.

#### Parameters

| Name | Type | Required | Description |
|---|---|---|---|
| `startTime` | string | no | `2026-09-01` or `2026-09-01T14:30:00`. Read as UTC. Defaults to 7 days before `endTime`. |
| `endTime` | string | no | Same format. Defaults to now. |
| `minMagnitude` | number −2–10 | no | Smallest magnitude to include, MLh. |
| `maxMagnitude` | number −2–10 | no | Largest magnitude to include. |
| `minDepthKm` | number 0–800 | no | Shallowest focal depth. |
| `maxDepthKm` | number 0–800 | no | Deepest focal depth. |
| `minLatitude` | number −90–90 | no* | Southern edge of a bounding box. |
| `maxLatitude` | number −90–90 | no* | Northern edge. |
| `minLongitude` | number −180–180 | no* | Western edge. |
| `maxLongitude` | number −180–180 | no* | Eastern edge. |
| `latitude` | number −90–90 | no† | Centre of a circular search. |
| `longitude` | number −180–180 | no† | Centre of a circular search. |
| `radiusKm` | number 1–5000 | no† | Radius around that centre. |
| `orderBy` | `time` \| `time-asc` \| `magnitude` \| `magnitude-asc` | no | Default `time`, newest first. |
| `limit` | integer 1–500 | no | Default 50. |

\* Any subset of the four edges is accepted — "north of 38°" is as valid a
region as a closed rectangle, because FDSN applies each edge independently.

† A circle needs all three parts. A box and a circle together are refused:
upstream would apply both at once and answer a question nobody asked.

The window may not exceed **31 days** — see [§1](#1-the-cost-is-in-the-window-and-the-window-is-capped-at-31-days).

#### Returns

```jsonc
{
  "window":  { "start": "2026-08-08T…", "end": "2026-09-07T…", "days": 30 },
  "orderBy": "magnitude",
  "count":   5,
  "truncated": true,            // stopped at `limit`; there are more
  "earthquakes": [
    {
      "id":            "noa2026qwpaz",
      "time":          "2026-08-…Z",   // UTC, microsecond precision
      "latitude":      36.5872,
      "longitude":     21.9699,
      "depthKm":       74.1,
      "magnitude":     4.5,
      "magnitudeType": "MLh",
      "region":        "Southern Greece",
      "eventType":     "earthquake",   // null on a very fresh event
      "contributor":   "NOAIG",
      "recordUrl":     "https://eida.gein.noa.gr/fdsnws/event/1/query?eventid=…&format=xml"
    }
  ],
  "notes": [ "Stopped at the limit of 5, so these are the largest and there are others. …" ]
}
```

With a circular search each event also carries `distanceKm` and `direction`
(a compass point) from the centre asked about — computed here from the
coordinates, not supplied upstream.

`truncated` and `orderBy` decide what a count from this means. Five results
ordered by magnitude with `truncated: true` are *the five largest*, not five of
anything; the note says which.

#### Examples

```
GET /gr/api/noa/search_earthquakes?minMagnitude=3&limit=10
    → 5 events in the last 7 days, 0.43 s

GET /gr/api/noa/search_earthquakes?latitude=37.98&longitude=23.73&radiusKm=60
    → 8 events within 60 km of Athens in the last 7 days, each with its
      distance and bearing: "noa2026rlvek M2.5, 60 km ENE", 0.19 s

GET /gr/api/noa/search_earthquakes?startTime=2026-08-08&endTime=2026-09-07&orderBy=magnitude&limit=5
    → the five largest of the last 30 days, 4.5 down to 3.8, 1.08 s

GET /gr/api/noa/search_earthquakes?startTime=2026-08-08&endTime=2026-09-07&minDepthKm=80&limit=10
    → the 9 deep events of that month, 82 to 128 km — the Hellenic
      subduction zone under the southern Aegean, 0.26 s
```

#### What it cannot do

Reach past 31 days in one call, search by place name, or tell you what the
shaking felt like. There is no text search of any kind: `region` is the
catalogue's own coarse label — `Greece`, `Crete, Greece`, `Aegean Sea` — and it
is returned, not searched.

---

### `get_earthquake`

One earthquake, and how much to trust it.

#### Parameters

| Name | Type | Required | Description |
|---|---|---|---|
| `id` | string 1–64 | yes | The catalogue id from any search result, copied exactly — case included. |

#### Returns

Everything `search_earthquakes` returns for that event, plus:

```jsonc
{
  "eventTypeCertainty": "known",
  "agency":     "NOAreg1",              // the group that produced this solution
  "author":     "P.Lantzourakis",       // the analyst credited with it
  "updatedAt":  "2021-04-12T17:31:36.691655Z",
  "earthModel": "AK135",
  "quality": {
    "evaluationMode":   "manual",       // or "automatic" — nobody has reviewed it
    "evaluationStatus": "confirmed",
    "usedStationCount":  58,
    "usedPhaseCount":    60,
    "associatedPhaseCount": 60,
    "rmsSeconds":        0.39,          // residual of the fit; smaller is better
    "azimuthalGapDegrees": 65,          // widest angle with no station in it
    "horizontalUncertaintyKm": 1.9,
    "depthUncertaintyKm":      3,
    "magnitudeUncertainty":    0.14,
    "magnitudeStationCount":   19
  },
  "notes": [ … ]
}
```

`contributor` and `agency` are different things and are both kept: the network
that catalogued the event (`NOAIG`) and the working group that produced this
particular solution (`NOAreg1`).

Notes are added when the solution is still automatic, when the azimuthal gap is
180° or more — the event was located from one side and the epicentre is
correspondingly less certain — and always for the magnitude scale.

`updatedAt` is worth reading. The Samos solution above was last rewritten on
**12 April 2021**, five and a half months after the earthquake.

#### Examples

```
GET /gr/api/noa/get_earthquake?id=noa2020vipzs
    → Samos, 30 October 2020: M6.7 MLh at 11.9 km, 58 stations, gap 65°,
      epicentre good to 1.9 km, confirmed by an analyst. 0.88 s

GET /gr/api/noa/get_earthquake?id=11F00205
    → the first event in the catalogue: 1 February 2011, M1.4, 7 stations,
      gap 114°, no horizontal uncertainty recorded in that era

GET /gr/api/noa/get_earthquake?id=NOA2020VIPZS
    → not_found — ids are matched exactly, case included
```

---

### `list_recent_earthquakes`

What has shaken lately. No arguments needed.

#### Parameters

| Name | Type | Required | Description |
|---|---|---|---|
| `hours` | number 1–168 | no | How far back. Default 24. |
| `minMagnitude` | number −2–10 | no | Around 3 to see only what was felt. |
| `limit` | integer 1–200 | no | Default 20. |

#### Returns

```jsonc
{
  "hours": 24,
  "since": "2026-09-06T16:51:55.007Z",
  "count": 20,
  "truncated": true,
  "largest": { "id": "noa2026rnwhq", "magnitude": 3.7, "region": "Greece", "time": "…" },
  "earthquakes": [ … ],   // newest first
  "notes": [ … ]
}
```

`largest` is named separately because it is usually the question behind the
question, and the newest-first ordering buries it whenever the largest was not
the most recent.

#### Example

```
GET /gr/api/noa/list_recent_earthquakes
    → 20 events in the last day, largest M3.7. 0.19 s
```

---

## Upstream API

`https://eida.gein.noa.gr/fdsnws/event/1/` — the FDSN `fdsnws-event` standard,
version 1.2.4. **Must be called over https**: plain `http://` answers 301, which
reads as a dead service to anything not following redirects.

`GET query` takes: `starttime`, `endtime`, `minlatitude`, `maxlatitude`,
`minlongitude`, `maxlongitude`, `latitude`, `longitude`, `minradius`,
`maxradius`, `mindepth`, `maxdepth`, `minmagnitude`, `maxmagnitude`,
`magnitudetype`, `eventtype`, `eventid`, `catalog`, `contributor`, `limit`,
`offset`, `orderby`, `updateafter`, `nodata`, and the `includeall*` flags. The
full list is published at `application.wadl`.

Details worth knowing:

- **`format=json` is a 400.** The service offers `xml` (QuakeML), `text` and
  `csv` only. This adapter reads `text` for searches and `xml` for one event.
- **`csv` is not `text` with commas.** It has no header row and only seven
  columns against the tabular format's fourteen — no magnitude type, no author,
  no event type. `text` is the richer one.
- **Radii are in degrees of arc**, not kilometres; there is no `maxradiuskm`
  here. The tools take kilometres and divide by 111.195.
- **`mindepth`/`maxdepth` are in kilometres**, and so is the tabular `Depth/km`
  column — but QuakeML gives depth in **metres**. Verified: `mindepth=40`
  returns events at 42.6 km and up.
- **`orderby=magnitude` with a `limit` gives the N largest**, which is what
  makes "the biggest of the month" a cheap question.
- **Every query must be bounded in time.** Since July 2026 a query with no
  `starttime`, `endtime` or `eventid` is refused with the bare Apache 400, and
  so are the FDSN abbreviations `start` and `end`. The node's own page gives
  the reason: an unbounded query sorts the whole catalogue. The adapter always
  sends `starttime` and `endtime`, or an `eventid`.
- **`catalog` is listed but refused**, with "catalog filter not supported":
  SeisComP keeps no catalogue name.

## Caching

`meta.ts` sets 300 s by default, 120 s for `list_recent_earthquakes` and
1,800 s for `get_earthquake`. Seismicity is the one genuinely live thing in
this repository — a swarm adds events every few minutes — so these are short.

One override on top of that: a search whose window **closed more than seven
days ago** is cached for a day instead. Solutions are revised in the hours
after an event and then settle, so a historical window is a settled answer —
and it is also the expensive kind of query, at up to 21 s, so it is the one
worth holding. Verified: a 2011 window took 14.3 s cold and 0.003 s warm.

Cache keys cover the whole criteria object, so the same question from two
callers at once collapses into one upstream request.

The verdict on whether the catalogue has gone silent ([§5](#5-nothing-found-no-such-event-and-a-silent-catalogue-are-the-same-204))
is held for 120 s. While it says silent, an empty search is not cached at all.

## Errors

| Code | When |
|---|---|
| `invalid_input` | A window over 31 days; a start at or after the end; a date that will not parse; a box and a circle together; an incomplete circle; a min above a max; an id that could not be an id. |
| `not_found` | `get_earthquake` for an id the catalogue does not hold — including a right id in the wrong case — while the catalogue is otherwise answering. |
| `upstream_unavailable` | The node timed out or answered 503. The message says how long the window was and that narrowing it is the remedy, because it is. Also `get_earthquake` for any id while the catalogue is answering everything with nothing ([§5](#5-nothing-found-no-such-event-and-a-silent-catalogue-are-the-same-204)). |
| `upstream_error` | A 400, reported as a fault in this adapter rather than in the question, since upstream validates nothing back to us. |

Retries are chosen by window length: windows of two days or less get one retry
on a 15 s timeout, because they are cheap enough that a retry costs less than a
failure. Anything longer gets a single attempt on a 25 s timeout — re-running a
scan that just timed out is what tips this node into 503 for everyone.

## Verification

Everything above was measured against the live service on 7 September 2026, and
the numbers in it are those measurements rather than estimates.

- **Volume and span.** 445 events in the seven days to 7 September. The
  catalogue's first entry is `11F00205` at `2011-02-01T00:01:56.81Z`; every
  window before it answers 204 with no magnitude filter at all, including the
  whole of January 2011 and all four quarters of 2010.
- **The window cap.** The table in §1. The twelve-month query was attempted
  twice, at 45 s and 90 s, and returned zero bytes both times; the second
  attempt left the service on 503 for minutes.
- **The unit seam.** `01F07929` (2012) against `noa2026rnaeb` and
  `noa2020vipzs` (2020, 2026), as set out in §3.
- **The largest event in the register** is the Samos earthquake of 30 October
  2020 at MLh 6.7. Checked against every major Greek earthquake since the
  catalogue opened: Northern Aegean 2014 (6.3), Lefkada 2015 (6.0), Kos 2017
  (6.2), Zakynthos 2018 (6.6), Elassona 2021 (5.9), Crete 2025 (6.1).
- **The tools.** All three exercised over the HTTP API and listed over MCP.
  Every validation path was driven to its error: over-long window, unparseable
  date, reversed window, box with circle, partial circle, inverted magnitude
  range, wrong-case id. A pre-2011 window returns an empty list with the note
  that says why, and a window straddling 1 February 2011 returns only the part
  after it, with a note.
- **The licence** is quoted from `https://eida.gein.noa.gr/`, the host serving
  the API. EMSC's terms are quoted from `https://www.seismicportal.eu/terms.html`.

On **28 September 2026** the catalogue went silent, and §5 was built against it:

- **Nothing, everywhere, at once.** One week in June of every year from 2011
  to 2026, the day of the Samos earthquake, the first fortnight of the 2025
  Santorini swarm at magnitude 4 and up, a window in 2030: all 204, all in
  about 50 ms. So were the ids `noa2020vipzs`, `noa2026rnaeb` and `11F00205`,
  every output format, and the `contributor` and `eventtype` filters.
  `nodata=404` shows it is SeisComP itself saying "no matching events found".
- **Not moved, and not a new parameter.** The FDSN data-centre registry and
  the node's own front page still name this URL, and no other NOA host serves
  `fdsnws-event`. `catalog` is refused as unsupported, and the July 2026 rule
  that every query be bounded in time is one the adapter already met.
- **The data was upstream all along.** The Institute's website catalogue,
  now served from `bbnet2.gein.noa.gr`, listed events to 08:26 UTC that
  morning. In that record the proof hour holds two events: the Samos mainshock
  at 11:51:24 and a magnitude 3.8 at 11:07.
- **The tools, against the silent service.** Each search returned its empty
  list with the note, a window before 2011 only its own note, and
  `get_earthquake` for the Samos earthquake `upstream_unavailable`, where the
  adapter before §5 had called it `not_found`.
