# Tauri v2 Research Report: Windows Desktop App with Overlay Capabilities

**Date:** March 26, 2026
**Scope:** Comprehensive research on Tauri v2 capabilities for a Windows desktop application with floating overlay windows, system tray integration, and sprite animation support.

---

## Executive Summary

Tauri v2 is production-ready for Windows desktop applications with advanced requirements including overlay windows, system tray integration, and real-time file watching. However, several features have platform-specific limitations, particularly around click-through transparency and acrylic effects on Windows 11. The framework provides both JavaScript/TypeScript and Rust APIs, with security-first approach via capabilities and permissions.

---

## 1. Floating/Overlay Windows

### Configuration

Tauri v2 supports overlay windows through the window customization API. To create a floating overlay window:

**In `tauri.conf.json`:**
```json
"windows": [
  {
    "label": "main",
    "title": "Masko",
    "width": 400,
    "height": 600,
    "decorations": false,
    "transparent": true,
    "alwaysOnTop": true,
    "skipTaskbar": false
  }
]
```

### Key Settings

- **`decorations: false`** - Removes native window frame (titlebar, borders)
- **`transparent: true`** - Enables transparency for the window
- **`alwaysOnTop: true`** - Keeps window above other windows
- **`skipTaskbar: false`** - Shows window in taskbar (set to `true` to hide)

### JavaScript API

```javascript
import { getCurrentWindow } from '@tauri-apps/api/window';

const appWindow = getCurrentWindow();

// Create custom titlebar with drag support
document.getElementById('titlebar')?.addEventListener('mousedown', (e) => {
  if (e.buttons === 1) {
    e.detail === 2 ? appWindow.toggleMaximize() : appWindow.startDragging();
  }
});

// Custom close/minimize buttons
document.getElementById('close')?.addEventListener('click', () => appWindow.close());
document.getElementById('minimize')?.addEventListener('click', () => appWindow.minimize());
```

### Rust API (Runtime Window Creation)

```rust
use tauri::WindowBuilder;

WindowBuilder::new(app, "overlay", tauri::WindowUrl::App("overlay.html".into()))
  .decorations(false)
  .transparent(true)
  .always_on_top(true)
  .build()?;
```

### Required Permissions

Add to capabilities file (e.g., `src-tauri/capabilities/main.json`):
```json
{
  "permissions": [
    "core:window:default",
    "core:window:allow-start-dragging"
  ]
}
```

### Known Issues & Limitations

- **Transparency Inconsistency:** Tauri v2 has reported issues with window transparency on Windows. The same configuration works differently between v1 and v2.
- **No Native Click-Through:** Cannot make transparent areas click-through to underlying windows natively (see section 9 for workarounds).
- **Title Bar:** Windows doesn't support transparent native titlebars; implement custom HTML/CSS title bar instead.

