import {
  cacheKey,
  createHttpClient,
  InvalidInputError,
  isAgoraError,
  NotFoundError,
  UpstreamError,
  withCache,
  type AgoraError,
  type Cache,
  type HttpClient,
} from "@agoramcp/core";
import { term, terms, type VocabularyTerm } from "./vocab.ts";

/**
 * A CKAN portal: the action API at `{root}api/3/action/`, the datastore
 * behind it, and the files the resources point at. Written once, over the
 * API every CKAN speaks, so a second portal is a second `CkanPortal` and
 * nothing else.
 */
export interface CkanPortal {
  /** The portal's root URL, with or without a trailing slash. */
  baseUrl: string;
  /** How the portal names itself in messages: `data.gov.gr`. */
  name: string;
  /** Cache-key prefix: `gr/datagov`. */
  namespace: string;
  /**
   * What a dataset with no `license_id` is under. Some portals leave the field
   * empty on every record and state the licence once, on their terms page;
   * others leave it empty on some records and mean "not specified".
   */
  defaultLicence: Licence | null;
  /** `organization_list` is a GET everywhere but on portals that refuse it; those want a POST. */
  organizationListMethod?: "GET" | "POST";
}

export interface Licence {
  id: string;
  title: string | null;
  url: string | null;
  /** True where the licence is the portal's default rather than the record's own. */
  assumed: boolean;
}

/* -------------------------------------------------------------------------- */
/* Upstream shapes                                                            */
/* -------------------------------------------------------------------------- */

interface RawEnvelope<T> {
  success?: boolean;
  result?: T;
  error?: RawError;
}

interface RawError {
  __type?: string;
  message?: string;
  [field: string]: unknown;
}

interface RawTag {
  name?: string | null;
  display_name?: string | null;
}

interface RawOrganizationRef {
  id?: string | null;
  name?: string | null;
  title?: string | null;
  description?: string | null;
  image_display_url?: string | null;
  package_count?: number | string | null;
  state?: string | null;
}

interface RawPublisher {
  name?: string | null;
  email?: string | null;
  url?: string | null;
  identifier?: string | null;
  type?: string | null;
}

interface RawContact {
  name?: string | null;
  email?: string | null;
  uri?: string | null;
}

interface RawResource {
  id: string;
  name?: string | null;
  description?: string | null;
  format?: string | null;
  mimetype?: string | null;
  /** A number on some records, a string on others. */
  size?: number | string | null;
  url?: string | null;
  url_type?: string | null;
  /** A boolean on some records, the string "True" on others. */
  datastore_active?: boolean | string | null;
  last_modified?: string | null;
  created?: string | null;
  metadata_modified?: string | null;
  license?: string | null;
  rights?: string | null;
  access_url?: string | null;
  download_url?: string | null;
}

interface RawPackage {
  id: string;
  name: string;
  title?: string | null;
  notes?: string | null;
  license_id?: string | null;
  license_title?: string | null;
  license_url?: string | null;
  isopen?: boolean | null;
  metadata_created?: string | null;
  metadata_modified?: string | null;
  organization?: RawOrganizationRef | null;
  tags?: RawTag[] | null;
  resources?: RawResource[] | null;
  num_resources?: number | null;
  theme?: unknown;
  frequency?: unknown;
  dcat_type?: unknown;
  hvd_category?: unknown;
  access_rights?: unknown;
  publisher?: RawPublisher[] | RawPublisher | null;
  contact?: RawContact[] | RawContact | null;
  spatial_coverage?: unknown;
  temporal_coverage?: unknown;
  landing_page?: string | string[] | null;
  url?: string | string[] | null;
  author?: string | null;
  maintainer?: string | null;
  extras?: { key?: string | null; value?: unknown }[] | null;
  [key: string]: unknown;
}

interface RawSearchResult {
  count?: number;
  results?: RawPackage[] | null;
  facets?: Record<string, Record<string, number>> | null;
}

interface RawLicence {
  id?: string | null;
  title?: string | null;
  url?: string | null;
  status?: string | null;
}

interface RawDatastoreField {
  id: string;
  type?: string | null;
}

