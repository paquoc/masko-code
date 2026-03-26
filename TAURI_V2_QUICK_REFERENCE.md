# Tauri v2 Quick Reference: API Cheatsheet

**Quick lookup for the most common Tauri v2 APIs needed for your project.**

---

## Window Configuration (tauri.conf.json)

```json
{
  "windows": [
    {
      "label": "main",
      "title": "App Title",
      "width": 800,
      "height": 600,
      "decorations": false,
      "transparent": true,
      "alwaysOnTop": true,
      "skipTaskbar": false,
      "resizable": true,
      "fullscreen": false
    }
  ]
}
```

| Property | Type | Purpose |
|----------|------|---------|
| `decorations` | bool | Show/hide native frame and titlebar |
| `transparent` | bool | Enable window transparency |
| `alwaysOnTop` | bool | Keep window above others |
| `skipTaskbar` | bool | Hide from taskbar |
| `resizable` | bool | Allow window resizing |
| `fullscreen` | bool | Start in fullscreen mode |

---

## Window JavaScript API

### Import
```javascript
import { getCurrentWindow } from '@tauri-apps/api/window';
const appWindow = getCurrentWindow();
```

### Common Methods
```javascript
// Window state
appWindow.show()                      // Make visible
appWindow.hide()                      // Hide window
appWindow.close()                     // Close window
appWindow.minimize()                  // Minimize
appWindow.maximize()                  // Maximize
appWindow.toggleMaximize()            // Toggle max/normal
appWindow.unmaximize()                // Restore size
appWindow.isMaximized()               // Get state (Promise<bool>)

// Position & size
appWindow.setPosition(new PhysicalPosition(100, 100))
appWindow.setSize(new PhysicalSize(800, 600))
appWindow.center()                    // Center on screen

// Behavior
appWindow.setAlwaysOnTop(true)        // Keep on top
appWindow.setDecorations(false)       // Remove titlebar
appWindow.setResizable(true)          // Allow resize
appWindow.setTitle("New Title")       // Update title

// Custom titlebar drag
appWindow.startDragging()             // Enable drag from custom titlebar

// Mouse
appWindow.setIgnoreCursorEvents(true) // Pass mouse events through (limited)
appWindow.setCursorIcon('pointer')    // Change cursor
appWindow.setCursorGrab(true)         // Lock cursor to window

// Events
appWindow.onCloseRequested((e) => {})         // Before close
appWindow.onFocusChanged((e) => {})           // Focus changed
appWindow.onResized((e) => {})                // Window resized
appWindow.onMoved((e) => {})                  // Window moved
appWindow.onScaleChanged((e) => {})           // DPI changed
```

---

## Window Rust API

### WindowBuilder
```rust
use tauri::WindowBuilder;

WindowBuilder::new(app, "label", tauri::WindowUrl::App("index.html".into()))
    .inner_size(800.0, 600.0)
    .position(100.0, 100.0)
    .decorations(false)
    .transparent(true)
    .always_on_top(true)
    .resizable(true)
    .build()?;
```

### Window Handle
```rust
let window = app.get_window("label")?;
window.show()?;
window.close()?;
window.set_title("New Title")?;
```

---

## System Tray

### Setup (Cargo.toml)
```toml
tauri = { version = "2", features = ["tray-icon"] }
```

### Create Tray (JavaScript)
```javascript
import { TrayIcon } from '@tauri-apps/api/tray';
import { Menu, MenuItem } from '@tauri-apps/api/menu';

const menu = await Menu.new({
  items: [
    { id: 'show', text: 'Show', action: async () => { /* ... */ } },
    { id: 'quit', text: 'Quit', action: async () => { /* ... */ } }
  ]
});

const tray = await TrayIcon.new({
  icon: 'path/to/icon.png',
  tooltip: 'My App',
  menu,
  menuOnLeftClick: true  // Show on left-click
});

tray.on('click', () => console.log('Clicked'));
```

### Create Tray (Rust)
```rust
use tauri::tray::TrayIconBuilder;
use tauri::menu::{Menu, MenuItem};

let menu = Menu::with_items(app, &[
    &MenuItem::with_id(app, "show", "Show", true, None)?,
])?;

let tray = TrayIconBuilder::new()
    .icon(app.default_window_icon().unwrap().clone())
    .menu(&menu)
    .on_menu_event(|app, event| {
        match event.id.as_ref() {
            "show" => { /* ... */ },
            _ => {}
        }
    })
    .build(app)?;
```

