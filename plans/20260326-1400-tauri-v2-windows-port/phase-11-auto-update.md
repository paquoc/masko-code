# Phase 11: Auto-Update & Packaging

## Context
- Parent: [plan.md](plan.md)
- Dependencies: All previous phases
- Reference: `Sources/App/MaskoDesktopApp.swift` (AppUpdater)

## Overview
- **Date:** 2026-03-26
- **Priority:** Medium
- **Status:** Pending
- **Review:** Not started
- **Description:** Build installer, auto-update mechanism, and CI/CD pipeline for Windows distribution.

## Key Insights
- macOS uses Sparkle framework for auto-updates
- Tauri v2 has built-in updater plugin with cryptographic signatures
- Windows installer options: NSIS (exe) or WiX (msi)
- NSIS is more flexible, WiX is more "enterprise"
- Update server can be static JSON on GitHub Releases

## Requirements
- NSIS installer (.exe) for Windows distribution
- Auto-update check on startup
- Update notification in settings + tray menu
- Cryptographic signature verification
- GitHub Releases as update server

## Implementation Steps

1. Generate signing key pair:
   ```bash
   npx tauri signer generate -w src-tauri/keys/masko.key
   ```

2. Configure updater in `tauri.conf.json`:
   ```json
   {
     "plugins": {
       "updater": {
         "active": true,
         "endpoints": [
           "https://github.com/RousselPaul/masko-code/releases/latest/download/update.json"
         ],
         "pubkey": "PUBLIC_KEY_HERE"
       }
     }
   }
   ```

3. Create update check flow in frontend:
   ```typescript
   import { check } from '@tauri-apps/plugin-updater';
   const update = await check();
   if (update?.available) {
     await update.downloadAndInstall();
     // relaunch
   }
   ```

4. Build configuration:
   ```json
   {
     "bundle": {
       "targets": ["nsis"],
       "windows": {
         "certificateThumbprint": null,
         "digestAlgorithm": "sha256",
         "timestampUrl": ""
       }
     }
   }
   ```

5. CI/CD (GitHub Actions):
   - Build on push to release branch
   - Sign artifacts
   - Upload to GitHub Releases
   - Generate update.json manifest

6. Update JSON format:
   ```json
   {
     "version": "0.2.0",
     "notes": "Bug fixes",
     "pub_date": "2026-03-26T12:00:00Z",
     "platforms": {
       "windows-x86_64": {
         "signature": "...",
         "url": "https://github.com/.../releases/download/v0.2.0/Masko_0.2.0_x64-setup.exe"
       }
     }
   }
   ```

## Todo
- [ ] Generate signing key pair
- [ ] Configure tauri-plugin-updater
- [ ] Implement update check on startup
- [ ] Configure NSIS installer
- [ ] Set up GitHub Actions CI/CD
- [ ] Create update.json generation script
- [ ] Test full update cycle

## Success Criteria
- NSIS installer works on clean Windows 11
- Auto-update detects new version and installs
- Signature verification passes

## Risk Assessment
- **Code signing** — Windows SmartScreen may warn on unsigned exe. Consider getting EV certificate.
- **Admin required** — NSIS per-user install avoids admin prompts

## Security Considerations
- All updates cryptographically signed
- HTTPS-only update endpoints
- No auto-install without user consent (show changelog)

## Next Steps
- Post-launch: performance monitoring, telemetry, crash reporting
