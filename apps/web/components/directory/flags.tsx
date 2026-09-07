/**
 * The countries hero's right column: a row of flags on their poles, receding
 * to the left — one line drawing, in the accent, of what the section is about.
 *
 * Outlines over the page's own background rather than open strokes: seven
 * flags in a row overlap, and a filled cloth lets a near one stand in front of
 * the ones behind it the way the perspective says it should. The fill stays
 * fully opaque for that reason — distance is in the stroke alone, which fades
 * and thins as the row recedes.
 *
 * Not on the page yet: it is drawn and kept, and the countries hero takes it
 * through `SectionHero`'s `aside` when it goes up.
 *
 * Geometry is fixed rather than generated: it was drawn once, and a decoration
 * that redraws itself on every render buys nothing.
 */

/** Far to near. Each cloth is a ribbon that tapers as it turns away. */
const FLAGS = [
  {
    strokeOpacity: 0.24,
    width: 1.51,
    pole: { x: 38.7, y: 264.0, w: 2.6, h: 104.0 },
    cloth:
      "M 40.0,269.1 C 54.6,269.1 61.8,274.6 74.9,274.0 C 86.6,273.4 92.4,267.8 101.1,269.1 C 106.9,270.0 109.8,272.8 112.8,275.2 L 112.8,328.5 C 109.8,326.0 106.9,324.8 101.1,324.8 C 92.4,324.8 86.6,333.4 74.9,334.0 C 61.8,334.7 54.6,330.9 40.0,330.9 Z",
    fold: null,
  },
  {
    strokeOpacity: 0.42,
    width: 1.62,
    pole: { x: 64.4, y: 250.8, w: 3.1, h: 125.5 },
    cloth:
      "M 65.9,256.9 C 83.5,256.9 92.2,263.7 108.0,262.9 C 122.1,262.2 129.1,255.4 139.7,256.9 C 146.7,258.1 150.2,261.4 153.7,264.4 L 153.7,328.6 C 150.2,325.6 146.7,324.1 139.7,324.1 C 129.1,324.1 122.1,334.6 108.0,335.3 C 92.2,336.1 83.5,331.6 65.9,331.6 Z",
    fold: null,
  },
  {
    strokeOpacity: 0.56,
    width: 1.76,
    pole: { x: 108.8, y: 229.5, w: 3.9, h: 155.2 },
    cloth:
      "M 110.8,237.1 C 132.5,237.1 143.3,245.4 162.9,244.5 C 180.2,243.5 188.9,235.2 201.9,237.1 C 210.6,238.5 214.9,242.6 219.3,246.3 L 219.3,325.7 C 214.9,322.0 210.6,320.2 201.9,320.2 C 188.9,320.2 180.2,333.1 162.9,334.0 C 143.3,334.9 132.5,329.4 110.8,329.4 Z",
    fold: null,
  },
  {
    strokeOpacity: 0.68,
    width: 1.93,
    pole: { x: 165.1, y: 204.0, w: 4.7, h: 189.0 },
    cloth:
      "M 167.4,213.3 C 193.8,213.3 207.0,223.4 230.8,222.3 C 251.9,221.2 262.5,211.1 278.4,213.3 C 288.9,215.0 294.2,220.1 299.5,224.5 L 299.5,321.2 C 294.2,316.7 288.9,314.5 278.4,314.5 C 262.5,314.5 251.9,330.2 230.8,331.3 C 207.0,332.4 193.8,325.7 167.4,325.7 Z",
    fold: "M 230.8,222.3 C 233.4,258.3 228.2,296.5 230.8,331.3",
  },
  {
    strokeOpacity: 0.79,
    width: 2.11,
    pole: { x: 230.5, y: 175.6, w: 5.6, h: 225.7 },
    cloth:
      "M 233.3,186.7 C 264.9,186.7 280.7,198.8 309.1,197.4 C 334.3,196.1 347.0,184.0 365.9,186.7 C 378.5,188.7 384.8,194.8 391.1,200.1 L 391.1,315.6 C 384.8,310.2 378.5,307.5 365.9,307.5 C 347.0,307.5 334.3,326.3 309.1,327.6 C 280.7,329.0 264.9,320.9 233.3,320.9 Z",
    fold: "M 309.1,197.4 C 312.2,240.4 305.9,286.0 309.1,327.6",
  },
  {
    strokeOpacity: 0.9,
    width: 2.3,
    pole: { x: 303.9, y: 144.8, w: 6.6, h: 264.9 },
    cloth:
      "M 307.2,157.8 C 344.2,157.8 362.7,172.0 396.1,170.4 C 425.7,168.8 440.5,154.7 462.7,157.8 C 477.6,160.2 485.0,167.3 492.4,173.6 L 492.4,309.0 C 485.0,302.7 477.6,299.6 462.7,299.6 C 440.5,299.6 425.7,321.6 396.1,323.2 C 362.7,324.8 344.2,315.3 307.2,315.3 Z",
    fold: "M 396.1,170.4 C 399.8,220.8 392.4,274.4 396.1,323.2",
  },
  {
    strokeOpacity: 1.0,
    width: 2.5,
    pole: { x: 384.2, y: 112.0, w: 7.6, h: 306.0 },
    cloth:
      "M 388.0,127.0 C 430.8,127.0 452.2,143.4 490.7,141.6 C 525.0,139.7 542.1,123.4 567.8,127.0 C 584.9,129.7 593.4,137.9 602.0,145.2 L 602.0,301.7 C 593.4,294.4 584.9,290.8 567.8,290.8 C 542.1,290.8 525.0,316.3 490.7,318.1 C 452.2,319.9 430.8,309.0 388.0,309.0 Z",
    fold: null,
  },
] as const;

export default function Flags({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 640 440"
      role="presentation"
      aria-hidden="true"
      className={`h-auto w-full text-accent ${className ?? ""}`}
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {FLAGS.map((flag) => (
        <g key={flag.pole.x} strokeOpacity={flag.strokeOpacity} strokeWidth={flag.width}>
          {/* Filled with the page's own ground, so the flags in front of this
              one read as being in front of it. */}
          <path d={flag.cloth} className="fill-background stroke-current" />
          {flag.fold && <path d={flag.fold} className="stroke-current" />}
          <rect
            x={flag.pole.x}
            y={flag.pole.y}
            width={flag.pole.w}
            height={flag.pole.h}
            strokeLinejoin="miter"
            className="fill-background stroke-current"
          />
        </g>
      ))}
    </svg>
  );
}
