# M0 login spike: test protocol

Goal: show on **Windows, macOS and Linux** that co-co can do all of the following without a backend:

- log in to eCamp with the user's normal account, **including PBS MiData**;
- make authenticated API calls;
- refresh the token;
- log out cleanly.

This protocol is the evidence for [ADR 0003](adr/0003-login-via-webview-cookies.md).

## Preparation

| Item | Notes |
| --- | --- |
| App build | Either run `npm run tauri dev -w apps/desktop` (needs the OS prerequisites from the README), or install the CI artifact `co-co-<platform>` from the latest green CI run on the branch. |
| Accounts | (A) an eCamp account that logs in via **PBS MiData**. (B) an eCamp account with **e-mail + password**. One person may have both. Test accounts on `https://dev.ecamp3.ch` are preferred where possible. |
| Camps | Account should be a member of at least one camp with some activities. |
| Network | Normal internet. No proxy that strips cookies. |
| Diagnostics | Keep the spike protocol card visible. It shows every `auth://log` event live. |

Record the following for each OS:

- OS version;
- webview version, if known (Windows: WebView2 runtime version under "Apps"; Linux: the
  `libwebkit2gtk-4.1` package version);
- co-co version or commit.

## Test steps

Run every step on each OS. "Expected" is the pass condition.

### 1. Instance discovery

1. Start co-co. Select **eCamp (Produktion)** (or **eCamp Dev**) and click **Prüfen**.
2. Expected:
   - apiRoot is `https://app.ecamp3.ch/api` (or the dev API);
   - cookiePrefix is `app_ecamp3_ch_` (or `dev_ecamp3_ch_`);
   - a version string is shown;
   - "Kommentare aktiv" shows ja/nein;
   - the OAuth providers include `pbsmidata`;
   - no error.
3. Add a custom URL (e.g. `https://dev.ecamp3.ch/`) and restart the app. Expected: the list is still
   there.

### 2. MiData login (primary path)

1. Click **Mit eCamp anmelden (inkl. MiData)**.
2. Expected: a window titled **"eCamp Anmeldung"** opens with the eCamp login page.
   - Log: `login-window-opened` ok.
3. Choose **MiData / PBS** in that window and log in with account (A). Complete MFA if asked.
4. Expected:
   - eCamp redirects back to `/loginCallback` and on to another route;
   - the login window **closes by itself** within a few seconds.
5. Expected log entries:
   - navigation/poll detected on the instance host;
   - `cookies` ok, listing the cookie **names** `…jwt_hp`, `…jwt_s`, `…refresh_token`;
   - `session` ok.
6. Expected in the session card:
   - method `webview`;
   - the user's name or e-mail, resolved via the API;
   - a token expiry countdown.

Note what you see if it fails:

- Window does not close → copy the log. Does it show a URL that is still `/login`, or is a cookie
  missing?
- `jwt_s` or `refresh_token` missing → the `HttpOnly` cookies were not returned by the webview cookie
  store on this OS. **This is a critical finding.**

### 3. Authenticated API read

1. In the camps card, click to load camps.
2. Expected: the same camps as on `app.ecamp3.ch/camps`, with title, short title and dates. The count
   matches.
3. Click one camp. Expected: activity count > 0, and the first activity titles are shown.
4. Expected log: API calls ok, and no 401.

### 4. Token refresh

1. Click **Token erneuern**.
2. Expected: the expiry countdown jumps forward. Log `refresh` ok. The refresh-token cookie name is
   still present.
3. Click **Token erneuern** a second time. Expected: ok again. This proves that the rotated single-use
   refresh token was stored.
4. Leave the app open past the scheduled auto-refresh, which happens at half the remaining lifetime
   (between 2 and 30 min). Expected: an automatic refresh entry in the log, and camps still load
   afterwards.
5. Optional: leave the machine idle or asleep for longer than the token lifetime, then load camps.
   Expected: a 401 triggers one automatic refresh and the call succeeds. Otherwise you get a clear
   "Sitzung abgelaufen" state.

### 5. Logout

1. Click **Abmelden**.
2. Expected:
   - the session card is empty;
   - loading camps fails with "nicht angemeldet", and no request is sent with old cookies;
   - log `logout` ok.

### 6. Re-login

1. Click **Mit eCamp anmelden** again.
2. Expected: the eCamp login page appears, not an automatic login with the previous eCamp session.
   - A MiData single-sign-on step may still be remembered by MiData itself. Note whether this happens.
3. Log in again (MiData). Expected: same result as step 2.
4. Close the login window by hand once, without logging in. Expected: log `login-window-closed`, and
   the app still works.

### 7. Password login (fallback)

1. Log out. Open **Passwort-Login (Fallback)** and log in with account (B).
2. Expected: session method `password`, and the same results as steps 3 and 4.
3. Enter a wrong password. Expected: a German error message (401), with no password in the log.
4. Log in via the webview window using the password form of the eCamp page.
   - Expected: also detected. This works through the poller, because SPA route changes do not fire
     page-load events.

### 8. Security checks (spot checks)

- The report and the log contain **no cookie values**. No long base64 strings appear after cookie
  names.
- Main window devtools (debug build only): `document.cookie` does not contain eCamp cookies.
- The login window must have no IPC access:
  - Open devtools in the login window, if available in the debug build.
  - Run `window.__TAURI_INTERNALS__?.invoke('session_status')`.
  - Expected: undefined or an error, never data.

## Go / no-go criteria

**GO**, which accepts ADR 0003, needs all of the following:

- Steps 2 to 6 pass with **MiData** on **Windows and macOS**. Linux should pass as well.
- `jwt_hp`, `jwt_s` and `refresh_token` are captured on each OS that passes.
- At least two refreshes in a row succeed.
- There are no cookie values or passwords in logs or reports.

**GO with restriction**:

- MiData webview login fails on one OS, but password login works there. Document the OS limitation
  and open an issue with the eCamp team about an official integration path.

**NO-GO**:

- Webview login fails on Windows **or** macOS because of the cookie store, i.e. no `HttpOnly`
  cookies are returned. → Re-plan: ask the eCamp team for API tokens or native OAuth, or fall back to
  password-only.
- The token cannot be refreshed reliably.
- A security check fails.

## Reporting

1. After the run on each OS, click **Ergebnis kopieren** in the spike protocol card. This copies a
   Markdown report with:
   - OS/user agent and app version;
   - login method and cookie names;
   - the results checklist and timestamps.
2. Paste it as a **comment in the GitHub issue "M0 – Login-Spike"** of the co-co repository, one
   comment per OS and login method. Add manual observations under the report:
   - OS and webview versions;
   - failures and screenshots without personal data;
   - whether MiData asked for a password again on re-login.
3. When all platforms are done, summarize the results in ADR 0003:
   - set the status to accepted or rejected;
   - link the issue comments.

### Result matrix (fill in)

| OS / version | Webview | MiData login | Password login | API read | Refresh ×2 | Logout / re-login | Report link |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Windows 11 | WebView2 … | | | | | | |
| macOS … | WKWebView | | | | | | |
| Ubuntu 24.04 | WebKitGTK 4.1 … | | | | | | |
