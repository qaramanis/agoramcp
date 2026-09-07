import {
  cacheKey,
  createHttpClient,
  InvalidInputError,
  UpstreamError,
  UpstreamUnavailableError,
  withCache,
  type Cache,
} from "@agoramcp/core";

/**
 * One upstream, no credential. VIES keeps no register of its own: it forwards
 * the question to the member state that issued the number and relays the
 * reply, so every answer is as live — and as available — as that state's own
 * tax administration. That is why a lookup can fail for reasons that say
 * nothing about the number, and why `list_member_states` exists.
 */
export const API_URL = "https://ec.europa.eu/taxation_customs/vies/rest-api/";

const api = createHttpClient({
  baseUrl: API_URL,
  // A member state's register answers in about a second; the ones that are
  // struggling take longer before VIES gives up on them for us.
  timeoutMs: 20_000,
  retries: 2,
});

/** VIES writes an unknown or withheld string as three dashes, never as null. */
const UNKNOWN = "---";

/**
 * The EU-27 plus `XI`, Northern Ireland, which stayed inside the EU VAT area
 * for goods after Brexit. Greece is `EL` here and in every EU VAT context —
 * not the `GR` its ISO country code would suggest — which is the single most
 * common way a caller gets this wrong.
 */
export const MEMBER_STATES = Object.freeze([
  "AT", "BE", "BG", "CY", "CZ", "DE", "DK", "EE", "EL", "ES",
  "FI", "FR", "HR", "HU", "IE", "IT", "LT", "LU", "LV", "MT",
  "NL", "PL", "PT", "RO", "SE", "SI", "SK", "XI",
] as const);

export type MemberStateCode = (typeof MEMBER_STATES)[number];

function isMemberState(code: string): code is MemberStateCode {
  return (MEMBER_STATES as readonly string[]).includes(code);
}

/* -------------------------------------------------------------------------- */
/* Upstream shapes                                                            */
/* -------------------------------------------------------------------------- */

interface RawCheck {
  isValid?: boolean | null;
  requestDate?: string | null;
  userError?: string | null;
  name?: string | null;
  address?: string | null;
  requestIdentifier?: string | null;
  originalVatNumber?: string | null;
  vatNumber?: string | null;
}

interface RawStatusCountry {
  countryCode?: string | null;
  availability?: string | null;
}

interface RawStatus {
  vow?: { available?: boolean | null } | null;
  countries?: RawStatusCountry[] | null;
}

/* -------------------------------------------------------------------------- */
/* Greek ΑΦΜ                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Greek ΑΦΜ check digit: weight the first eight digits by descending powers of
 * two, take the sum modulo 11, then modulo 10 again so that a remainder of 10
 * lands on 0. Verified against the 836 distinct ΑΦΜ in the Μίτος register of
 * bodies — 827 pass, and the one that fails, 090300767, VIES also rejects, so
 * this never turns away a number the register would have accepted.
 */
export function isValidAfm(afm: string): boolean {
  if (!/^\d{9}$/u.test(afm)) return false;
  // All zeros satisfies the arithmetic and is nobody's ΑΦΜ.
  if (afm === "000000000") return false;

  let total = 0;
  for (let i = 0; i < 8; i += 1) {
    total += Number(afm[i]) * 2 ** (8 - i);
  }
  return (total % 11) % 10 === Number(afm[8]);
}

export interface NormalizedVat {
  countryCode: MemberStateCode;
  /** The number without its country prefix, as VIES wants it in the path. */
  vatNumber: string;
  /** `EL094014201` — how the number is written on an invoice. */
  fullVatNumber: string;
  /** Set when the input was repaired rather than merely tidied. */
  note: string | null;
}

/**
 * Accepts a VAT number as any of the ways one is actually written down —
 * `EL 094 014 201`, `el-094014201`, `094014201` — and returns the country and
 * the bare number. Separators are dropped, a country prefix on the number
 * itself is honoured, and a Greek number that lost its leading zero to a
 * spreadsheet is padded back to nine digits.
 */
