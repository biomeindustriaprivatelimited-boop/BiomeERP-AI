/** Small local-only (per-machine) app preferences — stored in localStorage,
 *  never sent anywhere. Kept deliberately tiny: only add a preference here
 *  once there's a real, safe way to apply it across the app. */

const REDUCE_MOTION_KEY = "biome:reduceMotion";

export function getReduceMotion(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(REDUCE_MOTION_KEY) === "1";
}

export function setReduceMotion(value: boolean) {
  if (typeof window === "undefined") return;
  localStorage.setItem(REDUCE_MOTION_KEY, value ? "1" : "0");
  applyReduceMotionClass(value);
}

export function applyReduceMotionClass(value: boolean) {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("reduce-motion", value);
}
