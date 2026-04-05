# Tauri v2 `setIgnoreCursorEvents` Windows Implementation Analysis

## Summary

The `setIgnoreCursorEvents` function in Tauri v2 uses the **Tao** windowing library (tauri-apps/tao) for platform-specific implementation. On Windows, it ultimately makes the following Windows API calls:

1. **SetWindowLongW** (GWL_STYLE) - Updates base window styles
2. **SetWindowLongW** (GWL_EXSTYLE) - Updates extended window styles with `WS_EX_TRANSPARENT | WS_EX_LAYERED`
3. **SetWindowPos** - Applies frame changes with `SWP_FRAMECHANGED`

---

## Detailed Call Flow

### High-Level: JavaScript/TypeScript API
```typescript
await getCurrentWindow().setIgnoreCursorEvents(true);
```

This invokes the `plugin:window|set_ignore_cursor_events` command.

### Rust Implementation: Tao Library

**File:** `src/platform_impl/windows/window.rs`

```rust
pub fn set_ignore_cursor_events(&self, ignore: bool) -> Result<(), ExternalError> {
    let window = self.window.0 .0 as isize;
    let window_state = Arc::clone(&self.window_state);
    self.thread_executor.execute_in_thread(move || {
        WindowState::set_window_flags(window_state.lock(), HWND(window as _), |f| {
            f.set(WindowFlags::IGNORE_CURSOR_EVENT, ignore)
        });
    });
    Ok(())
}
```

**Key Actions:**
1. Extracts the window handle (HWND)
2. Clones the window state Arc reference
3. Executes on the UI thread via `thread_executor.execute_in_thread()`
4. Delegates to `WindowState::set_window_flags()` to update flags

---

## Windows API Calls

### 1. Flag Conversion: `to_window_styles()`

**File:** `src/platform_impl/windows/window_state.rs`

When `IGNORE_CURSOR_EVENT` flag is set:

```rust
if self.contains(WindowFlags::IGNORE_CURSOR_EVENT) {
    style_ex |= WS_EX_TRANSPARENT | WS_EX_LAYERED;
}
```

**What This Does:**
- `WS_EX_TRANSPARENT` - Makes the window transparent to mouse and keyboard input, allowing events to pass through to windows beneath it
- `WS_EX_LAYERED` - Enables layered window effects (required for proper rendering with WS_EX_TRANSPARENT)

### 2. Apply Changes: `apply_diff()` Function

**File:** `src/platform_impl/windows/window_state.rs` (lines 354-486)

When flags change, the following Windows API calls are made **in this order:**

#### Call #1: Update Base Window Styles
```rust
SetWindowLongW(window, GWL_STYLE, style.0 as i32);
```

- **API:** `SetWindowLongW`
- **Parameter 1:** `HWND window` - The window to modify
- **Parameter 2:** `GWL_STYLE` - Set base window styles (WS_OVERLAPPED, WS_CHILD, etc.)
- **Parameter 3:** `style.0 as i32` - The new style value

#### Call #2: Update Extended Window Styles
```rust
SetWindowLongW(window, GWL_EXSTYLE, style_ex.0 as i32);
```

- **API:** `SetWindowLongW` (note: this wraps `SetWindowLongPtrW` on 64-bit)
- **Parameter 1:** `HWND window` - The window to modify
- **Parameter 2:** `GWL_EXSTYLE` - Set extended window styles (WS_EX_TRANSPARENT, WS_EX_LAYERED, etc.)
- **Parameter 3:** `style_ex.0 as i32` - The new extended style value (includes WS_EX_TRANSPARENT | WS_EX_LAYERED)

#### Call #3: Apply Frame Changes
```rust
let mut flags = SWP_NOZORDER | SWP_NOMOVE | SWP_NOSIZE | SWP_FRAMECHANGED;
if !new.contains(WindowFlags::MARKER_EXCLUSIVE_FULLSCREEN)
    && !new.contains(WindowFlags::MARKER_BORDERLESS_FULLSCREEN)
{
    flags |= SWP_NOACTIVATE;
}
SetWindowPos(window, None, 0, 0, 0, 0, flags);
```

