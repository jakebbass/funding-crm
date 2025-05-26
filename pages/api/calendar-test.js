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
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/calendar.readonly',
      'https://www.googleapis.com/auth/calendar.events.readonly'
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
    
    const calendar = google.calendar({ version: 'v3', auth })
    
    const results = {
      serviceEmail: process.env.GOOGLE_SERVICE_EMAIL,
      tests: []
    }

    // Test 1: List all calendars
    try {
      const calendarList = await calendar.calendarList.list()
      results.tests.push({
        test: 'calendarList.list()',
        success: true,
        result: `Found ${calendarList.data.items?.length || 0} calendars`,
        calendars: calendarList.data.items?.map(cal => ({
          id: cal.id,
          summary: cal.summary,
          accessRole: cal.accessRole,
          selected: cal.selected,
          primary: cal.primary
        })) || []
      })
    } catch (error) {
      results.tests.push({
        test: 'calendarList.list()',
        success: false,
        error: error.message
      })
    }

    // Test 2: Try to access 'primary' calendar directly
    try {
      const now = new Date()
      const sevenDaysAgo = new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000))
      
      const response = await calendar.events.list({
        calendarId: 'primary',
        timeMin: sevenDaysAgo.toISOString(),
        timeMax: now.toISOString(),
        maxResults: 10
      })
      
      results.tests.push({
        test: "events.list(calendarId: 'primary')",
        success: true,
        result: `Found ${response.data.items?.length || 0} events`
      })
    } catch (error) {
      results.tests.push({
        test: "events.list(calendarId: 'primary')",
        success: false,
        error: error.message
      })
    }

    // Test 3: Try to access user's email as calendar ID
    try {
      const now = new Date()
      const sevenDaysAgo = new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000))
      
      const response = await calendar.events.list({
        calendarId: 'jake@viehq.com',
        timeMin: sevenDaysAgo.toISOString(),
        timeMax: now.toISOString(),
        maxResults: 10
      })
      
      results.tests.push({
        test: "events.list(calendarId: 'jake@viehq.com')",
        success: true,
        result: `Found ${response.data.items?.length || 0} events`
      })
    } catch (error) {
      results.tests.push({
        test: "events.list(calendarId: 'jake@viehq.com')",
        success: false,
        error: error.message
      })
    }

    // Test 4: Get calendar metadata
    try {
      const calendarInfo = await calendar.calendars.get({
        calendarId: 'jake@viehq.com'
      })
      
      results.tests.push({
        test: "calendars.get(calendarId: 'jake@viehq.com')",
        success: true,
        result: `Calendar: ${calendarInfo.data.summary}`,
        etag: calendarInfo.data.etag,
        timeZone: calendarInfo.data.timeZone
      })
    } catch (error) {
      results.tests.push({
        test: "calendars.get(calendarId: 'jake@viehq.com')",
        success: false,
        error: error.message
      })
    }

    res.status(200).json(results)

  } catch (error) {
    console.error('Calendar test error:', error)
    
    res.status(500).json({
      error: 'Calendar test failed',
      message: error.message,
      serviceEmail: process.env.GOOGLE_SERVICE_EMAIL
    })
  }
}
