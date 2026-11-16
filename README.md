# Where Is

A phone app for remembering where your family put things. Everyone in the household shares one list of places (Garage › Shelf 3 › Blue box) and things, and changes show up on every phone straight away.

- **Find:** type "passport" and see where it is, who put it there and when.
- **Put away:** stick a QR label or NFC sticker on a shelf, drawer or box. Scan or tap it, then tap the things you put there.
- **Two-tap move:** label something that moves around (a toolbox, the drill). Scan it, then scan the place you put it.
- **Tags and other names:** tag things (#tools, #christmas) and tap a tag to see everything with it. Add the other names people use ("Hoover" for the vacuum) so search finds them under any name. Start a search word with # to match tags only.
- **History:** every move is recorded, so "it used to be in the loft" is one tap away.
- **Offline:** the last list stays on the phone, so you can still look things up when the server can't be reached.
- **Web:** the same app runs in any browser at your server's address, for use on a computer or an iPhone until the iPhone app exists.

The repository has two parts:

| Folder | What it is |
| --- | --- |
| `app/` | The phone app: React Native with Expo, TypeScript. Android builds come from GitHub Actions; the same code can become the iPhone app later. |
| `server/` | The server: [PocketBase](https://pocketbase.io) with the household rules built in, run with Docker behind Caddy for HTTPS. Its image also contains the web version of the app. |

## Use it in a browser

Open your server's address (for example `https://whereis.example.com`) in any browser and sign in. The web version has everything the phone app has except NFC stickers, which browsers can't read or write. QR scanning uses the browser's camera where it's supported. Labels are downloaded as images instead of shared.

When someone scans a label with their phone's own camera, the link opens the place in the browser. On Android phones with the app installed, an **Open in the app** button takes them to the app.

## Install the app (Android)

1. Every push to `main` that changes the app builds it with GitHub Actions (workflow **Build Android App**, which can also be started by hand from the Actions tab to rebuild `main`).
2. On your phone, open the repository's **Releases** page, open **Android app (latest build)** and download `where-is-android.apk`.
3. Open the downloaded file and allow your browser to install apps when Android asks.
4. Open Where Is, enter your server address (for example `whereis.example.com`) and sign in with Google or with an email and password.
5. The first person creates the household. Everyone else joins with the invite code from **Settings → Invite your family**.

Publishing a release (for example with the tag `v1.2.0`) builds the app from that tag, names the version after it (`1.2.0`) and attaches `where-is-android.apk` to the release.

Pull requests that change the app get a test build of their own, the release **Android app (preview of pull request #N)** (tag `android-pr-N`). It is deleted when the pull request is closed. Pull request builds never see the signing key, so a preview is signed with a temporary key: uninstall the regular app before installing one. Previews are published by the workflow on `main`, so they start once this setup is merged.

### Signing, so updates install over the old version

Android only installs an update when it is signed with the same key as the installed app. Without a key the workflow signs each build with a temporary one, so you have to uninstall the old app first (your data stays on the server; you only sign in again).

To keep one key, create it once on your computer:

```sh
keytool -genkeypair -v -keystore where-is.jks -alias where-is -keyalg RSA -keysize 4096 -validity 10000
base64 -w0 where-is.jks   # on macOS: base64 -i where-is.jks
```

Then keep the key where only reviewed code can use it:

1. Under Settings > Environments, create an environment named `release`. Under **Deployment branches and tags**, choose **Selected branches and tags** and add the branch `main` and the tag pattern `v*`. Optionally add yourself as a required reviewer, so every signed build waits for your approval.
2. In that environment, add the secrets `ANDROID_KEYSTORE_BASE64` (the base64 text), `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` (`where-is`) and `ANDROID_KEY_PASSWORD`. Don't add them as repository secrets, which every workflow can read.

Keep the `.jks` file somewhere safe and never commit it.

The workflows are split by trust: pull request jobs get a read-only token and no secrets, and only the `release` job gets write access and the `release` environment. The workflow itself only lets that job run for `main` (pushes and manual runs) and published `v*` releases, and it always builds the exact commit the run is for, so the environment rules check what actually gets signed.

### Labels that open the app directly (optional)

Without this, scanning a QR label with the phone's own camera opens the place in the browser, with an **Open in the app** button on Android. Scanning from inside the app, and tapping NFC stickers, always opens the app directly.

To skip that page:

1. Print the key's SHA-256 fingerprint: `keytool -list -v -keystore where-is.jks -alias where-is` and copy the `SHA256:` line.
2. Put it in the server's `.env` as `ANDROID_CERT_SHA256=AB:CD:...` and restart the server.
3. Add the repository variable `WHEREIS_HOST` with your server's host name (for example `whereis.example.com`), and rebuild the app.

### Testers through Firebase App Distribution

This works the same way as in ezbookkeeping-android. Publishing a release also sends the app to Firebase App Distribution once these are set:
- the variable `FIREBASE_APP_ID`, for an Android app with the package name `com.ssiuuk.whereis`;
- the secret `FIREBASE_SERVICE_ACCOUNT` in the `release` environment, a service account with the Firebase App Distribution Admin role;
- optionally the variable `FIREBASE_TESTER_GROUPS` (default `testers`).

Until both settings exist, the step is skipped.

## Run the server

The server needs a machine that's always on, such as a small Linux VM on ESX with Docker installed, and a host name that points at your home's public IP.

1. **DNS:** create an A record (or a CNAME to your dynamic DNS name) such as `whereis.example.com`.
2. **Router:** forward TCP ports 80 and 443 (and UDP 443 if you want HTTP/3) to the VM. Caddy uses port 80 to get the Let's Encrypt certificate.
3. **Files:** copy the `server/` folder to the VM. To build the image on the VM instead of pulling it, clone the whole repository, because the image includes the web app from `app/`.
4. **Settings:** `cp .env.example .env` and set `WHEREIS_DOMAIN`. Leave the rest for now.
5. **Start:** `docker compose up -d`. This pulls the image that GitHub Actions publishes to `ghcr.io/ssiuuk/where-is-server`. To build it on the VM instead, run `docker compose up -d --build` from `server/` in a full clone. If the repository is private, the image is too: run `docker login ghcr.io` with a token that can read packages, or use `--build`.
6. **Admin account:** `docker compose exec whereis /app/whereis superuser upsert you@example.com 'a-long-password'`, then open `https://whereis.example.com/_/` to reach the PocketBase dashboard.
7. Open `https://whereis.example.com` to use the web app, or point the phone app at `whereis.example.com`.

**Updating:** `docker compose pull && docker compose up -d`. Database changes are applied automatically when the server starts.

**Backups:** everything (database and photos) is in `server/pb_data`. Copy that folder, or set up scheduled backups in the dashboard under Settings → Backups.

### Google sign-in

1. In [Google Cloud console](https://console.cloud.google.com/apis/credentials), create an **OAuth client ID** of type **Web application**. If it asks, set up the consent screen first: External, with your family's addresses as test users, or published.
2. Under **Authorized redirect URIs**, add `https://whereis.example.com/api/oauth2-redirect` with your own host name.
3. Put the client ID and secret in `.env` as `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, then run `docker compose up -d`.

The app and the web version show **Continue with Google** as soon as the server has it turned on. You can also set it up in the dashboard under Collections → users → Options → OAuth2. Settings in `.env` take priority when the server starts.

### Who can get in

Anyone who can reach the server can create an account, but an account sees nothing until it joins a household with that household's invite code. A wrong code is rate-limited.

To stop new accounts once your family has signed up, a site admin turns off **Allow sign-up** in **Settings → Admin → Server settings** (or set `ALLOW_SIGNUP=false` in `.env`, which then overrides the switch). Sign-up then disappears from the app, and both email sign-up and a first-time Google sign-in are refused. Everyone who already has an account still signs in as before. To add someone later, create their account in the dashboard under Collections → users (or turn sign-up back on for a moment).

### Admins

There are two admin roles, and the server checks them on every request. Each sees **Settings → Admin**; nobody else does.

- **Family admin:** whoever created the household. They can hand the role to another member (it also passes on automatically if they leave or their account is turned off). Their tools cover that household only: members and invite codes (new code, invites on or off, remove someone, send a password reset email), CSV export and import, merging duplicate items or places, the recycle bin (deleted items and places are kept for 30 days and come back with the same labels), printing a full list of where everything is organised by place, printing many QR labels at once and seeing which places have none, the activity log, and stats.
- **Site admin:** anyone who signs in with an email listed in `ADMIN_EMAILS` in `.env` (comma separated). The email must be confirmed, by signing in with Google or with the link the admin screen can email, so nobody can claim the role by signing up with your address first. Their tools cover the whole server: every account (turn off, delete, set a new password, send a reset email), the sign-up switch, email settings with a test email, Google sign-in with a check against Google, and backups (make, download, upload, restore, and a daily or weekly schedule).

```sh
ADMIN_EMAILS=you@example.com
```

Settings in `.env` win over the admin screens: when `ALLOW_SIGNUP`, `SMTP_HOST` or the Google keys are set there, the matching screen shows them but can't change them.

### Passwords

People change their password under **Settings → You → Change password**. Doing so signs them out on their other devices.

**Forgot password?** on the sign-in screen emails a reset link, so it only works once the server can send email. Put your email server in `.env` and run `docker compose up -d`:

```sh
PUBLIC_URL=https://whereis.example.com   # used for the link in the email
SMTP_HOST=smtp.example.com
SMTP_PORT=587                            # 465 for TLS from the start
SMTP_USERNAME=you@example.com
SMTP_PASSWORD=app-password
MAIL_FROM_ADDRESS=whereis@example.com    # the address emails come from
MAIL_FROM_NAME=Where Is
```

Any SMTP server works: your email provider's (for Gmail, use an app password), or a service such as Brevo or Mailgun. The settings in `.env` are applied each time the server starts. Leave `SMTP_HOST` empty to manage them in the dashboard under Settings → Mail settings instead; the dashboard can also send a test email. The link in the email opens a page on your server where the person picks a new password. Until email is set up, a superuser can set anyone's password in the dashboard: Collections → users → open the person → type a new password → Save. People who signed up with Google have no password; they can keep using Google, or set one with **Forgot password?**.

Every household's places, items and history are only visible to its members. A person belongs to one household at a time: to switch, they leave in Settings first. Item photos are protected files: they are only served with a short-lived file token that the server gives to signed-in members of that household, so a copied photo link stops working within the hour. Who moved an item and when is always set by the server, and an item's move and its history entry are saved together or not at all. This is enforced by the server's API rules (see `server/migrations`) and covered by the tests in `server/whereis_test.go`.

## Labels

- **QR:** open a place (or item) → **Label** → **Save or share label image**, then print it. The family admin can print a whole sheet at once under **Settings → Admin → Labels**, which also lists the places that have no label or sticker yet. Plain paper and tape work; laminated or vinyl labels last longer in a garage or loft.
- **NFC:** buy blank NTAG213/215/216 stickers (about £0.20–0.40 each), open **Label** → **Write NFC sticker**, and hold the phone against the sticker. On metal shelves, use stickers made for metal ("anti-metal").
- A label holds a link like `https://whereis.example.com/p/<id>`. It shows nothing to anyone outside your household. The app only accepts labels from the server it is signed in to (plus `whereis://` links on NFC stickers).

## Develop

```sh
# server: Go 1.27
cd server
go test ./...
go run . serve            # http://127.0.0.1:8090, dashboard at /_/
# with the web app: build it (below), then WEB_DIR=../app/dist go run . serve

# app: Node 24
cd app
npm ci
npm run typecheck && npm test
npx expo run:android      # needs the Android SDK; builds a development app
npx expo export --platform web --output-dir dist   # the web version
EXPO_PUBLIC_SERVER_URL=http://127.0.0.1:8090 npx expo start --web   # web, live reloading
```

The app uses Expo's generated native projects (`npx expo prebuild`), so `app/android` is not committed. Native settings live in `app/app.config.ts` and the config plugins in `app/plugins/`.

## iPhone

Until the iPhone app exists, iPhones can use the web version at the server's address; Safari's share menu can add it to the home screen as an icon. The app code already runs on iOS, including NFC reading and writing on iPhone 7 and later. Distribution still needs an Apple Developer account and a build pipeline. That's planned as a follow-up.
