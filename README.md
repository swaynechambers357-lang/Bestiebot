# Bestie Bot v1 — demo foundation

Phone-friendly Render web service for Deriv OAuth 2.0 + PKCE.

## Render
Build command: leave blank (or `npm install`)
Start command: `npm start`

Environment variables:
- `BASE_URL` = your Render HTTPS service URL, no trailing slash
- `DERIV_CLIENT_ID` = the App ID shown by Deriv after registering the OAuth application

Deriv redirect URL:
`https://YOUR-RENDER-SERVICE.onrender.com/callback`

## Safety
This first build deliberately does NOT place trades. It establishes secure OAuth and demo-account discovery first. Do not put tokens or passwords in the repository.
