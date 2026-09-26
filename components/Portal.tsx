"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Render children directly into <body>.
 *
 * Why every overlay needs this: CSS positions a `position: fixed` element
 * against the viewport ONLY if none of its ancestors has a transform,
 * filter, backdrop-filter or perspective. This app is full of those — the
 * page transition, glass cards with a backdrop blur, 3D tilt cards, hover
 * lifts. Inside any of them a "full-screen" modal is silently positioned
 * against that card instead: its top is cut off, it scrolls with the page,
 * and it jumps when the pointer moves. Mounting the overlay on <body>
 * takes it out of every such ancestor at once.
 */
export default function Portal({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return createPortal(children, document.body);
}
