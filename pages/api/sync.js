import { google } from 'googleapis'
import OpenAI from 'openai'
import { GoogleGenerativeAI } from '@google/generative-ai'
import axios from 'axios'

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

// Initialize AI clients
const getAIClient = () => {
  if (process.env.OPENAI_API_KEY) {
    return new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  } else if (process.env.GEMINI_API_KEY) {
    return new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
  }
  throw new Error('No AI API key configured')
}

const logMessage = (message) => {
  console.log(`[SYNC] ${new Date().toISOString()}: ${message}`)
}

export default async function handler(req, res) {
  // Verify CRON_SECRET for security
  const cronSecret = req.headers['x-cron-secret'] || req.body?.cronSecret
  if (!cronSecret || cronSecret !== process.env.CRON_SECRET) {
    logMessage('Unauthorized sync attempt - invalid CRON_SECRET')
    return res.status(401).json({ error: 'Unauthorized' })
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  logMessage('Starting sync process...')

  try {
    const auth = getGoogleAuth()
    await auth.authorize()
    
    logMessage('Google authentication successful')

    // Step 1: Get calendar events from last 60 days
    const calendarEvents = await getCalendarEvents(auth)
    logMessage(`Found ${calendarEvents.length} calendar events`)

    // Step 2: Get existing contacts from Google Sheets
    const existingContacts = await getSheetContacts(auth)
    logMessage(`Found ${existingContacts.length} existing contacts`)

    // Step 3: Process each calendar event
    const updatedContacts = []
    
    for (const event of calendarEvents) {
      try {
        logMessage(`Processing event: ${event.summary}`)
        
        // Extract email addresses from attendees
        const attendeeEmails = event.attendees?.map(a => a.email).filter(Boolean) || []
        
        for (const email of attendeeEmails) {
          // Skip if it's the organizer's own email
          if (email === process.env.GOOGLE_SERVICE_EMAIL) continue
          
          // Check if contact already exists
          let contact = existingContacts.find(c => c.email === email)
          
          if (!contact) {
            contact = {
              name: getNameFromEmail(email),
              email: email,
              status: 'New Contact',
              nextStep: 'Initial outreach',
              notes: '',
              lastMeeting: event.start?.dateTime || event.start?.date,
              createdAt: new Date().toISOString()
            }
          }

          // Get meeting transcript if available
          let transcript = null
          try {
            transcript = await getFirefliesTranscript(email, event.start?.dateTime)
            if (transcript) {
              logMessage(`Found transcript for ${email}`)
            }
          } catch (error) {
            logMessage(`No transcript found for ${email}: ${error.message}`)
          }

          // Use AI to analyze the meeting
          if (transcript) {
            try {
              const analysis = await analyzeWithAI(transcript, contact.name || email)
              
              // Update contact with AI analysis
              contact.status = analysis.status || contact.status
              contact.nextStep = analysis.nextStep || contact.nextStep
              contact.notes = analysis.notes || contact.notes
              
              logMessage(`AI analysis completed for ${email}`)
              logMessage(`Status: ${analysis.status}, Next Step: ${analysis.nextStep}`)
              
            } catch (error) {
              logMessage(`AI analysis failed for ${email}: ${error.message}`)
            }
          }

          // Update last meeting date
          const eventDate = new Date(event.start?.dateTime || event.start?.date)
          const lastMeetingDate = new Date(contact.lastMeeting || 0)
          
          if (eventDate > lastMeetingDate) {
            contact.lastMeeting = event.start?.dateTime || event.start?.date
          }

          updatedContacts.push(contact)
        }
      } catch (error) {
        logMessage(`Error processing event ${event.summary}: ${error.message}`)
      }
    }

    // Step 4: Update Google Sheets with new/updated contacts
    if (updatedContacts.length > 0) {
      await updateSheetContacts(auth, updatedContacts)
      logMessage(`Updated ${updatedContacts.length} contacts in Google Sheets`)
    }

    // Step 5: Record sync completion
    await recordSyncTimestamp(auth)
    
    logMessage('Sync process completed successfully')
    
    res.status(200).json({
      success: true,
      message: 'Sync completed successfully',
      contactsProcessed: updatedContacts.length,
      eventsProcessed: calendarEvents.length,
      timestamp: new Date().toISOString()
    })

  } catch (error) {
    logMessage(`Sync failed: ${error.message}`)
    console.error('Sync error:', error)
    
    res.status(500).json({
      error: 'Sync failed',
      message: error.message,
      timestamp: new Date().toISOString()
    })
  }
}

// Get calendar events from last 60 days with investor-related keywords
async function getCalendarEvents(auth) {
  const calendar = google.calendar({ version: 'v3', auth })
  
  const now = new Date()
  const sixtyDaysAgo = new Date(now.getTime() - (60 * 24 * 60 * 60 * 1000))
  
  // Try both primary calendar and the user's main calendar
  let response
  try {
    response = await calendar.events.list({
      calendarId: 'primary',
      timeMin: sixtyDaysAgo.toISOString(),
      timeMax: now.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 250
    })
  } catch (error) {
    // If primary fails, try the user's email as calendar ID
    response = await calendar.events.list({
      calendarId: 'jake@viehq.com',
      timeMin: sixtyDaysAgo.toISOString(),
      timeMax: now.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 250
    })
  }

  // Enhanced filtering for investor-related meetings
  const keywords = ['investor', 'pitch', 'intro', 'funding', 'vc', 'investment', 'demo', 'meeting', 'vie', 'capital', 'ventures', 'fund', 'consultation', 'session', 'call', 'sync', 'discussion']
  
  // VC/investor company patterns
  const vcPatterns = [
    /ventures?/i, /capital/i, /\bfund\b/i, /partners?/i, /investments?/i,
    /\.vc/i, /@.*ventures/i, /@.*capital/i, /@.*fund/i
  ]
  
  return response.data.items?.filter(event => {
    const title = (event.summary || '').toLowerCase()
    const description = (event.description || '').toLowerCase()
    const attendeeEmails = event.attendees?.map(a => a.email?.toLowerCase()).filter(Boolean) || []
    const organizerEmail = event.organizer?.email?.toLowerCase() || ''
    
    // Check for keywords in title/description
    const hasKeywords = keywords.some(keyword => 
      title.includes(keyword) || description.includes(keyword)
    )
    
    // Check for VC/investor patterns in emails or title
    const hasVCPatterns = vcPatterns.some(pattern => 
      pattern.test(title) || pattern.test(description) ||
      [...attendeeEmails, organizerEmail].some(email => pattern.test(email))
    )
    
    // Check if it has external business attendees (not personal gmail/yahoo etc)
    const hasBusinessAttendees = attendeeEmails.some(email => 
      !email.includes('viehq.com') && 
      !email.includes('gmail.com') && 
      !email.includes('yahoo.com') &&
      !email.includes('hotmail.com') &&
      email.includes('@')
    )
    
    return hasKeywords || hasVCPatterns || hasBusinessAttendees
  }) || []
}

// Get existing contacts from Google Sheets
async function getSheetContacts(auth) {
  const sheets = google.sheets({ version: 'v4', auth })
  
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: 'Contacts!A:G'
    })

    const rows = response.data.values || []
    if (rows.length <= 1) return [] // No data or just headers

    // Skip header row
    return rows.slice(1).map(row => ({
      name: row[0] || '',
      email: row[1] || '',
      status: row[2] || '',
      nextStep: row[3] || '',
      notes: row[4] || '',
      lastMeeting: row[5] || '',
      createdAt: row[6] || ''
    })).filter(contact => contact.email) // Only return contacts with emails
    
  } catch (error) {
    logMessage(`Error reading sheet: ${error.message}`)
    return []
  }
}

