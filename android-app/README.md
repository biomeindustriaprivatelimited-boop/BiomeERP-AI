# Biome ERP — Android app

A real Android app (APK) for staff and plant managers. It opens the same
Biome server the office PC runs, so the login, the data and every update are
shared live with the desktop app. Nothing is kept on the phone except the
sign-in.

## Build the APK (one time, about 15 minutes)

1. Install **Android Studio** (free) on any Windows PC: https://developer.android.com/studio
2. Android Studio → **Open** → choose this `android-app` folder.
   Let it finish "Gradle sync" (it downloads what it needs the first time).
3. Menu **Build → Build App Bundle(s) / APK(s) → Build APK(s)**.
4. Click **locate** in the popup. The file is `app/build/outputs/apk/debug/app-debug.apk`.
5. Send that APK to the phones (WhatsApp / USB). On the phone, allow
   "Install unknown apps" once, then tap the file to install.

## First launch on a phone

The app asks for the server address. On the office PC open Biome →
Imprest → **Open on phone**: the address under the QR (for example
`http://192.168.1.50:3000`) is what you type. The phone must be on the same
Wi-Fi as that PC.

## What works in the app

* Same user ID and password as the desktop app (created in Users & Access).
* Only the features that user's role allows (plant manager, coordinator, …).
* Attach bill photos straight from the camera.
* Pull down to refresh; entries from other phones and PCs appear by themselves.

## Without building an APK

Any Android phone can also open `http://<server-address>/m` in Chrome and use
the same screens. "Install app" appears in Chrome automatically once the
server is reached over **https** (for example through a Cloudflare Tunnel).
