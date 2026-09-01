"use client";

import { useEffect, useRef } from "react";

/**
 * The star field, lifted out of the eclipse shader so it can sit behind the
 * whole page rather than only the hero. Same cell size and colour — the hero
 * has not lost its stars, they are just drawn one layer down now and show
 * through the eclipse where it is dark.
 *
 * Every tunable is a named constant at the top of the fragment shader.
 */
const VERTEX_SHADER = `
attribute vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

const FRAGMENT_SHADER = `
precision highp float;

uniform float u_time;
// Cell edge in drawing-buffer pixels. Passed in rather than hard-coded so the
// stars keep one size on screen however far the buffer is scaled down.
uniform float u_cell;
// The site accent, read off --color-accent rather than written out again here,
// so re-theming the page re-themes the sky with it.
uniform vec3 u_color;

// One candidate star per cell; this is the share of cells that stay empty.
// Lower it for a denser sky. Together with the cell size on the JS side this
// works out around 250 stars in a 1440x900 viewport. Raising the cell size
// costs cells, so this has to come down with it to keep the sky as full.
const float STAR_DENSITY = 0.9975;

// Seconds for one full brightness cycle. Each star draws its own period from
// this range, so the field never pulses as one body. Widen the gap for a more
// restless sky, narrow it toward a single value for a metronome.
const float MIN_PERIOD = 2.5;
const float MAX_PERIOD = 11.0;

// How far a star dips at its dimmest, as a fraction of its own brightness.
// Also drawn per star: at 0.0 it burns steady, at 1.0 it blinks out entirely.
const float MIN_DEPTH = 0.0;
const float MAX_DEPTH = 0.7;

// Weight of a second beat, running at an irrational multiple of the first.
// The two never line up, so a star's flicker does not repeat on its period.
// At 0.0 every star is a clean sine.
const float FLICKER = 0.4;

const float TAU = 6.2831853;

/**
 * Three decorrelated values for roughly the price of one hash: whether a cell
 * holds a star, and — independently — when that star blinks and how hard.
 *
 * The independence is the point. Seeding the phase from the existence value is
 * the obvious shortcut and it desynchronises nothing: every cell that clears
 * STAR_DENSITY sits in the same top 0.25% of the range, so the whole sky ends
 * up blinking within a few percent of one cycle of itself.
 */
vec3 hash3(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yxz + 33.33);
  return fract((p3.xxy + p3.yzz) * p3.zyx);
}

