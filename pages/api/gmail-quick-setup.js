export default async function handler(req, res) {
  const hasOAuthCredentials = 
    process.env.GOOGLE_CLIENT_ID && 
    process.env.GOOGLE_CLIENT_ID !== 'your-google-client-id-here' &&
    process.env.GOOGLE_CLIENT_SECRET && 
    process.env.GOOGLE_CLIENT_SECRET !== 'your-google-client-secret-here'

  const response = {
    timestamp: new Date().toISOString(),
    oauthConfigured: hasOAuthCredentials,
    currentClientId: process.env.GOOGLE_CLIENT_ID || 'Not set',
    currentSecret: process.env.GOOGLE_CLIENT_SECRET ? 'Set (hidden)' : 'Not set',
    apiKey: process.env.API_KEY ? 'Available' : 'Not set'
  }

  if (!hasOAuthCredentials) {
    response.error = 'OAuth credentials not properly configured'
    response.instructions = [
      '1. Go to Google Cloud Console (console.cloud.google.com)',
      '2. Select your project: crm-autopilot', 
      '3. Navigate to APIs & Services > Credentials',
      '4. Click "Create Credentials" > "OAuth 2.0 Client ID"',
      '5. Set Application type to "Web application"',
      '6. Add redirect URI: http://localhost:3000/api/auth/gmail/callback',
      '7. Copy the Client ID and Client Secret',
      '8. Update your .env file with the real values'
    ]
    response.envExample = `
# Replace these in your .env file:
GOOGLE_CLIENT_ID=123456789-abcdef.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-abc123def456
NEXTAUTH_URL=http://localhost:3000
    `
    response.nextSteps = 'After updating .env, restart your server and try /api/auth/gmail again'
  } else {
    response.message = 'OAuth credentials are configured!'
    response.nextSteps = [
      '1. Visit /api/auth/gmail to get authorization URL',
      '2. Click the URL to authorize Gmail access',
      '3. Test with /api/gmail-oauth-test'
    ]
  }

  res.status(hasOAuthCredentials ? 200 : 400).json(response)
}