---

## File Watching

### Setup (Cargo.toml)
```toml
tauri-plugin-fs = { version = "2", features = ["watch"] }
```

### Watch with Debounce
```javascript
import { watch, BaseDirectory } from '@tauri-apps/plugin-fs';

const stop = await watch(
  'config.json',
  (event) => {
    console.log('Changed:', event.type, event.paths);
  },
  {
    baseDir: BaseDirectory.AppConfig,
    delayMs: 500,      // Wait 500ms before notifying
    recursive: false
  }
);

// Later: stop()
```

### Watch Immediate (No Debounce)
```javascript
import { watchImmediate, BaseDirectory } from '@tauri-apps/plugin-fs';

const stop = await watchImmediate(
  'logs',
  (event) => {
    console.log('Changed:', event.type);
  },
  {
    baseDir: BaseDirectory.AppLog,
    recursive: true    // Watch subdirectories
  }
);
```

### Event Types
```javascript
// event.type can be:
// 'create' | 'modify' | 'remove' | 'rename' | 'metadata'

// event.paths is array of affected file paths
```

---

## Sprite Animation (PixiJS)

### Setup
```bash
npm install pixi.js gsap
```

### Basic Sprite Sheet Animation
```javascript
import * as PIXI from 'pixi.js';
import gsap from 'gsap';

const app = new PIXI.Application({
  width: 800,
  height: 600,
  transparent: true,
  resolution: window.devicePixelRatio  // Important for DPI!
});

document.body.appendChild(app.canvas);

// Load sprite sheet JSON
const texture = PIXI.Assets.load('sprites/character.json');

// Create sprite
const sprite = new PIXI.Sprite(texture.textures['frame-0']);
sprite.x = 100;
sprite.y = 100;
app.stage.addChild(sprite);

// Animate with GSAP
let frame = 0;
gsap.to({ frame: 0 }, {
  frame: 12,  // Total frames
  duration: 1,
  repeat: -1,
  onUpdate: function() {
    frame = Math.floor(this.progress() * 12);
    sprite.texture = texture.textures[`frame-${frame}`];
  }
});
```

### Frame-by-Frame Update
```javascript
function updateFrame(frameNumber) {
  sprite.texture = texture.textures[`frame-${frameNumber}`];
}

// In game loop or tick:
app.ticker.add(() => {
  currentFrame = (currentFrame + 1) % totalFrames;
  updateFrame(currentFrame);
});
```

---

## Auto-Updates

### Setup (Cargo.toml)
```toml
tauri-plugin-updater = "2"
```

### Config (tauri.conf.json)
```json
{
  "plugins": {
    "updater": {
      "active": true,
      "pubkey": "YOUR_PUBLIC_KEY_HERE"
    }
  }
}
```

### Check for Updates
```javascript
import { check } from '@tauri-apps/plugin-updater';

const update = await check();
if (update) {
  console.log(`Update available: ${update.version}`);
}
```

### Download and Install
```javascript
import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/api/process';

const update = await check();
if (update?.shouldUpdate) {
  await update.downloadAndInstall((event) => {
    if (event.event === 'Progress') {
      const percent = Math.round(
        (event.data.chunkLength / event.data.contentLength) * 100
      );
      console.log(`Progress: ${percent}%`);
    }
  });
  await relaunch();
}
```

---

## Acrylic Effect (Windows 11)

### Setup (Cargo.toml)
```toml
window-vibrancy = "0.4"
```

### Apply Acrylic (Rust - lib.rs)
```rust
use tauri::Manager;
use window_vibrancy::apply_acrylic;

.setup(|app| {
    let window = app.get_window("main")?;
    apply_acrylic(&window, Some((0, 0, 0, 10)))?;
    Ok(())
})
```

### CSS Requirements
```css
html, body {
  background: transparent;
  margin: 0;
  padding: 0;
}
```

