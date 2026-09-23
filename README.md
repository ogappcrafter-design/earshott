# Earshot

Voice-focused sound amplifier, recorder and on-device transcriber for Android.
Package: `com.outboxenter.earshot` · Target SDK 36 (meets Google Play's Aug 31, 2026 rule) · Min SDK 24.

## What's built (v1.0)
- Animated intro with word-art title, 3-step onboarding, 2-minute tone check that builds a personal EQ curve
- Live listening: rumble cut → voice focus → 10-band EQ → adaptive noise gate → amp → limiter → L/R balance
- Voice profiles: 20-second sample → pitch range → Focus mode lifts that voice's range
- Recording: 16- or 24-bit, 48 kHz WAV, tap-to-bookmark while recording
- Archive: search titles and transcripts, rename, delete, share, save to Documents/Earshot
- Transcripts: Whisper running on the phone (offline after a one-time model download), timestamped, tap a line to jump there
- Settings, help, feedback, reset; Android back gesture handled; safe-area/edge-to-edge for Android 16
- 26 automated tests (DSP, WAV encoding, pitch detection, noise gate, storage, settings)

## Run it in GitHub Codespaces
1. Create a new repo on GitHub named `earshot`, click **Add file → Upload files**, drag in everything from this zip (not the zip itself), commit.
2. Click **Code → Codespaces → Create codespace on main**.
3. In the terminal at the bottom, run each line, waiting for each to finish:
   ```
   npm install
   npm test
   npm run dev
   ```
   Success looks like `26 passed` from the test step. `npm run dev` pops up a browser tab: that's the app running.

## Build the Android app (needs Android Studio on a computer)
Codespaces can't run Android Studio, so this part happens on a PC or Mac.
1. Install Android Studio (Narwhal or newer) and Node.js 22.
2. Clone your repo, open a terminal in the folder, run `npm install` then `npm run cap:sync`.
3. Run `npx cap open android`. Android Studio opens; let the Gradle sync finish (bottom bar goes quiet).
4. Plug in your phone with USB debugging on, pick it in the device dropdown, click the green ▶. Grant the microphone permission when asked.

## Release build for Google Play
1. **Make your upload key (one time, never lose it):** Android Studio → **Build → Generate Signed App Bundle or APK → Android App Bundle → Next → Create new…** Save it as `android/earshot-upload.jks`, alias `earshot`. Write the passwords down somewhere safe.
2. Copy `android/keystore.properties.example` to `android/keystore.properties` and fill in the passwords.
3. Terminal: `cd android` then `./gradlew bundleRelease` (Windows: `gradlew bundleRelease`).
4. Your upload file: `android/app/build/outputs/bundle/release/app-release.aab`
5. Your **deobfuscation file**: `android/app/build/outputs/mapping/release/mapping.txt`. Upload it in Play Console under the release's **App bundle explorer → Downloads → Deobfuscation file**, or it auto-attaches when included.
6. Every update: bump `versionCode` (+1) and `versionName` in `android/app/build.gradle`.

## Before you publish
- Set your real support email in `src/config.ts`.
- Host `PRIVACY.md` publicly (a GitHub Pages page or a Google Doc set to "anyone with the link") and paste the URL into Play Console.
- Follow `store/STORE_LISTING.md` for the listing, Data safety form and content rating answers.
