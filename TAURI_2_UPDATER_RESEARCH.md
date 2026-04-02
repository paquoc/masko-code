# Tauri 2.x Auto-Update Implementation for Windows

## 1. TAURI'S BUILT-IN UPDATER PLUGIN (@tauri-apps/plugin-updater)

### Overview
- **Mandatory Signing**: Tauri's updater REQUIRES cryptographic signature verification. This cannot be disabled—signatures are non-negotiable for security.
- **Platform Coverage**: Works on Windows, Linux, macOS
- **Architecture**: Rust backend (tauri-plugin-updater) + JavaScript frontend (@tauri-apps/plugin-updater)

### How It Works
1. Application checks update endpoint (static JSON or dynamic server)
2. Endpoint returns version, download URL, and Ed25519 signature
3. Updater validates signature before installation
4. On Windows: Exits app during installation (platform limitation)
5. On completion: Relaunches updated application

### Installation Steps

**Add plugin via CLI:**
```bash
npm run tauri add updater
# OR
yarn run tauri add updater
# OR
pnpm tauri add updater
```

**Manual Cargo.toml (conditional compilation):**
```toml
[target.'cfg(any(target_os = "windows", target_os = "macos", target_os = "linux"))'.dependencies]
tauri-plugin-updater = "2.0"
```

**Install JavaScript bindings:**
```bash
npm add @tauri-apps/plugin-updater
# OR
pnpm add @tauri-apps/plugin-updater
```

**Minimum Rust Version**: 1.77.2+

---

## 2. UPDATE SERVER OPTIONS

### A. GitHub Releases (Recommended for Simple Deployments)

**Direct Endpoint:**
```
https://github.com/<user>/<repo>/releases/latest/download/latest.json
```

**Requirements:**
- Create a GitHub release
- Upload binary artifacts (`.exe` for Windows, `.app.tar.gz` for macOS, `.AppImage` for Linux)
- Create `latest.json` file with manifest (see section 7)
- Upload `latest.json` to release assets

**Pros**: No server infrastructure, version control friendly
**Cons**: Requires manual release management or GitHub Actions automation

### B. Custom Update Server (Dynamic Response)

**Server Endpoint Pattern:**
```
https://your-server.com/update?version={{current_version}}&target={{target}}&arch={{arch}}
```

**Available URL Variables:**
- `{{current_version}}` - App version requesting update (e.g., "1.0.0")
- `{{target}}` - OS identifier: `windows`, `macos`, `linux`
- `{{arch}}` - Architecture: `x86_64`, `i686`, `aarch64`, `armv7`

**Server Response Logic:**
- **No Update**: Return HTTP 204 No Content
- **Update Available**: Return HTTP 200 + JSON with `url`, `version`, `signature`

**Example FastAPI Implementation:**
```python
from fastapi import FastAPI
import requests

app = FastAPI()

@app.get("/update")
async def check_update(version: str, target: str, arch: str):
    # Fetch latest.json from GitHub release
    gh_url = "https://github.com/user/repo/releases/latest/download/latest.json"
    latest = requests.get(gh_url).json()
    
    # Platform key: e.g., "windows-x86_64"
    platform_key = f"{target}-{arch}"
    
    if platform_key not in latest["platforms"]:
        return {"status_code": 204}  # No update
    
    platform_data = latest["platforms"][platform_key]
    return {
        "version": latest["version"],
        "url": platform_data["url"],
        "signature": platform_data["signature"]
    }
```

**Pros**: Fine-grained control, version selection logic, analytics
**Cons**: Requires infrastructure, complexity increases

### C. Static JSON Endpoint

Host `latest.json` on CDN/static host:
```
https://cdn.example.com/latest.json
```

**Pros**: Simplest deployment, no dynamic logic needed
**Cons**: Cannot do per-version logic, less flexible

**Cloudflare Workers Example** (Alternative infrastructure):
```javascript
export default {
  async fetch(request) {
    const url = new URL(request.url);
    const target = url.searchParams.get('target');
    const arch = url.searchParams.get('arch');
    
    // Fetch from GitHub
    const release = await fetch(
      'https://api.github.com/repos/user/repo/releases/latest'
    ).then(r => r.json());
    
    // Build manifest and return
    return new Response(JSON.stringify({ /* manifest */ }));
  }
};
```

---

## 3. REQUIRED TAURI CONFIGURATION

### A. Generate Signing Keys

**Mandatory First Step:**
```bash
pnpm tauri signer generate -w ~/.tauri/myapp.key
# Windows: -w C:\Users\<username>\.tauri\myapp.key
```

