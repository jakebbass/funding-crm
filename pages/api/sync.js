import { google } from 'googleapis'
import OpenAI from 'openai'
import { GoogleGenerativeAI } from '@google/generative-ai'
import axios from 'axios'
import fs from 'fs'
import path from 'path'

// Initialize Google Sheets, Calendar, and Gmail APIs
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
      'https://www.googleapis.com/auth/gmail.readonly'
    ]
  )
}

const getGmailOAuthClient = () => {
  const TOKEN_PATH = path.join(process.cwd(), 'gmail-tokens.json')
  try {
    const tokenData = fs.readFileSync(TOKEN_PATH, 'utf8')
    const tokens = JSON.parse(tokenData)
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      `${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/api/auth/gmail/callback`
    )
    oauth2Client.setCredentials(tokens)
    logMessage('Using OAuth Gmail authentication')
    return oauth2Client
  } catch (error) {
    logMessage('OAuth tokens not found, falling back to service account for Gmail')
    return null
  }
}

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

const shouldSkipEmail = (email) => {
  if (!email) return true
  const emailLower = email.toLowerCase()
  if (emailLower.includes('@viehq.com') || emailLower === 'fred@fireflies.ai' || emailLower === process.env.GOOGLE_SERVICE_EMAIL?.toLowerCase()) {
    logMessage(`Skipping designated email: ${email}`)
    return true
  }
  const skipDomains = ['@noreply.com', '@notifications.', '@calendly.com', '@zoom.us', '@teams.microsoft.com', '@meet.google.com']
  if (skipDomains.some(domain => emailLower.includes(domain))) {
    logMessage(`Skipping system email: ${email}`)
    return true
  }
  return false
}

