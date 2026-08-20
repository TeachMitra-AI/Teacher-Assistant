# Physical Android Device Setup

This project is verified against a **physical Android phone**, not an
emulator (no Android Studio / AVD is installed or required for this — see
"What was NOT installed" below).

## What's installed on this machine

- **Android SDK Platform Tools** (`adb`/`fastboot` only), via
  `winget install --id Google.PlatformTools`. This is the minimal official
  Google package — it is *not* Android Studio, does not include an
  emulator, and does not include a JDK.
- Install path:
  `%LOCALAPPDATA%\Microsoft\WinGet\Packages\Google.PlatformTools_Microsoft.Winget.Source_8wekyb3d8bbwe\platform-tools\`
- winget added this to your **persistent user PATH**. A brand-new terminal
  window will have `adb` on PATH automatically. If a shell opened *before*
  the install still can't find `adb`, close and reopen it (or run
  `refreshenv` if using a shell that supports it).

## What was NOT installed (intentionally)

- Android Studio, Android emulator/AVD images, or a JDK — not needed for
  running the app on a physical device via Expo Go.
- These only become necessary later, for `npx expo run:android` (a full
  native Gradle build) or a custom dev client build — see "When this
  stops being enough" at the bottom.

## One-time setup on your phone

1. **Enable Developer Options**: Settings → About phone → tap **Build
   number** 7 times (exact menu path varies slightly by manufacturer —
   e.g. Samsung: Settings → About phone → Software information → Build
   number). You'll see "You are now a developer!".
2. **Enable USB debugging**: Settings → System → Developer options →
   toggle **USB debugging** ON.
3. Recommended: also toggle **Stay awake** (keeps the screen on while
   charging/connected) so the screen doesn't lock mid-session.
4. **Install Expo Go** from the Play Store. Keep it updated — Expo Go
   needs to support this project's Expo SDK (**57**); the Play Store
   version auto-updates to support current SDKs.

## Connecting via USB

1. Plug the phone into this Windows machine with a USB cable that
   supports **data transfer** (some cheap/charge-only cables won't work —
   if nothing happens at all, try a different cable first).
2. A prompt appears **on the phone**: "Allow USB debugging?" — check
   **"Always allow from this computer"** and tap **Allow**. If you miss
   it, it can be behind the lock screen — unlock the phone and check
   again, or unplug/replug to re-trigger it.
3. On some phones, pull down the notification shade and check the USB
   mode — if it's set to "Charging only", switch it to "File transfer" or
   "PTP" (some phones require this for adb to see the device at all;
   others don't care).
4. Verify from this machine:
   ```
   adb devices
   ```
   Expected output:
   ```
   List of devices attached
   ABC123XYZ       device
   ```
   If the right column says `unauthorized`, the phone hasn't approved the
   RSA prompt yet (see step 2). If it says `offline`, run
   `adb kill-server && adb start-server` and replug the cable.

## Starting the app

From `mobile/`:

```
npm run android
```

This runs `expo start --android`, which:
- detects the USB-connected device via `adb`,
- automatically runs `adb reverse tcp:8081 tcp:8081` (tunnels the Metro
  bundler port to the phone **over the USB cable** — no shared Wi-Fi
  needed, which sidesteps most network/firewall issues),
- and either launches **Expo Go** directly on the phone with the project
  loaded, or prints a QR code / URL if it can't auto-launch (e.g. Expo Go
  isn't installed yet).

Plain `npm start` also works (opens the general Expo CLI with a QR code
and an interactive menu — press `a` once a device is connected to trigger
the same Android launch path).

## Opening the app on the phone

- **Automatic**: if `npm run android` succeeds, Expo Go opens by itself
  with the project already loading — nothing to do on the phone.
- **Manual fallback**: open Expo Go on the phone → "Enter URL manually" →
  type the URL Metro printed in the terminal. Because of the USB
  `adb reverse` tunnel, this works even with Wi-Fi off.
- Scanning the terminal's QR code with Expo Go's scanner also works, for
  the same USB-tunnel reason.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `adb devices` shows nothing | Try a different (data-capable) USB cable/port. Confirm USB debugging is ON. Look for the on-phone "Allow USB debugging?" prompt — unlock the phone if needed. `adb kill-server && adb start-server`, then replug. |
| Shows `unauthorized` | The phone hasn't approved this PC's RSA key. Check the phone screen (may be behind the lock screen) and tap Allow. |
| Shows `offline` | `adb kill-server && adb start-server`, replug the cable. |
| Windows shows no device at all, no adb entry, no OS-level popup | Rare on Windows 10/11 (built-in driver usually suffices), but some OEMs need their own USB driver — try the phone manufacturer's official USB driver, or Google's "Universal ADB Driver" as a last resort. |
| Metro starts but the phone says "could not connect to development server" | Confirm `adb reverse tcp:8081 tcp:8081` ran (Expo does this automatically when it detects a USB device — check the CLI output for it). As a fallback, run `expo start --tunnel` (needs internet access on both ends, slower, but bypasses local networking entirely). |
| Expo Go complains about an SDK mismatch | Update Expo Go from the Play Store — it must support SDK 57. |

## When this stops being enough (later phases)

Starting at **Phase 3** (native Google Sign-In) and **Phase 7b** (native
push), the app needs native modules Expo Go doesn't ship — Expo Go can no
longer run the project past that point (per `docs/mobile-app-plan.md`
§26). At that point a **custom dev client** is required, built via either
`npx expo run:android` (needs a full local Android SDK + Gradle + JDK —
not installed yet) or a cloud EAS Build. That's out of scope for this
setup; revisit it when Phase 3 starts.
