# PinToTrip

Web-only travel discovery and personal travel map.

**See it. Find it. Save it.**

## Status

This repository currently contains the **technical architecture foundation** only.
Product UI, polished screens, and AI implementations are intentionally not built yet.

## Stack

- **Frontend:** Next.js, React, TypeScript, Tailwind CSS
- **Backend:** Firebase Auth, Firestore, Storage, Cloud Functions, App Hosting
- **Maps:** Google Maps JavaScript API
- **AI:** OpenAI via Cloud Functions only (never from the browser)
- **Analytics:** PostHog (central abstraction in `src/lib/analytics`)

## Getting started

```bash
cp .env.example .env.local
# Fill in public Firebase / Maps / PostHog values

npm install
npm run dev
```

Cloud Functions:

```bash
cd functions
npm install
npm run build
```

## Environment

| Variable | Where | Notes |
|---|---|---|
| `NEXT_PUBLIC_FIREBASE_*` | `.env.local` / App Hosting | Public web config |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | `.env.local` / App Hosting | Restrict by HTTP referrer |
| `NEXT_PUBLIC_POSTHOG_*` | `.env.local` / App Hosting | Public analytics key |
| `NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION` | `.env.local` / App Hosting | Search Console HTML-tag token |
| `OPENAI_API_KEY` | Secret Manager / Functions secrets | **Never** `NEXT_PUBLIC_*` |
| `GOOGLE_PRIVATE_API_KEY` | Secret Manager / Functions secrets | Server verification only |

## Security

- Firestore and Storage rules restrict access to the signed-in owner.
- OpenAI and private API keys stay server-side in Cloud Functions.
- Do not commit `.env.local` or service account JSON.

## Manual console setup required

1. Create a Firebase project and enable Auth (Email/Password + Google), Firestore, Storage, Functions, App Hosting.
2. Register a web app and copy config into `.env.local`.
3. Create a Google Maps JavaScript API key (+ Map ID if using Advanced Markers).
4. Create a PostHog project and copy the project key.
5. Set Functions secrets: `firebase functions:secrets:set OPENAI_API_KEY`
6. Update `.firebaserc` with your real project ID.
7. Deploy rules: `firebase deploy --only firestore:rules,storage`
8. Google Search Console: add `https://pintototrip.app` → HTML tag verification → set `NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION` → redeploy → submit `https://pintototrip.app/sitemap.xml`