Output:
```
Private key: <base64-encoded-key>
Public key: <base64-encoded-key>
```

**Store Safely:**
- Private key: Keep secure, never commit to repo. Use environment variable or secure vault for CI/CD.
- Public key: Add to `tauri.conf.json`

### B. tauri.conf.json Configuration

**Minimal Example:**
```json
{
  "build": {
    "createUpdaterArtifacts": true
  },
  "app": {
    "windows": [{
      "title": "My App"
    }],
    "security": {
      "capabilities": ["updater-capability"]
    }
  },
  "plugins": {
    "updater": {
      "active": true,
      "pubkey": "your-public-key-here",
      "endpoints": [
        "https://github.com/user/repo/releases/latest/download/latest.json"
      ],
      "dialog": true,
      "windows": {
        "installMode": "passive"
      }
    }
  }
}
```

**With Custom Server:**
```json
{
  "plugins": {
    "updater": {
      "active": true,
      "pubkey": "your-public-key-here",
      "endpoints": [
        "https://your-backend.com/update?version={{current_version}}&target={{target}}&arch={{arch}}"
      ]
    }
  }
}
```

### C. Capabilities File (src-tauri/capabilities/updater.json)

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "updater-capability",
  "description": "Application auto-updater",
  "windows": ["main"],
  "permissions": [
    "updater:allow-check",
    "updater:allow-download",
    "updater:allow-install",
    "updater:allow-download-and-install"
  ]
}
```

**Available Updater Permissions:**
- `updater:allow-check` - Check for updates
- `updater:allow-download` - Download updates
- `updater:allow-install` - Install downloaded updates
- `updater:allow-download-and-install` - Combined operation
- `updater:allow-close` - Perform post-install cleanup
- `updater:default` - All of above (shorthand)

---

## 4. RUST-SIDE SETUP

### src-tauri/src/main.rs Example

```rust
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .setup(|app| {
      // Initialize updater plugin
      #[cfg(desktop)]
      app.handle().plugin(
        tauri_plugin_updater::Builder::new().build()
      )?;
      
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
```

### Advanced: Custom Public Key at Runtime

```rust
#[cfg(desktop)]
app.handle().plugin(
  tauri_plugin_updater::Builder::new()
    .pubkey("your-public-key-string")
    .build()
)?;
```

### Dependencies in Cargo.toml

```toml
[dependencies]
tauri = "2.0"

[target.'cfg(any(target_os = "windows", target_os = "macos", target_os = "linux"))'.dependencies]
tauri-plugin-updater = "2.0"
```

---

## 5. FRONTEND-SIDE API

### JavaScript Implementation

**Basic Check & Prompt Pattern:**
```javascript
import { check } from '@tauri-apps/plugin-updater';

async function checkForUpdates() {
  try {
    const update = await check();
    
    if (update?.shouldUpdate) {
      console.log(`Update available: ${update.currentVersion} -> ${update.version}`);
      
      // Show update dialog
      const confirmed = await showUpdateDialog(update);
      
      if (confirmed) {
        // Download and install
        await update.downloadAndInstall();
      }
    } else {
      console.log('You are on the latest version');
    }
  } catch (error) {
    console.error('Update check failed:', error);
  }
}
```

**Download with Progress Tracking:**
```javascript
import { check } from '@tauri-apps/plugin-updater';

async function downloadWithProgress() {
  const update = await check();
  
  if (update?.shouldUpdate) {
    // Download with progress callback
    await update.download((progress) => {
      console.log(`Downloaded: ${progress.chunkLength}/${progress.contentLength}`);
      updateProgressBar(progress.chunkLength / progress.contentLength);
    });
    
    // Install when ready
    await update.install();
  }
}
```

**Two-Step Pattern (Download First, Install Later):**
```javascript
// Step 1: Check and download (no interruption)
async function downloadUpdate() {
  const update = await check();
  
  if (update?.shouldUpdate) {
    await update.download();
    showRestartNotification(); // Non-blocking notification
    return update;
  }
}

// Step 2: Install on user request or app restart
async function installUpdate(update) {
  if (update) {
    await update.install();
  }
}
```

**React Example (Recommended Approach):**
```javascript
import { useEffect, useState } from 'react';
import { check } from '@tauri-apps/plugin-updater';

export function UpdateChecker() {
  const [update, setUpdate] = useState(null);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    checkUpdates();
  }, []);

  async function checkUpdates() {
    try {
      const available = await check();
      if (available?.shouldUpdate) {
        setUpdate(available);
      }
    } catch (error) {
      console.error('Update check failed:', error);
    }
  }

  async function handleInstall() {
    if (!update) return;
    
    setDownloading(true);
    try {
      await update.downloadAndInstall();
      // App will relaunch automatically
    } catch (error) {
      console.error('Installation failed:', error);
      setDownloading(false);
    }
  }

  if (!update) return null;

  return (
    <div className="update-prompt">
      <h3>Update Available</h3>
      <p>Version {update.version} is ready to download</p>
      <button onClick={handleInstall} disabled={downloading}>
        {downloading ? 'Downloading...' : 'Install Update'}
      </button>
    </div>
  );
}
```

### TypeScript Bindings

```typescript
import { check, CheckOptions, Update } from '@tauri-apps/plugin-updater';

