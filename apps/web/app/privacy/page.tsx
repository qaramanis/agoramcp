import type { Metadata } from "next";
import LegalPage from "@/components/legal/legal-page";
import { privacy } from "@/data/legal";

export const metadata: Metadata = {
  title: "Privacy — agoramcp",
  description:
    "What the site and the servers see when you use them, what is kept, and what is not. No accounts, no cookies, no analytics.",
};

export default function PrivacyPage() {
  return <LegalPage document={privacy} />;
}
