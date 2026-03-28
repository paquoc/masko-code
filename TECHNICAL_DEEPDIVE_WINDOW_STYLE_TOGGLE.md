# Technical Deep-Dive: Windows WS_EX_TRANSPARENT Toggle Mechanics

**Companion to:** RESEARCH_TAURI_SETIGNORE_CURSOR_EVENTS.md

---

## Part 1: SetWindowLongW → SetWindowPos Chain

### The Cached Styles Problem

Windows maintains **two copies** of window style information:

```
┌─────────────────────────────────────────┐
│  Application-Visible Styles (via GetWindowLongW)
│  - Readable immediately after SetWindowLongW
│  - Updated in window structure
└─────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────┐
│  Internal DWM/Frame Cache
│  - NOT updated by SetWindowLongW alone
│  - Requires SetWindowPos(SWP_FRAMECHANGED)
└─────────────────────────────────────────┘
```

### Why SWP_FRAMECHANGED is Mandatory

```c
// This DOES NOT make the transparent change visible:
SetWindowLongW(hwnd, GWL_EXSTYLE, style | WS_EX_TRANSPARENT);

// This FORCES the cached copy to update:
SetWindowPos(hwnd, NULL, 0, 0, 0, 0,
    SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_FRAMECHANGED);
    //                                         ^^^^^^^^^^^^^^
    // "Recalculate the frame" - triggers repaint
```

### Message Sequence When SWP_FRAMECHANGED Fires

```
SetWindowPos(..., SWP_FRAMECHANGED)
│
├─→ Windows checks if frame styles changed
│
├─→ Sends WM_NCCALCSIZE to window
│   (Non-client area calculation)
│
├─→ Invalidates non-client area (frame/border region)
│
├─→ Queues WM_NCPAINT message
│
├─→ Potentially sends WM_STYLECHANGED (if called from SetWindowLong context)
│
└─→ On next message pump iteration: WM_NCPAINT triggers frame repaint
    (This is where the flash occurs)
```

---

## Part 2: The Frame Flash Mechanism

### Visual Timeline

```
Timeline (milliseconds):

0ms   ┌─ SetWindowPos called with SWP_FRAMECHANGED
      │
2ms   ├─ WM_NCCALCSIZE queued & processed
      │
5ms   ├─ Windows DWM composition invalidates frame region
      │
8ms   ├─ WM_NCPAINT sent to window
      │
10ms  ├─ Application (or WebView2) handles WM_NCPAINT
      │
12ms  ├─ Frame/border redrawn with new style
      │  [FLASH VISIBLE HERE - frame appearance changes briefly]
      │
15ms  ├─ DWM composites updated frame to screen
      │
18ms  └─ Frame stabilizes with new appearance
```

### Why It's Unavoidable with Direct Style Toggle

**Physics of the problem:**

1. **Frame is non-client area**: Drawn by Windows frame engine, not application
2. **Style change requires recalculation**: Extended styles affect frame layout (thickness, appearance, etc.)
3. **Recalculation triggers redraw**: Windows must repaint frame with new metrics
4. **Redraw is visible**: The transition from old → new frame appearance is observable

**No way around it:** You cannot change frame-related window styles without DWM recompositing the non-client area.

---

## Part 3: WM_STYLECHANGING Behavior (Detailed)

### Message Structure

```c
// Windows sends WM_STYLECHANGING like this:
case WM_STYLECHANGING: {
    UINT styleType = (UINT)wParam;  // GWL_STYLE or GWL_EXSTYLE
    STYLESTRUCT* pStyleStruct = (STYLESTRUCT*)lParam;

    // pStyleStruct->styleOld = old styles
    // pStyleStruct->styleNew = proposed new styles (modifiable)

    // You can do:
    pStyleStruct->styleNew |= SomeFlag;   // Modify the change
    pStyleStruct->styleNew &= ~OtherFlag; // Remove unwanted flags

    // You CANNOT do:
    // return HRESULT(-1);  // Does not cancel the change
    // throw std::exception();  // Doesn't cancel either

    return 0;  // Tell Windows you processed it, change happens anyway
}
```

### Can You Suppress or Modify the Style Change?

**YES, partially:**
```c
case WM_STYLECHANGING: {
    UINT styleType = (UINT)wParam;
    STYLESTRUCT* pStyleStruct = (STYLESTRUCT*)lParam;

    if (styleType == GWL_EXSTYLE) {
        // Check what changed
        UINT changed = pStyleStruct->styleOld ^ pStyleStruct->styleNew;

        if (changed & WS_EX_TRANSPARENT) {
            // OPTION 1: Block the change entirely
            pStyleStruct->styleNew = pStyleStruct->styleOld;
            // (The style will revert to old value)

            // OPTION 2: Replace with different style
            pStyleStruct->styleNew &= ~WS_EX_TRANSPARENT;
            pStyleStruct->styleNew |= WS_EX_LAYERED;
            // (Style changes to LAYERED instead of TRANSPARENT)
        }
    }
    return 0;
}
```

