# Where Is

A phone app for remembering where your family put things. Everyone in the household shares one list of places (Garage › Shelf 3 › Blue box) and things, and changes show up on every phone straight away.

- **Find:** type "passport" and see where it is, who put it there and when.
- **Put away:** stick a QR label or NFC sticker on a shelf, drawer or box. Scan or tap it, then tap the things you put there.
- **Two-tap move:** label something that moves around (a toolbox, the drill). Scan it, then scan the place you put it.
- **History:** every move is recorded, so "it used to be in the loft" is one tap away.
- **Offline:** the last list stays on the phone, so you can still look things up when the server can't be reached.

The repository has two parts:

| Folder | What it is |
| --- | --- |
| `app/` | The phone app: React Native with Expo, TypeScript. Android builds come from GitHub Actions; the same code can become the iPhone app later. |
| `server/` | The server: [PocketBase](https://pocketbase.io) with the household rules built in, run with Docker behind Caddy for HTTPS. |

## Install the app (Android)

1. Every push to `main` that changes the app builds it with GitHub Actions (workflow **Build Android App**, which can also be started by hand from the Actions tab).
2. On your phone, open the repository's **Releases** page, open **Android app (latest build)** and download `where-is-android.apk`.
3. Open the downloaded file and allow your browser to install apps when Android asks.
4. Open Where Is, enter your server address (for example `whereis.example.com`) and sign in with Google or with an email and password.
5. The first person creates the household. Everyone else joins with the invite code from **Settings → Invite your family**.

Publishing a release (for example with the tag `v1.2.0`) builds the app from that tag, names the version after it (`1.2.0`) and attaches `where-is-android.apk` to the release. Pull requests that change the app publish a test build to the **Android app (preview of an open pull request)** release.

### Signing, so updates install over the old version

Android only installs an update when it is signed with the same key as the installed app. Without a key the workflow signs each build with a temporary one, so you have to uninstall the old app first (your data stays on the server; you only sign in again).

To keep one key, create it once on your computer:

```sh
keytool -genkeypair -v -keystore where-is.jks -alias where-is -keyalg RSA -keysize 4096 -validity 10000
base64 -w0 where-is.jks   # on macOS: base64 -i where-is.jks
```

Then add these repository secrets under Settings > Secrets and variables > Actions: `ANDROID_KEYSTORE_BASE64` (the base64 text), `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` (`where-is`) and `ANDROID_KEY_PASSWORD`. Keep the `.jks` file somewhere safe and never commit it.

### Labels that open the app directly (optional)

Without this, scanning a QR label with the phone's own camera opens a small page on your server with an **Open in Where Is** button. Scanning from inside the app, and tapping NFC stickers, always opens the app directly.

To skip that page:

1. Print the key's SHA-256 fingerprint: `keytool -list -v -keystore where-is.jks -alias where-is` and copy the `SHA256:` line.
2. Put it in the server's `.env` as `ANDROID_CERT_SHA256=AB:CD:...` and restart the server.
3. Add the repository variable `WHEREIS_HOST` with your server's host name (for example `whereis.example.com`), and rebuild the app.

### Testers through Firebase App Distribution

This works the same way as in ezbookkeeping-android. Publishing a release also sends the app to Firebase App Distribution once these are set:
- the variable `FIREBASE_APP_ID`, for an Android app with the package name `com.ssiuuk.whereis`;
- the secret `FIREBASE_SERVICE_ACCOUNT`, a service account with the Firebase App Distribution Admin role;
- optionally the variable `FIREBASE_TESTER_GROUPS` (default `testers`).

Until both settings exist, the step is skipped.

## Run the server

The server needs a machine that's always on, such as a small Linux VM on ESX with Docker installed, and a host name that points at your home's public IP.

1. **DNS:** create an A record (or a CNAME to your dynamic DNS name) such as `whereis.example.com`.
2. **Router:** forward TCP ports 80 and 443 (and UDP 443 if you want HTTP/3) to the VM. Caddy uses port 80 to get the Let's Encrypt certificate.
3. **Files:** copy the `server/` folder to the VM, or clone the repository there.
4. **Settings:** `cp .env.example .env` and set `WHEREIS_DOMAIN`. Leave the rest for now.
5. **Start:** `docker compose up -d`. This pulls the image that GitHub Actions publishes to `ghcr.io/ssiuuk/where-is-server`. To build it on the VM instead, run `docker compose up -d --build`. If the repository is private, the image is too: run `docker login ghcr.io` with a token that can read packages, or use `--build`.
6. **Admin account:** `docker compose exec whereis /app/whereis superuser upsert you@example.com 'a-long-password'`, then open `https://whereis.example.com/_/` to reach the PocketBase dashboard.
7. Check `https://whereis.example.com/api/health`, then point the app at `whereis.example.com`.

**Updating:** `docker compose pull && docker compose up -d`. Database changes are applied automatically when the server starts.

**Backups:** everything (database and photos) is in `server/pb_data`. Copy that folder, or set up scheduled backups in the dashboard under Settings → Backups.

### Google sign-in

1. In [Google Cloud console](https://console.cloud.google.com/apis/credentials), create an **OAuth client ID** of type **Web application**. If it asks, set up the consent screen first: External, with your family's addresses as test users, or published.
2. Under **Authorized redirect URIs**, add `https://whereis.example.com/api/oauth2-redirect` with your own host name.
3. Put the client ID and secret in `.env` as `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, then run `docker compose up -d`.

The app shows **Continue with Google** as soon as the server has it turned on. You can also set it up in the dashboard under Collections → users → Options → OAuth2. Settings in `.env` take priority when the server starts.

### Who can get in

Anyone who can reach the server can create an account, but an account sees nothing until it joins a household with that household's invite code. A wrong code is rate-limited. To stop new accounts entirely, open the dashboard, go to Collections → users → API Rules and set the **Create** rule to superusers only. Then create each person's account in the dashboard.

Every household's places, items and history are only visible to its members. This is enforced by the server's API rules (see `server/migrations`) and covered by the tests in `server/whereis_test.go`.

## Labels

- **QR:** open a place (or item) → **Label** → **Save or share label image**, then print it. Plain paper and tape work; laminated or vinyl labels last longer in a garage or loft.
- **NFC:** buy blank NTAG213/215/216 stickers (about £0.20–0.40 each), open **Label** → **Write NFC sticker**, and hold the phone against the sticker. On metal shelves, use stickers made for metal ("anti-metal").
- A label holds a link like `https://whereis.example.com/p/<id>`. It shows nothing to anyone outside your household.

## Develop

```sh
# server: Go 1.27
cd server
go test ./...
go run . serve            # http://127.0.0.1:8090, dashboard at /_/

# app: Node 24
cd app
npm ci
npm run typecheck && npm test
npx expo run:android      # needs the Android SDK; builds a development app
```

The app uses Expo's generated native projects (`npx expo prebuild`), so `app/android` is not committed. Native settings live in `app/app.config.ts` and the config plugins in `app/plugins/`.

## iPhone

The app code already runs on iOS, including NFC reading and writing on iPhone 7 and later. Distribution still needs an Apple Developer account and a build pipeline. That's planned as a follow-up.
