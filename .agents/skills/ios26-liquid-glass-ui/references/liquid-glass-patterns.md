# Liquid Glass Patterns

## CSS Tokens

```css
:root {
  --bg: #121315;
  --bg-soft: #222427;
  --glass-surface: linear-gradient(145deg, rgba(255,255,255,.14), rgba(255,255,255,.045));
  --glass-surface-raised: linear-gradient(145deg, rgba(255,255,255,.22), rgba(255,255,255,.09));
  --glass-border: rgba(255,255,255,.135);
  --glass-border-soft: rgba(255,255,255,.06);
  --glass-edge: inset 0 1px 0 rgba(255,255,255,.34), inset 0 -1px 0 rgba(255,255,255,.055);
  --shadow-soft: 0 18px 48px rgba(0,0,0,.20);
  --accent: #007aff;
  --ok: #32d74b;
  --warn: #ff9f0a;
  --danger: #ff453a;
  --text: rgba(255,255,255,.92);
  --text-secondary: rgba(255,255,255,.62);
  --text-tertiary: rgba(255,255,255,.38);
}
```

## Glass Panel

```css
.glass-panel {
  position: relative;
  border-radius: 22px;
  background: var(--glass-surface);
  border: 1px solid var(--glass-border);
  box-shadow: var(--glass-edge), var(--shadow-soft);
  backdrop-filter: blur(32px) saturate(190%) brightness(1.04);
  -webkit-backdrop-filter: blur(32px) saturate(190%) brightness(1.04);
  overflow: hidden;
}

.glass-panel::before {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  border-radius: inherit;
  background:
    linear-gradient(135deg, rgba(255,255,255,.22), transparent 31%),
    linear-gradient(315deg, rgba(255,255,255,.065), transparent 36%),
    linear-gradient(98deg, transparent 0 54%, rgba(255,255,255,.075) 58%, transparent 64%);
  opacity: .62;
}
```

## Segmented Control

```css
.segmented {
  display: grid;
  grid-template-columns: repeat(var(--segments, 4), minmax(0, 1fr));
  gap: 4px;
  padding: 5px;
  border-radius: 18px;
  background: var(--glass-surface);
  border: 1px solid var(--glass-border);
  box-shadow: var(--glass-edge);
  backdrop-filter: blur(22px) saturate(180%);
  -webkit-backdrop-filter: blur(22px) saturate(180%);
}

.segment {
  min-height: 42px;
  border: 0;
  border-radius: 14px;
  background: transparent;
  color: var(--text-secondary);
}

.segment[aria-selected="true"],
.segment.active {
  background: var(--glass-surface-raised);
  color: var(--text);
  border: 1px solid rgba(255,255,255,.16);
  box-shadow: var(--glass-edge), 0 12px 28px rgba(0,0,0,.16);
}
```

## Toggle Switch

```css
.glass-switch {
  position: relative;
  width: 52px;
  height: 30px;
  border: 1px solid var(--glass-border);
  border-radius: 999px;
  background: rgba(255,255,255,.16);
  box-shadow: var(--glass-edge);
}

.glass-switch::after {
  content: "";
  position: absolute;
  width: 26px;
  height: 26px;
  left: 2px;
  top: 2px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 3px 12px rgba(0,0,0,.34), inset 0 1px 0 rgba(255,255,255,.9);
  transition: transform 180ms ease;
}

.glass-switch.is-on {
  background: linear-gradient(180deg, rgba(89,231,112,.92), rgba(50,215,75,.74));
}

.glass-switch.is-on::after {
  transform: translateX(22px);
}
```

## Background

```css
body {
  background:
    linear-gradient(118deg, rgba(0,122,255,.22), transparent 46%),
    linear-gradient(250deg, rgba(100,210,255,.15), transparent 54%),
    linear-gradient(180deg, rgba(255,255,255,.09), transparent 28%),
    linear-gradient(135deg, var(--bg), var(--bg-soft));
}
```

## Validation Checklist

- Confirm no script errors in a browser.
- Check desktop and mobile widths for horizontal overflow.
- Inspect long labels inside buttons and segmented controls.
- Ensure glass panels remain readable over the chosen background.
- Reduce opacity/highlight strength if the surface reads like plastic or chrome.