interface RawDatastoreResult {
  total?: number | null;
  fields?: RawDatastoreField[] | null;
  records?: Record<string, unknown>[] | null;
  limit?: number | null;
  offset?: number | null;
}

/* -------------------------------------------------------------------------- */
/* Normalised shapes                                                          */
/* -------------------------------------------------------------------------- */

export interface OrganizationRef {
  /** The slug the search filter takes: `chania`. */
  name: string;
  title: string | null;
}

export interface Organization extends OrganizationRef {
  description: string | null;
  datasets: number;
  logoUrl: string | null;
}

export interface Resource {
  id: string;
  name: string | null;
  description: string | null;
  /** As the publisher labelled it: `CSV`, `GeoJSON`, `WMS`, … */
  format: string | null;
  mimetype: string | null;
  /** Bytes, where the portal knows. */
  size: number | null;
  url: string;
  /** Uploaded to the portal, or a link to the publisher's own site. */
  hosted: boolean;
  /** Loaded into the portal's datastore: rows can be queried with `query_resource`. */
  queryable: boolean;
  modifiedAt: string | null;
  createdAt: string | null;
}

export interface DatasetSummary {
  id: string;
  /** The slug, which `get_dataset` also takes. */
  name: string;
  title: string;
  organization: OrganizationRef | null;
  licence: Licence | null;
  /** The first sentence of the description. */
  summary: string | null;
  themes: VocabularyTerm[];
  modifiedAt: string | null;
  resourceCount: number;
  /** Distinct formats across the resources. */
  formats: string[];
  /** Whether any resource is in the datastore. */
  queryable: boolean;
  url: string;
}

export interface Dataset extends DatasetSummary {
  description: string | null;
  tags: string[];
  frequency: VocabularyTerm | null;
  datasetTypes: VocabularyTerm[];
  hvdCategories: VocabularyTerm[];
  accessRights: VocabularyTerm | null;
  publisher: { name: string | null; email: string | null; url: string | null } | null;
  contact: { name: string | null; email: string | null } | null;
  spatialCoverage: unknown;
  temporalCoverage: unknown;
  landingPage: string | null;
  createdAt: string | null;
  resources: Resource[];
  /** Catalogue-specific fields this adapter does not map, verbatim. */
  extra: Record<string, unknown>;
}

export interface SearchQuery {
  text?: string | undefined;
  organization?: string | undefined;
  tag?: string | undefined;
  format?: string | undefined;
  licence?: string | undefined;
  theme?: string | undefined;
  queryableOnly?: boolean | undefined;
  sort: "relevance" | "modified" | "title";
  page: number;
  size: number;
}

export interface SearchResult {
  total: number;
  datasets: DatasetSummary[];
}

export interface FacetCount {
  value: string;
  datasets: number;
}

export interface DatastoreField {
  name: string;
  /** `text`, `numeric`, `int`, `timestamp`, … — the datastore's own types. */
  type: string | null;
}

export interface DatastoreQuery {
  resourceId: string;
  text?: string | undefined;
  filters?: Record<string, string | number | boolean> | undefined;
  fields?: string[] | undefined;
  sort?: string | undefined;
  limit: number;
  offset: number;
}

export interface DatastorePage {
  total: number;
  fields: DatastoreField[];
  records: Record<string, unknown>[];
}

/* -------------------------------------------------------------------------- */
/* The client                                                                 */
/* -------------------------------------------------------------------------- */

/** Bodies, licences and vocabularies change on the order of months. */
export const REGISTER_TTL_SECONDS = 86_400;

const SORT: Record<SearchQuery["sort"], string> = {
  relevance: "score desc, metadata_modified desc",
  modified: "metadata_modified desc",
  title: "title_string asc",
};

export interface CkanClient {
  readonly portal: CkanPortal;
  search(query: SearchQuery, signal: AbortSignal): Promise<SearchResult>;
  fetchDataset(idOrName: string, signal: AbortSignal): Promise<Dataset>;
  fetchOrganizations(signal: AbortSignal): Promise<Organization[]>;
  loadOrganizations(cache: Cache, signal: AbortSignal): Promise<Organization[]>;
  fetchLicences(signal: AbortSignal): Promise<Omit<Licence, "assumed">[]>;
  fetchFacet(field: string, signal: AbortSignal): Promise<FacetCount[]>;
  searchTags(query: string, signal: AbortSignal): Promise<string[]>;
  queryDatastore(query: DatastoreQuery, signal: AbortSignal): Promise<DatastorePage>;
  /** The resource's URL and metadata, for `read_resource` to fetch the file. */
  fetchResource(id: string, signal: AbortSignal): Promise<Resource>;
  datasetUrl(name: string): string;
}

