# Gmail Access Setup Guide

Since your service account doesn't have an inbox for email forwarding, I've created an OAuth 2.0 solution that uses your unrestricted API key to enable Gmail access.

## Problem

- Service accounts can't receive emails (no inbox)
- Email forwarding to service account won't work
- Need access to your Gmail to sync Fireflies transcripts

## Solution

OAuth 2.0 flow that lets you authorize your personal Gmail account for the CRM to access.

## Setup Steps

### 1. Configure Google OAuth (Required)

You need to set up OAuth credentials in Google Cloud Console:

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Select your project (crm-autopilot)
3. Navigate to APIs & Services > Credentials
4. Click "Create Credentials" > "OAuth 2.0 Client ID"
5. Configure OAuth consent screen if not done already
6. Set Application type to "Web application"
7. Add authorized redirect URIs:
   - `http://localhost:3000/api/auth/gmail/callback`
   - `https://your-domain.com/api/auth/gmail/callback` (for production)

### 2. Update Environment Variables

Replace the placeholder values in your `.env` file:

```env
GOOGLE_CLIENT_ID=your-actual-client-id-from-step-1
GOOGLE_CLIENT_SECRET=your-actual-client-secret-from-step-1
NEXTAUTH_URL=http://localhost:3000
```

### 3. Authorization Flow

Once configured, follow this process:

1. **Start Authorization**: Visit `/api/auth/gmail?redirect=true`
2. **Grant Permissions**: Authorize Gmail access in your browser
3. **Test Connection**: Visit `/api/gmail-oauth-test` to verify

## API Endpoints Created

| Endpoint | Purpose |
|----------|---------|
| `/api/gmail-apikey` | Shows alternative approaches and API key capabilities |
| `/api/auth/gmail` | Generates OAuth authorization URL |
| `/api/auth/gmail/callback` | Handles OAuth callback and token storage |
| `/api/gmail-oauth-test` | Tests Gmail access with stored tokens |

## How It Works

1. **OAuth Flow**: Your CRM requests permission to access your Gmail
2. **Token Storage**: Access tokens are stored locally in `gmail-tokens.json`
3. **Automatic Refresh**: Tokens are automatically refreshed when needed
4. **Gmail Access**: Your CRM can now read emails from your Gmail account

## Benefits

✅ **No Email Forwarding Needed**: Direct access to your Gmail  
✅ **Secure**: OAuth 2.0 with proper scopes  
✅ **Automatic**: Tokens refresh automatically  
✅ **Comprehensive**: Can search for Fireflies emails with multiple queries  

## Next Steps

1. **Set up OAuth credentials** in Google Cloud Console
2. **Update your `.env` file** with the real client ID and secret
3. **Run the authorization flow** to grant Gmail access
4. **Test the connection** with the test endpoint
5. **Update your sync process** to use OAuth instead of service account

## Alternative Approaches

If OAuth seems complex, other options include:

- **Domain-wide Delegation**: Configure service account to impersonate domain users
- **Gmail API with App Passwords**: Use app-specific passwords
- **Cloud Functions**: Process emails server-side with your API key
- **Pub/Sub Integration**: Use Gmail push notifications

Let me know which approach you'd prefer to implement!
