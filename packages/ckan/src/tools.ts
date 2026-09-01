import { cacheKey, defineTool, InvalidInputError, withCache, type AnySourceTool, type ToolContext } from "@agoramcp/core";
import { z } from "zod";
import { createCkanClient, REGISTER_TTL_SECONDS, type CkanClient, type CkanPortal, type Licence } from "./client.ts";
import { decode, fetchFile, readJson, readTable, sniff, MAX_FILE_BYTES } from "./files.ts";
import { term } from "./vocab.ts";

/** The thirteen EU data themes, by code; the labels come from `vocab.ts`. */
const THEMES = ["AGRI", "ECON", "EDUC", "ENER", "ENVI", "GOVE", "HEAL", "INTR", "JUST", "REGI", "SOCI", "TECH", "TRAN"] as const;
export type Theme = (typeof THEMES)[number];

/** The examples every portal has to supply: they name real records on that portal. */
export interface CkanExamples {
  searchDatasets: { text?: string; organization?: string; tag?: string; format?: string; theme?: Theme; size?: number };
  getDataset: { dataset: string };
  listOrganizations: { query?: string; limit?: number };
  listTags: { query: string; limit?: number };
  listFacets: { facet: "licence" | "format" | "theme" | "frequency" | "hvd" | "type" };
  queryResource: { resourceId: string; limit?: number; text?: string; filters?: string; sort?: string };
  readResource: { resourceId: string; limit?: number };
}

export interface CkanToolsOptions {
  portal: CkanPortal;
  examples: CkanExamples;
  /** How the portal describes itself in the first sentence of each tool. */
  blurb: string;
}

const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 20;
const MAX_ROWS = 1_000;
const DEFAULT_ROWS = 50;
const MAX_FILE_ROWS = 500;
const DEFAULT_FILE_ROWS = 50;

const FACETS = {
  licence: "license_id",
  format: "res_format",
  theme: "theme",
  frequency: "frequency",
  hvd: "hvd_category",
  type: "dcat_type",
} as const;

/** A CKAN name is lower-case, digits, hyphens and underscores; an id is a UUID. */
const datasetRef = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[a-z0-9_-]+$/u, "A dataset name is lower-case letters, digits, hyphens and underscores, e.g. scholikes-monades-dimoy-naypaktias; an id is a UUID.");

const resourceId = z
  .string()
  .trim()
  .regex(/^[0-9a-f-]{36}$/u, "A resource id is a UUID, e.g. 303d3452-7bf8-46f4-a506-0160fea2184b.");

/** Fold case and accents, so "Χανιά" finds "ΧΑΝΙΑ" and "chania" alike. */
function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toUpperCase();
}

