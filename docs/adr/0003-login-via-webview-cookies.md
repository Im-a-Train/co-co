# ADR 0003: Login via the eCamp login page in a webview, then cookie hand-over to Rust

- Status: proposed. Accepted once the M0 spike passes on Windows, macOS and Linux (see
  [m0-spike-protocol.md](../m0-spike-protocol.md)).
- Date: 2026-11-07

## Context

How eCamp v3 authenticates (verified against `app.ecamp3.ch` and the upstream source on 2026-11-07):

- The JWT is split into two cookies by lexik/jwt-authentication-bundle:
  - `{PREFIX}jwt_hp` holds header.payload. It is readable from JavaScript; the payload contains `exp`,
    `user` (an IRI such as `/api/users/…`) and `roles`.
  - `{PREFIX}jwt_s` holds the signature and is `HttpOnly`.
- The refresh token is the cookie `{PREFIX}refresh_token`:
  - set by gesdinet/jwt-refresh-token-bundle;
  - `HttpOnly` and **single use**: every `POST /api/token/refresh` rotates it.
- All of these cookies are `SameSite=strict`, `Secure`, **host-only** (no `Domain` attribute) and
  `Path=/`.
  - The JWT cookies are session cookies (no explicit lifetime). Their validity comes from `exp`.
- `PREFIX` is instance specific, e.g. `app_ecamp3_ch_`. It is published in `{instance}/environment.js`
  as `COOKIE_PREFIX`.
- Login methods:
  - password: `POST /api/authentication_token` with `{identifier, password}`;
  - OAuth via **PBS MiData** (`/api/auth/pbsmidata`), Google, CeviDB or JublaDB.
  - The OAuth flows redirect back to `{instance}/loginCallback`. The OAuth client registrations belong
    to eCamp, so the redirect URI is fixed to the eCamp origin.
- eCamp has no public OAuth client or API-token mechanism for third-party apps.

What this means:

1. A third-party app cannot run the MiData OAuth flow itself. The redirect has to land on the eCamp
   origin.
2. `SameSite=strict` and host-only cookies mean that no other web origin can make authenticated calls.
   A web app or iframe approach is ruled out.
3. A native HTTP client with its own cookie jar is not bound by SameSite. Once it holds the three
   cookies, it can call the API exactly like the eCamp SPA does.

Many PBS coaches only have MiData login and no eCamp password, so password-only login is not enough.

## Decision

1. **Primary login: webview cookie hand-over.**
   - The Rust command `open_login_window` opens a separate Tauri window, label `ecamp-login`, at
     `{instance}/login`.
   - In that window the user logs in exactly as in the browser (MiData, password, other OAuth). We
     never see the credentials.
   - On page loads and navigations, plus a 1 s poller (eCamp is an SPA, so `pushState` route changes
     fire no navigation events), Rust checks whether the window is on the instance host and no longer
     on `/login`.
   - Once that is true, an **async task** (never on the main thread, because of the WebView2
     deadlock, wry#583) reads the cookies with `cookies_for_url(instance)`.
   - It selects `*jwt_hp`, `*jwt_s` and `*refresh_token`, matching by the known prefix or, if needed,
     by suffix, and copies them into the `reqwest` cookie jar as host-only `Secure` cookies.
   - Then it emits `auth://session` and closes the window.
2. **Fallback: password login in Rust.** `password_login` posts to `/api/authentication_token` with
   `reqwest`. The jar captures the `Set-Cookie` headers. The password is never stored or logged.
3. **Session handling in Rust.**
   - `refresh_session` posts to `/api/token/refresh`. The jar takes the rotated refresh token.
   - The frontend schedules a refresh at half the remaining JWT lifetime, clamped to 2–30 minutes.
     This is the same rule the eCamp SPA uses.
   - `api_get` retries once after a refresh when it gets a 401.
4. **Isolation.**
   - The `ecamp-login` window loads remote content and gets **no capabilities**, so it has no IPC.
   - Only the local `main` window has `core:default`. Commands also check the calling window label.
   - `api_get` accepts only paths on the logged-in instance's origin.
   - Cookie values never cross into the frontend or the logs. Only names and decoded `jwt_hp` fields
     (`exp`, `user`, `roles`) do.
   - Logout drops the Rust session and jar and clears the login webview's browsing data. That webview
     uses its own data directory or incognito mode, so the main window's localStorage is not wiped.

## Consequences

Positive:

- MiData and every other eCamp login method work without eCamp changes and without any backend.
- Credentials are only ever typed into eCamp's own page.

Negative and risks:

- We depend on eCamp internals that are not a public contract:
  - cookie names and prefix;
  - the `/loginCallback` flow;
  - refresh-token behaviour.
  If eCamp changes these, the login can break. Mitigation: auto-discovery via `environment.js` and the
  API root `_links`, suffix matching, and the diagnostic `auth://log` events.
- The cookie-store API behaves differently per OS:
  - WebView2 (Windows), WKWebView (macOS) and WebKitGTK (Linux) differ.
  - It must be verified that `HttpOnly` cookies (`jwt_s`, `refresh_token`) are returned on each OS.
  This is the main purpose of the M0 spike.
- The refresh token is single use. If the app and a browser tab share the same refresh token, one of
  them loses. Because the login window keeps its own state, and is cleared or incognito, this does not
  happen in practice.
- In M0 the session lives only in memory. After an app restart the user logs in again. Persisting the
  refresh token in the OS keychain is a later decision.
- MiData single sign-on cookies may survive in the login webview. "Re-login" may therefore be
  one-click, unless the login webview's data is cleared at logout.

If the spike fails on a platform: use the password login there. Then ask the eCamp team for an
official approach, e.g. a personal API token or a registered native OAuth client with a loopback
redirect.