// Update Google Sheets with contact data
async function updateSheetContacts(auth, contacts) {
  const sheets = google.sheets({ version: 'v4', auth })
  
  // Prepare data for batch update
  const values = [
    ['Name', 'Email', 'Status', 'Next Step', 'Notes', 'Last Meeting', 'Created At']
  ]
  
  contacts.forEach(contact => {
    values.push([
      contact.name || '',
      contact.email || '',
      contact.status || '',
      contact.nextStep || '',
      contact.notes || '',
      contact.lastMeeting || '',
      contact.createdAt || ''
    ])
  })

  await sheets.spreadsheets.values.update({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: 'Contacts!A:G',
    valueInputOption: 'RAW',
    resource: { values }
  })
}

// Get transcript from Fireflies.ai
async function getFirefliesTranscript(email, meetingDate) {
  if (!process.env.FIREFLIES_API_KEY) {
    throw new Error('Fireflies API key not configured')
  }

  // Search for meetings with this email around the meeting date
  const searchDate = new Date(meetingDate)
  const startDate = new Date(searchDate.getTime() - (24 * 60 * 60 * 1000)) // 1 day before
  const endDate = new Date(searchDate.getTime() + (24 * 60 * 60 * 1000))   // 1 day after

  try {
    const response = await axios.get('https://api.fireflies.ai/graphql', {
      headers: {
        'Authorization': `Bearer ${process.env.FIREFLIES_API_KEY}`,
        'Content-Type': 'application/json'
      },
      data: {
        query: `
          query GetTranscripts($userId: String!, $startDate: DateTime!, $endDate: DateTime!) {
            transcripts(
              user_id: $userId,
              start_date: $startDate,
              end_date: $endDate,
              limit: 10
            ) {
              id
              title
              date
              transcript_text
              participants {
                email
                name
              }
            }
          }
        `,
        variables: {
          userId: email,
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString()
        }
      }
    })

    const transcripts = response.data?.data?.transcripts || []
    
    // Find transcript with matching participant email
    const matchingTranscript = transcripts.find(t => 
      t.participants?.some(p => p.email === email)
    )

    return matchingTranscript?.transcript_text || null
    
  } catch (error) {
    throw new Error(`Fireflies API error: ${error.message}`)
  }
}