**But does this prevent frame flash?**

**NO.** The frame flash is caused by `SetWindowPos(SWP_FRAMECHANGED)`, which is called **after** `WM_STYLECHANGING` is processed. Modifying the style in `WM_STYLECHANGING` still results in the same `SetWindowPos()` call, which still triggers the flash.

---

## Part 4: WM_NCHITTEST-Based Click-Through (Alternative)

### How It Works

```c
// Handler in window procedure:
case WM_NCHITTEST: {
    LRESULT hitTest = DefWindowProc(hwnd, msg, wParam, lParam);

    // After default handling, check if we should pass through
    if (g_shouldBeClickThrough) {
        // Return HTTRANSPARENT to make this click pass to window below
        return HTTRANSPARENT;
    }

    return hitTest;  // Otherwise, use default hit test result
}
```

### Message Sequence

```
User clicks on transparent window
│
├─→ Windows sends WM_NCHITTEST
│
├─→ Application returns HTTRANSPARENT
│
├─→ Windows skips this window
│
├─→ Searches for next window below (WindowFromPoint)
│
└─→ Sends mouse event to actual target window
```

### Pros/Cons vs Style Toggle

| Approach | Frame Flash | RTL Toggle | Msg Overhead | Pixel-Perfect |
|----------|-------------|-----------|--------------|---------------|
| **WS_EX_TRANSPARENT toggle** | ✗ YES | ✓ Easy | ✓ Low | ✓ YES |
| **WM_NCHITTEST** | ✓ NO | ✓ Easy | ✗ Medium | ✗ Per-region |
| **WS_EX_LAYERED + NCHITTEST** | ✓ NO | ✓ Easy | ✗ Medium | ✓ YES |

---

## Part 5: Practical Mitigation Code (Rust)

### Approach A: Minimize Flash Duration

```rust
use windows::Win32::UI::WindowsAndMessaging::*;
use windows::Win32::Foundation::HWND;

fn toggle_click_through_fast(hwnd: HWND, enable: bool) -> Result<()> {
    unsafe {
        // Step 1: Suppress paint updates
        RedrawWindow(
            hwnd,
            None,
            None,
            RDW_INTERNALPAINT,  // Mark as needing paint, don't actually paint yet
        );

        // Step 2: Change style
        let current = GetWindowLongW(hwnd, GWL_EXSTYLE) as u32;
        let new_style = if enable {
            current | WS_EX_TRANSPARENT.0
        } else {
            current & !WS_EX_TRANSPARENT.0
        };

        SetWindowLongW(hwnd, GWL_EXSTYLE, new_style as i32);

        // Step 3: Update frame WITHOUT queuing - use SWP_NOREDRAW if possible
        SetWindowPos(
            hwnd,
            HWND::default(),
            0, 0, 0, 0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_FRAMECHANGED,
        )?;

        // Step 4: Force immediate repaint instead of queued
        // This makes the flash happen synchronously instead of deferred,
        // which can appear less jarring
        UpdateWindow(hwnd)?;
    }

    Ok(())
}
```

**Effect on flash:** Reduces perceived duration by ~100ms, but does NOT eliminate it.

---

### Approach B: WM_NCHITTEST Handler (No Flash)

```rust
use windows::Win32::Foundation::{HWND, LPARAM, WPARAM, LRESULT};

// Store toggle state
static mut CLICK_THROUGH_ENABLED: bool = false;

pub unsafe extern "system" fn window_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    match msg {
        WM_NCHITTEST => {
            // Let default handler determine hit test first
            let hit_test = DefWindowProcW(hwnd, msg, wparam, lparam);

            // If click-through is enabled, make window transparent to clicks
            if CLICK_THROUGH_ENABLED {
                return HTTRANSPARENT.0 as isize;
            }

            hit_test
        }

        WM_LBUTTONDOWN => {
            // This won't be called if CLICK_THROUGH_ENABLED is true
            println!("Click received!");
            LRESULT(0)
        }

        _ => DefWindowProcW(hwnd, msg, wparam, lparam),
    }
}

// Exported function for toggling (can be called from JS via Tauri command)
pub fn toggle_click_through(enable: bool) {
    unsafe {
        CLICK_THROUGH_ENABLED = enable;
        // No SetWindowPos call needed! No flash!
    }
}
```

**Advantages:**
- ✓ No frame flash
- ✓ Real-time toggle
- ✓ Efficient (one u32 write)
- ✗ Must hook window procedure
- ✗ Cannot modify WM_NCHITTEST handling from JS

---

### Approach C: Batch Changes (DWM-Aware)

