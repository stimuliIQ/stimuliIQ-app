"use client";

/**
 * MagicRings — animated concentric "pulse ring" shader, ported from the
 * react-bits `MagicRings-JS-CSS` component to TypeScript for this codebase.
 *
 * Changes from the upstream JS source:
 * - Typed props + refs (CLAUDE.md §3.1 — TypeScript strict, no `any`).
 * - `"use client"` so it works under the Next.js App Router (it touches
 *   WebGL/window and must never run during SSR).
 * - Tailwind sizing (`w-full h-full`) instead of the upstream MagicRings.css,
 *   so the caller controls the box.
 * - Honours `prefers-reduced-motion`: renders a single static frame instead of
 *   running the rAF loop (CLAUDE.md §3.9 — a11y is a requirement).
 * - Defensive teardown (guarded removeChild) and a WebGL-unavailable bail-out,
 *   so a machine without WebGL degrades to an empty box rather than throwing.
 *
 * Rendering note: the fragment shader drives alpha from the brightest channel
 * (`max(c.r, max(c.g, c.b)) * uOpacity`), so dark colours produce a nearly
 * transparent ring. Pass reasonably bright colours and place this on a dark
 * background — see brain-showcase.tsx.
 */

import * as React from "react";
import * as THREE from "three";

const vertexShader = `
void main() {
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const fragmentShader = `
precision highp float;

uniform float uTime, uAttenuation, uLineThickness;
uniform float uBaseRadius, uRadiusStep, uScaleRate;
uniform float uOpacity, uNoiseAmount, uRotation, uRingGap;
uniform float uFadeIn, uFadeOut;
uniform float uMouseInfluence, uHoverAmount, uHoverScale, uParallax, uBurst;
uniform vec2 uResolution, uMouse;
uniform vec3 uColor, uColorTwo;
uniform int uRingCount;

const float HP = 1.5707963;
const float CYCLE = 3.45;

float fade(float t) {
  return t < uFadeIn ? smoothstep(0.0, uFadeIn, t) : 1.0 - smoothstep(uFadeOut, CYCLE - 0.2, t);
}

float ring(vec2 p, float ri, float cut, float t0, float px) {
  float t = mod(uTime + t0, CYCLE);
  float r = ri + t / CYCLE * uScaleRate;
  float d = abs(length(p) - r);
  float a = atan(abs(p.y), abs(p.x)) / HP;
  float th = max(1.0 - a, 0.5) * px * uLineThickness;
  float h = (1.0 - smoothstep(th, th * 1.5, d)) + 1.0;
  d += pow(cut * a, 3.0) * r;
  return h * exp(-uAttenuation * d) * fade(t);
}

