import { createCkanTools, prefetchCkan } from "@agoramcp/ckan";
import { defineSource } from "@agoramcp/core";
import { meta } from "./meta.ts";

/**
 * The City of Athens runs CKAN 2.11 with the same DCAT-AP extension as
 * data.gov.gr, so this source is the shared adapter pointed at it. Two
 * things differ from the national portal and are set here: `organization_list`
 * answers a GET, and no record carries a licence at all.
 */
const { tools, client } = createCkanTools({
  portal: {
    baseUrl: "https://opendata.cityofathens.gr/",
    name: "opendata.cityofathens.gr",
    namespace: "gr/athens",
    // `license_id` is null on every one of the portal's datasets and its
    // pages state no licence. Reported as "not specified" rather than as a
    // grant the city has not made.
    defaultLicence: {
      id: "notspecified",
      title: "Η άδεια δεν έχει καθοριστεί",
      url: null,
      assumed: true,
    },
    organizationListMethod: "GET",
  },
  blurb:
    "the City of Athens' own catalogue of 460+ datasets: daily WiFi visitor counts per Smart Neighbourhood station, parks and green space, GIS layers of the city, traffic and municipal services.",
  examples: {
    searchDatasets: { text: "πάρκα", size: 5 },
    getDataset: { dataset: "wifi-highest-visitors-all-stations" },
    listOrganizations: { limit: 5 },
    listTags: { query: "wifi", limit: 10 },
    listFacets: { facet: "theme" },
    queryResource: {
      resourceId: "1cdccaf9-c11b-4393-b3c7-cf9d3f78ad0f",
      filters: '{"neighbourhood_name":"ΙΠΠΟΚΡΑΤΕΙΟ"}',
      sort: "date desc",
      limit: 5,
    },
    readResource: { resourceId: "e1c5f7de-feef-43af-bbec-f8247a47f2ee", limit: 3 },
  },
});

export const athensSource = defineSource({
  id: "athens",
  country: "gr",
  meta,
  tools,
  // The register of bodies takes upstream ~3 s. Fetched now so the first
  // list_organizations answers at once.
  async warm(context) {
    await prefetchCkan(client, context);
  },
});

export default athensSource;