export function createCkanClient(portal: CkanPortal): CkanClient {
  const root = portal.baseUrl.endsWith("/") ? portal.baseUrl : `${portal.baseUrl}/`;
  const http = createHttpClient({
    baseUrl: `${root}api/3/action/`,
    timeoutMs: 30_000,
    retries: 2,
  });

  const datasetUrl = (name: string) => `${root}dataset/${encodeURIComponent(name)}`;

  async function action<T>(
    name: string,
    options: { query?: Record<string, string | number | boolean | undefined>; body?: unknown; method?: "GET" | "POST"; timeoutMs?: number },
    signal: AbortSignal,
  ): Promise<T> {
    let envelope: RawEnvelope<T>;
    try {
      envelope = await http.getJson<RawEnvelope<T>>(name, {
        signal,
        ...(options.query ? { query: options.query } : {}),
        ...(options.method === "POST" || options.body !== undefined
          ? {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(options.body ?? {}),
            }
          : {}),
        ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
      });
    } catch (error) {
      throw translate(error, portal.name);
    }

    if (envelope.success === false || envelope.result === undefined) {
      throw new UpstreamError(`${portal.name} answered without a result: ${envelope.error?.message ?? "unknown error"}`, {
        status: 502,
        details: { action: name, error: envelope.error ?? null },
      });
    }
    return envelope.result;
  }

  /**
   * CKAN's own errors travel as HTTP 404 / 409 with a JSON envelope naming
   * the failing field. The shared client keeps the first 500 bytes of the
   * body, which is enough for these.
   */
  function translate(error: unknown, name: string): unknown {
    if (!isAgoraError(error)) return error;
    const raw = ckanError(error);
    if (error.status === 404) {
      return new NotFoundError(raw?.message ?? `${name} has nothing under that id.`, { cause: error });
    }
    if (error.status === 409) {
      return new InvalidInputError(`${name} rejected the request: ${describeError(raw)}`, {
        cause: error,
        details: { error: raw ?? null },
      });
    }
    return error;
  }

  function ckanError(error: AgoraError): RawError | null {
    const body = error.details?.body;
    if (typeof body !== "string") return null;
    try {
      const parsed = JSON.parse(body) as RawEnvelope<unknown>;
      return parsed.error ?? null;
    } catch {
      const match = /"message":\s*"((?:[^"\\]|\\.)*)/u.exec(body);
      return match?.[1] ? { message: match[1] } : null;
    }
  }

  function describeError(raw: RawError | null): string {
    if (!raw) return "validation error";
    const fields = Object.entries(raw)
      .filter(([key]) => key !== "__type" && key !== "message")
      .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join("; ") : String(value)}`);
    const message = raw.message ? raw.message.replace(/^Search error: /u, "") : null;
    return [message, ...fields].filter(Boolean).join(" — ") || (raw.__type ?? "validation error");
  }

  function licenceOf(raw: RawPackage): Licence | null {
    const id = blankToNull(raw.license_id);
    if (id) {
      return {
        id,
        title: blankToNull(raw.license_title) ?? term(id).nameEn ?? null,
        url: blankToNull(raw.license_url) ?? (id.startsWith("http") ? id : null),
        assumed: false,
      };
    }
    return portal.defaultLicence;
  }

  function toResource(raw: RawResource): Resource {
    return {
      id: raw.id,
      name: blankToNull(raw.name),
      description: blankToNull(raw.description),
      format: blankToNull(raw.format),
      mimetype: mimeOf(raw.mimetype),
      size: num(raw.size),
      url: blankToNull(raw.url) ?? "",
      hosted: raw.url_type === "upload",
      queryable: flag(raw.datastore_active),
      modifiedAt: blankToNull(raw.last_modified) ?? blankToNull(raw.metadata_modified),
      createdAt: blankToNull(raw.created),
    };
  }

  function toSummary(raw: RawPackage): DatasetSummary {
    const resources = (raw.resources ?? []).map(toResource);
    return {
      id: raw.id,
      name: raw.name,
      title: blankToNull(raw.title) ?? raw.name,
      organization: raw.organization?.name
        ? { name: raw.organization.name, title: blankToNull(raw.organization.title) }
        : null,
      licence: licenceOf(raw),
      summary: firstSentence(raw.notes),
      themes: terms(raw.theme),
      modifiedAt: blankToNull(raw.metadata_modified),
      resourceCount: raw.num_resources ?? resources.length,
      formats: unique(resources.map((resource) => resource.format)),
      queryable: resources.some((resource) => resource.queryable),
      url: datasetUrl(raw.name),
    };
  }

  function toDataset(raw: RawPackage): Dataset {
    const publisher = first(raw.publisher);
    const contact = first(raw.contact);
    const frequency = terms(raw.frequency)[0] ?? null;
    const accessRights = terms(raw.access_rights)[0] ?? null;

    const extra: Record<string, unknown> = {};
    for (const entry of raw.extras ?? []) {
      if (entry.key && entry.value !== null && entry.value !== undefined && entry.value !== "") extra[entry.key] = entry.value;
    }

    return {
      ...toSummary(raw),
      description: blankToNull(raw.notes),
      tags: unique((raw.tags ?? []).map((tag) => blankToNull(tag.display_name) ?? blankToNull(tag.name))),
      frequency,
      datasetTypes: terms(raw.dcat_type),
      hvdCategories: terms(raw.hvd_category),
      accessRights,
      publisher: publisher
        ? { name: blankToNull(publisher.name) ?? blankToNull(publisher.identifier), email: blankToNull(publisher.email), url: blankToNull(publisher.url) }
        : null,
      contact: contact ? { name: blankToNull(contact.name), email: blankToNull(contact.email) } : null,
      spatialCoverage: emptyToNull(raw.spatial_coverage),
      temporalCoverage: emptyToNull(raw.temporal_coverage),
      landingPage: firstString(raw.landing_page) ?? firstString(raw.url),
      createdAt: blankToNull(raw.metadata_created),
      resources: (raw.resources ?? []).map(toResource),
      extra,
    };
  }

  return {
    portal,
    datasetUrl,

    async search(query, signal) {
      const fq: string[] = [];
      if (query.organization) fq.push(`organization:${solrTerm(query.organization)}`);
      if (query.tag) fq.push(`tags:${solrTerm(query.tag)}`);
      if (query.format) fq.push(`res_format:${solrTerm(query.format)}`);
      if (query.licence) fq.push(`license_id:${solrTerm(query.licence)}`);
      if (query.theme) fq.push(`theme:*data-theme/${query.theme.toUpperCase().replace(/[^A-Z_]/gu, "")}*`);

      const result = await action<RawSearchResult>(
        "package_search",
        {
          query: {
            q: query.text ?? "*:*",
            fq: fq.length > 0 ? fq.join(" AND ") : undefined,
            sort: SORT[query.sort],
            rows: query.size,
            start: query.page * query.size,
          },
        },
        signal,
      );

      let datasets = (result.results ?? []).map(toSummary);
      // The datastore flag is not indexed, so it is applied on the page.
      if (query.queryableOnly) datasets = datasets.filter((dataset) => dataset.queryable);
      return { total: result.count ?? datasets.length, datasets };
    },

    async fetchDataset(idOrName, signal) {
      const raw = await action<RawPackage>("package_show", { query: { id: idOrName } }, signal);
      return toDataset(raw);
    },

    async fetchOrganizations(signal) {
      const rows = await action<RawOrganizationRef[]>(
        "organization_list",
        portal.organizationListMethod === "POST"
          ? { body: { all_fields: true, limit: 1_000 }, timeoutMs: 60_000 }
          : { query: { all_fields: true, limit: 1_000 }, timeoutMs: 60_000 },
        signal,
      );
      return rows
        .filter((row) => row.name)
        .map((row) => ({
          name: row.name as string,
          title: blankToNull(row.title),
          description: blankToNull(row.description),
          datasets: num(row.package_count) ?? 0,
          logoUrl: blankToNull(row.image_display_url),
        }));
    },

    loadOrganizations(cache, signal) {
      return withCache(cache, cacheKey(`${portal.namespace}:organizations`, {}), REGISTER_TTL_SECONDS, () =>
        this.fetchOrganizations(signal),
      );
    },

    async fetchLicences(signal) {
      const rows = await action<RawLicence[]>("license_list", {}, signal);
      return rows
        .filter((row) => row.id)
        .map((row) => ({ id: row.id as string, title: blankToNull(row.title), url: blankToNull(row.url) }));
    },

    async fetchFacet(field, signal) {
      const result = await action<RawSearchResult>(
        "package_search",
        { query: { q: "*:*", rows: 0, "facet.field": JSON.stringify([field]), "facet.limit": -1 } },
        signal,
      );
      const counts = result.facets?.[field] ?? {};
      return Object.entries(counts)
        .map(([value, datasets]) => ({ value, datasets }))
        .sort((a, b) => b.datasets - a.datasets || a.value.localeCompare(b.value));
    },

    async searchTags(query, signal) {
      const rows = await action<(string | RawTag)[]>("tag_list", { query: { query } }, signal);
      return unique(rows.map((row) => (typeof row === "string" ? row : blankToNull(row.name))));
    },

    async queryDatastore(query, signal) {
      const result = await action<RawDatastoreResult>(
        "datastore_search",
        {
          query: {
            resource_id: query.resourceId,
            q: query.text,
            filters: query.filters ? JSON.stringify(query.filters) : undefined,
            fields: query.fields?.join(","),
            sort: query.sort,
            limit: query.limit,
            offset: query.offset,
          },
        },
        signal,
      );
      return {
        total: result.total ?? (result.records ?? []).length,
        fields: (result.fields ?? []).map((field) => ({ name: field.id, type: blankToNull(field.type) })),
        records: result.records ?? [],
      };
    },

    async fetchResource(id, signal) {
      const raw = await action<RawResource>("resource_show", { query: { id } }, signal);
      return toResource(raw);
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/** A Solr term: quoted, with the quote and the backslash escaped. */
function solrTerm(value: string): string {
  return `"${value.replace(/["\\]/gu, "\\$&")}"`;
}

