import { allPath } from "./directory";
import { greeklish } from "./greeklish";
import { fetchRegistry, type Registry, type RegistrySource } from "./registry";

/**
 * The licences view of the registry: every mounted source grouped by the terms
 * it comes under, and what those terms ask of you.
 *
 * Built on `fetchRegistry` rather than on `data/directory.ts` for one reason —
 * the directory transliterates the publisher and the attribution line along
 * with the name, and here those two are quoted artefacts rather than page
 * copy. The line a licence asks you to show is the line the publisher wrote,
 * in the script they wrote it in, and a reader is meant to copy it verbatim.
 * Source names are still transliterated, like everywhere else on the site.
 *
 * Spelling follows the codebase's own split: `license` in identifiers, because
 * that is what the registry calls the field, and "licence" in anything a
 * reader sees.
 */

export type LicenseSource = {
  id: string;
  country: string;
  /** Transliterated, as the site writes it. */
  name: string;
  /** Verbatim, as the publisher wrote it. */
  publisher: string;
  /** Verbatim: this is the line to copy. */
  attribution: string;
  /** The licence exactly as this source declares it. */
  license: string;
  upstreamUrl: string;
  /** The source's page in the catalogue. */
  href: string;
};

export type LicenseGroup = {
  /**
   * The heading, and the key sources group on: the kind of licence rather than
   * the exact string. Two sources that record no licence for different reasons
   * are one group with one explanation, not the same paragraph twice.
   */
  title: string;
  /** What it permits, and what it asks in return. */
  terms: string;
  /** The canonical text, where the licence is a published one. */
  url?: string;
  /**
   * What every source in the group declares, when they all declare the same
   * string. Null where they differ, and then each source carries its own.
   */
  declared: string | null;
  sources: LicenseSource[];
};

export type Licenses = {
  groups: LicenseGroup[];
  /** Why there is nothing, when there is nothing for a reason worth showing. */
  unavailable: string | null;
};

export async function loadLicenses(): Promise<Licenses> {
  const result = await fetchRegistry();
  if (result.registry === null) return { groups: [], unavailable: result.unavailable };
  return { groups: toGroups(result.registry), unavailable: null };
}

/**
 * What a licence permits and asks for, written out. Keyed by the string the
 * source declares, so a licence this table does not know still gets a group
 * and its sources — with the licence quoted and no terms invented for it.
 *
 * `rank` orders the groups: the ones you can act on straight away, then the
 * ones you have to check per record, then the ones to ask about.
 */
type Description = { title: string; terms: string; url?: string; rank: number };

const SPDX: Record<string, Description> = {
  "CC-BY-4.0": {
    title: "Creative Commons Attribution 4.0",
    terms:
      "Copy it, reshape it, publish it, build a business on it. One condition: credit the publisher with the line below, and say so if you changed anything.",
    url: "https://creativecommons.org/licenses/by/4.0/",
    rank: 0,
  },
  "CC-BY-SA-4.0": {
    title: "Creative Commons Attribution-ShareAlike 4.0",
    terms:
      "Everything CC BY allows, with one more condition: a work you build on this and then distribute carries the same licence. Asking a question and quoting the answer does not trigger that; republishing a dataset derived from it does.",
    url: "https://creativecommons.org/licenses/by-sa/4.0/",
    rank: 0,
  },
};

/**
 * A catalogue has no single licence, and a source that records none has not
 * granted one. Both are matched on the opening words of the string the
 * source's `meta.ts` declares, which is written to be read by a person rather
 * than parsed — hence a marker rather than an exact match. Sources still group
 * on the whole string, so two that say "not stated" for different reasons stay
 * two groups and each keeps its own wording.
 */
const PER_DATASET: Description = {
  title: "One licence per dataset",
  terms:
    "A catalogue does not licence what it lists. Each dataset carries its own (CC BY, ODbL, CC BY-SA, something local, or nothing at all), and every result names it in a licence field. Read that field before you reuse the file behind it.",
  rank: 1,
};

const UNSTATED: Description = {
  title: "No licence recorded",
  terms:
    "No terms are recorded anywhere the source publishes, which is a fact about the source, not a grant. The line it declares says why in its own words, and each of these has a different reason. Reading a record is not redistributing it: before you republish anything from here, go to the body that publishes it.",
  rank: 2,
};

function describe(license: string): Description {
  const known = SPDX[license];
  if (known) return known;
  if (license.startsWith("Not stated")) return UNSTATED;
  if (license.startsWith("Per dataset")) return PER_DATASET;
  return {
    title: license,
    terms:
      "As the source declares it. Read the licence itself before you reuse the data. This page will not paraphrase terms it does not know.",
    rank: 3,
  };
}

/**
 * Sources grouped by the kind of licence they come under, groups in `rank`
 * order and sources alphabetical within one. Only the sources a country
 * actually bundles are listed, the way the catalogue does it: the bundle is
 * the server's own statement of what it serves.
 */
function toGroups(registry: Registry): LicenseGroup[] {
  const byKey = new Map((registry.sources ?? []).map((source) => [source.key, source]));
  const groups = new Map<string, { group: LicenseGroup; rank: number }>();

  for (const bundle of registry.countries ?? []) {
    for (const entry of bundle.sources) {
      const source = byKey.get(`${bundle.country}/${entry.id}`);
      if (!source) continue;

      const described = describe(source.license);
      let held = groups.get(described.title);
      if (!held) {
        held = {
          // Field by field rather than spread: `rank` orders the groups below
          // and has no business travelling on one.
          group: {
            title: described.title,
            terms: described.terms,
            url: described.url,
            declared: source.license,
            sources: [],
          },
          rank: described.rank,
        };
        groups.set(described.title, held);
      }
      // One shared line only while every source in the group says the same.
      if (held.group.declared !== source.license) held.group.declared = null;
      held.group.sources.push(toSource(source));
    }
  }

  for (const { group } of groups.values()) {
    group.sources.sort((a, b) => byName(a.name, b.name));
  }

  return [...groups.values()]
    .sort((a, b) => a.rank - b.rank || byName(a.group.title, b.group.title))
    .map(({ group }) => group);
}

/** Alphabetical as a reader sees it: case and accents do not split the list. */
function byName(a: string, b: string): number {
  return a.localeCompare(b, "en", { sensitivity: "base" });
}

function toSource(source: RegistrySource): LicenseSource {
  return {
    id: source.id,
    country: source.country,
    name: greeklish(source.name),
    publisher: source.publisher,
    attribution: source.attribution,
    license: source.license,
    upstreamUrl: source.upstreamUrl,
    href: allPath(source.country, source.id),
  };
}

/** Every source the page speaks for, in one flat list, alphabetical. */
export function allSources(groups: LicenseGroup[]): LicenseSource[] {
  return groups
    .flatMap((group) => group.sources)
    .sort((a, b) => byName(a.name, b.name));
}
