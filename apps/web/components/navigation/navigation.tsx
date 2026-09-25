"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Landmark } from "lucide-react";
import NavigationDesktop from "./navigation-desktop";
import NavigationMobile from "./navigation-mobile";

export default function Navigation() {
  const [isScrolled, setIsScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => setIsScrolled(window.scrollY > 20);
    window.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll();
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <nav
      aria-label="Site navigation"
      className="pointer-events-none fixed top-0 right-0 left-0 z-100 flex items-center justify-between bg-background px-4 py-4 md:bg-transparent md:px-6 lg:px-8"
    >
      {/* Outer logo — hands off to the one inside the pill on scroll. */}
      <Link
        href="/"
        className={`pointer-events-auto flex flex-row items-center gap-2 transition-all duration-300 hover:text-accent hover:opacity-80  ${
          isScrolled ? "md:pointer-events-none md:opacity-0" : "md:opacity-100"
        }`}
      >
        <Landmark size={20} className="-mt-0.5 shrink-0 text-foreground" />
        <span className="text-[16px] font-bold tracking-[0.2em] text-foreground">AGORA.MCP</span>
      </Link>

      <NavigationDesktop isScrolled={isScrolled} />

      <div className="pointer-events-auto flex items-center gap-2">
        <Link
          href="/quickstart"
          className={`hidden h-7 cursor-pointer items-center justify-center rounded border border-accent/40 bg-accent/20 px-4 text-center text-[10px] font-bold tracking-wider text-accent uppercase transition-all duration-300 hover:bg-accent/30 md:flex ${
            isScrolled ? "md:pointer-events-none md:opacity-0" : "md:opacity-100"
          }`}
        >
          Connect
        </Link>
        <NavigationMobile />
      </div>
    </nav>
  );
}
