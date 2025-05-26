import { google } from 'googleapis'

// Initialize Google Sheets and Calendar APIs
const getGoogleAuth = () => {
  // Properly format the private key by ensuring proper line breaks
  let privateKey = process.env.GOOGLE_PRIVATE_KEY
  if (privateKey) {
    // Replace literal \n with actual line breaks
    privateKey = privateKey.replace(/\\n/g, '\n')
    // Ensure the key has proper formatting
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
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/calendar.readonly'
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
    
    console.log('Google authentication successful')
    
    // Test Google Sheets access
    const sheets = google.sheets({ version: 'v4', auth })
    let sheetsResult = 'No access'
    try {
      const response = await sheets.spreadsheets.get({
        spreadsheetId: process.env.GOOGLE_SHEET_ID
      })
      sheetsResult = `Sheet found: ${response.data.properties.title}`
    } catch (error) {
      sheetsResult = `Sheets error: ${error.message}`
    }

    // Test Calendar access
    const calendar = google.calendar({ version: 'v3', auth })
    let calendarResult = 'No access'
    let calendarEvents = []
    
    try {
      // First, try to list calendars
      const calendarList = await calendar.calendarList.list()
      console.log('Available calendars:', calendarList.data.items?.map(cal => ({
        id: cal.id,
        summary: cal.summary,
        accessRole: cal.accessRole
      })))
      
      calendarResult = `Found ${calendarList.data.items?.length || 0} calendars`
      
      // Try to get events from the last 7 days (smaller window for testing)
      const now = new Date()
      const sevenDaysAgo = new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000))
      
      const response = await calendar.events.list({
        calendarId: 'primary',
        timeMin: sevenDaysAgo.toISOString(),
        timeMax: now.toISOString(),
        singleEvents: true,
        orderBy: 'startTime',
        maxResults: 50
      })

      calendarEvents = response.data.items?.map(event => ({
        summary: event.summary,
        start: event.start?.dateTime || event.start?.date,
        attendees: event.attendees?.map(a => a.email) || []
      })) || []
      
    } catch (error) {
      calendarResult = `Calendar error: ${error.message}`
    }

    res.status(200).json({
      success: true,
      googleAuth: 'Connected',
      sheetsAccess: sheetsResult,
      calendarAccess: calendarResult,
      recentEvents: calendarEvents.slice(0, 10), // First 10 events
      totalEvents: calendarEvents.length,
      serviceEmail: process.env.GOOGLE_SERVICE_EMAIL
    })

  } catch (error) {
    console.error('Test error:', error)
    
    res.status(500).json({
      error: 'Test failed',
      message: error.message,
      serviceEmail: process.env.GOOGLE_SERVICE_EMAIL
    })
  }
}
