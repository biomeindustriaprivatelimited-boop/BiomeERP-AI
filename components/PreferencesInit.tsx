"use client";

import { useEffect } from "react";
import { applyReduceMotionClass, getReduceMotion } from "@/lib/preferences";

/** Applies saved local preferences (currently: reduce motion) on every
 *  page load. Renders nothing — just a side-effect hook mounted once
 *  in the root layout. */
export default function PreferencesInit() {
  useEffect(() => {
    applyReduceMotionClass(getReduceMotion());
  }, []);
  return null;
}