interface UpdateState {
  update: Update | null;
  isChecking: boolean;
  error: string | null;
}

async function checkForUpdates(options?: CheckOptions): Promise<Update | null> {
  try {
    const update = await check({
      timeout: 30000, // 30 seconds
      headers: {
        'Authorization': `Bearer ${token}`, // Optional auth header
      },
      proxy: 'http://proxy.example.com:8080', // Optional proxy
    });
    
    return update || null;
  } catch (error) {
    console.error('Check failed:', error);
    return null;
  }
}
```

### Update Object Properties

```javascript
const update = await check();

// Available properties:
console.log(update.version);           // "2.0.0"
console.log(update.currentVersion);    // "1.0.0"
console.log(update.date);              // ISO 8601 date
console.log(update.body);              // Release notes (HTML)
console.log(update.manifest);          // Raw server response JSON
console.log(update.shouldUpdate);      // Boolean
```

---

## 6. CODE SIGNING FOR WINDOWS UPDATES

### Current Landscape (2024+)

**Critical Change (June 2023)**: Certificate Authorities no longer issue exportable OV certificates. New certificates MUST be stored on Hardware Security Modules (HSMs).

### Supported Methods

#### A. OV Certificates (Legacy - Pre-June 2023 Only)

**Requirements:**
- OV certificate acquired before June 1, 2023
- PFX file with private key
- Windows code signing capability

**tauri.conf.json:**
```json
{
  "bundle": {
    "windows": {
      "certificateThumbprint": null,
      "digestAlgorithm": "sha256",
      "signingIdentity": null,
      "timestampUrl": ""
    }
  }
}
```

**Build Environment:**
```bash
# Windows (PowerShell)
$env:TAURI_SIGNING_PRIVATE_KEY = "path/to/certificate.pfx"
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "your-password"

# macOS/Linux
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="your-password"
export TAURI_SIGNING_PRIVATE_KEY="$(cat path/to/certificate.pfx | base64)"
```

#### B. Azure Key Vault (EV Certificates)

**Prerequisites:**
- Azure subscription
- EV code signing certificate
- Azure Key Vault configured with certificate

**tauri.conf.json:**
```json
{
  "bundle": {
    "windows": {
      "certificateThumbprint": "your-thumbprint",
      "signingIdentity": "your-certificate-name",
      "digestAlgorithm": "sha256"
    }
  }
}
```

**Build with Azure:**
```bash
# Install signtool via Windows SDK or use AzureSignTool
AzureSignTool sign ^
  -kvu "https://your-vault.vault.azure.net/" ^
  -kvi "your-app-id" ^
  -kvs "your-app-secret" ^
  -kvtn "your-certificate-name" ^
  -fd sha256 ^
  -tr http://timestamp.digicert.com ^
  "path/to/app.exe"
