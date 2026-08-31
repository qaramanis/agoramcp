/**
 * Eclipse Glow — GPU-light rewrite of the original standalone shader.
 *
 * Cost reductions versus the source, which ran ~14 value-noise lookups per
 * fragment (about 56 hashes):
 *   - fbm3 x2 + fbm4 x1 for the corona rays  ->  fbm2 x2
 *   - fbm3 for chromosphere unevenness       ->  a sine
 *   - value noise on the lunar disc          ->  dropped (it was ~0.008 strong)
 *   - quintic noise interpolation            ->  smoothstep
 * That leaves 4 noise lookups per fragment. Everything visible is kept: rays,
 * chromosphere, diamond ring, solar wind, bloom, grain, cursor interaction.
 *
 * The star field it used to draw now lives in `components/background`, behind
 * the whole page. This shader renders transparent everywhere it is dark so
 * those stars show through, and opaque over the moon so it still occludes.
 */
export const VERTEX_SHADER = `
attribute vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

export const FRAGMENT_SHADER = `
precision highp float;

uniform float u_time;
uniform vec2  u_res;
uniform float u_coronaSize;
uniform float u_rayIntensity;
uniform vec2  u_mouse;
// Explicit flag: the cursor is tracked page-wide, so it legitimately sits at
// negative canvas coordinates and its sign says nothing about whether it is live.
uniform float u_mouseActive;

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
    f.y
  );
}

// Two octaves, unrolled. The third and fourth octaves of the original are
// invisible once the corona is bloomed and tone-mapped.
float fbm2(vec2 p) {
  float v = 0.5 * vnoise(p);
  p = mat2(0.8, 0.6, -0.6, 0.8) * p * 2.1 + vec2(1.7, 9.2);
  v += 0.25 * vnoise(p);
  return v;
}

