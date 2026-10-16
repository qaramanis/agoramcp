import type { SourceMeta } from "@agoramcp/core";

export const meta: SourceMeta = {
  name: "ECB Data Portal",
  description:
    "The European Central Bank's statistics, with Greece in front: the euro reference exchange rates, Greek government bond yields, what Greek banks charge on mortgages and business loans and pay on deposits, how much Greek households and firms hold and owe, the Bank of Greece's TARGET balance, inflation, house prices, non-performing loans and government debt, and any other series of the ECB's by its key.",
  publisher: "European Central Bank — ECB Data Portal",
  upstreamUrl: "https://data.ecb.europa.eu/",
  // The ESCB statistics reuse policy: "All publicly available ESCB statistics
  // may be reused free of charge on the condition that the source is quoted
  // (e.g. "Source: ECB statistics.") and that the statistics (including
  // metadata) are not modified." It adds that "the right of free reuse does
  // not apply to third-party data without a prior permission from the
  // originator", and the site's disclaimer asks that a user who modifies the
  // data — a growth rate, a seasonal adjustment — says so explicitly.
  // https://www.ecb.europa.eu/stats/ecb_statistics/governance_and_quality_framework/html/usage_policy.en.html
  // It is not one of the published licences, so this is its own name rather
  // than an SPDX identifier.
  license: "ESCB statistics reuse policy — free reuse, source quoted, statistics unmodified",
  attribution: "Source: ECB statistics (ECB Data Portal, data.ecb.europa.eu)",
  docsUrl: "https://data.ecb.europa.eu/help/api/overview",
  ttl: {
    // Most series are monthly or quarterly and change once a release; the
    // daily ones change once a working day. Six hours holds a release for
    // the afternoon it lands without reporting yesterday's as today's.
    default: 21_600,
    // The reference rates are set around 16:00 CET each TARGET working day,
    // and "what is the dollar today" is asked hourly.
    get_exchange_rate: 3_600,
    // Eighteen series in one answer, every one of them monthly or slower
    // except the stress index.
    list_greek_indicators: 10_800,
    // The list of flows and the list of series in a flow are structure, which
    // the ECB changes a few times a year.
    search_dataflows: 86_400,
    find_series: 86_400,
  },
};