```

#### C. Azure Code Signing (Modern - Recommended)

**Prerequisites:**
- Azure Trusted Signing account
- .NET 6.0+ installed

**Install Trusted Signing Tool:**
```bash
dotnet tool install --global Azure.CodeSigning.Cli
```

**Build Environment:**
```bash
# Set Azure credentials
$env:AZURE_TENANT_ID = "your-tenant-id"
$env:AZURE_CLIENT_ID = "your-client-id"
$env:AZURE_CLIENT_SECRET = "your-client-secret"
```

**tauri.conf.json:**
```json
{
  "bundle": {
    "windows": {
      "digestAlgorithm": "sha256"
    }
  }
}
```

### Important: SmartScreen Considerations

- **OV Certificates**: SmartScreen still warns users initially; reputation improves over time
- **EV Certificates**: Eliminates SmartScreen warnings immediately
- **Cost**: EV certificates start at $400+/year; requires hardware token

**Note**: App execution on Windows is NOT required for code signing. The signature validates the artifact; users can ignore SmartScreen warnings if desired.

---

## 7. UPDATE MANIFEST FORMAT

### Static JSON Structure (latest.json)

```json
{
  "version": "2.0.0",
  "notes": "- New features\n- Bug fixes\n- Performance improvements",
  "pub_date": "2024-01-15T10:30:00Z",
  "platforms": {
    "windows-x86_64": {
      "signature": "BASE64_ED25519_SIGNATURE",
      "url": "https://github.com/user/repo/releases/download/v2.0.0/MyApp_2.0.0_x64_en-US.msi.zip"
    },
    "windows-i686": {
      "signature": "BASE64_ED25519_SIGNATURE",
      "url": "https://github.com/user/repo/releases/download/v2.0.0/MyApp_2.0.0_x86_en-US.msi.zip"
    },
    "darwin-aarch64": {
      "signature": "BASE64_ED25519_SIGNATURE",
      "url": "https://github.com/user/repo/releases/download/v2.0.0/MyApp_2.0.0_aarch64.app.tar.gz"
    },
    "darwin-x86_64": {
      "signature": "BASE64_ED25519_SIGNATURE",
      "url": "https://github.com/user/repo/releases/download/v2.0.0/MyApp_2.0.0_x64.app.tar.gz"
    },
    "linux-x86_64": {
      "signature": "BASE64_ED25519_SIGNATURE",
      "url": "https://github.com/user/repo/releases/download/v2.0.0/my-app_2.0.0_amd64.AppImage"
    }
  }
}
```

### Generating Signatures

**Using Tauri CLI:**
```bash
pnpm tauri signer sign ../path-to-artifacts/MyApp_2.0.0_x64_en-US.msi.zip \
  --key ~/.tauri/myapp.key
```

Output:
```
Generated signature: __SIGNATURE__
```

**Batch Signing Script (bash):**
```bash
#!/bin/bash
PRIVATE_KEY="~/.tauri/myapp.key"

