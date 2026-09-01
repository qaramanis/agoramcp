# `gr/athens` — Δήμος Αθηναίων

MCP adapter over **opendata.cityofathens.gr**, the City of Athens open-data
portal: CKAN 2.11 with the same DCAT-AP extension as data.gov.gr, so this
source is the shared CKAN adapter (`packages/ckan`) pointed at it. Every tool,
parameter and return shape is the one documented for
[`gr/datagov`](../datagov/DOCUMENTATION.md); this page records what is
different about the city's portal and what was measured on it.

**464 datasets** (1 Sep 2026), two publishing units: the municipality itself
(331) and its geospatial-data department (133). Most of the catalogue is one
thing: **330 daily-updated datasets from the Smart Neighbourhood WiFi
network** — visitor counts per station and per neighbourhood, in the
datastore and queryable — plus 92 environmental-sensor datasets, parks and
green space, and the city's GIS layers served by its own GeoServer.

| | |
|---|---|
| **Mount point** | `POST /gr/mcp/athens` |
| **Upstream** | `https://opendata.cityofathens.gr/api/3/action/`, its datastore, and `gis.cityofathens.gr` (GeoServer WFS) for the map layers |
| **Authentication** | None. |
| **Licence** | **Not stated.** `license_id` is null on every dataset, the portal's pages state no licence, and the harvested copies on data.gov.gr (organisation `cityofathens`, 536 records) carry none either. Every result says `notspecified` with `assumed: true`. Ask the city before redistributing. |
| **Attribution** | Δήμος Αθηναίων (opendata.cityofathens.gr) and the unit named on every result |
| **Tools** | 7 — `search_datasets`, `get_dataset`, `list_organizations`, `list_tags`, `list_facets`, `query_resource`, `read_resource` |
| **Country index** | [`docs/gr-documentation.md`](../../../../docs/gr-documentation.md) |

---

## What is different from data.gov.gr

- **Everything tabular is queryable.** The city uploads its data as JSON and
  loads it into the datastore: 122 of 1,000 sampled resources are
  `datastore_active`, all JSON, and every one of the first 100 datasets has
  one. `query_resource` is the tool for this portal; `read_resource` is for
  the GIS layers, whose CSV/GeoJSON resources are live GeoServer WFS queries
  (fetchable: 19–22 KB, 0.2–0.3 s).
- **The datastore has real types.** `date`, `timestamptz`, `int4`, `text` —
  so `sort: "date desc"` and date filters behave; on data.gov.gr most columns
  are `text`.
- **Column names are English** (`station_id`, `neighbourhood_name`, `date`,
  `highest_visitors`), values Greek.
- **`organization_list` answers a GET** (2.7 s at boot, via `warm`); 200
  units are registered, 2 have datasets — the rest are hidden unless
  `includeEmpty` is set.
- **No licence facet at all**: `list_facets { "facet": "licence" }` returns
  no values and the note about the portal default.
- **The same datasets also appear on data.gov.gr** (organisation
  `cityofathens`), harvested and without a datastore; this portal is where
  the rows are.

---

## Measured, 1 Sep 2026

- `search_datasets { "text": "πάρκα" }` → 30 (0.6 s cold); `{ "tag": "wifi" }` → 248; `{ "theme": "ENVI" }` → 95;
  `{ "organization": "tmima-diaxeirisis-geoxorikon-dedomenon-poleos", "format": "GeoJSON" }` → 58.
- `get_dataset { "dataset": "wifi-highest-visitors-all-stations" }` → daily,
  themes REGI/SOCI/TECH, one JSON resource in the datastore (20,681 rows) and a ZIP.
- `query_resource` on it with `filters {"neighbourhood_name":"ΙΠΠΟΚΡΑΤΕΙΟ"}`,
  `sort "date desc"` → 299 rows, newest 2026-08-31, 0.1 s; `text "Ιπποκρατείου"`
  with `fields station_name,date,highest_visitors` → the same 299, three columns.
- `read_resource` on a GeoServer GeoJSON layer (`e1c5f7de-…`, fountains) →
  55 features, paged; a ZIP is refused with its URL.
- `list_facets`: themes in 12 combinations (REGI+SOCI+TECH 247, ENVI 92,
  REGI 50); formats JSON 329 · PNG 89 · PDF 87 · JPEG 71 · WMS 59 · CSV 58.
- `warm.ok` 2,681 ms. Tool count on `/gr/mcp`: 45, seven prefixed `athens_`.

---

## Caching, errors, upstream reference

As for `gr/datagov`, with keys namespaced `gr/athens:*` — see
[that source's documentation](../datagov/DOCUMENTATION.md#caching).
