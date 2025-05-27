import { google } from 'googleapis'
import OpenAI from 'openai'
import { GoogleGenerativeAI } from '@google/generative-ai'
import axios from 'axios'

// Initialize Google Sheets, Calendar, and Gmail APIs
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
      'https://www.googleapis.com/auth/calendar.readonly',
      'https://www.googleapis.com/auth/gmail.readonly'
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

          // Get meeting notes from multiple sources
          let meetingNotes = null
          try {
            meetingNotes = await getMeetingNotes(email, event.start?.dateTime, event.summary, auth)
            if (meetingNotes) {
              logMessage(`Found meeting notes for ${email} from ${meetingNotes.source}`)
            }
          } catch (error) {
            logMessage(`No meeting notes found for ${email}: ${error.message}`)
          }

          // Use AI to analyze the meeting notes
          if (meetingNotes) {
            try {
              const analysis = await analyzeWithAI(meetingNotes.content, contact.name || email, meetingNotes.source)
              
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

// Get meeting notes from multiple sources (Fireflies + Gmail)
async function getMeetingNotes(email, meetingDate, meetingTitle, auth) {
  // Try Fireflies first
  try {
    if (process.env.FIREFLIES_API_KEY) {
      const firefliesTranscript = await getFirefliesTranscript(email, meetingDate)
      if (firefliesTranscript) {
        return {
          content: firefliesTranscript,
          source: 'Fireflies'
        }
      }
    }
  } catch (error) {
    logMessage(`Fireflies failed for ${email}: ${error.message}`)
  }

  // Try Gmail as backup
  try {
    const gmailSummary = await getGmailMeetingRecap(email, meetingDate, meetingTitle, auth)
    if (gmailSummary) {
      return {
        content: gmailSummary,
        source: 'Gmail'
      }
    }
  } catch (error) {
    logMessage(`Gmail search failed for ${email}: ${error.message}`)
  }

  return null
}

// Get meeting recap from Gmail
async function getGmailMeetingRecap(email, meetingDate, meetingTitle, auth) {
  const gmail = google.gmail({ version: 'v1', auth })
  
  // Search for emails around the meeting date
  const searchDate = new Date(meetingDate)
  const dayBefore = new Date(searchDate.getTime() - (24 * 60 * 60 * 1000))
  const dayAfter = new Date(searchDate.getTime() + (48 * 60 * 60 * 1000)) // Search 2 days after for follow-ups
  
  // Create search query for meeting-related emails
  const searchTerms = [
    `from:${email}`,
    `to:${email}`,
    `(recap OR summary OR notes OR "meeting notes" OR "action items" OR follow-up OR "next steps")`,
    `after:${Math.floor(dayBefore.getTime() / 1000)}`,
    `before:${Math.floor(dayAfter.getTime() / 1000)}`
  ]
  
  // Add meeting title keywords if available
  if (meetingTitle) {
    const titleWords = meetingTitle.split(' ').filter(word => 
      word.length > 3 && 
      !['meeting', 'call', 'sync', 'intro', 'and', 'the', 'with'].includes(word.toLowerCase())
    )
    if (titleWords.length > 0) {
      searchTerms.push(`(${titleWords.join(' OR ')})`)
    }
  }
  
  const query = searchTerms.join(' ')
  
  try {
    logMessage(`Gmail search query: ${query}`)
    
    const response = await gmail.users.messages.list({
      userId: 'me',
      q: query,
      maxResults: 10
    })
    
    const messages = response.data.messages || []
    
    if (messages.length === 0) {
      logMessage(`No Gmail messages found for ${email}`)
      return null
    }
    
    // Get the most recent relevant message
    for (const message of messages.slice(0, 3)) { // Check top 3 messages
      try {
        const messageDetail = await gmail.users.messages.get({
          userId: 'me',
          id: message.id,
          format: 'full'
        })
        
        const headers = messageDetail.data.payload.headers
        const subject = headers.find(h => h.name.toLowerCase() === 'subject')?.value || ''
        const from = headers.find(h => h.name.toLowerCase() === 'from')?.value || ''
        
        // Check if this email is likely a meeting recap
        const isRecap = /recap|summary|notes|follow.?up|action.?items|next.?steps|discussed|meeting.?notes/i.test(subject)
        const isFromAttendee = from.toLowerCase().includes(email.toLowerCase())
        
        if (isRecap || isFromAttendee) {
          const body = extractEmailBody(messageDetail.data.payload)
          if (body && body.length > 100) { // Ensure we have substantial content
            logMessage(`Found Gmail recap from ${email}: ${subject}`)
            return `Subject: ${subject}\nFrom: ${from}\n\n${body}`
          }
        }
      } catch (error) {
        logMessage(`Error reading Gmail message: ${error.message}`)
      }
    }
    
    return null
    
  } catch (error) {
    logMessage(`Gmail API error: ${error.message}`)
    throw error
  }
}

// Extract text body from Gmail message payload
function extractEmailBody(payload) {
  let body = ''
  
  if (payload.body && payload.body.data) {
    body = Buffer.from(payload.body.data, 'base64').toString('utf-8')
  } else if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === 'text/plain' && part.body && part.body.data) {
        body = Buffer.from(part.body.data, 'base64').toString('utf-8')
        break
      } else if (part.mimeType === 'text/html' && part.body && part.body.data && !body) {
        // Use HTML as fallback, strip tags
        const htmlBody = Buffer.from(part.body.data, 'base64').toString('utf-8')
        body = htmlBody.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
      }
    }
  }
  
  // Clean up the body text
  return body
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .substring(0, 5000) // Limit to 5000 chars for AI processing
}

