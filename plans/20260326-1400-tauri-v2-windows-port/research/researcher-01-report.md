# Research: Tauri v2 Windows-Specific Capabilities

## 1. Transparent Video Playback in WebView2

**WebM VP9 Alpha** is fully supported in WebView2 (Chromium-based). This is the recommended approach:
- HTML5 `<video>` element with `.webm` source plays with alpha transparency
- No special configuration needed — just set `background: transparent` on window and body
- Masko configs already include `webm` URLs alongside `hevc` — direct reuse

**HEVC Alpha** (macOS default) is NOT supported in Chromium/WebView2. Don't use `.mov` files.

**Alternative: APNG/WebP** — Could work for simple animations but files are larger and no playback rate control.

**Recommendation:** Use WebM VP9 alpha. Already in mascot config JSON.

## 2. Global Hotkeys

**tauri-plugin-global-shortcut (v2):**
- Registers system-wide shortcuts via OS APIs
- Supports modifier combos: Ctrl+M, Ctrl+1-9, Ctrl+Enter, etc.
- Limitation: Cannot detect modifier-only presses (e.g., double-tap Ctrl)

**Double-tap Detection:**
- Requires low-level keyboard hook via Win32 `SetWindowsHookEx(WH_KEYBOARD_LL, ...)`
- Track `VK_CONTROL` key-up timestamps
- Fire event if two releases within 400ms with no other keys pressed
- Must run on separate thread to avoid blocking

**Windows Key:** Opens Start menu — NOT suitable as hotkey modifier. Use Ctrl instead of Cmd.

## 3. Click-Through Transparency

**Current Tauri v2 Status:** `setIgnoreCursorEvents(true)` is all-or-nothing.

**Win32 Workaround:**
- `WS_EX_TRANSPARENT` extended window style makes entire window click-through
- Not selective — the whole window or nothing
- Could use two overlapping windows: one for click-through mascot, one for interactive UI

**CSS pointer-events:** Only works within the webview — events don't pass to underlying OS windows.

**Recommendation:** Accept non-click-through overlay for now. Hide overlay on demand via tray. This matches Tauri's documented limitation.

## 4. Embedded HTTP Server

**Axum + Tokio** (recommended):
- Axum runs on Tokio async runtime — same runtime Tauri uses
- No additional thread management needed
- Spawn server in Tauri `.setup()`:
  ```rust
  tauri::async_runtime::spawn(async move { server::start(handle).await; });
  ```
- Use `tokio::sync::oneshot` for PermissionRequest blocking

**Alternatives:** `tiny_http` (sync, lighter) or `warp`. Axum is best for async + Tauri integration.

## 5. Window Management

**Non-activating windows:**
- Tauri v2 `focus: false` in window config prevents initial focus
- For click behavior: may need Win32 `WS_EX_NOACTIVATE` style via raw window handle
- Access raw HWND: `window.hwnd()` in Tauri Rust API

**Multiple windows:**
- Overlay window (always-on-top, frameless, transparent)
- Dashboard window (regular, decorated)
- Permission panel (frameless, always-on-top, positioned above mascot)
- Each can have separate HTML entry points

**Window positioning:** Use `window.set_position()` to position permission panel relative to mascot.
