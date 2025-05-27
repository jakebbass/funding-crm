import { google } from 'googleapis'

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  `${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/api/auth/gmail/callback`
)

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.modify'
]

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    // Generate the authorization URL
    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES,
      prompt: 'consent',
      state: JSON.stringify({
        timestamp: Date.now(),
        source: 'funding-crm'
      })
    })

    // For development, redirect directly
    if (req.query.redirect === 'true') {
      return res.redirect(authUrl)
    }

    // Otherwise return the URL for manual use
    res.status(200).json({
      success: true,
      message: 'Gmail OAuth authorization URL generated',
      authUrl,
      instructions: [
        '1. Click the authUrl to authorize Gmail access',
        '2. Grant permissions for Gmail reading and modification',
        '3. You will be redirected to the callback URL',
        '4. The callback will handle token exchange and storage'
      ],
      scopes: SCOPES,
      timestamp: new Date().toISOString()
    })

  } catch (error) {
    console.error('Gmail OAuth setup failed:', error)
    
    res.status(500).json({
      error: 'Gmail OAuth setup failed',
      message: error.message,
      timestamp: new Date().toISOString()
    })
  }
}
