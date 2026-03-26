# Research: Frontend Stack for Tauri Mascot Overlay

## 1. Framework Comparison

| Framework | Bundle Size | Reactivity | Tauri Support | Verdict |
|-----------|------------|------------|---------------|---------|
| **SolidJS** | ~7KB | Fine-grained signals | Official template | Best for overlay |
| React | ~45KB | Virtual DOM diffing | Official template | Overkill for overlay |
| Svelte | ~3KB | Compile-time | Official template | Good but less ecosystem |
| Vanilla TS | 0KB | Manual | N/A | Too much boilerplate |

**Recommendation: SolidJS**
- Smallest runtime with reactive primitives
- No virtual DOM — direct DOM updates = better animation perf
- `createStore` maps naturally to Swift's `@Observable`
- Official Tauri template available

## 2. Animation Approach

| Approach | Transparency | Performance | Complexity | Verdict |
|----------|-------------|-------------|------------|---------|
| **HTML5 `<video>` + WebM VP9** | Native alpha | Excellent (GPU) | Simple | Best choice |
| PixiJS sprite sheets | Supported | Good (WebGL) | Medium | Overkill — videos already exist |
| CSS sprite animation | No alpha for video | OK | Simple | Can't play video |
| Lottie | Supported | Good | Medium | Would need re-export all animations |
| Canvas API | Supported | Manual | Complex | Too low-level |

**Recommendation: HTML5 `<video>` with WebM VP9 alpha**
- Mascot configs already include `.webm` URLs
- WebView2 (Chromium) supports VP9 alpha natively
- Simple implementation: `<video autoplay loop muted>`
- GPU-accelerated decoding
- Playback rate control via `video.playbackRate`

## 3. State Management

| Solution | Size | Reactivity | Fit |
|----------|------|-----------|-----|
| **SolidJS signals/stores** | 0KB (built-in) | Fine-grained | Perfect |
| Zustand | ~3KB | Subscription | React-only |
| Jotai | ~4KB | Atomic | React-only |

**Recommendation: SolidJS built-in**
- `createSignal()` for simple values (current node, video URL)
- `createStore()` for complex objects (session list, permission queue)
- `createEffect()` for side effects (emit IPC on state change)
- No extra dependency needed

## 4. Styling Approach

| Solution | Bundle | Animation | DX |
|----------|--------|-----------|-----|
| **Tailwind CSS** | ~10KB (purged) | Via arbitrary values | Excellent |
| CSS Modules | 0KB | Standard CSS | Good |
| styled-components | ~12KB | JS-in-CSS | React-only |

**Recommendation: Tailwind CSS**
- Utility-first maps well to component-based architecture
- Easy to replicate brand colors from Constants.swift
- Small purged bundle for overlay window
- No runtime overhead

## 5. Recommended Stack

```
Frontend:
  SolidJS + TypeScript   (reactivity, components)
  Tailwind CSS           (styling)
  Vite                   (build tool)
  HTML5 <video>          (WebM VP9 alpha animation)

Backend (Rust):
  Axum + Tokio           (HTTP server)
  Serde                  (JSON serialization)
  tauri-plugin-*         (shortcuts, updater, notifications)

Build:
  Vite                   (frontend bundling)
  Cargo                  (Rust compilation)
  Tauri CLI              (packaging)
```

This stack minimizes bundle size (~20KB frontend) while providing all needed capabilities.