export function normalizeVat(input: string, requestedCountry: string): NormalizedVat {
  const country = requestedCountry.trim().toUpperCase();
  if (!isMemberState(country)) {
    throw new InvalidInputError(
      `"${requestedCountry}" is not an EU VAT country code. Greece is EL, not GR; the codes in use are ${MEMBER_STATES.join(", ")}.`,
    );
  }

  let digits = input.toUpperCase().replace(/[\s.\-_/]/gu, "");
  let note: string | null = null;

  // A number written in full carries its own country. Honour it when it
  // agrees, and refuse rather than guess when it contradicts the argument.
  const prefixed = /^([A-Z]{2})(.+)$/u.exec(digits);
  const writtenCountry = prefixed?.[1];
  const withoutPrefix = prefixed?.[2];
  if (writtenCountry !== undefined && withoutPrefix !== undefined && isMemberState(writtenCountry)) {
    if (writtenCountry !== country) {
      throw new InvalidInputError(
        `The number is written for ${writtenCountry} but countryCode says ${country}. Drop the prefix or fix the country.`,
      );
    }
    digits = withoutPrefix;
  }

  if (digits === "") {
    throw new InvalidInputError("Give a VAT number.");
  }

  if (country === "EL") {
    // Eight digits is a nine-digit ΑΦΜ whose leading zero was eaten by a
    // spreadsheet — by far the most common corruption, and reversible.
    if (/^\d{8}$/u.test(digits)) {
      digits = `0${digits}`;
      note = `Read as ${digits}: a Greek ΑΦΜ is nine digits, so the missing leading zero was restored.`;
    }
    if (!/^\d{9}$/u.test(digits)) {
      throw new InvalidInputError(
        `A Greek ΑΦΜ is nine digits; "${input}" has ${digits.length}. Pass a foreign number with its own countryCode.`,
      );
    }
    // Upstream cannot tell a mistyped number from an unregistered one — both
    // come back INVALID — so the check digit is what separates "you typed it
    // wrong" from "this number is real but not registered for VAT".
    if (!isValidAfm(digits)) {
      throw new InvalidInputError(
        `${digits} is not a well-formed ΑΦΜ: it fails the check-digit test, so it has been mistyped or transposed. This is a fact about the number itself, not a statement that it is unregistered.`,
      );
    }
  }

  return { countryCode: country, vatNumber: digits, fullVatNumber: `${country}${digits}`, note };
}

/* -------------------------------------------------------------------------- */
/* Answers                                                                    */
/* -------------------------------------------------------------------------- */

export interface VatCheck {
  countryCode: MemberStateCode;
  vatNumber: string;
  fullVatNumber: string;
  /** Whether the number is a live VAT registration in that member state. */
  registered: boolean;
  /** Null when the number is unregistered, or the state withholds names. */
  name: string | null;
  /** Trade names the register carries besides the first, often empty. */
  alsoKnownAs: string[];
  address: string | null;
  /** When the member state's register answered, as VIES timestamps it. */
  checkedAt: string | null;
}

/**
 * `"---"` is upstream's way of saying nothing, and must not reach a caller.
 * Registers pad their fields to fixed columns, so an address arrives as
 * `ΑΙΟΛΟΥ 86        10559 - ΑΘΗΝΑ`; the runs of spaces carry no information.
 */
function text(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.replace(/\s+/gu, " ").trim();
  return trimmed === "" || trimmed === UNKNOWN ? null : trimmed;
}

/**
 * A register that holds more than one trade name for a company returns them
 * in the single `name` field joined by `||`, e.g.
 * `EPSILON TELEDATA ΙΚΕ||EPSILON TELE DATA`. The first is the legal name.
 */
function names(value: string | null | undefined): { name: string | null; alsoKnownAs: string[] } {
  const full = text(value);
  if (full === null) return { name: null, alsoKnownAs: [] };

  const parts = full
    .split("||")
    .map((part) => part.trim())
    .filter((part) => part !== "" && part !== UNKNOWN);

  const [first, ...rest] = parts;
  return { name: first ?? null, alsoKnownAs: rest };
}

/**
 * Everything VIES reports through `userError` rather than through a status
 * code: the whole API answers 200, so an unavailable member state and an
 * unregistered number are told apart here or not at all.
 */
