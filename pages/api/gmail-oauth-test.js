import { google } from 'googleapis'
import fs from 'fs'
import path from 'path'

const TOKEN_PATH = path.join(process.cwd(), 'gmail-tokens.json')

const getOAuthClient = () => {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/api/auth/gmail/callback`
  )

  try {
    // Load stored tokens
    const tokenData = fs.readFileSync(TOKEN_PATH, 'utf8')
    const tokens = JSON.parse(tokenData)
    oauth2Client.setCredentials(tokens)
    return oauth2Client
  } catch (error) {
    throw new Error('Gmail tokens not found. Please authorize first at /api/auth/gmail')
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const auth = getOAuthClient()
    console.log('Gmail OAuth authentication successful')

    const gmail = google.gmail({ version: 'v1', auth })
    
    // Test basic Gmail access
    const profile = await gmail.users.getProfile({
      userId: 'me'
    })
    
    console.log('Gmail profile retrieved:', profile.data.emailAddress)
    
    // Search for recent Fireflies emails with extended query
    const queries = [
      'from:fireflies.ai',
      'from:noreply@fireflies.ai', 
      'from:transcript@fireflies.ai',
      'subject:"meeting recording"',
      'subject:"transcript ready"',
      'subject:fireflies'
    ]
    
    let allMessages = []
    let totalFound = 0
    
    for (const query of queries) {
      try {
        const response = await gmail.users.messages.list({
          userId: 'me',
          q: query,
          maxResults: 10
        })
        
        const messages = response.data.messages || []
        console.log(`Query "${query}" found ${messages.length} messages`)
        
        totalFound += messages.length
        allMessages = allMessages.concat(messages.slice(0, 3)) // Get first 3 from each query
      } catch (queryError) {
        console.error(`Query "${query}" failed:`, queryError.message)
      }
    }
    
    // Remove duplicates
    const uniqueMessages = allMessages.filter((message, index, self) => 
      index === self.findIndex(m => m.id === message.id)
    )
    
    console.log(`Found ${totalFound} total Fireflies-related emails, ${uniqueMessages.length} unique`)
    
    // Get details of recent messages
    const messageDetails = []
    for (const message of uniqueMessages.slice(0, 5)) {
      try {
        const messageDetail = await gmail.users.messages.get({
          userId: 'me',
          id: message.id,
          format: 'full'
        })
        
        const headers = messageDetail.data.payload.headers
        const subject = headers.find(h => h.name.toLowerCase() === 'subject')?.value || ''
        const from = headers.find(h => h.name.toLowerCase() === 'from')?.value || ''
        const date = headers.find(h => h.name.toLowerCase() === 'date')?.value || ''
        
        messageDetails.push({
          id: message.id,
          subject,
          from,
          date,
          snippet: messageDetail.data.snippet
        })
      } catch (detailError) {
        console.error(`Failed to get details for message ${message.id}:`, detailError.message)
      }
    }
    
    res.status(200).json({
      success: true,
      message: 'Gmail OAuth API test successful',
      profile: {
        email: profile.data.emailAddress,
        messagesTotal: profile.data.messagesTotal,
        threadsTotal: profile.data.threadsTotal
      },
      firefliesEmails: {
        totalFound,
        uniqueCount: uniqueMessages.length,
        messages: messageDetails
      },
      searchQueries: queries,
      timestamp: new Date().toISOString()
    })

  } catch (error) {
    console.error('Gmail OAuth test failed:', error)
    
    // Check if it's an authentication error
    if (error.message.includes('tokens not found')) {
      return res.status(401).json({
        error: 'Gmail not authorized',
        message: 'Please authorize Gmail access first',
        authUrl: '/api/auth/gmail?redirect=true',
        instructions: [
          '1. Visit /api/auth/gmail to get authorization URL',
          '2. Authorize Gmail access in your browser', 
          '3. Return here to test the connection'
        ],
        timestamp: new Date().toISOString()
      })
    }
    
    res.status(500).json({
      error: 'Gmail OAuth test failed',
      message: error.message,
      details: error.response?.data || error.stack,
      timestamp: new Date().toISOString()
    })
  }
}