function themeDescription(): string {
  return THEMES.map((code) => `'${code}' ${term(`http://publications.europa.eu/resource/authority/data-theme/${code}`).nameEn}`).join(", ");
}

export function createCkanTools(options: CkanToolsOptions): { tools: AnySourceTool[]; client: CkanClient } {
  const { portal, examples, blurb } = options;
  const client = createCkanClient(portal);
  const ns = portal.namespace;

  const searchDatasets = defineTool({
    name: "search_datasets",
    title: `Search ${portal.name} datasets`,
    description:
      `Search the datasets catalogued on ${portal.name} — ${blurb} ` +
      "Returns each dataset's slug, title, publishing body, licence, themes, formats and whether its rows can be queried here; get_dataset lists its files. " +
      "`text` searches titles and descriptions (Solr: quote a phrase, AND/OR between words; a bare word matches anywhere). Filters combine with AND: `organization` takes the slug from list_organizations, `tag` an exact tag from list_tags, `format` a file format such as 'CSV' or 'GeoJSON', `licence` a licence id from list_facets, `theme` one of the EU data themes. " +
      "Most datasets are geospatial layers (WMS, GeoJSON); `queryableOnly` keeps those whose rows are in the datastore and can be filtered with query_resource. " +
      "A catalogue entry is a description of data, not the data: to read rows, pick a resource from get_dataset and use query_resource (datastore) or read_resource (the file).",
    inputSchema: {
      text: z.string().trim().min(1).max(200).optional().describe("Words from the title or description. Case and accents are ignored."),
      organization: z.string().trim().min(1).max(100).optional().describe("Slug of the publishing body, from list_organizations, e.g. 'chania'."),
      tag: z.string().trim().min(1).max(100).optional().describe("An exact tag, from list_tags."),
      format: z.string().trim().min(1).max(40).optional().describe("A file format the dataset has a resource in: 'CSV', 'XLSX', 'GeoJSON', 'WMS', …"),
      licence: z.string().trim().min(1).max(120).optional().describe("A licence id, e.g. 'cc-by', 'odc-odbl', 'other-open', 'notspecified'. list_facets with 'licence' lists them."),
      theme: z.enum(THEMES).optional().describe(`EU data theme: ${themeDescription()}.`),
      queryableOnly: z.boolean().optional().describe("Only datasets with at least one resource in the datastore. Applied to each page after the search, so a page may come back short. Defaults to false."),
      sort: z.enum(["relevance", "modified", "title"]).optional().describe("'relevance' (default), 'modified' newest first, or 'title'."),
      page: z.number().int().min(0).optional().describe("Zero-based page number. Defaults to 0."),
      size: z.number().int().min(1).max(MAX_PAGE_SIZE).optional().describe(`Datasets per page, 1-${MAX_PAGE_SIZE}. Defaults to ${DEFAULT_PAGE_SIZE}.`),
    },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    example: examples.searchDatasets,
    async handler(input, context) {
      if (!input.text && !input.organization && !input.tag && !input.format && !input.licence && !input.theme) {
        throw new InvalidInputError("Give text, or at least one of organization, tag, format, licence and theme.");
      }
      const query = {
        text: input.text,
        organization: input.organization,
        tag: input.tag,
        format: input.format,
        licence: input.licence,
        theme: input.theme,
        queryableOnly: input.queryableOnly,
        sort: input.sort ?? "relevance",
        page: input.page ?? 0,
        size: input.size ?? DEFAULT_PAGE_SIZE,
      };
      const result = await withCache(context.cache, cacheKey(`${ns}:search_datasets`, query), context.ttl, () =>
        client.search(query, context.signal),
      );
      return {
        query: { ...query, text: query.text ?? null },
        total: result.total,
        page: query.page,
        size: query.size,
        returned: result.datasets.length,
        hasMore: (query.page + 1) * query.size < result.total,
        ...(query.queryableOnly
          ? { note: "queryableOnly is applied to each page after the search: `total` counts every match, and a page may come back short." }
          : {}),
        datasets: result.datasets,
      };
    },
  });

  const getDataset = defineTool({
    name: "get_dataset",
    title: "Get a dataset and its files",
    description:
      `Fetch one dataset from ${portal.name} by its slug or id: the full description, publisher and contact, licence, tags, EU theme, update frequency, coverage, and every resource (file or service) it publishes — each with its format, size, URL, and whether it is \`queryable\` (loaded into the datastore, so query_resource can filter its rows) or only downloadable. ` +
      "This is the step between finding a dataset and reading it: pick the resource, then query_resource for a queryable one or read_resource for a CSV/JSON file.",
    inputSchema: {
      dataset: datasetRef.describe("The dataset's slug from search_datasets (`name`), or its UUID."),
    },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    example: examples.getDataset,
    async handler(input, context) {
      return withCache(context.cache, cacheKey(`${ns}:get_dataset`, input.dataset), context.ttl, () =>
        client.fetchDataset(input.dataset, context.signal),
      );
    },
  });

  const listOrganizations = defineTool({
    name: "list_organizations",
    title: "List publishing bodies",
    description:
      `List the bodies that publish on ${portal.name} — ministries, regions, municipalities, agencies — with the slug \`organization\` on search_datasets takes and how many datasets each has, most first. ` +
      "`query` narrows by name (case and accents ignored). Bodies with no datasets are left out unless `includeEmpty` is set.",
    inputSchema: {
      query: z.string().trim().min(1).max(100).optional().describe("Part of the body's name, in Greek or as the slug."),
      includeEmpty: z.boolean().optional().describe("Include bodies registered with no datasets. Defaults to false."),
      limit: z.number().int().min(1).max(500).optional().describe("Most bodies to return, 1-500. Defaults to 50."),
    },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    example: examples.listOrganizations,
    async handler(input, context) {
      const all = await client.loadOrganizations(context.cache, context.signal);
      const needle = input.query ? fold(input.query) : null;
      const limit = input.limit ?? 50;
      const matched = all
        .filter((organization) => input.includeEmpty || organization.datasets > 0)
        .filter(
          (organization) =>
            needle === null ||
            fold(organization.title ?? "").includes(needle) ||
            fold(organization.name).includes(needle),
        )
        .sort((a, b) => b.datasets - a.datasets || (a.title ?? a.name).localeCompare(b.title ?? b.name, "el"));
      return {
        query: input.query ?? null,
        total: matched.length,
        returned: Math.min(matched.length, limit),
        hasMore: matched.length > limit,
        organizations: matched.slice(0, limit).map(({ logoUrl: _logo, ...organization }) => organization),
      };
    },
  });

  const listTags = defineTool({
    name: "list_tags",
    title: "Find tags",
    description:
      `Find the tags datasets on ${portal.name} carry, by part of the word — the exact spelling \`tag\` on search_datasets needs. ` +
      "Tags are free text from thousands of publishers, so the same idea appears in several spellings and cases; match the one you find.",
    inputSchema: {
      query: z.string().trim().min(2).max(100).describe("Part of a tag. Case-insensitive; accents must match."),
      limit: z.number().int().min(1).max(500).optional().describe("Most tags to return. Defaults to 50."),
    },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    example: examples.listTags,
    async handler(input, context) {
      const tags = await withCache(context.cache, cacheKey(`${ns}:list_tags`, input.query), REGISTER_TTL_SECONDS, () =>
        client.searchTags(input.query, context.signal),
      );
      const limit = input.limit ?? 50;
      return { query: input.query, total: tags.length, returned: Math.min(tags.length, limit), hasMore: tags.length > limit, tags: tags.slice(0, limit) };
    },
  });

  const listFacets = defineTool({
    name: "list_facets",
    title: "Count datasets by licence, format, theme…",
    description:
      `How the catalogue on ${portal.name} divides up: the datasets under each licence, file format, EU data theme, update frequency, dataset type or high-value-dataset category, most first. ` +
      "The values are what search_datasets takes for `licence`, `format` and `theme`. Licences matter here: this catalogue carries many, some non-commercial, and each dataset's own applies.",
    inputSchema: {
      facet: z.enum(["licence", "format", "theme", "frequency", "hvd", "type"]).describe("'licence', 'format', 'theme', 'frequency', 'hvd' (high-value-dataset category) or 'type' (dataset type)."),
    },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    example: examples.listFacets,
    async handler(input, context) {
      const field = FACETS[input.facet];
      const [counts, licences] = await Promise.all([
        withCache(context.cache, cacheKey(`${ns}:facet`, field), REGISTER_TTL_SECONDS, () => client.fetchFacet(field, context.signal)),
        input.facet === "licence"
          ? withCache(context.cache, cacheKey(`${ns}:licences`, {}), REGISTER_TTL_SECONDS, () => client.fetchLicences(context.signal))
          : Promise.resolve(null),
      ]);

      const values = counts.map(({ value, datasets }) => {
        if (input.facet === "licence") {
          const licence = licences?.find((entry) => entry.id === value);
          return { value, title: licence?.title ?? term(value).nameEn ?? null, url: licence?.url ?? null, datasets };
        }
        if (input.facet === "format") return { value, datasets };
        // Themes, types and categories are indexed as the JSON list a record
        // carries, so one value may name several terms.
        const uris = value.startsWith("[") ? (JSON.parse(value) as string[]) : [value];
        return { value, terms: uris.map(term), datasets };
      });

      return {
        facet: input.facet,
        total: values.length,
        values,
        ...(input.facet === "licence" && portal.defaultLicence
          ? { note: `Datasets with no licence recorded fall under the portal's default: ${describeLicence(portal.defaultLicence)}.` }
          : {}),
      };
    },
  });

  const queryResource = defineTool({
    name: "query_resource",
    title: "Query a resource's rows",
    description:
      `Read rows from a resource ${portal.name} has loaded into its datastore — the ones get_dataset marks \`queryable\` — with filters, full-text search, sorting and paging done upstream. ` +
      "Returns the columns with their types, the matching row count and a page of records. " +
      "`filters` is a JSON object of exact column matches, e.g. {\"Demos\": \"ΑΘΗΝΑΙΩΝ\"}; `text` matches any column; `sort` is 'column asc' or 'column desc'; `fields` picks columns. Column names are the publisher's, as the first call shows them. " +
      "Not every resource is queryable — a resource that is not gets a not-found error; use read_resource on the file instead.",
    inputSchema: {
      resourceId: resourceId.describe("The resource's UUID, from get_dataset."),
      text: z.string().trim().min(1).max(200).optional().describe("Full-text search across all columns."),
      filters: z.string().trim().min(2).max(2_000).optional().describe("JSON object of column → exact value, e.g. {\"Demos\":\"ΑΘΗΝΑΙΩΝ\"}."),
      fields: z.string().trim().min(1).max(1_000).optional().describe("Comma-separated column names to return. Defaults to all."),
      sort: z.string().trim().min(1).max(200).optional().describe("'column asc' or 'column desc'; several separated by commas."),
      limit: z.number().int().min(1).max(MAX_ROWS).optional().describe(`Rows to return, 1-${MAX_ROWS}. Defaults to ${DEFAULT_ROWS}.`),
      offset: z.number().int().min(0).optional().describe("Rows to skip. Defaults to 0."),
    },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    example: examples.queryResource,
    async handler(input, context) {
      let filters: Record<string, string | number | boolean> | undefined;
      if (input.filters) {
        try {
          const parsed: unknown = JSON.parse(input.filters);
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
          filters = parsed as Record<string, string | number | boolean>;
        } catch {
          throw new InvalidInputError('filters must be a JSON object of column → value, e.g. {"Demos":"ΑΘΗΝΑΙΩΝ"}.');
        }
      }
      const query = {
        resourceId: input.resourceId,
        text: input.text,
        filters,
        fields: input.fields?.split(",").map((field) => field.trim()).filter(Boolean),
        sort: input.sort,
        limit: input.limit ?? DEFAULT_ROWS,
        offset: input.offset ?? 0,
      };
      const page = await withCache(context.cache, cacheKey(`${ns}:query_resource`, query), context.ttl, () =>
        client.queryDatastore(query, context.signal),
      );
      return {
        resourceId: input.resourceId,
        total: page.total,
        offset: query.offset,
        returned: page.records.length,
        hasMore: query.offset + page.records.length < page.total,
        fields: page.fields,
        records: page.records,
      };
    },
  });

  const readResource = defineTool({
    name: "read_resource",
    title: "Read a resource's file",
    description:
      `Fetch the file behind a resource on ${portal.name} that is not in the datastore and read it here: a CSV (any delimiter, UTF-8 or Windows-1253) comes back as columns and rows, a JSON or GeoJSON file as its document with arrays paged. ` +
      `Files over ${MAX_FILE_BYTES / 1_048_576} MB, spreadsheets, PDFs, map services and pages that turn out to be HTML are refused with the URL, which is what to hand the user then. ` +
      "Prefer query_resource where get_dataset marks the resource queryable — it filters upstream; this reads the whole file to show a slice.",
    inputSchema: {
      resourceId: resourceId.describe("The resource's UUID, from get_dataset."),
      offset: z.number().int().min(0).optional().describe("Rows (or array items) to skip. Defaults to 0."),
      limit: z.number().int().min(1).max(MAX_FILE_ROWS).optional().describe(`Rows (or array items) to return, 1-${MAX_FILE_ROWS}. Defaults to ${DEFAULT_FILE_ROWS}.`),
    },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    example: examples.readResource,
    async handler(input, context) {
      const resource = await withCache(context.cache, cacheKey(`${ns}:resource`, input.resourceId), context.ttl, () =>
        client.fetchResource(input.resourceId, context.signal),
      );
      if (!resource.url) throw new InvalidInputError(`Resource ${input.resourceId} has no URL to fetch.`);

      const format = (resource.format ?? "").toUpperCase();
      if (["XLS", "XLSX", "ODS", "PDF", "ZIP", "SHAPE-ZIP", "WMS", "WFS", "WCS", "PNG", "JPEG", "TIF", "TIFF", "DOC", "DOCX"].includes(format)) {
        throw new InvalidInputError(
          `Resource ${input.resourceId} is ${format}, which cannot be read here. It can be downloaded from ${resource.url}.`,
        );
      }

      // The whole decoded file is cached, so paging through it costs one fetch.
      const file = await withCache(context.cache, cacheKey(`${ns}:file`, input.resourceId), context.ttl, async () => {
        const { bytes, contentType } = await fetchFile(resource.url, context.signal);
        const decoded = decode(bytes);
        return { text: decoded.text, encoding: decoded.encoding, contentType, bytes: bytes.byteLength };
      });

      const kind = sniff(file.text, file.contentType, resource.format);
      const offset = input.offset ?? 0;
      const limit = input.limit ?? DEFAULT_FILE_ROWS;

      if (kind === "html") {
        throw new InvalidInputError(
          `The publisher's server answered with a web page, not a data file, for resource ${input.resourceId} (${resource.url}). The link is probably out of date.`,
        );
      }
      if (kind === "unknown") {
        throw new InvalidInputError(
          `Resource ${input.resourceId} is not a CSV or JSON file this tool can read (labelled ${resource.format ?? "unknown"}, served as ${file.contentType ?? "unknown"}). It can be downloaded from ${resource.url}.`,
        );
      }

      const base = { resourceId: input.resourceId, name: resource.name, format: resource.format, url: resource.url, bytes: file.bytes, encoding: file.encoding, offset, limit };

      if (kind === "json") {
        let parsed;
        try {
          parsed = readJson(file.text, offset, limit);
        } catch {
          throw new InvalidInputError(`Resource ${input.resourceId} looks like JSON but does not parse. It can be downloaded from ${resource.url}.`);
        }
        return {
          ...base,
          kind: "json",
          itemCount: parsed.itemCount,
          returned: parsed.returned,
          hasMore: parsed.itemCount !== null && parsed.returned !== null && offset + parsed.returned < parsed.itemCount,
          data: parsed.data,
        };
      }

      const table = readTable(file.text, offset, limit);
      return {
        ...base,
        kind: "table",
        delimiter: table.delimiter === "\t" ? "tab" : table.delimiter,
        columns: table.columns,
        rowCount: table.rowCount,
        returned: table.rows.length,
        hasMore: offset + table.rows.length < table.rowCount,
        rows: table.rows,
      };
    },
  });

  return {
    client,
    tools: [searchDatasets, getDataset, listOrganizations, listTags, listFacets, queryResource, readResource],
  };
}

function describeLicence(licence: Licence): string {
  return licence.title ? `${licence.title} (${licence.id})` : licence.id;
}

/** What a portal's `warm` should prefetch: the register of bodies, which is the slow call. */
export async function prefetchCkan(client: CkanClient, context: Pick<ToolContext, "cache" | "signal">): Promise<void> {
  await client.loadOrganizations(context.cache, context.signal);
}
