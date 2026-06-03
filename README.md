# golfkortari

Static Iceland golf course tracker with Firebase-backed accounts and private
profile documents.

## Local Development

Serve the repo root from a local web server. Opening `index.html` directly will
not work reliably because the app loads CSV data and Firebase modules.

```bash
python3 -m http.server 8000
```

Then open:

```text
http://127.0.0.1:8000/
```

## Firebase Setup

Use the Firebase Spark plan for a zero-cost setup.

1. Create a Firebase project.
2. In Authentication, enable Email/Password and Google sign-in.
3. In Authentication settings, add authorized domains:
   - `localhost`
   - `127.0.0.1`
   - `golfkortari.snorribjarkason.com`
4. Create a Cloud Firestore database.
5. Copy `firebase-config.example.js` values into `firebase-config.js`.
6. Deploy the Firestore rules from `firestore.rules`.

The Firebase web config is public project configuration. Security is enforced by
Firebase Auth and Firestore Security Rules.

## Auth Behavior

- Everyone can view the public map.
- Users can register with email/password.
- Users can sign in with Google.
- Email/password users must verify their email before saving progress or opening
  their profile.
- Google profile photos are used as avatars when available.
- Existing local course progress is not synced into Firestore after login.

## Firestore Data

Profile documents are stored at:

```text
users/{uid}
```

Fields:

- `displayName`
- `email`
- `photoURL`
- `bio`
- `phoneNumber`
- `location`
- `createdAt`
- `updatedAt`