### Documentation Reference
- [Window Customization | Tauri](https://v2.tauri.app/learn/window-customization/)
- [Window API Reference | Tauri](https://v2.tauri.app/reference/javascript/api/namespacewindow/)

---

## 2. System Tray

### Setup

Enable the `tray-icon` feature in `Cargo.toml`:
```toml
tauri = { version = "2", features = ["tray-icon"] }
```

### Creating a Tray Icon

**JavaScript:**
```javascript
import { TrayIcon } from '@tauri-apps/api/tray';

const tray = await TrayIcon.new({
  icon: 'path/to/icon.png',
  tooltip: 'My App',
  title: 'My App Tray'
});
```

**Rust:**
```rust
use tauri::tray::TrayIconBuilder;

let tray = TrayIconBuilder::new()
  .icon(app.default_window_icon().unwrap().clone())
  .tooltip("My App")
  .build(app)?;
```

### Custom Menus

**JavaScript:**
```javascript
import { Menu, MenuItem } from '@tauri-apps/api/menu';

const menu = await Menu.new({
  items: [
    {
      id: 'toggle-window',
      text: 'Toggle',
      action: async () => { /* handle toggle */ }
    },
    { id: 'separator', separator: true },
    { id: 'quit', text: 'Quit', action: async () => { /* handle quit */ } }
  ]
});

const tray = await TrayIcon.new({
  menu,
  menuOnLeftClick: true  // Show menu on left-click (default: right-click only)
});
```

**Rust:**
```rust
use tauri::menu::{Menu, MenuItem};

let menu = Menu::with_items(app, &[
  &MenuItem::with_id(app, "toggle", "Toggle", true, None)?,
  &MenuItem::new(app, "separator", None)?,
  &MenuItem::with_id(app, "quit", "Quit", true, None)?,
])?;

let tray = TrayIconBuilder::new()
  .menu(&menu)
  .on_menu_event(|app, event| {
    match event.id.as_ref() {
      "toggle" => { /* handle */ },
      "quit" => app.exit(0),
      _ => {}
    }
  })
  .build(app)?;
```

### Tray Events

Both click and menu events are emitted:
```javascript
tray.on('click', (event) => {
  console.log('Tray clicked at:', event.position);
});

tray.on('double-click', (event) => {
  console.log('Tray double-clicked');
});
```

### Icon Support

- **Formats:** PNG, ICO, platform-specific formats
- **Windows Sizes:** 16x16, 32x32
- **Recent Updates:** Icon support for submenus available since Tauri 2.8.0

### Documentation Reference
- [System Tray | Tauri](https://v2.tauri.app/learn/system-tray/)
- [Tray API Reference | Tauri](https://v2.tauri.app/reference/javascript/api/namespacetray/)

---

## 3. Local HTTP Server

### Options & Recommendations

Tauri v2 offers multiple approaches for HTTP functionality:

#### Option A: Tauri's Built-in Protocol (RECOMMENDED)
Use Tauri's custom protocol instead of HTTP. This is the default and most secure approach. Assets are served through the `tauri://` protocol which provides:
- Built-in CORS protection
- Automatic asset bundling
- No external server needed

#### Option B: Localhost Plugin
Enable localhost server for serving assets via HTTP:

**Install:**
```toml
tauri-plugin-localhost = "2"
```

**Configuration:**
```json
"plugins": {
  "localhost": {
    "port": 9527
  }
}
```

**Usage:**
```javascript
// Assets load from http://localhost:9527 instead of tauri:// protocol
window.location.href = 'http://localhost:9527';
```

**Security Warning:** The localhost plugin introduces security risks. Only use if you understand the implications.

#### Option C: Embedded HTTP Server (tauri-invoke-http)
Use the community crate for a custom HTTP server with IPC:

```rust
// Bundle and run a local HTTP server
// Each Tauri invoke goes through XMLHttpRequest to localhost
```

**Use Case:** When you need standard HTTP for third-party integrations.

#### Option D: Sidecar Process
Run a separate HTTP server as a sidecar process (e.g., Node.js, Python):

```rust
use std::process::{Command, Stdio};

let server = Command::new("node")
  .arg("server.js")
  .stdout(Stdio::null())
  .spawn()?;
```

**Port 49152:** You can configure the sidecar to run on port 49152 (or any available port).

### Recommendations

For your use case (file watching + sprite animation):
- **IPC Commands** are sufficient and more secure for most operations
- Use **Tauri protocol** (default) for serving webview assets
- Only add HTTP server if integrating external tools that require HTTP endpoints

### Documentation Reference
- [Localhost Plugin | Tauri](https://v2.tauri.app/plugin/localhost/)
- [IPC Concepts | Tauri](https://v2.tauri.app/concept/inter-process-communication/)

---

## 4. File Watching

### Setup

Enable the `fs-watch` plugin in `Cargo.toml`:
```toml
tauri-plugin-fs = { version = "2", features = ["watch"] }
```

### Watch Functions

Tauri provides two watching approaches:

#### `watch()` - Debounced (Recommended for UI)
Events fire after a delay, useful for performance:

```javascript
import { watch, BaseDirectory } from '@tauri-apps/plugin-fs';

await watch(
  'logs',
  (event) => {
    console.log('File changed:', event);
    // Handle changes - fires after delayMs
  },
  {
    baseDir: BaseDirectory.AppLog,
    recursive: true,
    delayMs: 500  // Waits 500ms before notifying
  }
);
```

#### `watchImmediate()` - No Debounce
Events fire instantly without delay:

```javascript
import { watchImmediate, BaseDirectory } from '@tauri-apps/plugin-fs';

await watchImmediate(
  'config.json',
  (event) => {
    console.log('Config file changed:', event);
  },
  {
    baseDir: BaseDirectory.AppConfig
  }
);
```

### Watch Event Structure

```javascript
// Event object contains:
{
  type: 'create' | 'remove' | 'modify' | 'metadata' | 'rename',
  paths: ['/path/to/file1', '/path/to/file2']
}
```

### Configuration Options

- **`recursive: true`** - Monitor all subdirectories (default: false)
- **`delayMs: 500`** - Debounce delay in milliseconds (for `watch()` only)
- **`baseDir`** - Base directory context (AppLog, AppData, etc.)

### Rust Alternative

If you prefer Rust-side file watching, use the `notify` crate directly:

```toml
notify = "6"
```

```rust
use notify::Watcher;

let mut watcher = notify::RecommendedWatcher::new(
  |event| { /* handle */ },
  Default::default()
)?;

watcher.watch(Path::new("./watch"), RecurseMode::Recursive)?;
```

### Recommendation

Use **JavaScript-side `watch()`** for most use cases. It's simpler, and you already have access to UI updates. Use Rust-side watching only for backend operations that shouldn't trigger UI changes.

### Documentation Reference
- [File System Plugin | Tauri](https://v2.tauri.app/plugin/file-system/)

---

## 5. Sprite Animations

### Best Approach: PixiJS

**Recommendation:** PixiJS is the best-in-class solution for sprite animations in Tauri webviews.

#### Why PixiJS?

1. **High Performance:** WebGL with Canvas fallback
2. **Built-in Animation:** GSAP, Lottie, Spine integrations
3. **Tauri-Proven:** Multiple successful Tauri + PixiJS projects
4. **DPI Scaling:** Handles Windows 11 DPI scaling correctly
5. **Active Development:** Maintained and frequently updated

#### Setup

```bash
npm install pixi.js gsap
```

#### Sprite Sheet Animation Example

```javascript
import * as PIXI from 'pixi.js';
import gsap from 'gsap';

const app = new PIXI.Application({
  width: 800,
  height: 600,
  transparent: true
});

document.body.appendChild(app.canvas);

// Load sprite sheet
const spriteSheet = PIXI.Assets.load('sprites/character.json');

// Create sprite
const sprite = new PIXI.Sprite(spriteSheet.textures['frame-0']);
sprite.x = 100;
sprite.y = 100;
app.stage.addChild(sprite);

// Animate using GSAP
let frame = 0;
gsap.to(sprite, {
  onUpdate: () => {
    frame = Math.floor((gsap.getProperty(sprite, 'frame') ?? 0) * 12);
    sprite.texture = spriteSheet.textures[`frame-${frame}`];
  },
  duration: 1,
  repeat: -1
});
```

#### Alternative Approaches

**Canvas API** - Direct pixel drawing (performance intensive)
```javascript
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

// Manual frame-by-frame animation
function animate(frame) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(spriteSheet, frame * 64, 0, 64, 64, 0, 0, 64, 64);
}
```

**CSS Animations** - Sprite sheet with `background-position` (limited control)
```css
@keyframes walk {
  0% { background-position: 0 0; }
  100% { background-position: -3840px 0; /* 60 frames × 64px */ }
}

.sprite {
  animation: walk 2s steps(60) infinite;
}
```

**Lottie Integration** - For vector animations
```javascript
// Use lottie-web or lottie-pixi for vector animation files
import lottie from 'lottie-web';

const animation = lottie.loadAnimation({
  container: document.getElementById('lottie'),
  renderer: 'canvas',
  loop: true,
  autoplay: true,
  path: 'animations/character.json'
});
```

### DPI & Scale Considerations

Tauri on Windows 11 needs proper DPI handling:

```javascript
// Get device pixel ratio
const scale = window.devicePixelRatio;

// Apply to canvas
canvas.width = 800 * scale;
canvas.height = 600 * scale;
canvas.style.width = '800px';
canvas.style.height = '600px';

// Apply to PixiJS
const app = new PIXI.Application({
  width: 800,
  height: 600,
  resolution: scale  // Important!
});
```

### Documentation Reference
- [PixiJS Getting Started](https://pixijs.com/8.x/guides/getting-started/intro)
- [Tauri + PixiJS + React Guide](https://dev.to/etekinalp/this-is-not-my-child-integrating-pixijs-in-tauri-vite-react-4j0b)
- [iOS Game Development with Tauri + PixiJS](https://jangwook.net/en/blog/en/tauri-pixijs-ios-game-development/)

---

## 6. Auto-Updates

### Setup

Install the updater plugin:

```toml
tauri-plugin-updater = "2"
```

Enable in `tauri.conf.json`:
```json
{
  "plugins": {
    "updater": {
      "active": true
    }
  }
}
```

### Signature Generation

Tauri requires cryptographic signatures for security:

```bash
# Generate key pair (run once)
tauri signer generate -w ./src-tauri/tauri.key

# Store public key in tauri.conf.json
```

**In `tauri.conf.json`:**
```json
{
  "productName": "Masko",
  "version": "0.1.0",
  "build": {
    "beforeBuildCommand": "",
    "beforeDevCommand": "",
    "devUrl": "http://localhost:5173",
    "frontendDist": "../dist"
  },
  "plugins": {
    "updater": {
      "active": true,
      "pubkey": "YOUR_PUBLIC_KEY_HERE"
    }
  }
}
```

### Checking for Updates

**JavaScript:**
```javascript
import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/api/process';

const update = await check();
if (update) {
  console.log(`Found update: ${update.version}`);
  console.log(`Should install: ${update.shouldUpdate}`);
}
```

### Downloading and Installing

```javascript
if (update?.shouldUpdate) {
  await update.downloadAndInstall((event) => {
    if (event.event === 'Progress') {
      const percent = Math.floor((event.data.chunkLength / event.data.contentLength) * 100);
      console.log(`Download progress: ${percent}%`);
    }
  });

  // Restart the app
  await relaunch();
}
```

**Rust:**
```rust
use tauri_plugin_updater::UpdaterExt;

let update = app.updater()?.check().await?;
if let Some(update) = update {
    println!("Downloading update: {}", update.version);
    update.download_and_install(
        |chunk_length, content_length| {
            println!("Downloaded {}/{}", chunk_length, content_length);
        },
        || println!("Finished"),
    ).await?;
    app.restart();
}
```

### Update Server Endpoints

Two options:

#### Option A: Static JSON (GitHub/S3)
```json
{
  "version": "0.2.0",
  "notes": "New features and bug fixes",
  "pub_date": "2026-03-26T12:00:00Z",
  "platforms": {
    "windows-x86_64": {
      "signature": "...",
      "url": "https://releases.example.com/Masko_0.2.0_x64-setup.exe"
    }
  }
}
```

#### Option B: Dynamic Server
Implement an HTTP endpoint that returns the JSON above based on the requesting app's current version.

### Signing Artifacts

```bash
# After building MSI/EXE
tauri signer sign -k ./src-tauri/tauri.key ./src-tauri/target/release/bundle/msi/Masko_0.2.0_x64-setup.exe
```

This creates a `.sig` file needed in the update JSON.

### Documentation Reference
- [Updater Plugin | Tauri](https://v2.tauri.app/plugin/updater/)
- [Tauri v2 Auto-Update Guide](https://docs.crabnebula.dev/cloud/guides/auto-updates-tauri/)

---

## 7. Window Transparency on Windows 11

### Configuration

```json
"windows": [
  {
    "transparent": true,
    "decorations": false
  }
]
```

### CSS Requirements

```css
html, body {
  background: transparent;
  margin: 0;
  padding: 0;
  overflow: hidden;
}
```

### Acrylic Effect (Recommended for Windows 11)

For a modern look with blur effect, use the `window-vibrancy` crate:

**Setup:**

```toml
window-vibrancy = "0.4"
```

**Rust Implementation:**

```rust
use tauri::Manager;
use window_vibrancy::apply_acrylic;

.setup(|app| {
    let window = app.get_window("main").unwrap();

    // Apply acrylic effect with RGBA color
    // Parameters: (Red, Green, Blue, Alpha/Opacity)
    apply_acrylic(&window, Some((0, 0, 0, 10)))?;

    Ok(())
})
```

### Acrylic Parameters

The RGBA tuple controls the tint:
- **`(0, 0, 0, 10)`** - Dark tint (recommended)
- **`(255, 255, 255, 10)`** - Light tint
- Adjust the 4th value (0-255) to control transparency intensity

### Known Limitations

1. **Windows 11 Build Requirement:** Acrylic has poor performance on Windows 11 build 22621+ when resizing/dragging
2. **Focus Loss:** Acrylic effect stops working when the app loses focus
3. **No Rounded Corners:** Acrylic incompatible with border-radius styling
4. **Frameless Required:** Must set `decorations: false`

### Alternative: Blur Effect (Mica)

Windows 11 also supports Mica effect, though support in Tauri varies:

```rust
// Future: await window.setEffects(...) // mica-alt effect
```

### Documentation Reference
- [Acrylic Window Effect with Tauri | DEV Community](https://dev.to/waradu/acrylic-window-effect-with-tauri-1078)
- [window-vibrancy | GitHub](https://github.com/tauri-apps/window-vibrancy)

---

## 8. Multi-Window Support

### Static Window Configuration

Define windows in `tauri.conf.json`:

```json
"windows": [
  {
    "label": "main",
    "title": "Masko",
    "width": 400,
    "height": 600,
    "decorations": false,
    "transparent": true,
    "alwaysOnTop": true
  },
  {
    "label": "notifications",
    "title": "Notifications",
    "width": 300,
    "height": 200,
    "decorations": false,
    "transparent": true,
    "alwaysOnTop": true,
    "skipTaskbar": true
  }
]
```

### Dynamic Window Creation (JavaScript)

```javascript
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';

const notifWindow = new WebviewWindow('notifications-2', {
  url: 'notifications.html',
  width: 300,
  height: 200,
  decorations: false,
  transparent: true,
  alwaysOnTop: true,
  skipTaskbar: true
});

notifWindow.once('tauri://created', () => {
  console.log('Notification window created');
});

notifWindow.once('tauri://error', (e) => {
  console.error('Error creating window:', e);
});
```

### Dynamic Window Creation (Rust)

```rust
use tauri::WindowBuilder;

WindowBuilder::new(
    app,
    "notifications-2",
    tauri::WindowUrl::App("notifications.html".into())
)
.width(300.0)
.height(200.0)
.decorations(false)
.transparent(true)
.always_on_top(true)
.skip_taskbar(true)
.build()?;
```

### Permissions for Dynamic Windows

Add to capabilities file:

```json
{
  "permissions": [
    "core:window:default",
    "core:webview:allow-create-webview-window"
  ]
}
```

### Window-Specific Capabilities

Assign different permissions to different windows:

```json
{
  "windows": ["main"],
  "permissions": [
    "core:window:allow-focus",
    "core:window:allow-close"
  ]
}
```

### Window Communication

Send messages between windows:

**From main window:**
```javascript
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';

const notif = WebviewWindow.getByLabel('notifications');
await notif?.emit('notification', { message: 'Hello!' });
```

**In notifications window:**
```javascript
import { listen } from '@tauri-apps/api/event';

await listen('notification', (event) => {
  console.log('Received:', event.payload);
});
```

### Documentation Reference
- [Window Capabilities | Tauri](https://v2.tauri.app/learn/security/capabilities-for-windows-and-platforms/)
- [WebviewWindow API | Tauri](https://v2.tauri.app/reference/javascript/api/classwebviewwindow/)

---

## 9. Click-Through / Mouse Pass-Through

### Current Status

**⚠️ Native click-through is NOT fully supported in Tauri v2.** This is an active area of development with multiple open feature requests.

### Available Options

#### Option A: `setIgnoreCursorEvents()` (Limited)

This API exists but has limitations:

```javascript
import { getCurrentWindow } from '@tauri-apps/api/window';

const window = getCurrentWindow();

// Ignore all mouse events
await window.setIgnoreCursorEvents(true);

// Resume accepting mouse events
await window.setIgnoreCursorEvents(false);
```

**Limitation:** You cannot have the window simultaneously capture events AND forward them. It's all-or-nothing.

#### Option B: tauri-plugin-polygon (Experimental)

A community plugin for selective click-through:

```toml
tauri-plugin-polygon = "0.1"
```

```rust
// Define clickable polygon areas
// Non-clickable areas allow mouse to pass through
```

**Limitation:** Only works with full-screen applications with transparent backgrounds.

#### Option C: CSS pointer-events

Use CSS to disable interaction on specific elements:

```css
.click-through {
  pointer-events: none;
}

.clickable {
  pointer-events: auto;
}
```

**Limitation:** Events don't forward to underlying applications, only within your app.

#### Option D: Workaround with Parent Window

For a chat-bubble-style overlay that shouldn't interfere with clicking:

1. Make the window large and transparent
2. Use CSS `pointer-events: none` on transparent areas
3. Use `pointer-events: auto` only on the chat bubble element
4. Implement your own window hide/show logic

```javascript
// Hide window when clicking outside bubble
document.addEventListener('click', (e) => {
  if (!e.target.closest('.bubble')) {
    appWindow.hide();
  }
});
```

### Recommendation

**For your use case:** If you need mouse events to pass through to the desktop:
- This is not yet fully supported in Tauri v2
- Consider fallback: Implement an always-on-top overlay that temporarily hides when not needed
- OR use a tray-icon-based approach where the overlay only appears on demand

### Related Issues
- [Transparent Window Support Click-Through | GitHub #13070](https://github.com/tauri-apps/tauri/issues/13070)
- [Ignore mouse event on transparent areas | GitHub #2090](https://github.com/tauri-apps/tauri/issues/2090)

---

## 10. Tauri v2 Prerequisites (Windows Setup)

### System Requirements

#### Rust (Required)

1. Download from [https://www.rust-lang.org/tools/install](https://www.rust-lang.org/tools/install)
2. Run the installer
3. **Important:** During installation, select **MSVC Rust toolchain** as the default:
   - For x64 systems: `x86_64-pc-windows-msvc`
   - For ARM64 systems: `aarch64-pc-windows-msvc`

**Verify installation:**
```bash
rustc --version
cargo --version
```

#### WebView2 (Required on Windows 10 1803 and earlier)

Modern Windows 10 (1803+) and Windows 11 include WebView2 pre-installed.

**If needed:** Download from [Microsoft Edge WebView2 Runtime](https://developer.microsoft.com/en-us/microsoft-edge/webview2/)
- Download the "Evergreen Bootstrapper" and run the installer

**Verify:** Check Windows Settings > Apps > Apps & features > "WebView2"

#### Node.js (Recommended)

1. Download from [https://nodejs.org/](https://nodejs.org/) (LTS recommended)
2. Run installer
3. Verify: `node --version` and `npm --version`

**Why needed:** If using JavaScript frameworks (React, Vue, Svelte) or Vite for frontend tooling.

#### Visual Studio Build Tools (Required for MSI packaging)

For building Windows MSI installers:

1. Download [Visual Studio Build Tools](https://visualstudio.microsoft.com/downloads/)
2. Select **Desktop development with C++** workload
3. Ensure **VBSCRIPT optional feature** is enabled (required by MSI builder)

**Verify:**
```bash
cargo --version  # Should work
```

### Git (Recommended)

For version control and dependency management:
- Download from [https://git-scm.com/](https://git-scm.com/)
- Install with default options

### Creating a New Tauri v2 Project

```bash
# Using create-tauri-app (recommended)
npm create tauri-app@latest

# Or with Cargo for Rust-first approach
cargo create-tauri-app

# Navigate to project
cd my-app

# Install dependencies
npm install  # Frontend deps
cd src-tauri && cargo build  # Rust deps
```

### Project Structure

```
my-app/
├── src/                    # Frontend (React, Vue, etc.)
├── src-tauri/              # Rust backend
│   ├── src/
│   │   ├── main.rs        # Entry point
│   │   └── lib.rs         # Plugin configuration
│   ├── tauri.conf.json    # Tauri configuration
│   └── Cargo.toml         # Rust dependencies
├── package.json            # Node.js dependencies
└── vite.config.ts         # Frontend build config
```

### Development Commands

```bash
# Start dev server (hot-reload)
npm run tauri dev

# Build for production
npm run tauri build

# Create installer (Windows)
npm run tauri build -- --config src-tauri/tauri.conf.json
```

### Troubleshooting Setup

**"rustc not found"**
- Reinstall Rust, ensure MSVC toolchain selected

**"WebView2 not found"**
- Windows 11/10 1803+: Should be pre-installed
- Older Windows: Download Evergreen Bootstrapper

**"npm command not found"**
- Reinstall Node.js and restart terminal

**MSI Build Fails**
- Ensure Visual Studio Build Tools installed with C++ workload
- Enable VBSCRIPT optional feature

### Documentation Reference
- [Tauri v2 Prerequisites](https://v2.tauri.app/start/prerequisites/)
- [Rust Windows Setup](https://rust.ipworkshop.ro/docs/tauri/prerequisites/windows/)

---

## Summary Table: Feature Support on Windows 11

| Feature | Support | Caveats | API |
|---------|---------|---------|-----|
| Overlay Windows | ✅ Full | Transparency issues reported | `WindowBuilder`, config |
| System Tray | ✅ Full | - | `TrayIconBuilder`, `TrayIcon` |
| File Watching | ✅ Full | JS-side recommended | `watch()`, `watchImmediate()` |
| Sprite Animation | ✅ Full | Use PixiJS | PixiJS + GSAP |
| Auto-Updates | ✅ Full | Requires signatures | `check()`, `downloadAndInstall()` |
| Transparent Windows | ⚠️ Partial | Known issues | `transparent: true` + CSS |
| Acrylic Effects | ⚠️ Partial | Poor performance on resize, loses effect on focus loss | `apply_acrylic()` |
| Multi-Window | ✅ Full | Requires permissions | `WindowBuilder`, `WebviewWindow` |
| Click-Through | ❌ Not Supported | Feature request open | `setIgnoreCursorEvents()` (limited) |
| HTTP Server | ✅ Available | Security risks, use IPC instead | localhost plugin, sidecar |
| Local IPC | ✅ Full | Recommended | Commands, Events |

---

## Architecture Recommendations

### Recommended Tech Stack

```
Frontend:
- React 18+ (with Tauri API)
- Vite (build tool)
- PixiJS (sprite animation)
- TailwindCSS (styling)

Backend:
- Rust (Tauri core)
- Tokio (async runtime if needed)
- Serde (serialization)

Integrations:
- tauri-plugin-fs (file watching)
- tauri-plugin-updater (auto-updates)
- tauri-plugin-notification (desktop notifications)
- window-vibrancy (acrylic effects)
```

### IPC Pattern (Recommended over HTTP)

```
Frontend (JavaScript)    Tauri IPC    Backend (Rust)
├─ ui-layer            ─────────────  ├─ window mgmt
├─ animation           ─────────────  ├─ file ops
└─ event-handlers      ─────────────  └─ watch/notify
```

### Application Flow

1. **Main Window:** Always-on-top overlay with sprite animation
2. **System Tray:** Quick access menu to show/hide
3. **Notifications Panel:** Separate window for system notifications
4. **File Watcher:** Monitors config file changes (Rust-side)
5. **Auto-Update:** Check on startup, download in background

---

## Unresolved Questions & Limitations

1. **Click-Through Windows:** Not natively supported; workaround needed
2. **Transparency on Windows 11:** Reported inconsistencies between v1 and v2
3. **Acrylic Performance:** Degrades on resize/focus loss
4. **Native Rounded Corners:** Not compatible with acrylic/transparent windows
5. **Windows 10 Support:** Acrylic effects behavior differs from Windows 11

---

## References

### Official Documentation
- [Tauri v2 Documentation](https://v2.tauri.app/)
- [Window Customization Guide](https://v2.tauri.app/learn/window-customization/)
- [System Tray Documentation](https://v2.tauri.app/learn/system-tray/)
- [Plugin Ecosystem](https://v2.tauri.app/plugin/)

### Community & Examples
- [Tauri GitHub Discussions](https://github.com/tauri-apps/tauri/discussions)
- [Tauri Tutorials](https://tauritutorials.com/)
- [PixiJS Documentation](https://pixijs.com/)

### Related Tools
- [window-vibrancy](https://github.com/tauri-apps/window-vibrancy)
- [tauri-plugin-polygon](https://github.com/tauri-apps/tauri-plugin-polygon)
- [GSAP Animation Library](https://greensock.com/gsap/)

---

**Research completed:** March 26, 2026
**Knowledge cutoff:** February 2025
**Status:** Ready for implementation planning