function interpret(raw: RawCheck, target: string): boolean {
  const code = (raw.userError ?? "").trim().toUpperCase();

  switch (code) {
    case "VALID":
      return true;
    case "INVALID":
      return false;
    case "INVALID_INPUT":
      throw new InvalidInputError(
        `${target} is not a well-formed VAT number for that country.`,
      );
    // The member state, not VIES, is the one that is down or throttling us.
    case "MS_UNAVAILABLE":
    case "MS_MAX_CONCURRENT_REQ":
    case "MS_MAX_CONCURRENT_REQ_TIME":
      throw new UpstreamUnavailableError(
        `The VAT register of ${target.slice(0, 2)} is not answering VIES right now, so this number can be neither confirmed nor denied. list_member_states shows which registers are up.`,
        { details: { userError: code } },
      );
    case "SERVICE_UNAVAILABLE":
    case "TIMEOUT":
    case "GLOBAL_MAX_CONCURRENT_REQ":
    case "GLOBAL_MAX_CONCURRENT_REQ_TIME":
      throw new UpstreamUnavailableError(
        "VIES itself is unavailable or throttling requests. Try again shortly.",
        { details: { userError: code } },
      );
    case "VAT_BLOCKED":
    case "IP_BLOCKED":
      throw new UpstreamError(
        "VIES has blocked this request. The service rate-limits by IP, so this usually means too many lookups in too short a time.",
        { status: 403, details: { userError: code } },
      );
    default:
      // `isValid` alone is not enough to trust when we cannot read the code
      // that qualifies it — say so rather than report a confident answer.
      throw new UpstreamError(`VIES answered with an unrecognised status "${code}".`, {
        details: { userError: code },
      });
  }
}

/**
 * One VAT number, checked. Cached on the normalised number, so the same
 * contractor looked up across a set of contract awards costs one call.
 */
export async function checkVat(
  vat: NormalizedVat,
  cache: Cache,
  ttl: number,
  signal: AbortSignal,
): Promise<VatCheck> {
  return withCache(cache, cacheKey("vies:check", vat.fullVatNumber), ttl, async () => {
    const raw = await api.getJson<RawCheck>(
      `ms/${encodeURIComponent(vat.countryCode)}/vat/${encodeURIComponent(vat.vatNumber)}`,
      { signal },
    );

    if (raw === undefined || raw === null) {
      throw new UpstreamError("VIES returned an empty body.");
    }

    const registered = interpret(raw, vat.fullVatNumber);
    const { name, alsoKnownAs } = registered
      ? names(raw.name)
      : { name: null, alsoKnownAs: [] };

    return {
      countryCode: vat.countryCode,
      vatNumber: vat.vatNumber,
      fullVatNumber: vat.fullVatNumber,
      registered,
      name,
      alsoKnownAs,
      address: registered ? text(raw.address) : null,
      checkedAt: text(raw.requestDate),
    };
  });
}

export interface MemberStateStatus {
  countryCode: string;
  available: boolean;
  /** Upstream's own word, kept so an unforeseen third value is not lost. */
  availability: string;
}

export interface ServiceStatus {
  /** Whether VIES-on-the-Web itself is up, independently of the states. */
  serviceAvailable: boolean;
  memberStates: MemberStateStatus[];
}

export async function fetchStatus(
  cache: Cache,
  ttl: number,
  signal: AbortSignal,
): Promise<ServiceStatus> {
  return withCache(cache, cacheKey("vies:status", "all"), ttl, async () => {
    const raw = await api.getJson<RawStatus>("check-status", { signal });

    const memberStates = (raw?.countries ?? [])
      .filter((entry): entry is RawStatusCountry & { countryCode: string } =>
        typeof entry?.countryCode === "string" && entry.countryCode !== "",
      )
      .map((entry) => {
        const availability = (entry.availability ?? "Unknown").trim();
        return {
          countryCode: entry.countryCode.toUpperCase(),
          available: availability.toLowerCase() === "available",
          availability,
        };
      })
      .sort((a, b) => a.countryCode.localeCompare(b.countryCode));

    return { serviceAvailable: raw?.vow?.available === true, memberStates };
  });
}
