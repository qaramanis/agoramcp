# Greece — tool index

Every tool agoramcp mounts for Greece, one line each. The full reference for a
source — parameters, return shapes, upstream quirks, measured examples — is the
`DOCUMENTATION.md` inside that source's package.

| | |
|---|---|
| **Country server** | `/gr/mcp` — every source below in one server, tools prefixed with the source that answers them: `diavgeia_get_decision` |
| **Per-source servers** | `/gr/mcp/{source}` — the same tools under their plain names: `get_decision` |
| **HTTP API** | `/gr/api/{source}/{tool}` — the same tools over a plain GET or POST, no MCP client needed: `/gr/api/diavgeia/get_decision?ada=…` |

## ΑΔΜΗΕ — `admie`

The electricity transmission operator's published files: how much electricity
Greece used each day and hour since 2011 and what produced it, tomorrow's load
and renewables forecasts, and all 74 kinds of operating and market file it
posts, listed by day and read cell by cell. Full reference:
[`packages/sources/gr/admie/DOCUMENTATION.md`](../packages/sources/gr/admie/DOCUMENTATION.md).

- `list_file_types`: the 74 kinds of file the operator publishes, with what the most useful ones hold
- `list_files`: the files of one kind for a period, with their versions and links
- `read_file`: the sheets and rows of one .xls or .xlsx file
- `get_daily_energy`: a day's load, production by fuel and border flows, in MWh, by day or hour
- `get_forecast`: tomorrow's load and renewables forecast by quarter-hour, with the peak

## Δήμος Αθηναίων — `athens`

The City of Athens open-data portal: 460+ datasets on the city — daily WiFi
visitor counts per neighbourhood, environmental sensors, parks, GIS layers —
with the tables queryable in place. The same seven tools as data.gov.gr. Full
reference: [`packages/sources/gr/athens/DOCUMENTATION.md`](../packages/sources/gr/athens/DOCUMENTATION.md).

- `search_datasets`: find the city's datasets by words, unit, tag, format or EU theme
- `get_dataset`: one dataset in full — description, unit, and every file or service it carries
- `list_organizations`: the city units that publish, with how many datasets each has
- `list_tags`: find the exact spelling of a tag
- `list_facets`: how many datasets there are per format, theme, update frequency or type
- `query_resource`: filter and read the rows of a table the portal holds — the WiFi and sensor series
- `read_resource`: read a GeoJSON or CSV layer from the city's map server

## Κίνδυνος Πυρκαγιάς — `civilprotection`

The daily wildfire risk forecast of the General Secretariat for Civil
Protection, read from its official map into a category from 1 to 5 for each of
148 areas, every day of the fire season (1 May to 31 October). Full reference:
[`packages/sources/gr/civilprotection/DOCUMENTATION.md`](../packages/sources/gr/civilprotection/DOCUMENTATION.md).

- `list_maps`: the latest daily maps and the days they are for
- `get_fire_risk`: a day's risk category for every area, the highest, and the areas at it
- `get_fire_risk_at`: the risk category at a point or a named town, island or regional unit

## data.gov.gr — `datagov`

The national open-data catalogue: 22,000+ datasets from 370 bodies, each with
its publisher, licence and files, and the rows of the uploaded tables queryable
in place. Full reference:
[`packages/sources/gr/datagov/DOCUMENTATION.md`](../packages/sources/gr/datagov/DOCUMENTATION.md).

- `search_datasets`: find datasets by words, publishing body, tag, format, licence or EU theme
- `get_dataset`: one dataset in full — description, publisher, licence, and every file or service it carries
- `list_organizations`: the bodies that publish on the catalogue, with how many datasets each has
- `list_tags`: find the exact spelling of a tag
- `list_facets`: how many datasets there are per licence, format, theme, update frequency or type
- `query_resource`: filter and read the rows of a table the portal holds in its datastore
- `read_resource`: read a CSV or JSON file the portal links to, when it is not in the datastore

## Διαύγεια — `diavgeia`

The register of administrative acts every Greek public body must publish before
they take effect. Full reference:
[`packages/sources/gr/diavgeia/DOCUMENTATION.md`](../packages/sources/gr/diavgeia/DOCUMENTATION.md).

- `search_decisions`: find decisions by topic, issuing body, type, signer, dates or status
- `search_decisions_advanced`: the same search with a hand-written Lucene query, for OR, ranges and type-specific fields
- `get_decision`: the full record of one decision, by its ΑΔΑ code, with any files attached to it
- `get_decision_text`: the text of a decision's signed PDF — what the act actually says, page by page
- `get_decision_history`: every version of a decision — whether it was corrected or revoked, when, and why
- `list_decision_types`: all decision types with their codes
- `get_decision_type`: what a decision of one type contains, and which of its fields can be searched
- `search_organizations`: find a public body by name or VAT number and get its id, dissolved bodies on request
- `get_organization`: the register record of one public body
- `list_organization_units`: the departments and directorates of one body
- `get_unit`: name one department by its id, and what it sits inside
- `list_organization_signers`: who is registered to sign for a body
- `get_signer`: who a signing official is, by their id
- `list_positions`: the position titles the register uses, for the whole state or for one body
- `list_thematic_categories`: all thematic categories with their codes
- `list_dictionaries`: the vocabularies Διαύγεια publishes — CPV codes, body categories, regions and municipalities, and the rest
- `search_dictionary`: look up a code, or find codes by word, in one vocabulary

## ECB Data Portal — `ecb`

The European Central Bank's statistics, with Greece in front: euro reference
exchange rates, Greek bond yields, bank lending and deposit rates, deposits and
loans, the TARGET balance, inflation, house prices, non-performing loans and
government debt, and any other ECB series by its key. Full reference:
[`packages/sources/gr/ecb/DOCUMENTATION.md`](../packages/sources/gr/ecb/DOCUMENTATION.md).

