import { google } from 'googleapis'

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
    ['https://www.googleapis.com/auth/spreadsheets']
  )
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const auth = getGoogleAuth()
    await auth.authorize()

    const sheets = google.sheets({ version: 'v4', auth })
    
    // Get contacts data
    const contactsResponse = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: 'Contacts!A:G'
    })

    const contactRows = contactsResponse.data.values || []
    let contacts = []
    
    if (contactRows.length > 1) {
      // Skip header row and map data
      contacts = contactRows.slice(1).map(row => ({
        name: row[0] || '',
        email: row[1] || '',
        status: row[2] || '',
        nextStep: row[3] || '',
        notes: row[4] || '',
        lastMeeting: row[5] || '',
        createdAt: row[6] || ''
      })).filter(contact => contact.email) // Only return contacts with emails
    }

    // Get last sync timestamp
    let lastSync = null
    try {
      const syncResponse = await sheets.spreadsheets.values.get({
        spreadsheetId: process.env.GOOGLE_SHEET_ID,
        range: 'Sync!A1:B1'
      })
      
      const syncData = syncResponse.data.values
      if (syncData && syncData[0] && syncData[0][1]) {
        lastSync = syncData[0][1]
      }
    } catch (error) {
      console.log('No sync timestamp found')
    }

    res.status(200).json({
      contacts,
      lastSync,
      total: contacts.length
    })

  } catch (error) {
    console.error('Error fetching contacts:', error)
    res.status(500).json({
      error: 'Failed to fetch contacts',
      message: error.message
    })
  }
}
