/**
 * The star field, lifted out of the eclipse shader so it can sit behind the
 * whole page rather than only the hero. Same cell size and colour — the hero
 * has not lost its stars, they are just drawn one layer down now and show
 * through the eclipse where it is dark.
 *
 * Every tunable is a named constant at the top of the fragment shader.
 */
export const VERTEX_SHADER = `
attribute vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

export const FRAGMENT_SHADER = `
precision highp float;

uniform float u_time;
// Cell edge in drawing-buffer pixels. Passed in rather than hard-coded so the
// stars keep one size on screen however far the buffer is scaled down.
uniform float u_cell;

// One candidate star per cell; this is the share of cells that stay empty.
// Lower it for a denser sky. Together with the cell size on the JS side this
// works out around 200 stars in a 1440x900 viewport.
const float STAR_DENSITY = 0.9985;

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

  vec3 col = vec3(0.80, 0.86, 0.82) * bright * 0.55;

  // Premultiplied: the gaps between stars are transparent, so the page
  // background shows through instead of a near-black rectangle.
  gl_FragColor = vec4(col, max(col.r, max(col.g, col.b)));
}
`;