function getNameFromEmail(email) {
  if (!email || !email.includes('@')) return 'Unknown Name'
  const localPart = email.split('@')[0]
  return localPart.replace(/[._-]/g, ' ').split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

async function analyzeWithAI(notesContent, contactName, sourceType) {
  if (!notesContent || notesContent.trim().length < 20) {
    logMessage(`Skipping AI for ${contactName} (source: ${sourceType}): insufficient content.`)
    return { status: 'Manual Review Needed', nextStep: 'Insufficient content for AI', notes: `No meaningful content from ${sourceType}.` }
  }
  const aiClient = getAIClient()
  const contactNameToUse = contactName || getNameFromEmail(contactName)
  let prompt = sourceType === 'Fireflies API' || sourceType === 'Fireflies Email' ?
`Analyze this Fireflies meeting content for CRM. Contact: ${contactNameToUse}.
Extract:
1. Investment interest/sentiment (e.g., 'High Interest', 'Passed').
2. Specific next actions/commitments.
3. Key concerns, requirements, objections.
4. Decision timelines or funding amounts.
5. Other critical CRM notes.
Output JSON: {"status": "...", "nextStep": "...", "notes": "..."} (combine 3,4,5 into notes, max 300 chars).
Content (max 7000 chars):
---
${notesContent.substring(0, 7000)}
---` :
`Summarize meeting content for CRM. Contact: ${contactNameToUse}.
Extract:
1. Investment status (e.g., 'Interested', 'Passed').
2. Single most important next step.
3. Brief summary of key points (max 300 chars for notes).
Output JSON: {"status": "...", "nextStep": "...", "notes": "..."}.
Content (max 7000 chars):
---
${notesContent.substring(0, 7000)}
---`
  logMessage(`AI Prompt for ${contactNameToUse} (source: ${sourceType}): ${prompt.substring(0,300)}...`)
  try {
    let analysisResultText
    if (process.env.OPENAI_API_KEY) {
      const c = await aiClient.chat.completions.create({ model: 'gpt-4-turbo-preview', messages: [{role:'user',content:prompt}], response_format: {type:"json_object"}, temperature:0.3 })
      analysisResultText = c.choices[0]?.message?.content
    } else if (process.env.GEMINI_API_KEY) {
      const m = aiClient.getGenerativeModel({model:'gemini-pro'}); const r = await m.generateContent(prompt)
      analysisResultText = r.response.text()
    } else throw new Error('No AI client configured.')
    logMessage(`Raw AI Response for ${contactNameToUse}: ${analysisResultText || 'empty'}`)
    if (!analysisResultText) throw new Error('AI response empty.')
    let pA; try { pA = JSON.parse(analysisResultText.replace(/^```json\s*|```\s*$/g,'').trim()) }
    catch (e) { logMessage(`Failed AI JSON parse for ${contactNameToUse}: ${e.message}. Raw: ${analysisResultText}`); const m = analysisResultText.match(/{[\s\S]*}/); if(m&&m[0])pA=JSON.parse(m[0]); else throw new Error('AI response not valid JSON.') }
    return { status:pA.status||'Manual Review', nextStep:pA.nextStep||'Review AI', notes:pA.notes||'AI notes missing.'}
  } catch (e) { logMessage(`AI analysis failed for ${contactNameToUse}: ${e.message}`); return { status:'Manual Review', nextStep:'Review AI', notes:`AI failed: ${e.message}`}}}

async function recordSyncTimestamp(auth) {
  const sheets = google.sheets({ version: 'v4', auth }); const ts = new Date().toISOString()
  try { await sheets.spreadsheets.values.update({ spreadsheetId:process.env.GOOGLE_SHEET_ID, range:'Contacts!H1', valueInputOption:'USER_ENTERED', resource:{values:[[ts]]}}); logMessage(`Recorded sync timestamp: ${ts}`) }
  catch (e) { logMessage(`Error recording sync timestamp: ${e.message}`) }
}

export default async function handler(req, res) {
  const cronSecret = req.headers['x-cron-secret'] || req.body?.cronSecret
  if (!cronSecret || cronSecret !== process.env.CRON_SECRET) { logMessage('Unauthorized: Invalid CRON_SECRET'); return res.status(401).json({ error: 'Unauthorized' }) }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  logMessage('Starting sync...')
  try {
    const auth = getGoogleAuth(); await auth.authorize(); logMessage('Google auth successful.')
    const calendarEvents = await getCalendarEvents(auth); logMessage(`Found ${calendarEvents.length} calendar events.`)
    const existingContacts = await getSheetContacts(auth); logMessage(`Found ${existingContacts.length} existing contacts.`)
    const processedContacts = new Map()
    for (const event of calendarEvents) {
      try {
        logMessage(`Processing event: ${event.summary || 'No Summary'}`)
        const attendeeEmails = event.attendees?.map(a => a.email).filter(Boolean) || []
        for (const email of attendeeEmails) {
          if (shouldSkipEmail(email)) continue
          if (processedContacts.has(email)) {
            const exContact = processedContacts.get(email)
            if (new Date(event.start?.dateTime || event.start?.date) > new Date(exContact.lastMeeting || 0)) exContact.lastMeeting = event.start?.dateTime || event.start?.date
            continue
          }
          let contact = existingContacts.find(c => c.email === email)
          if (!contact) contact = { name:getNameFromEmail(email), email, status:'New Contact', nextStep:'Initial outreach', notes:'', lastMeeting:event.start?.dateTime||event.start?.date, createdAt:new Date().toISOString()}
          let meetingNotes = null; try { meetingNotes = await getMeetingNotes(email, event.start?.dateTime, event.summary, auth); if(meetingNotes)logMessage(`Found notes for ${email} from ${meetingNotes.source}`)} catch(e){logMessage(`No notes for ${email}: ${e.message}`)}
          if (meetingNotes) {
            try { const analysis = await analyzeWithAI(meetingNotes.content, contact.name||email, meetingNotes.source); contact.status=analysis.status||contact.status; contact.nextStep=analysis.nextStep||contact.nextStep; contact.notes=analysis.notes||contact.notes; logMessage(`AI for ${email}: Status: ${analysis.status}, Next: ${analysis.nextStep}`)}
            catch(e){logMessage(`AI failed for ${email}: ${e.message}`)}
          }
          if (new Date(event.start?.dateTime||event.start?.date) > new Date(contact.lastMeeting||0)) contact.lastMeeting = event.start?.dateTime||event.start?.date
          processedContacts.set(email, contact)
        }
      } catch (e) { logMessage(`Error processing event ${event.summary||'Unknown Event'}: ${e.message}`) }
    }
    const updatedContacts = Array.from(processedContacts.values())
    if (updatedContacts.length > 0) { await updateSheetContacts(auth, updatedContacts); logMessage(`Updated ${updatedContacts.length} contacts.`) }
    await recordSyncTimestamp(auth); logMessage('Sync completed successfully.')
    res.status(200).json({ success:true, message:'Sync completed', contactsProcessed:updatedContacts.length, eventsProcessed:calendarEvents.length, timestamp:new Date().toISOString()})
  } catch (e) { logMessage(`Sync failed: ${e.message}`); console.error('Sync error:', e); res.status(500).json({error:'Sync failed',message:e.message,timestamp:new Date().toISOString()})}}

async function getMeetingNotes(email, meetingDate, meetingTitle, auth) {
  try { if(process.env.FIREFLIES_API_KEY){ const ffTr = await getFirefliesTranscript(email,meetingDate); if(ffTr)return{content:ffTr,source:'Fireflies API'}}}catch(e){logMessage(`Fireflies API failed for ${email}: ${e.message}`)}
  try { const ffEm = await getFirefliesEmailSummary(email,meetingDate,meetingTitle,auth); if(ffEm)return{content:ffEm,source:'Fireflies Email'}}catch(e){logMessage(`Fireflies email search failed for ${email}: ${e.message}`)}
  try { const gmSum = await getGmailMeetingRecap(email,meetingDate,meetingTitle,auth); if(gmSum)return{content:gmSum,source:'Gmail'}}catch(e){logMessage(`Gmail search failed for ${email}: ${e.message}`)}
  return null
}

async function getFirefliesEmailSummary(email, meetingDate, meetingTitle, auth) {
  const gmailAuth = getGmailOAuthClient()||auth; const gmail = google.gmail({version:'v1',auth:gmailAuth}); const searchDt = new Date(meetingDate)
  const dayBef = new Date(searchDt.getTime()-(24*60*60*1000)); const dayAft = new Date(searchDt.getTime()+(48*60*60*1000))
  const searchTerms = [`from:fred@fireflies.ai`,`after:${Math.floor(dayBef.getTime()/1000)}`,`before:${Math.floor(dayAft.getTime()/1000)}`,`("meeting recap" OR summary OR "meeting overview" OR transcript OR "action items" OR notes)`]
  if(email)searchTerms.push(`${email}`)
  if(meetingTitle){const tW=meetingTitle.split(' ').filter(w=>w.length>3&&!['meeting','call','sync','intro','and','the','with'].includes(w.toLowerCase()));if(tW.length>0)searchTerms.push(`(${tW.join(' OR ')})`)}
  const query=searchTerms.join(' '); try {logMessage(`Fireflies email query: ${query}`); const r=await gmail.users.messages.list({userId:'me',q:query,maxResults:5}); const msgs=r.data.messages||[]
  if(msgs.length===0){logMessage(`No Fireflies emails for ${email}`);return null}
  for(const msg of msgs.slice(0,2)){try{const mD=await gmail.users.messages.get({userId:'me',id:msg.id,format:'full'}); const subj=mD.data.payload.headers.find(h=>h.name.toLowerCase()==='subject')?.value||''; const frm=mD.data.payload.headers.find(h=>h.name.toLowerCase()==='from')?.value||''
  if(frm.toLowerCase().includes('fred@fireflies.ai')){const body=extractEmailBody(mD.data.payload);if(body&&body.length>100){logMessage(`Found Fireflies email for ${email}: ${subj}`);return `Subject: ${subj}\nFrom: ${frm}\n\n${body}`}}}catch(e){logMessage(`Error reading Fireflies email: ${e.message}`)}}return null}
  catch(e){logMessage(`Fireflies email search error: ${e.message}`);throw e}}

async function getGmailMeetingRecap(email, meetingDate, meetingTitle, auth) {
  const gmailAuth = getGmailOAuthClient()||auth; const gmail = google.gmail({version:'v1',auth:gmailAuth}); const searchDt = new Date(meetingDate)
  const dayBef = new Date(searchDt.getTime()-(24*60*60*1000)); const dayAft = new Date(searchDt.getTime()+(48*60*60*1000))
  const searchTerms = [`from:${email}`,`to:${email}`,`(recap OR summary OR notes OR "meeting notes" OR "action items" OR follow-up OR "next steps")`,`after:${Math.floor(dayBef.getTime()/1000)}`,`before:${Math.floor(dayAft.getTime()/1000)}`]
  if(meetingTitle){const tW=meetingTitle.split(' ').filter(w=>w.length>3&&!['meeting','call','sync','intro','and','the','with'].includes(w.toLowerCase()));if(tW.length>0)searchTerms.push(`(${tW.join(' OR ')})`)}
  const query=searchTerms.join(' '); try {logMessage(`Gmail query: ${query}`); const r=await gmail.users.messages.list({userId:'me',q:query,maxResults:10}); const msgs=r.data.messages||[]
  if(msgs.length===0){logMessage(`No Gmail messages for ${email}`);return null}
  for(const msg of msgs.slice(0,3)){try{const mD=await gmail.users.messages.get({userId:'me',id:msg.id,format:'full'}); const subj=mD.data.payload.headers.find(h=>h.name.toLowerCase()==='subject')?.value||''; const frm=mD.data.payload.headers.find(h=>h.name.toLowerCase()==='from')?.value||''
  const isRecap=/recap|summary|notes|follow.?up|action.?items|next.?steps|discussed|meeting.?notes/i.test(subj); const isFromAtt=frm.toLowerCase().includes(email.toLowerCase())
  if(isRecap||isFromAtt){const body=extractEmailBody(mD.data.payload);if(body&&body.length>100){logMessage(`Found Gmail recap from ${email}: ${subj}`);return `Subject: ${subj}\nFrom: ${frm}\n\n${body}`}}}catch(e){logMessage(`Error reading Gmail message: ${e.message}`)}}return null}
  catch(e){logMessage(`Gmail API error: ${e.message}`);throw e}}

function extractEmailBody(payload) {
  let body=''; if(payload.body&&payload.body.data){body=Buffer.from(payload.body.data,'base64').toString('utf-8')}
  else if(payload.parts){for(const part of payload.parts){if(part.mimeType==='text/plain'&&part.body&&part.body.data){body=Buffer.from(part.body.data,'base64').toString('utf-8');break}
  else if(part.mimeType==='text/html'&&part.body&&part.body.data&&!body){const hB=Buffer.from(part.body.data,'base64').toString('utf-8');body=hB.replace(/<script[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<style[^>]*>[\s\S]*?<\/style>/gi,'').replace(/<br\s*\/?>/gi,'\n').replace(/<\/p>/gi,'\n\n').replace(/<\/div>/gi,'\n').replace(/<[^>]*>/g,'').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/</g,'<').replace(/>/g,'>').replace(/"/g,'"').replace(/&#39;/g,"'")}}}
  return body.replace(/\r\n/g,'\n').replace(/\n{3,}/g,'\n\n').replace(/^\s+|\s+$/gm,'').trim().substring(0,8000)
}

async function getCalendarEvents(auth) {
  const calendar = google.calendar({ version: 'v3', auth }); const now = new Date(); const sixtyDaysAgo = new Date(now.getTime()-(60*24*60*60*1000))
  const response = await calendar.events.list({ calendarId:'jake@viehq.com', timeMin:sixtyDaysAgo.toISOString(), timeMax:now.toISOString(), singleEvents:true, orderBy:'startTime', maxResults:250 })
  const keywords = ['investor','pitch','intro','funding','vc','investment','demo','meeting','vie','capital','ventures','fund','consultation','session','call','sync','discussion']
  const vcPatterns = [/ventures?/i, /capital/i, /\bfund\b/i, /partners?/i, /investments?/i, /\.vc/i, /@.*ventures/i, /@.*capital/i, /@.*fund/i]
  const allEvents = response.data.items || []
  logMessage(`[DEBUG] Total events before filtering: ${allEvents.length}`)
  allEvents.forEach((event, index) => { // Debugging line
    logMessage(`[DEBUG] Event ${index + 1}: ${event.summary || 'No Summary'} Attendees: ${event.attendees?.map(a => a.email).join(', ') || 'None'}`)
  }) // Closing forEach
  const filteredEvents = allEvents.filter(event => {
    const title=(event.summary||'').toLowerCase(); const description=(event.description||'').toLowerCase(); const attendeeEmails=event.attendees?.map(a=>a.email?.toLowerCase()).filter(Boolean)||[]; const organizerEmail=event.organizer?.email?.toLowerCase()||''
    const hasKeywords=keywords.some(k=>title.includes(k)||description.includes(k))
    const hasVCPatterns=vcPatterns.some(p=>p.test(title)||p.test(description)||attendeeEmails.some(e=>p.test(e))||p.test(organizerEmail))
    const hasBizAttendees=attendeeEmails.some(e=>!e.includes('viehq.com')&&!e.includes('gmail.com')&&!e.includes('yahoo.com')&&!e.includes('hotmail.com')&&e.includes('@'))
    const matchesFilter = hasKeywords || hasVCPatterns || hasBizAttendees
    logMessage(`[DEBUG] Event "${event.summary||'No Summary'}": ${matchesFilter?'INCLUDED':'FILTERED OUT'} (K:${hasKeywords},VCP:${hasVCPatterns},BizA:${hasBizAttendees})`)
    return matchesFilter
  })
  logMessage(`[DEBUG] Events after filtering: ${filteredEvents.length}`)
  return filteredEvents
} // Closing getCalendarEvents

async function getSheetContacts(auth) {
  const sheets = google.sheets({ version: 'v4', auth })
  try {
    const response = await sheets.spreadsheets.values.get({ spreadsheetId:process.env.GOOGLE_SHEET_ID, range:'Contacts!A:G' })
    const rows = response.data.values || []; if (rows.length <= 1) return []
    return rows.slice(1).map(row => ({ name:row[0]||'', email:row[1]||'', status:row[2]||'', nextStep:row[3]||'', notes:row[4]||'', lastMeeting:row[5]||'', createdAt:row[6]||''})).filter(c=>c.email&&!shouldSkipEmail(c.email))
  } catch (e) { logMessage(`Error reading sheet: ${e.message}`); return [] }
}

async function updateSheetContacts(auth, contacts) {
  const sheets = google.sheets({ version: 'v4', auth }); const uniqueContacts = new Map()
  contacts.forEach(c=>{if(c.email&&!shouldSkipEmail(c.email)){if(uniqueContacts.has(c.email)){const ex=uniqueContacts.get(c.email);if(new Date(c.lastMeeting||0)>new Date(ex.lastMeeting||0))uniqueContacts.set(c.email,c)}else uniqueContacts.set(c.email,c)}})
  const cleanedContacts = Array.from(uniqueContacts.values())
  const values = [['Name','Email','Status','Next Step','Notes','Last Meeting','Created At']]
  cleanedContacts.forEach(c=>{values.push([c.name||'',c.email||'',c.status||'',c.nextStep||'',c.notes||'',c.lastMeeting||'',c.createdAt||''])})
  await sheets.spreadsheets.values.update({ spreadsheetId:process.env.GOOGLE_SHEET_ID, range:'Contacts!A:G', valueInputOption:'RAW', resource:{values}})
  logMessage(`Cleaned/deduplicated: ${cleanedContacts.length} contacts to sheets.`)
}

async function getFirefliesTranscript(email, meetingDate) {
  if (!process.env.FIREFLIES_API_KEY) throw new Error('Fireflies API key not configured')
  const searchDate = new Date(meetingDate); const startDate = new Date(searchDate.getTime()-(24*60*60*1000)); const endDate = new Date(searchDate.getTime()+(24*60*60*1000))
  try {
    const res = await axios.post('https://api.fireflies.ai/graphql', {
      query:`query GetTranscripts($fromDate:DateTime!,$toDate:DateTime!){transcripts(fromDate:$fromDate,toDate:$toDate,limit:50){id title date participants}}`,
      variables:{fromDate:startDate.toISOString(),toDate:endDate.toISOString()}
    },{headers:{'Authorization':`Bearer ${process.env.FIREFLIES_API_KEY}`,'Content-Type':'application/json'}})
    const transcripts = res.data?.data?.transcripts||[]
    const matchTr = transcripts.find(t=>Array.isArray(t.participants)&&t.participants.includes(email))
    if(!matchTr) return null
    const trRes = await axios.post('https://api.fireflies.ai/graphql', {
      query:`query GetSpecificTranscript($transcriptId:String!){transcript(id:$transcriptId){id title date sentences{text speaker_name}participants}}`,
      variables:{transcriptId:matchTr.id}
    },{headers:{'Authorization':`Bearer ${process.env.FIREFLIES_API_KEY}`,'Content-Type':'application/json'}})
    const fullTr = trRes.data?.data?.transcript
    if(!fullTr||!fullTr.sentences) return null
    const trText = fullTr.sentences.map(s=>`${s.speaker_name||'Speaker'}: ${s.text}`).join('\n')
    logMessage(`Retrieved Fireflies transcript for ${email} - ${trText.length} chars`)
    return trText
  } catch (e) { logMessage(`Fireflies API error: ${JSON.stringify(e.response?.data||e.message)}`); throw new Error(`Fireflies API error: ${e.message}`) }
}