/** A string, or the first of a list of them — DCAT-AP writes URLs both ways. */
function firstString(value: unknown): string | null {
  if (Array.isArray(value)) return blankToNull(value[0]);
  return blankToNull(value);
}

function first<T>(value: T[] | T | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function unique(values: readonly (string | null | undefined)[]): string[] {
  const out: string[] = [];
  for (const value of values) {
    if (value && !out.includes(value)) out.push(value);
  }
  return out;
}

/** "True"/"False" strings on some records, booleans on others. */
function flag(value: boolean | string | null | undefined): boolean {
  return value === true || value === "True" || value === "true";
}

function num(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** Some portals write the IANA registry URL where a media type belongs. */
function mimeOf(value: string | null | undefined): string | null {
  const text = blankToNull(value);
  if (!text) return null;
  const match = /media-types\/(.+)$/u.exec(text);
  return match?.[1] ?? text;
}

function emptyToNull(value: unknown): unknown {
  if (value === null || value === undefined || value === "") return null;
  if (Array.isArray(value) && value.length === 0) return null;
  if (typeof value === "object" && Object.keys(value as object).length === 0) return null;
  return value;
}

/**
 * A string, trimmed, or null. Takes `unknown` on purpose: a DCAT-AP field a
 * schema says is a string arrives as a list or an object on some records,
 * and a catalogue of 370 publishers has every such record somewhere.
 */
export function blankToNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

/** The first sentence of a description, for a list row. */
export function firstSentence(text: string | null | undefined): string | null {
  const clean = blankToNull(text)?.replace(/\s+/gu, " ");
  if (!clean) return null;
  const match = /^.{20,}?[.;!?](?=\s|$)/u.exec(clean);
  const sentence = match?.[0] ?? clean;
  return sentence.length > 300 ? `${sentence.slice(0, 297)}…` : sentence;
}
