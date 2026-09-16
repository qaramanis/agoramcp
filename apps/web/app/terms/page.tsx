import type { Metadata } from "next";
import LegalPage from "@/components/legal/legal-page";
import { terms } from "@/data/legal";

export const metadata: Metadata = {
  title: "Terms - agoramcp",
  description:
    "Whose data it is, what is promised, the per-source limit, and what not to do with a service that adapts public registries.",
};

export default function TermsPage() {
  return <LegalPage document={terms} />;
}
