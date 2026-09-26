# BIOME ERP Login Interface — Premium Redesign

Scope is limited to the Login Interface.

## Design
- Sky-blue daylight renewable-energy environment.
- Premium biomass pellet processing plant rendered as responsive SVG.
- Silos, processing building, conveyor, pellet hoppers, clean steam, green hills, trees/horizon and a subtle wind turbine.
- Moving leaves, clouds, sunlight, steam and plant micro-motion.
- BIOME brand mark and concise enterprise positioning.
- Glass white login card with secure enterprise styling.
- Login card reveals after the cinematic environment intro (~2.35s).
- Existing testing-mode authentication behavior is preserved.
- Reduced-motion support is preserved.
- No dashboard/ERP module files were intentionally modified.

## Deliberate change from previous attempts
The unreliable extracted character asset was removed. The login experience no longer depends on the broken chroma-key PNG/video asset. The scene is fully self-contained and deterministic in React/CSS/SVG, so the character visibility problem cannot blank the login screen.