void main() {
  vec2 cell = gl_FragCoord.xy / u_cell;
  // h.x decides the star exists, h.y its rhythm, h.z where in that rhythm it
  // starts. A fourth value for the depth is folded out of the other two.
  vec3 h = hash3(floor(cell));

  float bright = step(STAR_DENSITY, h.x);
  // Shaded as a soft round point rather than filled edge to edge, so stars
  // stay dot-like when the buffer is upscaled.
  bright *= smoothstep(0.5, 0.05, length(fract(cell) - 0.5));

  float rate = TAU / mix(MIN_PERIOD, MAX_PERIOD, h.y);
  float phase = h.z * TAU;
  float depth = mix(MIN_DEPTH, MAX_DEPTH, fract(h.y * 7.13 + h.z * 3.71));

  float wave = sin(u_time * rate + phase);
  wave = mix(wave, wave * sin(u_time * rate * 1.618 + phase * 2.3), FLICKER);
  // Dips from full brightness rather than swinging around it, so a star is
  // never brighter than the one steady star next to it.
  bright *= 1.0 - depth * (0.5 - 0.5 * wave);

  vec3 col = u_color * bright * 0.55;

  // Premultiplied: the gaps between stars are transparent, so the page
  // background shows through instead of a near-black rectangle.
  gl_FragColor = vec4(col, max(col.r, max(col.g, col.b)));
}
`;

/** Retina beyond 1.5x is wasted on points this small. */
const MAX_DPR = 1.5;
/** Render below CSS resolution and let the browser upscale. */
const RESOLUTION_SCALE = 0.75;
/**
 * This canvas is as tall as the whole page, not one viewport, so the buffer
 * gets a ceiling: past it the resolution scale drops rather than the memory
 * climbing with the page.
 */
const MAX_BUFFER_PIXELS = 3_000_000;
/**
 * Cell edge in CSS pixels: one candidate star per cell, and the dot is drawn
 * to fill it. So this sets star size and thins the field at the same time —
 * cells grow with its square, and there is at most one star in each.
 */
const STAR_CELL_CSS = 3;
/** The twinkle is slow enough that a full 60Hz redraw buys nothing. */
const FRAME_INTERVAL = 1 / 30;
/** #4ade80, for when --color-accent is missing or in a form this cannot read. */
const ACCENT_FALLBACK: [number, number, number] = [0.29, 0.871, 0.502];

/**
 * The site accent as 0..1 channels. Only hex is parsed, which is the
 * form globals.css uses; anything else falls back rather than throwing, since
 * a wrongly coloured sky beats a blank one.
 */
function accentRgb(): [number, number, number] {
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue("--color-accent")
    .trim();
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value);
  if (!match) return ACCENT_FALLBACK;

  const hex = match[1];
  const wide = hex.length === 3;
  const at = (i: number) =>
    wide
      ? parseInt(hex[i] + hex[i], 16) / 255
      : parseInt(hex.slice(i * 2, i * 2 + 2), 16) / 255;
  return [at(0), at(1), at(2)];
}

interface StarfieldProps {
  className?: string;
}

/**
 * Page-wide star field. Sits behind every section — absolutely positioned so
 * it is bounded by the page wrapper and scrolls with it, which keeps it off
 * the footer underneath.
 */
export default function Starfield({ className }: StarfieldProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext("webgl", {
      // Transparent: only the stars are drawn, the page background is the sky.
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: "low-power",
    });
    if (!gl) return;

    const prefersReduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    const compile = (type: number, src: string) => {
      const shader = gl.createShader(type);
      if (!shader) return null;
      gl.shaderSource(shader, src);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error(
          "Starfield shader compile error:",
          gl.getShaderInfoLog(shader),
        );
        gl.deleteShader(shader);
        return null;
      }
      return shader;
    };

    const vert = compile(gl.VERTEX_SHADER, VERTEX_SHADER);
    const frag = compile(gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
    if (!vert || !frag) return;

    const program = gl.createProgram();
    gl.attachShader(program, vert);
    gl.attachShader(program, frag);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error(
        "Starfield program link error:",
        gl.getProgramInfoLog(program),
      );
      return;
    }
    gl.useProgram(program);

    // One oversized triangle covers the clip volume with no wasted vertices.
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 3, -1, -1, 3]),
      gl.STATIC_DRAW,
    );
    const aPos = gl.getAttribLocation(program, "a_pos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const uTime = gl.getUniformLocation(program, "u_time");
    const uCell = gl.getUniformLocation(program, "u_cell");
    // Set once: the accent does not change for the life of the program.
    gl.uniform3f(gl.getUniformLocation(program, "u_color"), ...accentRgb());

    let frame = 0;
    let tabActive = true;
    let lastDrawn = -Infinity;
    // Under reduced motion the field is drawn once and left alone.
    let needsDraw = true;

    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);

    const resize = () => {
      const cssWidth = canvas.clientWidth;
      const cssHeight = canvas.clientHeight;
      if (cssWidth === 0 || cssHeight === 0) return;

      // Buffer pixels per CSS pixel, pulled down on long pages so the buffer
      // stays under the ceiling.
      const budget = Math.sqrt(MAX_BUFFER_PIXELS / (cssWidth * cssHeight));
      const density = Math.min(dpr * RESOLUTION_SCALE, budget);

      const width = Math.max(1, Math.round(cssWidth * density));
      const height = Math.max(1, Math.round(cssHeight * density));
      // Reallocating the drawing buffer is expensive, so only touch it on a
      // real size change.
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      gl.viewport(0, 0, canvas.width, canvas.height);
      // Re-uploaded unconditionally: uniforms belong to the program, and a
      // cell of 0 would divide gl_FragCoord by zero.
      gl.uniform1f(uCell, Math.max(1, STAR_CELL_CSS * density));
      needsDraw = true;
    };

    const render = (now: number) => {
      frame = requestAnimationFrame(render);
      if (!tabActive) return;

      const time = now * 0.001;

      if (prefersReduced) {
        if (!needsDraw) return;
        needsDraw = false;
        gl.uniform1f(uTime, 0);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        return;
      }

      if (!needsDraw && time - lastDrawn < FRAME_INTERVAL) return;
      needsDraw = false;
      lastDrawn = time;

      gl.uniform1f(uTime, time);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    const onVisibility = () => {
      tabActive = !document.hidden;
    };
    document.addEventListener("visibilitychange", onVisibility);

    // The canvas spans the page, so it resizes when the page grows — a route
    // change, a section expanding — not only when the window does.
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    resize();
    frame = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      gl.deleteShader(vert);
      gl.deleteShader(frag);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={
        className ?? "pointer-events-none absolute inset-0 -z-10 h-full w-full"
      }
    />
  );
}