for file in dist/*.msi.zip dist/*.app.tar.gz dist/*.AppImage; do
  echo "Signing $file..."
  pnpm tauri signer sign "$file" --key "$PRIVATE_KEY"
done
```

### Dynamic Server Response Format

**200 OK Response (Update Available):**
```json
{
  "version": "2.0.0",
  "url": "https://github.com/user/repo/releases/download/v2.0.0/MyApp_2.0.0_x64_en-US.msi.zip",
  "signature": "BASE64_ED25519_SIGNATURE"
}
```

**204 No Content Response (No Update):**
```
HTTP/1.1 204 No Content
```

**Key Requirements:**
- `version`: Must be higher than client's current version (semantic versioning)
- `url`: Direct download link to installer
- `signature`: Base64-encoded Ed25519 signature from `tauri signer sign`
- `pub_date` (optional): ISO 8601 timestamp for manifests

---

## 8. BEST PRACTICES

### Silent vs. Prompted Updates

**Prompted Updates (Recommended for Most Apps):**
```javascript
// Let user decide
const update = await check();
if (update?.shouldUpdate) {
  const userConfirmed = await showDialog({
    title: 'Update Available',
    message: `Update to version ${update.version}?`,
  });
  
  if (userConfirmed) {
    await update.downloadAndInstall();
  }
}
```

**Silent Background Downloads:**
```javascript
// Download silently, prompt only for install
const update = await check();
if (update?.shouldUpdate) {
  await update.download(); // No UI blocking
  
  // Show non-blocking notification
  showNotification({
    title: 'Update Ready',
    body: 'Restart to apply the update',
    actions: [{
      id: 'restart',
      title: 'Restart Now'
    }]
  });
}
```

**Passive Installation Mode (Windows-Only):**
```json
{
  "plugins": {
    "updater": {
      "windows": {
        "installMode": "passive"
      }
    }
  }
}
```

### Error Handling Strategy

```javascript
import { check } from '@tauri-apps/plugin-updater';
import { listen } from '@tauri-apps/api/event';

// Listen to update errors even if dialog is enabled
await listen('tauri://update-available', (event) => {
  console.log('Update available:', event.payload);
});

await listen('tauri://update-error', (event) => {
  console.error('Update error:', event.payload);
  // Notify user, log to analytics, etc.
});

// Explicit error handling in check
async function safeCheckForUpdates() {
  try {
    const update = await check({
      timeout: 10000, // 10 seconds before timeout
    });
    return update;
  } catch (error) {
    if (error.message.includes('timeout')) {
      console.warn('Update check timed out, will retry later');
    } else if (error.message.includes('network')) {
      console.warn('Network error during update check');
    } else {
      console.error('Unexpected update error:', error);
    }
    return null;
  }
}
```

### Startup Check Pattern

```javascript
// In your main App component
import { useEffect } from 'react';
import { check } from '@tauri-apps/plugin-updater';

export function App() {
  useEffect(() => {
    // Check on startup, but don't block UI
    checkForUpdatesInBackground();
  }, []);

  async function checkForUpdatesInBackground() {
    try {
      const update = await check();
      if (update?.shouldUpdate) {
        // Show unobtrusive badge or banner
        showUpdateAvailable(update);
      }
    } catch (error) {
      console.error('Background update check failed:', error);
      // Fail silently for startup
    }
  }

  return <MainUI />;
}
```

### Data Preservation

**Important**: Updater only touches installation directory. User data remains safe.

**Store User Data Separately:**
```javascript
import { appConfigDir } from '@tauri-apps/api/path';

// User data always survives updates
const configPath = await appConfigDir();
// On Windows: C:\Users\<user>\AppData\Roaming\<app-name>
// On macOS: ~/Library/Application Support/<app-name>
// On Linux: ~/.config/<app-name>
```

### Timeout Configuration

```javascript
// Default timeout often too short for slow networks
await check({
  timeout: 30000, // 30 seconds instead of default
});

// For users behind corporate proxies
await check({
  timeout: 60000, // 60 seconds
  proxy: 'http://proxy.company.com:8080'
});
```

### CI/CD Automation (GitHub Actions)

```yaml
name: Release with Tauri Updater

on:
  push:
    tags:
      - 'v*'

jobs:
  build:
    runs-on: ${{ matrix.platform }}
    strategy:
      matrix:
        platform: [ubuntu-20.04, macos-11, windows-2019]
    steps:
      - uses: actions/checkout@v3
      
      - uses: tauri-apps/tauri-action@v0
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
          TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
      
      # After build artifacts exist, create latest.json
      - name: Create latest.json
        run: |
          pnpm tauri signer sign dist/*.msi.zip \
            --key ~/.tauri/myapp.key
          # Generate latest.json from signed artifacts
          node scripts/generate-manifest.js
        env:
          TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
          TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
      
      - uses: actions/upload-release-asset@v1
        with:
          upload_url: ${{ steps.create_release.outputs.upload_url }}
          asset_path: ./latest.json
          asset_name: latest.json
          asset_content_type: application/json
```

### Installation Modes (Windows)

```json
{
  "plugins": {
    "updater": {
      "windows": {
        "installMode": "quiet"  // No UI, requires admin
        // OR
        "installMode": "passive" // Progress bar only (default, recommended)
      }
    }
  }
}
```

---

## IMPLEMENTATION CHECKLIST

- [ ] Generate signing keys: `pnpm tauri signer generate -w ~/.tauri/myapp.key`
- [ ] Add `@tauri-apps/plugin-updater` npm package
- [ ] Add `tauri-plugin-updater` to Cargo.toml
- [ ] Enable `createUpdaterArtifacts: true` in tauri.conf.json
- [ ] Add updater plugin initialization in src/main.rs
- [ ] Create capabilities/updater.json with permissions
- [ ] Configure update endpoint (GitHub Releases URL or custom server)
- [ ] Set public key in tauri.conf.json
- [ ] Implement frontend check/install logic
- [ ] Test update flow with manual version bump
- [ ] Set up code signing (OV/EV/Azure)
- [ ] Configure CI/CD for automated builds and signing
- [ ] Create `latest.json` manifest with platform-specific entries
- [ ] Verify signature generation and validation

---

## SOURCES

- [Tauri v2 Updater Documentation](https://v2.tauri.app/plugin/updater/)
- [Tauri v2 JavaScript API Reference](https://v2.tauri.app/reference/javascript/updater/)
- [Windows Code Signing Guide](https://v2.tauri.app/distribute/sign/windows/)
- [Tauri Capabilities & Permissions](https://v2.tauri.app/security/capabilities/)
- [Using Plugin Permissions](https://v2.tauri.app/learn/security/using-plugin-permissions/)
- [Tauri v2 Auto-Updater Setup Guide](https://thatgurjot.com/til/tauri-auto-updater/)
- [Practical Tauri v2 Auto-Updates](https://ratulmaharaj.com/posts/tauri-automatic-updates/)
- [CrabNebula Auto-Updates Documentation](https://docs.crabnebula.dev/cloud/guides/auto-updates-tauri/)