// Analyze meeting transcript with AI
async function analyzeWithAI(transcript, contactName) {
  const prompt = `
Analyze this investor meeting transcript and extract CRM information. 
Contact: ${contactName}

Transcript:
${transcript}

Please provide a JSON response with:
- status: (one of: "Interested", "Follow-up", "Meeting Scheduled", "Rejected", "Under Review")
- nextStep: (specific next action to take)
- notes: (key insights, concerns, or important details - max 200 chars)

Focus on investment interest, concerns raised, timeline, and concrete next steps mentioned.
`

  try {
    if (process.env.OPENAI_API_KEY) {
      const openai = getAIClient()
      const response = await openai.chat.completions.create({
        model: 'gpt-4',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 500
      })
      
      const content = response.choices[0]?.message?.content
      if (content) {
        logMessage(`OpenAI response: ${content}`)
        return JSON.parse(content)
      }
      
    } else if (process.env.GEMINI_API_KEY) {
      const genAI = getAIClient()
      const model = genAI.getGenerativeModel({ model: 'gemini-pro' })
      
      const result = await model.generateContent(prompt)
      const response = await result.response
      const content = response.text()
      
      if (content) {
        logMessage(`Gemini response: ${content}`)
        return JSON.parse(content)
      }
    }
    
    throw new Error('No AI response received')
    
  } catch (error) {
    logMessage(`AI analysis error: ${error.message}`)
    // Return default values if AI fails
    return {
      status: 'Under Review',
      nextStep: 'Manual review required',
      notes: 'AI analysis failed - manual review needed'
    }
  }
}

// Record sync timestamp in sheets
async function recordSyncTimestamp(auth) {
  const sheets = google.sheets({ version: 'v4', auth })
  
  try {
    await sheets.spreadsheets.values.update({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: 'Sync!A1:B1',
      valueInputOption: 'RAW',
      resource: {
        values: [['Last Sync', new Date().toISOString()]]
      }
    })
  } catch (error) {
    logMessage(`Error recording sync timestamp: ${error.message}`)
  }
}

// Extract name from email address
function getNameFromEmail(email) {
  const localPart = email.split('@')[0]
  return localPart
    .replace(/[._-]/g, ' ')
    .replace(/\b\w/g, l => l.toUpperCase())
}
