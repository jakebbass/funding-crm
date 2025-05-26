import axios from 'axios'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const firefliesApiKey = process.env.FIREFLIES_API_KEY
  
  if (!firefliesApiKey) {
    return res.status(500).json({ error: 'Fireflies API key not configured' })
  }

  console.log('Testing Fireflies API...')
  console.log('API Key:', firefliesApiKey.substring(0, 8) + '...')

  try {
    // Test 1: Basic API connectivity - Get user info
    console.log('\n=== Test 1: Basic API Connectivity ===')
    
    const userInfoQuery = `
      query {
        user {
          user_id
          name
          email
        }
      }
    `

    let userResponse
    try {
      userResponse = await axios.post('https://api.fireflies.ai/graphql', {
        query: userInfoQuery
      }, {
        headers: {
          'Authorization': `Bearer ${firefliesApiKey}`,
          'Content-Type': 'application/json'
        }
      })
      
      console.log('User info response:', userResponse.data)
    } catch (error) {
      console.log('User info error:', error.response?.data || error.message)
      return res.status(500).json({
        error: 'Failed to get user info',
        details: error.response?.data || error.message
      })
    }

    // Test 2: Get recent transcripts (no filters)
    console.log('\n=== Test 2: Get Recent Transcripts ===')
    
    const recentTranscriptsQuery = `
      query {
        transcripts(limit: 5) {
          id
          title
          date
          duration
          participants
        }
      }
    `

    let transcriptsResponse
    try {
      transcriptsResponse = await axios.post('https://api.fireflies.ai/graphql', {
        query: recentTranscriptsQuery
      }, {
        headers: {
          'Authorization': `Bearer ${firefliesApiKey}`,
          'Content-Type': 'application/json'
        }
      })
      
      console.log('Recent transcripts response:', JSON.stringify(transcriptsResponse.data, null, 2))
    } catch (error) {
      console.log('Recent transcripts error:', error.response?.data || error.message)
    }

    // Test 3: Test with date range (last 30 days)
    console.log('\n=== Test 3: Get Transcripts with Date Range ===')
    
    const now = new Date()
    const thirtyDaysAgo = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000))
    
    const dateRangeQuery = `
      query GetTranscriptsInRange($fromDate: DateTime!, $toDate: DateTime!) {
        transcripts(
          fromDate: $fromDate,
          toDate: $toDate,
          limit: 10
        ) {
          id
          title
          date
          duration
          participants
        }
      }
    `

    let dateRangeResponse
    try {
      dateRangeResponse = await axios.post('https://api.fireflies.ai/graphql', {
        query: dateRangeQuery,
        variables: {
          fromDate: thirtyDaysAgo.toISOString(),
          toDate: now.toISOString()
        }
      }, {
        headers: {
          'Authorization': `Bearer ${firefliesApiKey}`,
          'Content-Type': 'application/json'
        }
      })
      
      console.log('Date range transcripts response:', JSON.stringify(dateRangeResponse.data, null, 2))
    } catch (error) {
      console.log('Date range transcripts error:', error.response?.data || error.message)
    }

    // Test 4: Test getting transcript text for a specific meeting
    console.log('\n=== Test 4: Get Specific Transcript Text ===')
    
    if (transcriptsResponse?.data?.data?.transcripts?.length > 0) {
      const firstTranscript = transcriptsResponse.data.data.transcripts[0]
      console.log('Testing transcript ID:', firstTranscript.id)
      
      const specificTranscriptQuery = `
        query GetSpecificTranscript($transcriptId: String!) {
          transcript(id: $transcriptId) {
            id
            title
            date
            transcript_url
            sentences {
              text
              speaker_name
              ai_filters {
                action_items
                questions
                metrics
                follow_ups
                topics
                tasks
              }
            }
            participants
          }
        }
      `

      try {
        const specificResponse = await axios.post('https://api.fireflies.ai/graphql', {
          query: specificTranscriptQuery,
          variables: {
            transcriptId: firstTranscript.id
          }
        }, {
          headers: {
            'Authorization': `Bearer ${firefliesApiKey}`,
            'Content-Type': 'application/json'
          }
        })
        
        console.log('Specific transcript response:', JSON.stringify(specificResponse.data, null, 2))
      } catch (error) {
        console.log('Specific transcript error:', error.response?.data || error.message)
      }
    }

    // Test 5: Test the original function approach but with correct HTTP method
    console.log('\n=== Test 5: Original Function Approach (Fixed) ===')
    
    const testEmail = 'simon.draper@growersedge.com' // Use a real email from the transcripts
    const testDate = new Date(1747771200000).toISOString() // Use the date from the "Texas" meeting
    
    try {
      const transcript = await getFirefliesTranscriptFixed(testEmail, testDate, firefliesApiKey)
      console.log('Original function result:', transcript ? 'Found transcript' : 'No transcript found')
      if (transcript) {
        console.log('Transcript length:', transcript.length)
        console.log('Transcript preview:', transcript.substring(0, 200) + '...')
      }
    } catch (error) {
      console.log('Original function error:', error.message)
    }

    // Return comprehensive test results
    res.status(200).json({
      success: true,
      tests: {
        userInfo: userResponse?.data || 'Failed',
        recentTranscripts: transcriptsResponse?.data || 'Failed',
        dateRangeTranscripts: dateRangeResponse?.data || 'Failed'
      },
      apiKey: firefliesApiKey.substring(0, 8) + '...'
    })

  } catch (error) {
    console.error('Fireflies test error:', error)
    res.status(500).json({
      error: 'Fireflies test failed',
      message: error.message,
      details: error.response?.data || 'No additional details'
    })
  }
}

// Fixed version of the Fireflies function
async function getFirefliesTranscriptFixed(email, meetingDate, apiKey) {
  const searchDate = new Date(meetingDate)
  const startDate = new Date(searchDate.getTime() - (24 * 60 * 60 * 1000))
  const endDate = new Date(searchDate.getTime() + (24 * 60 * 60 * 1000))

  try {
    // Use POST instead of GET, and fix the query structure
    const response = await axios.post('https://api.fireflies.ai/graphql', {
      query: `
        query GetTranscripts($fromDate: DateTime!, $toDate: DateTime!) {
          transcripts(
            fromDate: $fromDate,
            toDate: $toDate,
            limit: 10
          ) {
            id
            title
            date
            transcript_url
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
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }
    })

    const transcripts = response.data?.data?.transcripts || []
    
    // Find transcript with matching participant email
    const matchingTranscript = transcripts.find(t => 
      Array.isArray(t.participants) && t.participants.includes(email)
    )

    return matchingTranscript?.transcript_url || null
    
  } catch (error) {
    throw new Error(`Fireflies API error: ${error.message}`)
  }
}
