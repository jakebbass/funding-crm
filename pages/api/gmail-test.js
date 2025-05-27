import { google } from 'googleapis'

const getGoogleAuth = () => {
  let privateKey = process.env.GOOGLE_PRIVATE_KEY
  if (privateKey) {
    privateKey = privateKey.replace(/\\n/g, '\n')
    if (!privateKey.includes('\n')) {
      privateKey = privateKey.replace(/-----BEGIN PRIVATE KEY-----/, '-----BEGIN PRIVATE KEY-----\n')
      privateKey = privateKey.replace(/-----END PRIVATE KEY-----/, '\n-----END PRIVATE KEY-----')
      privateKey = privateKey.replace(/(.{64})/g, '$1\n')
    }
  }
  
  return new google.auth.JWT(
    process.env.GOOGLE_SERVICE_EMAIL,
    null,
    privateKey,
    [
      'https://www.googleapis.com/auth/gmail.readonly'
    ]
  )
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const auth = getGoogleAuth()
    await auth.authorize()
    
    console.log('Gmail authentication successful')

    const gmail = google.gmail({ version: 'v1', auth })
    
    // Test basic Gmail access
    const profile = await gmail.users.getProfile({
      userId: 'me'
    })
    
    console.log('Gmail profile retrieved:', profile.data.emailAddress)
    
    // Search for recent Fireflies emails
    const response = await gmail.users.messages.list({
      userId: 'me',
      q: 'from:fireflies.ai OR from:noreply@fireflies.ai OR from:transcript@fireflies.ai',
      maxResults: 5
    })
    
    const messages = response.data.messages || []
    console.log(`Found ${messages.length} Fireflies emails`)
    
    // Get details of first message if any
    let messageDetails = null
    if (messages.length > 0) {
      const messageDetail = await gmail.users.messages.get({
        userId: 'me',
        id: messages[0].id,
        format: 'full'
      })
      
      const headers = messageDetail.data.payload.headers
      const subject = headers.find(h => h.name.toLowerCase() === 'subject')?.value || ''
      const from = headers.find(h => h.name.toLowerCase() === 'from')?.value || ''
      const date = headers.find(h => h.name.toLowerCase() === 'date')?.value || ''
      
      messageDetails = {
        subject,
        from,
        date,
        snippet: messageDetail.data.snippet
      }
    }
    
    res.status(200).json({
      success: true,
      message: 'Gmail API test successful',
      profile: {
        email: profile.data.emailAddress,
        messagesTotal: profile.data.messagesTotal,
        threadsTotal: profile.data.threadsTotal
      },
      firefliesEmails: {
        count: messages.length,
        latestMessage: messageDetails
      },
      timestamp: new Date().toISOString()
    })

  } catch (error) {
    console.error('Gmail test failed:', error)
    
    res.status(500).json({
      error: 'Gmail test failed',
      message: error.message,
      details: error.response?.data || error.stack,
      timestamp: new Date().toISOString()
    })
  }
}