- **API:** `SetWindowPos`
- **Parameter 1:** `HWND window` - The window to reposition
- **Parameter 2:** `None` - Z-order position (HWND_NOTOPMOST implied by SWP_NOZORDER)
- **Parameters 3-6:** `0, 0, 0, 0` - Position and size not changed (SWP_NOMOVE | SWP_NOSIZE)
- **Parameter 7:** Window position flags:
  - `SWP_NOZORDER` - Don't change z-order
  - `SWP_NOMOVE` - Don't change position
  - `SWP_NOSIZE` - Don't change size
  - **`SWP_FRAMECHANGED`** - Force recalculation of window frame and redraw
  - `SWP_NOACTIVATE` - Don't activate the window (unless fullscreen)

---

## Direct Answer to Your Questions

### 1. Does it call `SetWindowLongW` to toggle `WS_EX_TRANSPARENT`?

**Yes.** The extended window style with `WS_EX_TRANSPARENT | WS_EX_LAYERED` is applied via:

```rust
SetWindowLongW(window, GWL_EXSTYLE, style_ex.0 as i32);
```

where `style_ex` includes the `WS_EX_TRANSPARENT` flag.

### 2. Does it call `SetWindowPos` with `SWP_FRAMECHANGED` after?

**Yes.** After both `SetWindowLongW` calls, `SetWindowPos` is called with `SWP_FRAMECHANGED`:

```rust
SetWindowPos(window, None, 0, 0, 0, 0,
    SWP_NOZORDER | SWP_NOMOVE | SWP_NOSIZE | SWP_FRAMECHANGED | SWP_NOACTIVATE);
```

### 3. What other APIs does it call?

The `apply_diff` function (which is called from `set_window_flags`) can also call:

- **ShowWindow** - For window visibility/state (minimized, maximized, restored) - but NOT specifically for IGNORE_CURSOR_EVENT changes
- **InvalidateRgn** - For window redraw after positioning changes
- **GetSystemMenu** - For toggling close button (not related to IGNORE_CURSOR_EVENT)
- **EnableMenuItem** - For menu state (not related to IGNORE_CURSOR_EVENT)
- **SendMessageW** - For state retention during resizing (not related to IGNORE_CURSOR_EVENT)

However, **for IGNORE_CURSOR_EVENT specifically**, only the three calls above are made:
1. `SetWindowLongW(GWL_STYLE)`
2. `SetWindowLongW(GWL_EXSTYLE)`
3. `SetWindowPos(... SWP_FRAMECHANGED)`

---

## No Additional Calls for IGNORE_CURSOR_EVENT

- **UpdateWindow** - NOT called for this flag change
- **RedrawWindow** - NOT called for this flag change (InvalidateRgn only called for certain other flags)

The `SWP_FRAMECHANGED` flag in SetWindowPos is sufficient to trigger the necessary window recalculation and redraw.

---

## Architecture Notes

**Rust Wrapper Chain:**
```
setIgnoreCursorEvents (Tauri JS API)
  → set_ignore_cursor_events (Tauri Rust API)
    → set_ignore_cursor_events (Tao Window impl)
      → WindowState::set_window_flags
        → apply_diff
          → SetWindowLongW (GWL_STYLE)
          → SetWindowLongW (GWL_EXSTYLE)
          → SetWindowPos (SWP_FRAMECHANGED)
```

**Flag Definition:**
```rust
const IGNORE_CURSOR_EVENT = 1 << 15;  // Bit 15 in WindowFlags bitfield
```

**Style Conversion:**
```rust
WindowFlags::IGNORE_CURSOR_EVENT → WS_EX_TRANSPARENT | WS_EX_LAYERED (in extended styles)
```

---

## Sources

- [Tauri setIgnoreCursorEvents Issue #6164](https://github.com/tauri-apps/tauri/issues/6164)
- [Tauri setIgnoreCursorEvents Bug #11461](https://github.com/tauri-apps/tauri/issues/11461)
- [Tao set_ignore_cursor_events Feature #421](https://github.com/tauri-apps/tao/pull/421)
- [Tao set_ignore_cursor_events Commit](https://github.com/tauri-apps/tao/commit/4fa8761776d546ee3b1b0bb1a02a31d72eedfa80)
- [Tao window.rs Implementation](https://github.com/tauri-apps/tao/blob/dev/src/platform_impl/windows/window.rs)
- [Tao window_state.rs Implementation](https://github.com/tauri-apps/tao/blob/dev/src/platform_impl/windows/window_state.rs)
- [Tao util.rs SetWindowLongPtrW](https://github.com/tauri-apps/tao/blob/dev/src/platform_impl/windows/util.rs)
- [Tao Aero-snap Fix Commit](https://github.com/tauri-apps/tao/commit/f35dd03dc6f15d51fb348c6b404c195ba2401339)
