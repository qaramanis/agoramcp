import type { Metadata } from "next";
import { Geist, JetBrains_Mono } from "next/font/google";
import Navigation from "@/components/navigation/navigation";
import Footer from "@/components/footer/footer";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

// Greek is not optional here: Διαύγεια returns Greek subjects, issuing bodies
// and ΑΔΑ codes, and the previous face had no Greek subset to fall back on.
const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin", "greek"],
});

export const metadata: Metadata = {
  title: "agoramcp",
  description: "MCP servers over open government data.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        {/* The page sits above the footer and carries its own background, so
            the footer stays pinned underneath until the content scrolls off. */}
        <div className="relative z-10 w-full bg-background">
          <Navigation />
          {children}
        </div>
        <Footer />
      </body>
    </html>
  );
}
