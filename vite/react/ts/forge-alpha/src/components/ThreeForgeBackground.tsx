import React, { useEffect, useRef } from "react";
import * as THREE from "three";

/**
 * Minimal Three.js background with deliberate RAF scheduling.
 * Only requests next frame after target delay, avoiding RAF spam.
 */
const ThreeForgeBackground: React.FC<{ className?: string }> = ({ className }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Three.js renderer
    const renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: "low-power",
    });

    // Scene and camera
    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    // Shader material
    const material = new THREE.ShaderMaterial({
      uniforms: {
        u_res: { value: new THREE.Vector2() },
        u_time: { value: 0 },
        u_seed: { value: Math.random() * 1000 },
      },
      vertexShader: `
        void main() {
          gl_Position = vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        #ifdef GL_FRAGMENT_PRECISION_HIGH
        precision highp float;
        #else
        precision mediump float;
        #endif

        uniform vec2 u_res;
        uniform float u_time;
        uniform float u_seed;

        float vnoise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          const float K = 43758.5;
          vec2 h = vec2(12.9898, 78.233);
          vec4 px = i.x + vec4(0, 1, 0, 1);
          vec4 py = i.y + vec4(0, 0, 1, 1);
          vec4 hash = fract(sin(px * h.x + py * h.y) * K);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash.x, hash.y, u.x), mix(hash.z, hash.w, u.x), u.y);
        }

        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5);
        }

        void main() {
          vec2 p = (gl_FragCoord.xy - 0.5 * u_res) / u_res.y;
          float t = u_time * 0.5;

          p.y -= t * 0.038;

          float ft = t * 0.2;
          vec2 flow = vec2(
            sin(ft + p.y * 1.5),
            cos(ft * 0.9 + p.x * 1.5)
          ) * 0.25;

          const float NOISE_SCALE = 1.5;
          vec2 pw = (p * NOISE_SCALE + flow);

          float wt = t * 0.15;
          pw += vec2(
            sin(wt + p.y * 1.2),
            cos(wt * 1.07 + p.x * 1.1)
          ) * 0.12;

          float n = vnoise(pw + t * 0.02 + u_seed) * 0.65 +
                    vnoise(pw * 2.2 + t * 0.035 + u_seed * 0.7) * 0.35;

          n += sin(t * 0.4) * 0.025;
          n = clamp(n, 0.0, 1.0);
          n = pow(n, 1.35);
          n = clamp(n, 0.0, 1.0);

          vec3 colBase     = vec3(9.0, 0.8, 0.0) / 255.0;
          vec3 colDarkRare = vec3(5.0, 1.0, 0.0) / 255.0;
          vec3 colTrans    = vec3(30.0, 5.0, 2.0) / 255.0;
          vec3 colBright   = vec3(57.0, 12.0, 4.0) / 255.0;
          vec3 colHi       = vec3(122.0, 43.0, 12.0) / 255.0;

          float baseEnd   = 0.2;
          float transEnd  = 0.45;
          float brightEnd = 0.625;

          vec3 col;
          if (n < baseEnd) {
            col = mix(colDarkRare, colBase, smoothstep(0.0, 0.05, n));
          } else if (n < transEnd) {
            float f = pow((n - baseEnd) / (transEnd - baseEnd), 0.7);
            col = mix(colBase, colTrans, f);
          } else if (n < brightEnd) {
            float f = pow((n - transEnd) / (brightEnd - transEnd), 0.85);
            col = mix(colTrans, colBright, f);
          } else {
            float f = pow((n - brightEnd) / (1.0 - brightEnd), 1.6);
            col = mix(colBright, colHi, f);
          }

          float h = hash(gl_FragCoord.xy);
          float ang = h * 6.2831853;
          vec2 dir = vec2(cos(ang), sin(ang));
          float shimmer = sin(dot(p, dir) * 16.0 + t * 1.2 + h * 6.2831853) * 0.0025;

          col += shimmer;
          col = clamp(col, 0.0, 1.0);

          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });

    const geometry = new THREE.PlaneGeometry(2, 2);
    const mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);

    // Handle resize
    const handleResize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.0);
      const scale = 1.0;
      const w = window.innerWidth;
      const h = window.innerHeight;
      const canvasWidth = w * dpr * scale;
      const canvasHeight = h * dpr * scale;

      renderer.setSize(canvasWidth, canvasHeight, false);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;

      material.uniforms.u_res.value.set(canvasWidth, canvasHeight);
    };
    handleResize();
    window.addEventListener("resize", handleResize);

    // Deliberate rendering - no RAF spam
    const startTime = performance.now();
    const targetDelta = 1000 / 30; // 30fps
    let rafId: number | undefined;
    let timeoutId: number | undefined;
    let isScheduled = false;

    const render = () => {
      // Render the frame
      const now = performance.now();
      material.uniforms.u_time.value = (now - startTime) * 0.001;
      renderer.render(scene, camera);
      
      // Schedule next render after delay
      isScheduled = false;
      scheduleNext();
    };

    const scheduleNext = () => {
      if (isScheduled) return;
      isScheduled = true;
      
      // Use setTimeout to wait, then RAF for vsync timing
      timeoutId = window.setTimeout(() => {
        rafId = requestAnimationFrame(render);
      }, targetDelta);
    };

    // Start the loop
    scheduleNext();

    return () => {
      if (rafId !== undefined) cancelAnimationFrame(rafId);
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      window.removeEventListener("resize", handleResize);
      renderer.dispose();
      geometry.dispose();
      material.dispose();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{
        position: "fixed",
        inset: 0,
        width: "100%",
        height: "100%",
        display: "block",
        pointerEvents: "none",
        zIndex: -1,
        imageRendering: "auto",
      }}
    />
  );
};

export default ThreeForgeBackground;