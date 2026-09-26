"use client";

import { useEffect, useRef } from "react";

/**
 * A real 3D scene (Three.js, WebGL): a slowly turning hexagonal prism of
 * lime particles — the Biome mark in three dimensions — with a field of
 * floating pellets and pointer parallax. Built without OrbitControls so
 * it works in Electron with no extra modules; degrades to nothing on
 * machines without WebGL, and pauses when the tab is hidden.
 */
export default function Hero3D({ className = "", density = 1400, intensity = 1 }: { className?: string; density?: number; intensity?: number }) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const host = ref.current; if (!host) return;
    let disposed = false; let raf = 0;
    let cleanup: (() => void) | null = null;
    (async () => {
      const THREE = await import("three");
      if (disposed) return;
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const W = host.clientWidth || 800, H = host.clientHeight || 500;
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); renderer.setSize(W, H); host.appendChild(renderer.domElement);
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(42, W / H, 0.1, 100); camera.position.set(0, 0.4, 7.2);

      // Hexagonal prism of particles — the logo, volumetric.
      const pts: number[] = []; const cols: number[] = [];
      const lime = new THREE.Color("#9fe870"), forest = new THREE.Color("#3d7a1f"), white = new THREE.Color("#e2f6d5");
      for (let i = 0; i < density; i++) {
        const side = Math.floor(Math.random() * 6); const t = Math.random();
        const a0 = (side / 6) * Math.PI * 2 + Math.PI / 6, a1 = ((side + 1) / 6) * Math.PI * 2 + Math.PI / 6;
        const r = 1.6; const x = Math.cos(a0) * r + (Math.cos(a1) * r - Math.cos(a0) * r) * t; const z = Math.sin(a0) * r + (Math.sin(a1) * r - Math.sin(a0) * r) * t;
        const y = (Math.random() - 0.5) * 2.2;
        pts.push(x, y, z);
        const c = Math.random() < 0.12 ? white : Math.random() < 0.5 ? lime : forest; cols.push(c.r, c.g, c.b);
      }
      // Inner leaf ribbon
      for (let i = 0; i < density / 3; i++) {
        const t = i / (density / 3); const ang = t * Math.PI * 1.6 - 0.8; const r = 0.25 + t * 0.9;
        pts.push(Math.cos(ang) * r, (t - 0.5) * 1.8, Math.sin(ang) * r * 0.6); cols.push(lime.r, lime.g, lime.b);
      }
      const geo = new THREE.BufferGeometry(); geo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3)); geo.setAttribute("color", new THREE.Float32BufferAttribute(cols, 3));
      const mat = new THREE.PointsMaterial({ size: 0.035, vertexColors: true, transparent: true, opacity: 0.95, sizeAttenuation: true });
      const logo = new THREE.Points(geo, mat); scene.add(logo);

      // Wire edges of the prism
      const edges = new THREE.EdgesGeometry(new THREE.CylinderGeometry(1.6, 1.6, 2.2, 6, 1));
      const wire = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x9fe870, transparent: true, opacity: 0.35 })); scene.add(wire);

      // Floating pellets (ambient field)
      const fp: number[] = []; for (let i = 0; i < 400; i++) fp.push((Math.random() - 0.5) * 16, (Math.random() - 0.5) * 9, (Math.random() - 0.5) * 8 - 2);
      const fg = new THREE.BufferGeometry(); fg.setAttribute("position", new THREE.Float32BufferAttribute(fp, 3));
      const field = new THREE.Points(fg, new THREE.PointsMaterial({ color: 0x9fe870, size: 0.02, transparent: true, opacity: 0.35 })); scene.add(field);

      let mx = 0, my = 0; const onMove = (e: PointerEvent) => { mx = (e.clientX / window.innerWidth - 0.5) * 2; my = (e.clientY / window.innerHeight - 0.5) * 2; };
      window.addEventListener("pointermove", onMove);
      const onResize = () => { const w = host.clientWidth, h = host.clientHeight; renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); };
      window.addEventListener("resize", onResize);

      let t0 = performance.now();
      const loop = (t: number) => {
        if (disposed) return;
        if (document.hidden) { raf = requestAnimationFrame(loop); return; }
        const dt = (t - t0) / 1000; t0 = t;
        if (!reduce) { logo.rotation.y += dt * 0.25 * intensity; wire.rotation.y = logo.rotation.y; logo.rotation.x += (my * 0.35 - logo.rotation.x) * 0.04; wire.rotation.x = logo.rotation.x; field.rotation.y += dt * 0.03; }
        camera.position.x += (mx * 0.9 - camera.position.x) * 0.05; camera.position.y += (0.4 - my * 0.5 - camera.position.y) * 0.05; camera.lookAt(0, 0, 0);
        renderer.render(scene, camera); raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
      cleanup = () => { window.removeEventListener("pointermove", onMove); window.removeEventListener("resize", onResize); renderer.dispose(); geo.dispose(); fg.dispose(); edges.dispose(); host.contains(renderer.domElement) && host.removeChild(renderer.domElement); };
    })().catch(() => { /* no WebGL — the CSS scene behind us still shows */ });
    return () => { disposed = true; cancelAnimationFrame(raf); cleanup?.(); };
  }, [density, intensity]);

  return <div ref={ref} className={`pointer-events-none ${className}`} aria-hidden="true" />;
}