void main() {
  vec2 uv = (gl_FragCoord.xy - u_res * 0.5) / min(u_res.x, u_res.y);
  float t = u_time;

  float r = length(uv);
  float a = atan(uv.y, uv.x);

  vec3 col = vec3(0.005, 0.003, 0.008);

  float discRadius = 0.15;
  float chromoRadius = discRadius + 0.008;
  float rotAngle = a + t * 0.05;

  // Corona rays: two octaves drifting at different speeds.
  float ray1 = fbm2(vec2(rotAngle * 3.0, r * 4.0 - t * 0.08));
  float ray2 = fbm2(vec2(rotAngle * 7.0 + 5.0, r * 6.0 - t * 0.12));
  float rays = (ray1 * 0.62 + ray2 * 0.38) * 1.18;

  // Streamers are uneven around the disc.
  float asymmetry = 0.7 + 0.3 * sin(a * 2.0 + 0.5) * sin(a * 3.0 + t * 0.02);
  asymmetry += 0.15 * sin(a * 5.0 + 1.7);
  rays *= asymmetry;

  float coronaOuter = discRadius + 0.35 * u_coronaSize;
  float radialFalloff = smoothstep(coronaOuter, discRadius + 0.02, r);
  radialFalloff *= smoothstep(discRadius - 0.01, discRadius + 0.03, r);

  float rayReach = discRadius + 0.6 * u_coronaSize;
  float rayFalloff = smoothstep(rayReach, discRadius + 0.03, r);
  rayFalloff *= smoothstep(discRadius - 0.01, discRadius + 0.03, r);

  float colorMix = smoothstep(discRadius, coronaOuter, r);
  vec3 innerColor = vec3(0.62, 1.00, 0.75);
  vec3 outerColor = vec3(0.06, 0.50, 0.22);
  vec3 coronaColor = mix(innerColor, outerColor, colorMix);

  float coronaGlow = radialFalloff * (0.4 + rays * 0.6);
  col += coronaColor * coronaGlow * 1.2 * u_rayIntensity;

  float rayStreak = rayFalloff * pow(rays, 1.5) * 0.8;
  col += mix(coronaColor, outerColor, 0.5) * rayStreak * u_rayIntensity;

  // Chromosphere ring. The original modulated this with an fbm; a sine reads
  // the same once it is this thin and this bright.
  float chromoDist = abs(r - chromoRadius);
  float chromo = exp(-chromoDist * chromoDist / 0.00008);
  chromo *= 0.7 + (0.5 + 0.5 * sin(rotAngle * 10.0 + t * 0.6)) * 0.5;
  col += vec3(0.76, 1.00, 0.85) * chromo * 2.5 * u_rayIntensity;

  float innerEdge = exp(-pow((r - discRadius) * 80.0, 2.0));
  innerEdge *= smoothstep(discRadius - 0.02, discRadius + 0.005, r);
  col += vec3(0.90, 1.00, 0.93) * innerEdge * 3.0;

  // Solar wind — one hash, quantised into fine radial streaks.
  float wind = hash(vec2(floor((a + t * 0.02) * 80.0), floor((r - t * 0.06) * 100.0)));
  wind = smoothstep(0.95, 1.0, wind);
  float windFade = smoothstep(discRadius, discRadius + 0.05, r);
  windFade *= smoothstep(rayReach + 0.08, discRadius + 0.06, r);
  col += vec3(0.70, 1.00, 0.80) * wind * windFade * 0.06 * u_rayIntensity;

  float bloom = exp(-max(r - discRadius, 0.0) * 2.5);
  bloom *= smoothstep(discRadius - 0.05, discRadius + 0.01, r);
  col += vec3(0.10, 0.34, 0.18) * bloom * 0.25 * u_rayIntensity;

  col += vec3(0.07, 0.24, 0.13) * exp(-r * 1.2) * 0.15 * u_rayIntensity;

  float streak = exp(-uv.y * uv.y * 80.0) * exp(-abs(r - discRadius) * 5.0);
  streak *= smoothstep(discRadius - 0.02, discRadius + 0.05, r);
  col += vec3(0.28, 0.56, 0.36) * streak * 0.08 * u_rayIntensity;

  // Occluding moon.
  float disc = smoothstep(discRadius + 0.003, discRadius - 0.003, r);
  col *= 1.0 - disc;

  // Diamond ring — follows the cursor while it is over the hero.
  float diamondAngle = sin(t * 0.02) * 3.14159265359;
  bool hasMouse = u_mouseActive > 0.5;
  if (hasMouse) {
    vec2 mUV = (u_mouse - u_res * 0.5) / min(u_res.x, u_res.y);
    diamondAngle = atan(mUV.y, mUV.x);
  }
  vec2 diamondDir = vec2(cos(diamondAngle), sin(diamondAngle));
  float diamondDot = dot(normalize(uv), diamondDir);
  float diamond = smoothstep(0.96, 1.0, diamondDot);
  float diamondR = smoothstep(discRadius + 0.025, discRadius, r);
  diamondR *= smoothstep(discRadius - 0.015, discRadius, r);
  float diamondBoost = hasMouse ? 2.5 : 1.5;
  col += vec3(0.90, 1.00, 0.93) * diamond * diamondR * diamondBoost * u_rayIntensity;

  float dBloomR = exp(-pow((r - discRadius) * 20.0, 2.0));
  float dBloomA = smoothstep(0.92, 1.0, diamondDot);
  col += vec3(0.20, 0.46, 0.28) * dBloomR * dBloomA * (diamondBoost * 0.4) * u_rayIntensity;

  // Corona leans toward the cursor.
  if (hasMouse) {
    float coronaPull = smoothstep(0.3, 1.0, dot(normalize(uv), diamondDir));
    coronaPull *= smoothstep(discRadius, discRadius + 0.25, r);
    coronaPull *= smoothstep(0.6, discRadius + 0.05, r);
    col += vec3(0.30, 0.78, 0.44) * coronaPull * 0.15 * u_rayIntensity;
  }

  col += (hash(gl_FragCoord.xy + fract(t * 43.0) * 1000.0) - 0.5) * 0.015;

  col *= 0.7 + 0.3 * (1.0 - smoothstep(0.3, 1.1, r));

  col = max(col, vec3(0.0));
  col = col / (1.0 + col * 0.3);
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(col, col * vec3(0.94, 1.06, 0.97), smoothstep(0.05, 0.0, lum) * 0.2);

  // Premultiplied alpha: what the eclipse lights up is opaque in proportion to
  // how brightly it is lit, everything else lets the page starfield through.
  // The moon is forced opaque — a hole in the sky, not a window onto it.
  float alpha = clamp(max(col.r, max(col.g, col.b)), 0.0, 1.0);
  gl_FragColor = vec4(col, max(alpha, disc));
}
`;