- `get_exchange_rate`: what a euro buys in other currencies, today, on a date or over a period
- `list_greek_indicators`: the latest value of eighteen key ECB series on Greece in one call
- `search_dataflows`: find the ECB dataset that holds a statistic
- `find_series`: the series a dataset holds for Greece, with their keys
- `get_series`: the observations of one or more series by key

## Εθνικό Τυπογραφείο — `et`

The Government Gazette: laws and decrees by number and year, every ΦΕΚ issue
by series, date or the words in it, which later acts amended an act, and the
text of an issue. Full reference:
[`packages/sources/gr/et/DOCUMENTATION.md`](../packages/sources/gr/et/DOCUMENTATION.md).

- `search_legislation`: find a law or decree by number, year and words in its title, and the ΦΕΚ it was published in
- `search_gazette`: find ΦΕΚ issues by series, number, date or the words in them
- `get_gazette_issue`: one issue, who published it, and the acts that amended it or that it amends
- `get_gazette_text`: the text of a ΦΕΚ issue, page by page

## Eurostat — `eurostat`

The EU's harmonised statistics — unemployment, inflation, GDP, population,
tourism, energy and more — for Greece and its regions next to every other
member state and the EU and euro-area totals. Full reference:
[`packages/sources/gr/eurostat/DOCUMENTATION.md`](../packages/sources/gr/eurostat/DOCUMENTATION.md).

- `search_datasets`: find a dataset's code by words in its title
- `get_dataset_structure`: a dataset's dimensions and the codes each one takes
- `get_data`: figures for the countries, breakdowns and periods asked for, with the citation Eurostat asks for

## Παρατηρητήριο Τιμών Καυσίμων — `fuelprices`

The fuel price observatory's bulletins: the average pump price of each fuel in
each of the 51 prefectures and nationally, every day since March 2017, and how
a litre's price splits into refinery price, taxes and margin. Full reference:
[`packages/sources/gr/fuelprices/DOCUMENTATION.md`](../packages/sources/gr/fuelprices/DOCUMENTATION.md).

- `list_bulletins`: which daily and weekly bulletins exist
- `get_prices`: a day's fuel prices by prefecture and the national average
- `get_price_history`: one fuel's daily price over up to 31 days, for a prefecture or the country
- `get_price_breakdown`: how a litre's price splits into refinery price, taxes and margin, from the weekly bulletin

## ΚΗΜΔΗΣ — `kimdis`

The registry of public contracts: every public purchase at each step — the
request, the tender notice, the signed contract, the payment order — with
amounts, CPV codes and the signed PDF. Full reference:
[`packages/sources/gr/kimdis/DOCUMENTATION.md`](../packages/sources/gr/kimdis/DOCUMENTATION.md).

- `search_requests`: find the requests with which bodies start a purchase — what they mean to buy, and for how much
- `search_notices`: find tender notices by CPV, body, title, procedure or deadline — what is out to bid
- `search_contracts`: find signed contracts — what was bought and what it cost
- `search_payments`: find payment orders — what was actually paid, and the contract it settles
- `get_document`: one act in full by its ΑΔΑΜ code, with links to the other acts of the same purchase and to Διαύγεια
- `get_document_text`: the text of an act's signed PDF — the tender document, the contract, the payment order
- `search_organizations`: find a buying body by name or VAT number and get its uid — the same uid Διαύγεια uses

## ΜΗΤΟΣ — `mitos`

The National Registry of Administrative Procedures: every procedure a person or
business can ask the state for — documents, cost, steps, where to go, the law.
Full reference:
[`packages/sources/gr/mitos/DOCUMENTATION.md`](../packages/sources/gr/mitos/DOCUMENTATION.md).

- `search_procedures`: find procedures by words, or by life event, audience or owning body
- `get_procedure`: one procedure in full — documents needed, cost, steps in person and online, deadlines, legal basis
- `list_life_events`: the life events procedures are filed under, with counts
- `list_audiences`: who procedures are addressed to — citizens, businesses, students and the rest — with counts
- `list_recent_procedures`: the procedures whose records changed most recently
- `search_organizations`: find a body in the procedures registry by name, VAT number or id
- `get_organization`: a body's registry record — contact details, parent and sub-bodies

## Σεισμοί — `noa`

The Greek earthquake catalogue, kept by the National Observatory of Athens from
the Hellenic Unified Seismic Network: roughly 60 located events a day, reviewed
by an analyst, back to February 2011. When the catalogue answers every question
with nothing, as it did on 28 September 2026, the searches say so first in
their `notes` and `get_earthquake` answers `upstream_unavailable` rather than
`not_found`. Full reference:
[`packages/sources/gr/noa/DOCUMENTATION.md`](../packages/sources/gr/noa/DOCUMENTATION.md).

- `search_earthquakes`: find earthquakes by time, magnitude, depth and place — a bounding box or a radius around a point
- `get_earthquake`: one earthquake with the quality of its solution — stations, azimuthal gap, how far the epicentre could be out, and whether an analyst confirmed it
- `list_recent_earthquakes`: what has been located in the last day, newest first, with the largest called out

## VIES — `vies`

The EU VAT Information Exchange System: turns a VAT number into the name and
address it is registered to. This is the join the other sources need — ΚΗΜΔΗΣ,
Διαύγεια and Μίτος all identify a company by its ΑΦΜ and never by its name.
Full reference:
[`packages/sources/gr/vies/DOCUMENTATION.md`](../packages/sources/gr/vies/DOCUMENTATION.md).

- `check_vat_number`: a VAT number (ΑΦΜ) to the company name and address it is registered to, and whether the registration is live
- `list_member_states`: the 28 EU VAT registers and whether each is answering right now
