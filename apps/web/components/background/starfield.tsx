"use client";

import { useEffect, useRef } from "react";
import { FRAGMENT_SHADER, VERTEX_SHADER } from "./starfield-shader";

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
const STAR_CELL_CSS = 2.8;
/** The twinkle is slow enough that a full 60Hz redraw buys nothing. */
const FRAME_INTERVAL = 1 / 30;

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
        className ??
        "pointer-events-none absolute inset-0 -z-10 h-full w-full"
      }
    />
  );
}
