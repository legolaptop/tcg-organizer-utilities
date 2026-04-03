# Google OAuth & Drive Auth Spec
## For Copilot Agent Integration — Client-Side Only

---

## Overview

Add Google Identity Services (GIS) OAuth to the app to support Google Drive
state persistence. The app is purely client-side (static files on GitHub Pages)
with no backend. Auth is implemented using the GIS `tokenClient` implicit grant
flow — no client secret is ever exposed.

Google Sign-In serves as a "Connect Google Drive" feature specifically for the
order tracker's state persistence. The app should remain fully usable without
auth — Drive sync is opt-in.

---

## 1. Prerequisites

### 1.1 Google Cloud Console Setup

Before implementation, the following must be configured in Google Cloud Console.
**This is a manual step — do not attempt to automate it.**

1. Create a project at https://console.cloud.google.com
2. Enable the following APIs:
   - Google Drive API
3. Configure the OAuth consent screen:
   - User type: External
   - App name, support email, and developer contact required
   - Add the following scopes:
     - `https://www.googleapis.com/auth/drive.appdata`
4. Create an OAuth 2.0 Client ID:
   - Application type: **Web application**
   - Authorized JavaScript origins: add your GitHub Pages URL
     (e.g. `https://yourusername.github.io`)
   - No redirect URIs needed for the implicit/token flow
5. Copy the generated **Client ID** — this is the only credential needed
   client-side. There is no client secret in this flow.

### 1.2 Environment Config

Store the Client ID in a config file rather than hardcoding it:

```typescript
// src/config.ts
export const GOOGLE_CLIENT_ID = 'YOUR_CLIENT_ID_HERE.apps.googleusercontent.com';

// Required OAuth scopes
export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/drive.appdata',
].join(' ');
```

---

## 2. Loading the GIS Library

Load the Google Identity Services library via script tag. Do not use the older
`gapi.auth2` library — it is deprecated.

```html
<!-- index.html -->
<script src="https://accounts.google.com/gsi/client" async defer></script>
```

---

## 3. Auth State

Track auth state in memory only — do not persist the access token to
localStorage or Drive. Tokens are short-lived (1 hour) and should be
re-requested on each app session.

```typescript
interface AuthState {
  accessToken: string | null;
  expiresAt: number | null;    // Unix timestamp ms
  userEmail: string | null;
}

let authState: AuthState = {
  accessToken: null,
  expiresAt: null,
  userEmail: null,
};

function isAuthenticated(): boolean {
  return (
    authState.accessToken !== null &&
    authState.expiresAt !== null &&
    Date.now() < authState.expiresAt
  );
}
```

---

## 4. Token Client Initialization

Initialize the GIS token client once on app load. This does not trigger a
login prompt — it just configures the client for when the user clicks
"Connect Google Drive".

```typescript
import { GOOGLE_CLIENT_ID, GOOGLE_SCOPES } from './config';

let tokenClient: google.accounts.oauth2.TokenClient;

function initGoogleAuth(): void {
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: GOOGLE_CLIENT_ID,
    scope: GOOGLE_SCOPES,
    callback: handleTokenResponse,
  });
}

function handleTokenResponse(response: google.accounts.oauth2.TokenResponse): void {
  if (response.error) {
    console.error('OAuth error:', response.error);
    setAuthStatus('error');
    return;
  }

  authState = {
    accessToken: response.access_token,
    // GIS tokens are valid for 1 hour
    expiresAt: Date.now() + (response.expires_in ?? 3600) * 1000,
    userEmail: null, // populated separately via People API if needed
  };

  setAuthStatus('connected');
  // Trigger Drive state load now that we have a token
  onAuthSuccess(authState.accessToken!);
}

// Call on app load
window.onload = () => {
  initGoogleAuth();
};
```

---

## 5. Sign-In Flow

The token client uses a popup-based consent flow. No redirects are needed.

```typescript
function connectGoogleDrive(): void {
  if (isAuthenticated()) {
    // Already connected — skip straight to Drive operations
    onAuthSuccess(authState.accessToken!);
    return;
  }

  // Prompt the user for consent and request a token
  // If the user has previously granted consent, this may resolve silently
  tokenClient.requestAccessToken({ prompt: '' });
}

function disconnectGoogleDrive(): void {
  if (authState.accessToken) {
    google.accounts.oauth2.revoke(authState.accessToken, () => {
      console.log('Token revoked');
    });
  }
  authState = { accessToken: null, expiresAt: null, userEmail: null };
  setAuthStatus('disconnected');
}
```

---

## 6. Token Expiry Handling

Check token validity before every Drive API call. If expired, silently request
a new token before proceeding.

```typescript
async function getValidAccessToken(): Promise<string> {
  if (isAuthenticated()) {
    return authState.accessToken!;
  }

  // Token expired — request a new one silently (no prompt if consent was
  // previously granted)
  return new Promise((resolve, reject) => {
    tokenClient.requestAccessToken({
      prompt: '',
      callback: (response: google.accounts.oauth2.TokenResponse) => {
        if (response.error) {
          reject(new Error(response.error));
          return;
        }
        authState.accessToken = response.access_token;
        authState.expiresAt = Date.now() + (response.expires_in ?? 3600) * 1000;
        resolve(authState.accessToken!);
      },
    } as any);
  });
}
```

Replace all direct uses of `authState.accessToken` in the Drive persistence
layer (section 4 of `order-tracker-feature-spec.md`) with `await getValidAccessToken()`.

---

## 7. UI Components

### 7.1 Connect Button

Show a "Connect Google Drive" button when the user is not authenticated.
Hide it and show status when connected.

```typescript
type AuthStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

function setAuthStatus(status: AuthStatus): void {
  // Update UI based on status:
  // disconnected → show "Connect Google Drive" button
  // connecting   → show spinner, disable button
  // connected    → show "Connected as [email] · Disconnect" 
  // error        → show "Connection failed — try again" in red
}
```

### 7.2 Placement

Place the auth control in the top-right corner of the tracker view, visually
separate from the order list. It should be compact — a single line showing
either the connect button or the connected state.

### 7.3 Behaviour on Load

On app load:
1. Initialize the token client (`initGoogleAuth()`)
2. Do **not** auto-prompt for login — wait for the user to click "Connect Google Drive"
3. If the user connects, load Drive state and merge with any in-memory state

### 7.4 Behaviour Without Auth

The tracker must remain fully functional without Google auth:
- Orders load and display normally from the parsed MHT
- Checkboxes and notes work, stored in memory for the session
- The summary stats, filters, and per-card states all work
- The only missing capability is cross-device persistence
- Show a subtle inline note: "Connect Google Drive to sync progress across devices"

---

## 8. Integration with Drive Persistence Layer

The Drive persistence layer in `order-tracker-feature-spec.md` section 4
expects an `accessToken` parameter on every call. Update those call sites to
use `getValidAccessToken()`:

```typescript
// Before (from order-tracker-feature-spec.md section 4)
await saveStateToDrive(state, accessToken);
await loadStateFromDrive(accessToken);

// After
await saveStateToDrive(state, await getValidAccessToken());
await loadStateFromDrive(await getValidAccessToken());
```

No other changes to the Drive persistence layer are needed.

---

## 9. Security Notes

- The Client ID is safe to expose client-side — it is not a secret
- Never store the access token in localStorage, sessionStorage, or cookies
- The `drive.appdata` scope is intentionally narrow — the app can only
  read/write its own hidden folder, not the user's full Drive
- Token revocation (`disconnectGoogleDrive()`) should always be offered
  so the user can unlink the app from their Google account at any time
