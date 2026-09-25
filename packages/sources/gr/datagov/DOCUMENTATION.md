# `gr/datagov` — data.gov.gr

MCP adapter over **data.gov.gr**, the national open-data catalogue run by the
Ministry of Digital Governance under ν. 4305/2014. It is a stock CKAN 2.10
with the DCAT-AP extension: **22,633 datasets** from **370 bodies** (1 Sep
2026), each a description of data plus the files or services that carry it.
Most of the catalogue — 13,613 datasets — is harvested from other portals
(regional GIS servers, the Bank of Greece, ΕΚΤ), which shapes what can be
read here and what can only be linked to.

This source is the shared CKAN adapter (`packages/ckan`) pointed at one
portal. A second CKAN — the City of Athens, say — is a second `CkanPortal`
and nothing else.

| | |
|---|---|
| **Mount point** | `POST /gr/mcp/datagov` |
| **Upstream** | `https://data.gov.gr/api/3/action/` (CKAN action API), the datastore behind it, and the files the resources point at, wherever they are hosted |
| **Authentication** | None. The token-gated `/api/v1/query/{dataset}` of the old portal is gone (404); `DATAGOV_TOKEN` is not needed. |
| **Licence** | **Per dataset.** The catalogue carries 16 licence ids — CC-BY 457, ODbL 612, CC-BY-SA 148, "other (open)" 1,628, "other (non-commercial)" 928, "not specified" 3,662 — and thousands of records with none at all. Every result names its own. |
| **Attribution** | data.gov.gr and the publishing body named on every result |
| **Coverage** | The whole catalogue; rows for the ~14 % of CSV resources loaded into the datastore, plus any CSV/JSON file under 8 MB that the publisher's server still serves |
| **Tools** | 7 — `search_datasets`, `get_dataset`, `list_organizations`, `list_tags`, `list_facets`, `query_resource`, `read_resource` |
| **Country index** | [`docs/gr-documentation.md`](../../../../docs/gr-documentation.md) — every Greek tool, one line each |

Attribution is a licence condition, not a courtesy, and here the licence is
the dataset's, not the portal's: 928 datasets are non-commercial and 3,662
say nothing. `apps/server/src/mcp.ts` sends the portal-level attribution once
per session; the per-dataset `licence` on every result is what governs reuse.

---

## Contents

