---
name: ios26-liquid-glass-ui
description: Design or refine frontend interfaces with an iOS 26 Liquid Glass visual system. Use when the user asks for iOS 26 style, Liquid Glass, glassmorphism, translucent Apple-like UI, polished macOS/iOS glass controls, frosted/refraction effects, or wants an existing HTML/CSS/React/Vue/Tauri interface to look less rough and more premium.
---

# iOS 26 Liquid Glass UI

Create refined Apple-platform interfaces that feel like layered, translucent glass rather than generic dark glassmorphism.

## Core Direction

- Treat content as the anchor and glass as the floating navigation/control material.
- Use translucent surfaces with enough opacity for readability; avoid ultra-clear panels behind dense text.
- Build depth with three layers: background color field, blurred glass surfaces, edge/highlight reflections.
- Keep accent color restrained. Default to system blue `#007AFF`; use orange/red only for warnings.
- Prefer rounded continuous corners: 18-26px for panels, 12-18px for controls, 999px for capsules.
- Use Apple/system typography: `-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", "Noto Sans SC", sans-serif`.

## Required Visual Traits

Use these traits together:

- **Liquid surface**: `backdrop-filter: blur(24px-36px) saturate(160%-200%) brightness(1.02-1.08)`.
- **Soft glass fill**: layered `linear-gradient(145deg, rgba(255,255,255,.14), rgba(255,255,255,.045))`.
- **Refractive edge**: subtle border plus inner highlights, not hard outlines.
- **Glint**: one restrained diagonal/highlight layer per major surface, never a loud stripe that competes with content.
- **Floating shadow**: broad, low-opacity shadows. Avoid neon glow except selected blue controls.
- **Readable contrast**: main text near 90% opacity, secondary 55-65%, tertiary 32-42%.

## Interaction Patterns

- Use segmented controls for mutually exclusive modes.
- Use capsule switches for binary settings.
- Use thin sliders with white circular thumbs and soft shadow.
- Use icon-only buttons for compact actions when the symbol is familiar; provide `title` and `aria-label`.
- Use page-level sidebars/topbars as glass navigation floating over content.
- Make selected states look like a raised glass layer, not a flat filled rectangle.

## Implementation Workflow

1. Audit the existing UI before editing: locate current colors, border radii, panels, buttons, sliders, and navigation.
2. Create CSS tokens for glass material, text opacity, accent colors, radius, shadow, and line colors.
3. Replace hard borders and opaque cards with glass surfaces using fill + blur + inner highlights.
4. Simplify color palette before adding effects. A noisy palette makes Liquid Glass look cheap.
5. Add responsive checks for text fit and horizontal overflow.
6. Verify in browser screenshots at desktop and mobile widths when possible.

## Anti-Patterns

- Do not use pure black or flat dark gray as the only background.
- Do not use heavy neon colors, thick borders, or visible grid patterns as the main aesthetic.
- Do not make everything transparent; readability wins.
- Do not stack cards inside cards unless the inner element is a real control, modal, list item, or repeated item.
- Do not use large decorative orbs/blobs as the only source of visual interest.
- Do not overdo diagonal shine. It should feel like reflection, not a banner.

## References

For reusable CSS tokens, component recipes, and validation checks, read `references/liquid-glass-patterns.md`.