void main() {
  float px = 1.0 / min(uResolution.x, uResolution.y);
  vec2 p = (gl_FragCoord.xy - 0.5 * uResolution.xy) * px;
  float cr = cos(uRotation), sr = sin(uRotation);
  p = mat2(cr, -sr, sr, cr) * p;
  p -= uMouse * uMouseInfluence;
  float sc = mix(1.0, uHoverScale, uHoverAmount) + uBurst * 0.3;
  p /= sc;
  vec3 c = vec3(0.0);
  float rcf = max(float(uRingCount) - 1.0, 1.0);
  for (int i = 0; i < 10; i++) {
    if (i >= uRingCount) break;
    float fi = float(i);
    vec2 pr = p - fi * uParallax * uMouse;
    vec3 rc = mix(uColor, uColorTwo, fi / rcf);
    c = mix(c, rc, vec3(ring(pr, uBaseRadius + fi * uRadiusStep, pow(uRingGap, fi), i == 0 ? 0.0 : 2.95 * fi, px)));
  }
  c *= 1.0 + uBurst * 2.0;
  float n = fract(sin(dot(gl_FragCoord.xy + uTime * 100.0, vec2(12.9898, 78.233))) * 43758.5453);
  c += (n - 0.5) * uNoiseAmount;
  gl_FragColor = vec4(c, max(c.r, max(c.g, c.b)) * uOpacity);
}
`;

export interface MagicRingsProps {
  /** Inner ring colour (hex). */
  color?: string;
  /** Outer ring colour (hex) — rings blend from `color` to this. */
  colorTwo?: string;
  speed?: number;
  /** Number of rings; the shader caps out at 10. */
  ringCount?: number;
  attenuation?: number;
  lineThickness?: number;
  baseRadius?: number;
  radiusStep?: number;
  scaleRate?: number;
  opacity?: number;
  /** CSS blur applied to the whole canvas, in px. */
  blur?: number;
  noiseAmount?: number;
  /** Degrees. */
  rotation?: number;
  ringGap?: number;
  fadeIn?: number;
  fadeOut?: number;
  followMouse?: boolean;
  mouseInfluence?: number;
  hoverScale?: number;
  parallax?: number;
  clickBurst?: boolean;
  className?: string;
}

/** The prop set the animation loop reads each frame (all defaults resolved). */
type AnimatedProps = Required<
  Omit<MagicRingsProps, "blur" | "className">
>;

export function MagicRings({
  color = "#fc42ff",
  colorTwo = "#42fcff",
  speed = 1,
  ringCount = 6,
  attenuation = 10,
  lineThickness = 2,
  baseRadius = 0.35,
  radiusStep = 0.1,
  scaleRate = 0.1,
  opacity = 1,
  blur = 0,
  noiseAmount = 0.1,
  rotation = 0,
  ringGap = 1.5,
  fadeIn = 0.7,
  fadeOut = 0.5,
  followMouse = false,
  mouseInfluence = 0.2,
  hoverScale = 1.2,
  parallax = 0.05,
  clickBurst = false,
  className,
}: MagicRingsProps): React.JSX.Element {
  const mountRef = React.useRef<HTMLDivElement | null>(null);
  const propsRef = React.useRef<AnimatedProps | null>(null);
  const mouseRef = React.useRef<[number, number]>([0, 0]);
  const smoothMouseRef = React.useRef<[number, number]>([0, 0]);
  const hoverAmountRef = React.useRef(0);
  const isHoveredRef = React.useRef(false);
  const burstRef = React.useRef(0);

  // Kept in a ref so the rAF loop always reads current props without re-running
  // the WebGL setup effect.
  propsRef.current = {
    color,
    colorTwo,
    speed,
    ringCount,
    attenuation,
    lineThickness,
    baseRadius,
    radiusStep,
    scaleRate,
    opacity,
    noiseAmount,
    rotation,
    ringGap,
    fadeIn,
    fadeOut,
    followMouse,
    mouseInfluence,
    hoverScale,
    parallax,
    clickBurst,
  };

  React.useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    // Probe for WebGL2 with a plain canvas BEFORE handing three.js anything:
    // THREE.WebGLRenderer console.error()s ("A WebGL context could not be
    // created…", "Error creating WebGL context.") in addition to throwing, so a
    // try/catch alone still spams the console on machines with the GPU/WebGL
    // disabled (remote desktops, sandboxed browsers, blocklisted drivers).
    // canvas.getContext returns null silently in that case — no console noise.
    let probeGl: WebGL2RenderingContext | null = null;
    try {
      probeGl = document.createElement("canvas").getContext("webgl2");
    } catch {
      probeGl = null;
    }
    if (!probeGl) {
      // No WebGL2 — this is a decorative background; leave an empty box.
      return;
    }
    // Release the probe context right away so it doesn't count against the
    // browser's live-context limit alongside the real renderer below.
    probeGl.getExtension("WEBGL_lose_context")?.loseContext();

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    } catch {
      // Probe passed but the real context still failed (context-limit races,
      // driver resets) — same graceful empty box.
      return;
    }

    if (!renderer.capabilities.isWebGL2) {
      renderer.dispose();
      return;
    }

    renderer.setClearColor(0x000000, 0);
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-0.5, 0.5, 0.5, -0.5, 0.1, 10);
    camera.position.z = 1;

    const uniforms = {
      uTime: { value: 0 },
      uAttenuation: { value: 0 },
      uResolution: { value: new THREE.Vector2() },
      uColor: { value: new THREE.Color() },
      uColorTwo: { value: new THREE.Color() },
      uLineThickness: { value: 0 },
      uBaseRadius: { value: 0 },
      uRadiusStep: { value: 0 },
      uScaleRate: { value: 0 },
      uRingCount: { value: 0 },
      uOpacity: { value: 1 },
      uNoiseAmount: { value: 0 },
      uRotation: { value: 0 },
      uRingGap: { value: 1.6 },
      uFadeIn: { value: 0.5 },
      uFadeOut: { value: 0.75 },
      uMouse: { value: new THREE.Vector2() },
      uMouseInfluence: { value: 0 },
      uHoverAmount: { value: 0 },
      uHoverScale: { value: 1 },
      uParallax: { value: 0 },
      uBurst: { value: 0 },
    };

    const material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms,
      transparent: true,
      // The shader already outputs premultiplied colour: it builds `c` by mixing
      // up from black by the ring's coverage, then derives alpha from that same
      // value. Without this flag three.js blends with SRC_ALPHA and multiplies
      // by alpha a second time, so partly-faded rings darken toward grey. That
      // is invisible on a black background but shows as dirty grey smudges on a
      // light one — which is what this band is now.
      premultipliedAlpha: true,
    });
    const geometry = new THREE.PlaneGeometry(1, 1);
    const quad = new THREE.Mesh(geometry, material);
    scene.add(quad);

    const resize = () => {
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      const dpr = Math.min(window.devicePixelRatio, 2);
      renderer.setPixelRatio(dpr);
      renderer.setSize(w, h);
      uniforms.uResolution.value.set(w * dpr, h * dpr);
    };
    resize();
    window.addEventListener("resize", resize);

    const ro = new ResizeObserver(resize);
    ro.observe(mount);

    const onMouseMove = (e: MouseEvent) => {
      const rect = mount.getBoundingClientRect();
      mouseRef.current[0] = (e.clientX - rect.left) / rect.width - 0.5;
      mouseRef.current[1] = -((e.clientY - rect.top) / rect.height - 0.5);
    };
    const onMouseEnter = () => {
      isHoveredRef.current = true;
    };
    const onMouseLeave = () => {
      isHoveredRef.current = false;
      mouseRef.current[0] = 0;
      mouseRef.current[1] = 0;
    };
    const onClick = () => {
      burstRef.current = 1;
    };

    mount.addEventListener("mousemove", onMouseMove);
    mount.addEventListener("mouseenter", onMouseEnter);
    mount.addEventListener("mouseleave", onMouseLeave);
    mount.addEventListener("click", onClick);

    /** Push the current props/refs into the shader uniforms for time `t` (ms). */
    const syncUniforms = (t: number) => {
      const p = propsRef.current;
      if (!p) return;

      uniforms.uTime.value = t * 0.001 * p.speed;
      uniforms.uAttenuation.value = p.attenuation;
      uniforms.uColor.value.set(p.color);
      uniforms.uColorTwo.value.set(p.colorTwo);
      uniforms.uLineThickness.value = p.lineThickness;
      uniforms.uBaseRadius.value = p.baseRadius;
      uniforms.uRadiusStep.value = p.radiusStep;
      uniforms.uScaleRate.value = p.scaleRate;
      uniforms.uRingCount.value = p.ringCount;
      uniforms.uOpacity.value = p.opacity;
      uniforms.uNoiseAmount.value = p.noiseAmount;
      uniforms.uRotation.value = (p.rotation * Math.PI) / 180;
      uniforms.uRingGap.value = p.ringGap;
      uniforms.uFadeIn.value = p.fadeIn;
      uniforms.uFadeOut.value = p.fadeOut;
      uniforms.uMouse.value.set(smoothMouseRef.current[0], smoothMouseRef.current[1]);
      uniforms.uMouseInfluence.value = p.followMouse ? p.mouseInfluence : 0;
      uniforms.uHoverAmount.value = hoverAmountRef.current;
      uniforms.uHoverScale.value = p.hoverScale;
      uniforms.uParallax.value = p.parallax;
      uniforms.uBurst.value = p.clickBurst ? burstRef.current : 0;
    };

    // Reduced motion: draw one representative frame, skip the rAF loop entirely.
    const prefersReducedMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let frameId = 0;

    if (prefersReducedMotion) {
      syncUniforms(1200);
      renderer.render(scene, camera);
    } else {
      const animate = (t: number) => {
        frameId = requestAnimationFrame(animate);

        smoothMouseRef.current[0] += (mouseRef.current[0] - smoothMouseRef.current[0]) * 0.08;
        smoothMouseRef.current[1] += (mouseRef.current[1] - smoothMouseRef.current[1]) * 0.08;
        hoverAmountRef.current += ((isHoveredRef.current ? 1 : 0) - hoverAmountRef.current) * 0.08;
        burstRef.current *= 0.95;
        if (burstRef.current < 0.001) burstRef.current = 0;

        syncUniforms(t);
        renderer.render(scene, camera);
      };
      frameId = requestAnimationFrame(animate);
    }

    return () => {
      if (frameId) cancelAnimationFrame(frameId);
      window.removeEventListener("resize", resize);
      ro.disconnect();
      mount.removeEventListener("mousemove", onMouseMove);
      mount.removeEventListener("mouseenter", onMouseEnter);
      mount.removeEventListener("mouseleave", onMouseLeave);
      mount.removeEventListener("click", onClick);
      // Guarded: React may already have detached the node on unmount.
      if (renderer.domElement.parentNode === mount) {
        mount.removeChild(renderer.domElement);
      }
      geometry.dispose();
      material.dispose();
      renderer.dispose();
    };
  }, []);

  return (
    <div
      ref={mountRef}
      aria-hidden="true"
      className={className ?? "h-full w-full"}
      style={blur > 0 ? { filter: `blur(${blur}px)` } : undefined}
    />
  );
}

MagicRings.displayName = "MagicRings";

export default MagicRings;
