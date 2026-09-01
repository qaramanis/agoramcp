import { createCkanTools, prefetchCkan } from "@agoramcp/ckan";
import { defineSource } from "@agoramcp/core";
import { meta } from "./meta.ts";

/**
 * data.gov.gr is a stock CKAN 2.10 with the DCAT-AP extension, so the whole
 * source is the shared CKAN adapter pointed at it. What is specific to this
 * portal is here: its address, how it treats a missing licence, that its
 * `organization_list` refuses GET, and the examples, which name real records.
 */
const { tools, client } = createCkanTools({
  portal: {
    baseUrl: "https://data.gov.gr/",
    name: "data.gov.gr",
    namespace: "gr/datagov",
    // 3,662 datasets say "notspecified" outright; thousands more leave the
    // field empty. Neither is a grant, so the adapter reports "not specified"
    // rather than assuming the framework's default applies to the record.
    defaultLicence: {
      id: "notspecified",
      title: "Η άδεια δεν έχει καθοριστεί",
      url: null,
      assumed: true,
    },
    organizationListMethod: "POST",
  },
  blurb:
    "the national catalogue of 22,000+ datasets from ministries, regions, municipalities and agencies: geospatial layers, statistics, registers, budgets, measurements.",
  examples: {
    searchDatasets: { text: "σχολεία", format: "CSV", size: 5 },
    getDataset: { dataset: "scholikes-monades-dimoy-naypaktias" },
    listOrganizations: { query: "δήμος", limit: 10 },
    listTags: { query: "νερ", limit: 10 },
    listFacets: { facet: "licence" },
    queryResource: { resourceId: "303d3452-7bf8-46f4-a506-0160fea2184b", filters: '{"Demos":"ΑΘΗΝΑΙΩΝ"}', limit: 5 },
    readResource: { resourceId: "303d3452-7bf8-46f4-a506-0160fea2184b", limit: 5 },
  },
});

export const datagovSource = defineSource({
  id: "datagov",
  country: "gr",
  meta,
  tools,
  // The register of bodies takes upstream ~8 s to produce. Fetched now, the
  // first list_organizations answers at once instead of paying for it.
  async warm(context) {
    await prefetchCkan(client, context);
  },
});

export default datagovSource;
