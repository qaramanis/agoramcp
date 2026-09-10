import Link from "next/link";
import Section from "@/components/layout/grid";

/**
 * The way out: the page ends on one action rather than sliding straight
 * under the footer. A title and the one button — centred, short, not a
 * second hero. The quickstart owns everything after the click.
 *
 * The one band that does not lay out on the columns: nothing here lines up
 * with anything above it, so the block takes the content width and centres
 * its two lines in it, and the title is free to stand on one line.
 */
export default function Exit() {
  return (
    // Twice the standard band's padding: the page's last word gets room to
    // stand on its own before the footer.
    <Section ariaLabel="Connect" py="py-48">
      <div className="col-span-12 flex flex-col items-center text-center md:col-span-10">
        {/* The hero's own title treatment: the page closes at the size it
            opened at. */}
        <h2 className="text-[2.5rem] leading-[1.2] font-medium tracking-tight text-foreground">
          Connect to Agora now
        </h2>

        {/* The hero's primary button, so the one green button on the page
            always leads to the same place. */}
        <Link
          href="/quickstart"
          className="mt-6 w-fit rounded-md bg-accent px-6 py-3 text-[12px] font-medium text-background transition-opacity duration-300 hover:opacity-90"
        >
          Get started
        </Link>
      </div>
    </Section>
  );
}