- [What this answers](#what-this-answers)
- [Read this first](#read-this-first)
- [Tools](#tools)
  - [`search_datasets`](#search_datasets)
  - [`get_dataset`](#get_dataset)
  - [`list_organizations`](#list_organizations)
  - [`list_tags`](#list_tags)
  - [`list_facets`](#list_facets)
  - [`query_resource`](#query_resource)
  - [`read_resource`](#read_resource)
- [Upstream API reference](#upstream-api-reference)
- [Reference data](#reference-data)
- [Caching](#caching)
- [Errors](#errors)
- [Verification](#verification)

---

## What this answers

In one sentence: **a user can find out whether the Greek state publishes data
on something, who publishes it and under what terms, and — for the tabular
part of it — read the rows without leaving the conversation.**

| The user wants to… | …when they know… | …via |
|---|---|---|
| Find out if there is data on X | words for it, a body, a theme | `search_datasets` |
| See what a body publishes | the body's slug | `search_datasets` with `organization` |
| See what a dataset contains and in which files | its slug | `get_dataset` |
| Filter and read rows of a table | a queryable resource's id | `query_resource` |
| Read a CSV or JSON file the portal only links to | the resource's id | `read_resource` |
| Name a body, a tag or a licence exactly | part of it | `list_organizations`, `list_tags`, `list_facets` |
| Know what the reuse terms are | the dataset — `licence` on every result | any of the above |

The catalogue is Greek; titles and descriptions are as the publishers wrote
them. Theme, frequency and dataset-type codes are EU vocabularies and come
back with their Greek and English labels.

---

## Read this first

Six things about the upstream that shape every tool here.

### 1. A catalogue entry is a description of data, not the data

`search_datasets` finds *datasets*; a dataset has *resources* — files or
services; only a resource can be read. Two thirds of the resources are
geospatial services (11,882 WMS layers, 4,403 GeoJSON exports, 4,300
shapefiles) and PNG legends, which nothing here reads: the adapter hands back
the URL. The path to rows is always `search_datasets` → `get_dataset` → pick a
resource → `query_resource` or `read_resource`.

### 2. Only what was uploaded to the portal is in the datastore

The datastore — the part of CKAN that lets rows be filtered upstream — is
filled only for files uploaded to data.gov.gr itself, never for harvested
records. Measured: **138 of 1,000 CSV resources** (14 %) are
`datastore_active`; 909 datasets carry a native CSV at all. `get_dataset`
marks each resource `queryable`; `search_datasets` has `queryableOnly`, which
is applied after the search because the flag is not indexed, so a page can
come back short.

`datastore_active` arrives as the string `"True"` on some records and a
boolean on others, `size` as a string or a number, `mimetype` sometimes as
the IANA registry URL. All normalised.

### 3. What a publisher calls a CSV is anyone's guess

Of five non-datastore "CSV" resources sampled, one was an HTML page (the
publisher's server lost the file), three were GeoServer WFS exports with a
geometry column, one was a plain comma-separated file. Separators vary
(`,` and `;` both common), encodings too (UTF-8 mostly, Windows-1253 still
around), and the portal's own uploads carry a BOM. `read_resource` sniffs
all of it and refuses what it cannot read — HTML, spreadsheets, archives,
anything over 8 MB — with the URL, so the user can still be handed the file.

### 4. The licence travels with the record, and often it is missing

`license_id` is null on thousands of records, "notspecified" on 3,662 more,
and one of fourteen other ids on the rest, including 928 `other-nc`
(non-commercial) and 7 `other-closed`. The adapter reports a missing licence
as the portal's "not specified" with `assumed: true`, rather than pretending
the framework's default applies to a record its publisher left blank. Treat
"not specified" as "ask the publisher", not as open.

### 5. Search is Solr, tags are free text

`text` goes to Solr as written: a bare word matches titles and descriptions
(case- and accent-insensitive), quotes make a phrase, `AND`/`OR` work, and an
unbalanced bracket is a 409 that comes back as `invalid_input` with Solr's
message. Tags are whatever 370 publishers typed — `σχολεία` (4 datasets) and
`ΣΧΟΛΕΙΑ` (1) are different tags — so `list_tags` finds the spelling and
`tag` matches it exactly, case and accents included. Themes are indexed as the
JSON list a record carries; the adapter filters them with a wildcard on the
code, which is why `theme` is an enum of the thirteen EU codes.

### 6. The register of bodies is slow

`organization_list` with details takes upstream ~8 s and refuses GET (a 400
asking for POST). It is held for a day and filled at boot by `warm`; a host
without a boot pays it on the first `list_organizations`. 515 bodies are
registered, 145 of them with no dataset — left out unless asked for.

---

## Tools

Every tool is read-only, idempotent and unauthenticated. Every handler throws
an `AgoraError` for anything the model should read as a failure; the server
turns it into a tool error.

### `search_datasets`

| Name | Type | Required | Description |
|---|---|---|---|
| `text` | string, 1–200 | no* | Solr query over titles and descriptions. |
| `organization` | slug | no* | From `list_organizations`: `chania`, `emy-2026`. |
| `tag` | string | no* | Exact tag, from `list_tags`. |
| `format` | string | no* | `CSV`, `XLSX`, `GeoJSON`, `WMS`, … (case as the portal writes it). |
| `licence` | id | no* | `cc-by`, `odc-odbl`, `other-open`, `notspecified`, … from `list_facets`. |
| `theme` | `AGRI` `ECON` `EDUC` `ENER` `ENVI` `GOVE` `HEAL` `INTR` `JUST` `REGI` `SOCI` `TECH` `TRAN` | no* | EU data theme. |
| `queryableOnly` | boolean | no | Keep datasets with a datastore resource; applied per page. |
| `sort` | `relevance` / `modified` / `title` | no | Default relevance. |
| `page`, `size` | integers | no | Zero-based; 1–100 per page, default 20. |

\* At least one of the five is required.

#### Returns

```jsonc
{
  "query": { "text": "σχολεία", "format": "CSV", "sort": "relevance", "page": 0, "size": 5, "…": null },
  "total": 62,
  "page": 0, "size": 5, "returned": 5, "hasMore": true,
  "datasets": [{
    "id": "7a8e8f70-4e9b-42e6-9058-e4c1951c6c5a",
    "name": "scholikes-monades-dimoy-naypaktias",     // what get_dataset takes
    "title": "ΣΧΟΛΙΚΕΣ ΜΟΝΑΔΕΣ ΔΗΜΟΥ ΝΑΥΠΑΚΤΙΑΣ",
    "organization": { "name": "nafpaktos", "title": "Δήμος Ναυπακτίας" },
    "licence": { "id": "notspecified", "title": "Η άδεια δεν έχει καθοριστεί", "url": null, "assumed": true },
    "summary": "Το παρόν σύνολο δεδομένων περιλαμβάνει την πλήρη και επικαιροποιημένη λίστα των σχολικών μονάδων …",
    "themes": [{ "code": "EDUC", "name": "Παιδεία, πολιτιστικά θέματα και αθλητισμός", "nameEn": "Education, culture and sport", "uri": "http://publications.europa.eu/resource/authority/data-theme/EDUC" }],
    "modifiedAt": "2026-09-01T09:23:24.482754",
    "resourceCount": 2,
    "formats": ["CSV", "XLS"],
    "queryable": true,
    "url": "https://data.gov.gr/dataset/scholikes-monades-dimoy-naypaktias"
  }]
}
```

#### Examples, measured 1 Sep 2026

- `{ "text": "σχολεία", "format": "CSV", "size": 5 }` → 62, 0.3 s; the top hits are municipal GIS layers of schools.
- `{ "organization": "chania", "format": "GeoJSON" }` → 404 of the municipality's 2,224 datasets.
- `{ "theme": "EDUC", "sort": "modified" }` → 1,516, newest first.
- `{ "tag": "σχολεία" }` → 4; `{ "tag": "ΣΧΟΛΕΙΑ" }` → 1 — different tags.
- `{ "licence": "cc-by", "queryableOnly": true, "size": 20 }` → 457 in total; the first page is the meteorological service's station files, all queryable.
- `{ "text": "title:(" }` → `invalid_input`: *data.gov.gr rejected the request: 'SOLR returned an error running query…*
- `{ "organization": "does-not-exist" }` → `total: 0`, no error.

---

### `get_dataset`

| Name | Type | Required | Description |
|---|---|---|---|
| `dataset` | slug or UUID | yes | `name` from `search_datasets`, or the id. |

Returns the summary fields plus:

```jsonc
{
  "description": "…the full text…",
  "tags": ["ΕΚΠΑΙΔΕΥΣΗ", "ΝΑΥΠΑΚΤΟΣ", "ΠΑΙΔΕΙΑ", "σχολεία"],
  "frequency": { "code": "AS_NEEDED", "name": "ανάλογα με τις ανάγκες", "nameEn": "as needed", "uri": "…" },
  "datasetTypes": [],                       // e.g. GEOSPATIAL, STATISTICAL, HVD
  "hvdCategories": [],                      // the six categories of Regulation (EU) 2023/138
  "accessRights": { "code": "PUBLIC", "…": "…" },
  "publisher": { "name": "ΔΗΜΟΣ ΝΑΥΠΑΚΤΙΑΣ", "email": "info@nafpaktos.gr", "url": "https://www.nafpaktos.gr/el/home" },
  "contact": { "name": "ΘΕΟΔΩΡΟΣ ΠΑΛΙΑΤΣΑΣ", "email": "info@nafpaktos.gr" },
  "spatialCoverage": null,                  // GeoJSON bbox on geospatial records, verbatim
  "temporalCoverage": null,
  "landingPage": "https://www.nafpaktos.gr/el/home",
  "createdAt": "2026-09-01T09:03:12.853785",
  "resources": [{
    "id": "bdba9b82-790e-4466-9235-bcc4c7f1ecfa",
    "name": "ΣΧΟΛΙΚΕΣ ΜΟΝΑΔΕΣ ΔΗΜΟΥ ΝΑΥΠΑΚΤΙΑΣ",
    "description": "…",
    "format": "CSV",
    "mimetype": "text/csv",
    "size": 3556,
    "url": "https://data.gov.gr/dataset/…/download/sxoleia.csv",
    "hosted": true,                         // uploaded to the portal, not a link elsewhere
    "queryable": true,                      // in the datastore: query_resource works
    "modifiedAt": "2026-09-01T09:18:50.081878",
    "createdAt": "2026-09-01T09:18:52.295097"
  }],
  "extra": {}                               // harvested records carry guid, harvest_source_title, wms_layer_name…
}
```

`{ "dataset": "does-not-exist" }` → `not_found`; a slug with capitals or
spaces is rejected by the schema.

---

### `list_organizations`

| Name | Type | Required | Description |
|---|---|---|---|
| `query` | string | no | Part of the name, Greek or slug; case and accents ignored. |
| `includeEmpty` | boolean | no | Include the 145 bodies with no dataset. |
| `limit` | 1–500 | no | Default 50. |

Returns `{ query, total, returned, hasMore, organizations: [{ name, title, description, datasets }] }`,
most datasets first. `{ "query": "δήμος", "limit": 5 }` → 127 municipalities,
led by Χανιά (2,224), Αγρίνιο (1,196), Ηράκλειο (937). Instant once held.

---

### `list_tags`

| Name | Type | Required | Description |
|---|---|---|---|
| `query` | string, 2–100 | yes | Part of a tag; case-insensitive, accents must match. |
| `limit` | 1–500 | no | Default 50. |

Returns the matching tags. `{ "query": "νερ" }` → 48, including `Φυσικά
μεταλλικά νερά`, `Νερά`, `Ενεργεια` — substring, so also `ανεργία`.

---

### `list_facets`

| Name | Type | Required | Description |
|---|---|---|---|
| `facet` | `licence` / `format` / `theme` / `frequency` / `hvd` / `type` | yes | |

Returns `{ facet, total, values: [...], note? }`, most datasets first.
Licences carry `title` and `url`; themes, types and HVD categories carry
`terms` with labels — a value may name several, because the portal indexes
the list a record carries as one string:

- `licence` → 16: notspecified 3,662 · other-open 1,628 · other-nc 928 · odc-odbl 612 · cc-by 457 · …
- `format` → 101: XML 12,190 · WMS 11,882 · PNG 7,677 · CSV 5,513 · GeoJSON 4,403 · SHAPE-ZIP 4,300 · …
- `theme` → 256 combinations: `REGI` alone 9,728 · `GOVE`+`REGI` 2,800 · `GOVE` 1,292 · `ENVI` 1,039 · …
- `hvd` → 14: none 21,406 · Statistics 477 · Mobility+Statistics 246 · …

---

### `query_resource`

Rows of a resource in the datastore, filtered upstream.

| Name | Type | Required | Description |
|---|---|---|---|
| `resourceId` | UUID | yes | From `get_dataset`, a resource marked `queryable`. |
| `text` | string | no | Full-text search across all columns. |
| `filters` | JSON object as a string | no | Exact matches, `{"Demos":"ΑΘΗΝΑΙΩΝ"}`. |
| `fields` | comma-separated | no | Columns to return. |
| `sort` | `column asc|desc`, comma-separated | no | |
| `limit`, `offset` | integers | no | 1–1,000 rows, default 50. |

Returns `{ resourceId, total, offset, returned, hasMore, fields: [{ name, type }], records }`.
Column names are the publisher's, as `fields` shows them on the first call —
here Greeklish (`Periokhe`, `Demos`, `Klase katanaloses`) with types `text`,
`numeric`, `int`.

Measured on ΕΥΔΑΠ's school water-consumption file (11,776 rows):
`filters {"Demos":"ΑΘΗΝΑΙΩΝ"}` → 1,613 in 0.1 s; `text "ΑΘΗΝΑ"` with
`sort "Klase katanaloses desc"` → 6; `offset 11775` → the last row,
`hasMore: false`. A bad column in `filters` or `sort` → `invalid_input` with
upstream's message (*filters: invalid value "nope"*); a resource not in the
datastore → `not_found`.

---

### `read_resource`

The file behind a resource, read here.

| Name | Type | Required | Description |
|---|---|---|---|
| `resourceId` | UUID | yes | From `get_dataset`. |
| `offset`, `limit` | integers | no | Rows or array items; 1–500, default 50. |

A table comes back as
`{ kind: "table", columns, rowCount, returned, hasMore, rows, delimiter, encoding, bytes, url, … }`,
a JSON or GeoJSON file as `{ kind: "json", itemCount, data, … }` with its
top-level array (or `features`) paged. The decoded file is cached, so paging
costs one fetch.

Measured: the ΕΥΔΑΠ file (994 KB, comma-separated, UTF-8, Greek headers) →
11,776 rows in 0.8 s; the Ναυπακτία schools file (3.5 KB, `;`-separated,
BOM) → 31 rows. Refused with the URL: XLS/XLSX, PDF, ZIP, map services and
images by format; HTML pages and unparseable bytes by content; anything over
8 MB, counted as the body arrives (after decompression), so a server that
sends no length or a small compressed body stops at the cap rather than
filling memory. Prefer `query_resource` where the resource is queryable.

The link is the publisher's, so it is fetched only if it is http or https and
every address it resolves to is on the public internet — a record pointing at
a private, loopback or link-local address, directly or through a redirect
(up to five are followed), is refused without being fetched.

---

## Upstream API reference

CKAN 2.10 action API: <https://docs.ckan.org/en/2.10/api/>. Every action is
`GET {root}api/3/action/{name}?…` returning `{ success, result }`, except
where noted. Errors are `404 {"error":{"__type":"Not Found Error"}}` and
`409 {"error":{"__type":"Validation Error"|"Search Error", …}}`.

| Action | Used by | Notes |
|---|---|---|
| `package_search?q&fq&sort&rows&start&facet.field&facet.limit` | `search_datasets`, `list_facets` | `rows` up to 1,000 works (8 s); `fq` takes `organization:`, `tags:"…"`, `res_format:"…"`, `license_id:"…"`, `theme:*data-theme/EDUC*`; `facet.limit=-1` for all values. |
| `package_show?id` | `get_dataset` | Slug or UUID. |
| `organization_list` (**POST** `{all_fields:true,limit:1000}`) | `list_organizations` | ~8 s; GET is a 400 on this portal. |
| `organization_show?id` | — | Works; not needed. |
| `tag_list?query` | `list_tags` | Substring, case-insensitive. |
| `license_list` | `list_facets` | 14 licences. |
| `datastore_search?resource_id&q&filters&fields&sort&limit&offset` | `query_resource` | `limit` clamps at 32,000; `datastore_search_sql` is disabled on this portal. |
| `resource_show?id` | `read_resource` | For the URL and format. |

Portal-specific: the DCAT-AP extension writes `theme`, `frequency`,
`dcat_type`, `hvd_category`, `access_rights` as EU authority URIs;
`publisher`, `contact`, `landing_page`, `spatial_coverage` and
`temporal_coverage` as lists; harvested records carry `extras` with the
harvest source. The vocabulary labels in `packages/ckan/src/vocab.ts` were
read back from the Publications Office's authority tables for every URI the
catalogue uses (56).

---

## Reference data

Measured 1 Sep 2026.

| | |
|---|---|
| Datasets | 22,633 — 13,613 harvested, 9,020 native |
| Bodies | 515 registered, 370 with datasets; largest Χανιά 2,224, Αγρίνιο 1,196, Περιφέρεια Κρήτης 948, Ηράκλειο 937, ΓΑΚ 890 |
| Tags | 5,639 distinct |
| Formats | 101; XML 12,190 · WMS 11,882 · PNG 7,677 · CSV 5,513 · GeoJSON 4,403 |
| CSV resources in the datastore | ~14 % (138 of 1,000 sampled) |
| Licence ids | 16 (see `list_facets`) |
| Themes | 13 EU codes in 256 combinations; `REGI` on 12,000+ |
| Update frequency | NOT_PLANNED 7,628 · DAILY 250 · ANNUAL 244 · IRREG 197 · MONTHLY 197 |

---

## Caching

Keys are namespaced `gr/datagov:*`. TTLs live in `meta.ts`.

| What | Key | Held |
|---|---|---|
| A search page | `search_datasets` | 1 hour |
| A dataset | `get_dataset` | 6 hours |
| The register of bodies | `organizations` | 1 day; filled at boot by `warm` (8.0 s measured) |
| A tag search, a facet, the licence list | `list_tags`, `facet`, `licences` | 1 day |
| A datastore page | `query_resource` | 1 hour |
| A resource's record, and its decoded file | `resource`, `file` | 6 hours |

---

## Errors

| Situation | Code | Message |
|---|---|---|
| `search_datasets` with no criteria | `invalid_input` | Give text, or at least one of organization, tag, format, licence and theme. |
| Solr rejects the query | `invalid_input` | data.gov.gr rejected the request: 'SOLR returned an error…' |
| Unknown dataset, resource, body | `not_found` | Δεν βρέθηκε (upstream's own wording) |
| Bad `filters` JSON | `invalid_input` | filters must be a JSON object of column → value… |
| Bad column in `filters` / `sort` | `invalid_input` | data.gov.gr rejected the request: filters: invalid value "…" |
| `read_resource` on a spreadsheet, archive, service or image | `invalid_input` | Resource … is XLS, which cannot be read here. It can be downloaded from … |
| The publisher's server answers HTML | `invalid_input` | …answered with a web page, not a data file… The link is probably out of date. |
| File over 8 MB, or 404 at the publisher | `upstream_error` (413) / `not_found` | …too large to read here… / The publisher's server has no file at … |
| The file's link is not http(s), or it or a redirect points at a non-public address | `invalid_input` | The file at … is not fetched here: 10.0.0.5 is not a public internet address. |

---

## Verification

Run against a server on `:3010` with every tool exercised, 1 Sep 2026:

- `tools/list` on `/gr/mcp/datagov` → 7 tools; on `/gr/mcp` → 38, the seven
  prefixed `datagov_`.
- `warm.ok` 8,037 ms (the register of bodies).
- 10 searches (text, organization, theme, tag, licence + queryableOnly,
  paging, sort), each 0.1–0.3 s; the Solr syntax error and the empty-criteria
  call rejected as designed.
- `get_dataset` by slug and by UUID on a native and a harvested record;
  `list_organizations`, `list_tags`, `list_facets` on four facets;
  `query_resource` with filters, text, sort, fields and offset plus three
  rejection cases; `read_resource` on a 994 KB comma-separated file and a
  3.5 KB semicolon-separated one, and refusing an XLS.
- Every example on `GET /` validates against its schema at boot.
