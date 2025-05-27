# OAuth Setup Instructions

## Current Issue

Your `.env` file still contains placeholder OAuth credentials:

```env
GOOGLE_CLIENT_ID=your-google-client-id-here
GOOGLE_CLIENT_SECRET=your-google-client-secret-here
```bash

## Step-by-Step Fix

### 1. Get Your OAuth Credentials from Google Cloud Console

1. **Go to Google Cloud Console**: <https://console.cloud.google.com/>
2. **Select your project**: `crm-autopilot`
3. **Navigate to**: APIs & Services > Credentials
4. **Look for your OAuth 2.0 Client ID** (you mentioned it's already configured)
5. **Click on your OAuth client** to view details
6. **Copy the Client ID** (looks like: `123456789-abcdef.apps.googleusercontent.com`)
7. **Copy the Client Secret** (looks like: `GOCSPX-abc123def456`)

### 2. Update Your .env File

Replace these lines in your `.env` file:

```env
# OLD (placeholder values):
GOOGLE_CLIENT_ID=your-google-client-id-here
GOOGLE_CLIENT_SECRET=your-google-client-secret-here

# NEW (your actual values):
GOOGLE_CLIENT_ID=123456789-abcdef.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-abc123def456
```

### 3. Verify Redirect URI

Make sure your OAuth client in Google Cloud Console has this redirect URI:

```text
http://localhost:3000/api/auth/gmail/callback
```

### 4. Restart Your Server

After updating `.env`, restart your development server:

```bash
# Stop current server (Ctrl+C)
# Then restart:
npm run dev
```

### 5. Test the Fix

1. **Check configuration**: Visit `http://localhost:3000/api/gmail-quick-setup`
2. **Start OAuth flow**: Visit `http://localhost:3000/api/auth/gmail?redirect=true`
3. **Test Gmail access**: Visit `http://localhost:3000/api/gmail-oauth-test`

## Common Issues

- **"File cannot be accessed"**: OAuth credentials not updated in `.env`
- **"Invalid client"**: Wrong Client ID or not enabled in Google Cloud
- **"Redirect URI mismatch"**: Redirect URI not added to OAuth client settings

## Quick Verification

Run this to check your current config:

```bash
curl http://localhost:3000/api/gmail-quick-setup
```

Should show `"oauthConfigured": true` when fixed.
