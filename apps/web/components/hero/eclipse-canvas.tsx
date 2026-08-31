"use client";

import { useEffect, useRef } from "react";
import { FRAGMENT_SHADER, VERTEX_SHADER } from "./eclipse-shader";

/** Retina beyond 1.5x is wasted on a shader this soft. */
const MAX_DPR = 1.5;
/** Render below CSS resolution and let the browser upscale. */
const RESOLUTION_SCALE = 0.75;

const CORONA_SIZE = 1.0;
const RAY_INTENSITY = 1.0;
/**
 * Seconds for the corona to close half the remaining distance to the cursor.
 * Exponential smoothing rather than a fixed step, so the trail feels the same
 * at 60Hz and 120Hz. Larger = laggier.
 */
const POINTER_HALF_LIFE = 0.3;

interface EclipseCanvasProps {
  className?: string;
  style?: React.CSSProperties;
}

export default function EclipseCanvas({
  className,
  style,
}: EclipseCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext("webgl", {
      alpha: false,
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
          "Eclipse shader compile error:",
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
        "Eclipse program link error:",
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
    const uRes = gl.getUniformLocation(program, "u_res");
    const uCoronaSize = gl.getUniformLocation(program, "u_coronaSize");
    const uRayIntensity = gl.getUniformLocation(program, "u_rayIntensity");
    const uMouse = gl.getUniformLocation(program, "u_mouse");
    const uMouseActive = gl.getUniformLocation(program, "u_mouseActive");

    gl.uniform1f(uCoronaSize, CORONA_SIZE);
    gl.uniform1f(uRayIntensity, RAY_INTENSITY);

    // Viewport coordinates, converted to canvas space at draw time. Storing the
    // raw client position keeps pointermove free of layout reads. The corona
    // chases `target` via `smooth`, which is what gives it the lag.
    let targetClientX = 0;
    let targetClientY = 0;
    let smoothClientX = 0;
    let smoothClientY = 0;
    let pointerActive = false;
    let lastTime = 0;

    let visible = true;
    let tabActive = true;
    let frame = 0;
    // Reduced motion draws on demand instead of every frame.
    let needsDraw = true;

    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);

    const resize = () => {
      const width = Math.max(
        1,
        Math.round(canvas.clientWidth * dpr * RESOLUTION_SCALE),
      );
      const height = Math.max(
        1,
        Math.round(canvas.clientHeight * dpr * RESOLUTION_SCALE),
      );
      // Reallocating the drawing buffer is expensive, so only touch it on a
      // real size change.
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      // Always re-upload: uniforms belong to the program, not the canvas, so a
      // freshly linked program starts at zero even when the size is unchanged.
      // u_res of (0,0) divides uv by zero and renders pure black.
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(uRes, canvas.width, canvas.height);
      needsDraw = true;
    };

    const draw = (timeSeconds: number) => {
      gl.uniform1f(uTime, timeSeconds);

      if (pointerActive) {
        // The canvas scrolls with the page and is offset from the viewport, so
        // the mapping has to be recomputed rather than cached.
        const rect = canvas.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          gl.uniform2f(
            uMouse,
            ((smoothClientX - rect.left) / rect.width) * canvas.width,
            // gl_FragCoord counts from the bottom, the DOM from the top.
            (1 - (smoothClientY - rect.top) / rect.height) * canvas.height,
          );
        }
      }
      gl.uniform1f(uMouseActive, pointerActive ? 1 : 0);

      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    const render = (now: number) => {
      frame = requestAnimationFrame(render);

      const time = now * 0.001;
      // Clamped so resuming after a pause eases in rather than snapping.
      const dt = Math.min(0.1, Math.max(0, time - lastTime));
      lastTime = time;

      if (!visible || !tabActive) return;

      if (prefersReduced) {
        if (!needsDraw) return;
        needsDraw = false;
        // No easing under reduced motion: follow the cursor exactly.
        smoothClientX = targetClientX;
        smoothClientY = targetClientY;
        draw(0);
        return;
      }

      if (pointerActive && dt > 0) {
        const k = 1 - Math.pow(2, -dt / POINTER_HALF_LIFE);
        smoothClientX += (targetClientX - smoothClientX) * k;
        smoothClientY += (targetClientY - smoothClientY) * k;
      }

      draw(time);
    };

    // Tracked on the window, not the hero: the cursor keeps steering the corona
    // over the nav, over the copy, anywhere on the page. Deliberately never
    // cleared, so the eclipse holds the last direction instead of snapping back
    // to its idle sweep.
    const onPointerMove = (event: PointerEvent) => {
      targetClientX = event.clientX;
      targetClientY = event.clientY;
      if (!pointerActive) {
        // Adopt the first position outright; easing in from (0,0) would sweep
        // the corona across the screen on the very first movement.
        smoothClientX = targetClientX;
        smoothClientY = targetClientY;
        pointerActive = true;
      }
      needsDraw = true;
    };

    const onResize = () => resize();
    const onVisibility = () => {
      tabActive = !document.hidden;
    };

    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("resize", onResize, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);

    // Stop drawing entirely once the hero scrolls away.
    const observer = new IntersectionObserver(
      ([entry]) => {
        visible = entry?.isIntersecting ?? true;
        needsDraw = true;
      },
      { threshold: 0 },
    );
    observer.observe(canvas);

    resize();
    frame = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("resize", onResize);
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
      className={className}
      style={style}
    />
  );
}
