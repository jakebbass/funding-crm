import { google } from 'googleapis'
import fs from 'fs'
import path from 'path'

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  `${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/api/auth/gmail/callback`
)

// Simple token storage (in production, use a database)
const TOKEN_PATH = path.join(process.cwd(), 'gmail-tokens.json')

const storeToken = (tokens) => {
  try {
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2))
    console.log('Gmail tokens stored successfully')
  } catch (error) {
    console.error('Failed to store Gmail tokens:', error)
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { code, error, state } = req.query

  if (error) {
    return res.status(400).json({
      error: 'OAuth authorization failed',
      details: error,
      timestamp: new Date().toISOString()
    })
  }

  if (!code) {
    return res.status(400).json({
      error: 'No authorization code provided',
      timestamp: new Date().toISOString()
    })
  }

  try {
    // Exchange authorization code for tokens
    const { tokens } = await oauth2Client.getToken(code)
    
    // Store tokens for future use
    storeToken(tokens)
    
    // Set credentials for testing
    oauth2Client.setCredentials(tokens)
    
    // Test Gmail access
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client })
    const profile = await gmail.users.getProfile({ userId: 'me' })
    
    res.status(200).json({
      success: true,
      message: 'Gmail OAuth authorization successful!',
      profile: {
        email: profile.data.emailAddress,
        messagesTotal: profile.data.messagesTotal,
        threadsTotal: profile.data.threadsTotal
      },
      tokens: {
        hasAccessToken: !!tokens.access_token,
        hasRefreshToken: !!tokens.refresh_token,
        expiryDate: tokens.expiry_date
      },
      nextSteps: [
        'Gmail access is now configured',
        'You can now sync Fireflies emails',
        'Tokens are stored locally for future use'
      ],
      timestamp: new Date().toISOString()
    })

  } catch (error) {
    console.error('Gmail OAuth callback failed:', error)
    
    res.status(500).json({
      error: 'Gmail OAuth callback failed',
      message: error.message,
      details: error.response?.data || error.stack,
      timestamp: new Date().toISOString()
    })
  }
}
