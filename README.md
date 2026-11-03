# FitDad

Wellness reminders for busy dads — stand up, drink water — with car maintenance coming next.

## Phase 1: Wellness
- **Start Day / Pause / End Day** — stand-up and water reminders run from the moment you start.
- **Morning nudge** — if you haven't started by your nudge time, it alarms and keeps asking (Start now / Later / Day off).
- **Water tracker** — daily goal (default 3 L), one-tap glass logging, late-afternoon "behind on water" check-in.
- Exact Android alarms: fire with the app closed and the phone locked. Data stays on the phone.

## Install
1. Open the repo's **Releases** on your phone and download the latest `FitDad-N.apk`.
2. Open it and allow "Install unknown apps" for your browser when asked.
3. In FitDad → Settings, tap **Test alarm**, lock the phone, and confirm it rings.
4. Phone Settings → Apps → FitDad → Battery → **Unrestricted**.

## Build
Every push to `main` builds the APK via GitHub Actions (`.github/workflows/build-apk.yml`).

Local: `npm ci && npx cap sync android && cd android && ./gradlew assembleDebug`

## Stack
Plain HTML/CSS/JS in `www/`, wrapped with Capacitor 7 (`@capacitor/local-notifications`, `@capacitor/preferences`, `@capacitor/app`).