### RGBA Parameters
```rust
// Format: (Red, Green, Blue, Alpha)
(0, 0, 0, 10)           // Dark tint (recommended)
(255, 255, 255, 10)     // Light tint
// Adjust 4th value (0-255) for transparency intensity
```

---

## Multi-Window

### Create Window (JavaScript)
```javascript
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';

const win = new WebviewWindow('notifications', {
  url: 'notifications.html',
  width: 300,
  height: 200,
  decorations: false,
  transparent: true,
  alwaysOnTop: true
});

win.once('tauri://created', () => console.log('Created'));
win.once('tauri://error', (e) => console.error('Error:', e));
```

### Send Message Between Windows
```javascript
// From window A:
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';

const target = WebviewWindow.getByLabel('notifications');
await target?.emit('my-event', { data: 'hello' });

// In window B:
import { listen } from '@tauri-apps/api/event';

await listen('my-event', (event) => {
  console.log('Received:', event.payload);
});
```

### Permissions (capabilities/main.json)
```json
{
  "permissions": [
    "core:window:default",
    "core:webview:allow-create-webview-window"
  ]
}
```

---

## IPC: Commands (Rust → JavaScript)

### Define Command (Rust - lib.rs)
```rust
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}!", name)
}

// Register in main.rs:
.invoke_handler(tauri::generate_handler![greet])
```

### Call Command (JavaScript)
```javascript
import { invoke } from '@tauri-apps/api/core';

const greeting = await invoke('greet', { name: 'World' });
console.log(greeting);  // "Hello, World!"
```

### Async Command
```rust
#[tauri::command]
async fn fetch_data() -> Result<String, String> {
    // Async operation
    Ok("data".to_string())
}
```

---

## IPC: Events (Bidirectional)

### Emit from Rust
```rust
app.emit("file-changed", "/path/to/file")?;
```

### Listen in JavaScript
```javascript
import { listen } from '@tauri-apps/api/event';

const unlisten = await listen('file-changed', (event) => {
  console.log('File changed:', event.payload);
});

// Later: unlisten() to stop listening
```

### Emit from JavaScript
```javascript
import { emit } from '@tauri-apps/api/event';

await emit('my-event', { data: 'hello' });
```

### Listen in Rust
```rust
app.listen_global("my-event", |event| {
    println!("Event: {:?}", event);
});
```

---

## Capabilities (Security)

### Example (src-tauri/capabilities/main.json)
```json
{
  "version": 1,
  "identifier": "main-capability",
  "description": "Main window permissions",
  "windows": ["main"],
  "permissions": [
    "core:window:default",
    "core:window:allow-show",
    "core:window:allow-hide",
    "core:window:allow-close"
  ]
}
```

### Common Permissions
```json
{
  "permissions": [
    "core:window:default",
    "core:window:allow-*",              // All window methods
    "core:webview:allow-create-webview-window",
    "core:fs:allow-read-dir",
    "core:fs:allow-read-file",
    "core:fs:allow-write-file"
  ]
}
```

---

## Debugging

### Frontend
```javascript
// Standard browser DevTools
// Run: npm run tauri dev

// View console logs:
// DevTools (F12) → Console tab
```

### Backend (Rust)
```bash
# Enable Rust logging
RUST_LOG=debug npm run tauri dev

# Common log macros:
println!("Message");
eprintln!("Error message");
log::debug!("Debug info");
```

### Check Configuration
```bash
# Validate tauri.conf.json
npm run tauri info

# Build and show errors
npm run tauri build
```

---

## Troubleshooting Quick Fixes

| Problem | Solution |
|---------|----------|
| Window not transparent | Set `"transparent": true` in config + `background: transparent` in CSS |
| Always on top not working | Check `"alwaysOnTop": true` in config |
| File watcher not firing | Use `watchImmediate()` instead of `watch()` or increase `delayMs` |
| PixiJS scaling wrong | Set `resolution: window.devicePixelRatio` in Application options |
| Update fails to download | Check `pubkey` in config matches generated key |
| Tray icon not showing | Ensure icon path is correct; use `.png` format |
| Multi-window permission denied | Add `"core:webview:allow-create-webview-window"` to capabilities |

---

**Quick Reference Version:** March 26, 2026
**For full details, see:** TAURI_V2_RESEARCH_REPORT.md