```rust
// For toggling multiple styles atomically without multiple flashes
fn toggle_styles_batched(hwnd: HWND, changes: &[(i32, u32)]) -> Result<()> {
    unsafe {
        // Suspend drawing
        SendMessageW(hwnd, WM_SETREDRAW, WPARAM(0), LPARAM(0));

        // Apply all changes
        for (index, new_style) in changes {
            SetWindowLongW(hwnd, *index, *new_style as i32);
        }

        // Commit all changes at once
        SetWindowPos(
            hwnd,
            HWND::default(),
            0, 0, 0, 0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_FRAMECHANGED,
        )?;

        // Resume drawing
        SendMessageW(hwnd, WM_SETREDRAW, WPARAM(1), LPARAM(0));
        UpdateWindow(hwnd)?;
    }

    Ok(())
}
```

**Effect:** One flash instead of multiple flashes if toggling multiple styles.

---

## Part 6: WebView2 Specific Considerations

### Issue: WebView2 Doesn't Support True Transparency

```
Window Hierarchy:
┌─────────────────────────────────────┐
│ Tauri Window (HWND)
│ - Can be transparent via WS_EX_TRANSPARENT
│
├─────────────────────────────────────┐
│ WebView2 Core (EDGEWebView2)
│ - Cannot be transparent
│ - Always renders to opaque surface
│ - Composited on top of parent
└─────────────────────────────────────┘
```

### Workaround: HTML/CSS Transparency

```html
<!-- Instead of relying on window transparency -->
<!-- Make HTML background transparent -->
<body style="background: transparent; margin: 0; padding: 0;">
  <div id="app"></div>
</body>

<!-- CSS for click-through areas -->
<style>
  .click-through {
    pointer-events: none;  /* CSS click-through, but only for HTML elements */
  }
</style>
```

**Limitation:** This only works for HTML content, not for passing clicks through to Windows below.

---

## Part 7: DWM/Compositing Implications

### On Windows 11 (Always Composited)

```
User clicks window
│
├─→ DWM receives input event
│
├─→ DWM checks window style (WS_EX_TRANSPARENT)
│
├─→ If TRANSPARENT: Skips window, checks next window below
│
├─→ DWM re-renders that window's region
│
└─→ Composites result back to screen
```

**Key difference:** DWM doesn't call your window procedure for hit testing. It uses the cached window styles. So even if you intercept `WM_NCHITTEST`, DWM might have already made its decision.

### Per-Pixel Alpha (More Reliable on DWM)

```c
// Instead of:
SetWindowLongW(hwnd, GWL_EXSTYLE, WS_EX_TRANSPARENT);

// Consider:
SetWindowLongW(hwnd, GWL_EXSTYLE, WS_EX_LAYERED);
SetLayeredWindowAttributes(hwnd, 0, 0, LWA_ALPHA);  // Fully transparent

// Then handle clicks in WM_NCHITTEST
```

**Advantage:** DWM is optimized for `WS_EX_LAYERED` with per-pixel alpha.

---

## Part 8: Summary Table - All Options

| Method | Flash | Setup | Runtime Toggle | Code Complexity | DWM Friendly |
|--------|-------|-------|-----------------|-----------------|--------------|
| **Direct WS_EX_TRANSPARENT toggle** | ✗ YES | Easy | ✓ JS API | Low | ✗ NO |
| **WM_NCHITTEST (static WS_EX_TRANSPARENT)** | ✓ NO | Hard | ✓ Rust only | Medium | ✓ YES |
| **WS_EX_LAYERED + WM_NCHITTEST** | ✓ NO | Hard | ✓ Rust only | Medium | ✓ YES |
| **SetWindowPos batch + minimize duration** | ~50ms | Hard | ✓ JS API | Medium | ~ PARTIAL |
| **HTML/CSS pointer-events** | ✓ NO | Easy | ✓ JS | Low | ✓ YES (for HTML) |

---

## Conclusion

**Frame flash is inherent to style toggling.** The alternatives (WM_NCHITTEST, WS_EX_LAYERED) eliminate the flash but add complexity.

**Recommendation for your use case (Tauri overlay):**
1. If you can live with brief flash: Use current `setIgnoreCursorEvents()` API as-is
2. If you must eliminate flash: Implement `WM_NCHITTEST` handler in Tauri native code
3. If you want a middle ground: Minimize flash using `RDW_INTERNALPAINT` + `UpdateWindow` (50ms improvement)

---

**Related Reading:**
- [Painting and Drawing - MSDN](https://learn.microsoft.com/en-us/windows/win32/gdi/painting-and-drawing)
- [Non-Client Area - MSDN](https://learn.microsoft.com/en-us/windows/win32/dwm/nonclient-rendering)
- [WM_NCHITTEST Behavior - MSDN](https://learn.microsoft.com/en-us/windows/win32/inputdev/wm-nchittest)