// Get calendar events from last 60 days with investor-related keywords
async function getCalendarEvents(auth) {
  const calendar = google.calendar({ version: 'v3', auth })
  
  const now = new Date()
  const sixtyDaysAgo = new Date(now.getTime() - (60 * 24 * 60 * 60 * 1000))
  
  // Use the working calendar ID directly
  const response = await calendar.events.list({
    calendarId: 'jake@viehq.com',
    timeMin: sixtyDaysAgo.toISOString(),
    timeMax: now.toISOString(),
    singleEvents: true,
    orderBy: 'startTime',
    maxResults: 250
  })

  // Enhanced filtering for investor-related meetings
  const keywords = ['investor', 'pitch', 'intro', 'funding', 'vc', 'investment', 'demo', 'meeting', 'vie', 'capital', 'ventures', 'fund', 'consultation', 'session', 'call', 'sync', 'discussion']
  
  // VC/investor company patterns
  const vcPatterns = [
    /ventures?/i, /capital/i, /\bfund\b/i, /partners?/i, /investments?/i,
    /\.vc/i, /@.*ventures/i, /@.*capital/i, /@.*fund/i
  ]
  
  const allEvents = response.data.items || []
  
  // Log all events for debugging
  console.log(`[DEBUG] Total events before filtering: ${allEvents.length}`)
  allEvents.forEach((event, index) => {
    console.log(`[DEBUG] Event ${index + 1}: ${event.summary}`)
    console.log(`[DEBUG]   Attendees: ${event.attendees?.map(a => a.email).join(', ') || 'None'}`)
  })
  
  const filteredEvents = allEvents.filter(event => {
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
    
    const matchesFilter = hasKeywords || hasVCPatterns || hasBusinessAttendees
    
    console.log(`[DEBUG] Event "${event.summary}": ${matchesFilter ? 'INCLUDED' : 'FILTERED OUT'}`)
    if (!matchesFilter) {
      console.log(`[DEBUG]   - Keywords: ${hasKeywords}, VC patterns: ${hasVCPatterns}, Business attendees: ${hasBusinessAttendees}`)
    }
    
    return matchesFilter
  })
  
  console.log(`[DEBUG] Events after filtering: ${filteredEvents.length}`)
  return filteredEvents
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
    // Step 1: Find matching transcript
    const response = await axios.post('https://api.fireflies.ai/graphql', {
      query: `
        query GetTranscripts($fromDate: DateTime!, $toDate: DateTime!) {
          transcripts(
            fromDate: $fromDate,
            toDate: $toDate,
            limit: 50
          ) {
            id
            title
            date
            participants
          }
        }
      `,
      variables: {
        fromDate: startDate.toISOString(),
        toDate: endDate.toISOString()
      }
    }, {
      headers: {
        'Authorization': `Bearer ${process.env.FIREFLIES_API_KEY}`,
        'Content-Type': 'application/json'
      }
    })

    const transcripts = response.data?.data?.transcripts || []
    
    // Find transcript with matching participant email
    const matchingTranscript = transcripts.find(t => 
      Array.isArray(t.participants) && t.participants.includes(email)
    )

    if (!matchingTranscript) {
      return null
    }

    // Step 2: Get the full transcript content using the transcript ID
    const transcriptResponse = await axios.post('https://api.fireflies.ai/graphql', {
      query: `
        query GetSpecificTranscript($transcriptId: String!) {
          transcript(id: $transcriptId) {
            id
            title
            date
            sentences {
              text
              speaker_name
            }
            participants
          }
        }
      `,
      variables: {
        transcriptId: matchingTranscript.id
      }
    }, {
      headers: {
        'Authorization': `Bearer ${process.env.FIREFLIES_API_KEY}`,
        'Content-Type': 'application/json'
      }
    })

    const fullTranscript = transcriptResponse.data?.data?.transcript
    
    if (!fullTranscript || !fullTranscript.sentences) {
      return null
    }

    // Convert sentences to readable transcript text
    const transcriptText = fullTranscript.sentences
      .map(sentence => `${sentence.speaker_name || 'Speaker'}: ${sentence.text}`)
      .join('\n')

    logMessage(`Retrieved transcript for ${email} - ${transcriptText.length} characters`)
    return transcriptText
    
  } catch (error) {
    logMessage(`Fireflies API error details: ${JSON.stringify(error.response?.data || error.message)}`)
    throw new Error(`Fireflies API error: ${error.message}`)
  }
}

// Analyze meeting transcript/notes with AI
async function analyzeWithAI(content, contactName, source = 'Unknown') {
  const prompt = `
Analyze this investor meeting ${source.toLowerCase()} and extract CRM information. 
Contact: ${contactName}
Source: ${source}

Content:
${content}

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
        model: 'gpt-4o-mini',
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
      notes: `${source} content found - manual review needed`
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
