# 🚀 Quick Start Guide - Running Your Funding CRM Dashboard

This guide shows you how to start and use your funding CRM dashboard locally.

## 🏃‍♂️ **Starting Your Dashboard (Development Mode)**

### Option 1: Using npm (Recommended)

```bash
# Install dependencies (if not already done)
npm install

# Start the development server
npm run dev
```

### Option 2: Using yarn

```bash
# Install dependencies (if not already done)
yarn install

# Start the development server
yarn dev
```

## 🌐 **Accessing Your Dashboard**

Once the server starts, you'll see output like:

```plaintext
ready - started server on 0.0.0.0:3000, url: <http://localhost:3000>
```

**Open your browser and go to:** <http://localhost:3000>

## 📊 **Dashboard Features & How to Use**

### **Main Dashboard View**

When you first open the application, you'll see:

1. **Header**: "Funding CRM Dashboard" with sync button
2. **Statistics Cards**:
   - Total Contacts
   - Interested prospects
   - Follow-ups needed
   - Recent meetings
3. **Recent Contacts Section**: List of your latest contacts

### **Using the Sync Feature**

1. **Click the "Sync Now" button** in the top right
2. The system will:
   - Pull calendar events from last 60 days
   - Look for investor-related meetings
   - Fetch transcripts from Fireflies.ai
   - Use AI to analyze conversations
   - Update your Google Sheet with new contacts

### **What You'll See After Sync**

- Updated contact counts in the statistics
- New contacts appearing in the "Recent Contacts" section
- Contact status automatically determined by AI
- Next steps suggested based on meeting analysis

## 🔧 **Dashboard Status Indicators**

### **Contact Status Types**

- 🟢 **Interested** - Investor showed clear interest
- 🟡 **Follow-up** - Needs follow-up action
- 🔵 **Meeting Scheduled** - Next meeting booked
- 🔴 **Rejected** - Not interested
- ⚪ **Under Review** - Needs manual review

### **Real-time Updates**

- Dashboard automatically refreshes data
- Sync status shows in browser console
- Error messages display if sync fails

## 📝 **Using Your CRM Data**

### **Contact Information Tracked**

For each contact, the system tracks:

- **Name** (extracted from email or calendar)
- **Email** (from calendar attendees)
- **Status** (AI-determined from conversation)
- **Next Step** (AI-suggested action)
- **Notes** (Key insights from meetings)
- **Last Meeting** (Most recent interaction)
- **Created At** (When added to system)

### **Data Storage**

All data is stored in your Google Sheet with two tabs:

- **Contacts** - Main CRM data
- **Sync** - Last sync timestamp

## 🔍 **Monitoring & Debugging**

### **Check Development Logs**

In your terminal where you ran `npm run dev`, you'll see:

```plaintext
- API requests and responses
- Sync process logs
- Error messages if any issues occur
```

### **Browser Console**

Press F12 to open developer tools and check:

- Network requests to `/api/contacts` and `/api/sync`
- JavaScript errors
- Real-time sync status

## 🛠 **Common Actions**

### **Manual Sync**

- Click "Sync Now" anytime to refresh data
- Useful after important meetings
- Process typically takes 30-60 seconds

### **View Raw Data**

- Check your Google Sheet directly
- Verify contact information
- Make manual edits if needed

### **API Testing**

You can test individual components:

```bash
# Test contacts API
curl http://localhost:3000/api/contacts

# Test sync API (replace with your CRON_SECRET)
curl -X POST http://localhost:3000/api/sync \
  -H "Content-Type: application/json" \
  -d '{"cronSecret":"your_cron_secret_here"}'
```

## 🚨 **Troubleshooting**

### **Dashboard Won't Load**

1. Make sure server is running (`npm run dev`)
2. Check for port conflicts
3. Verify environment variables in `.env`

### **No Contacts Showing**

1. Run sync manually with "Sync Now" button
2. Check Google Sheet permissions
3. Verify calendar has investor meetings
4. Check browser console for errors

### **Sync Errors**

1. Verify all API keys in `.env` file
2. Check service account permissions
3. Ensure Google Sheet is shared correctly
4. Check terminal logs for specific errors

## 🎯 **Next Steps After Testing**

1. **Test locally** with real calendar data
2. **Verify sync functionality** works properly
3. **Check Google Sheet** gets populated
4. **Deploy to production** using `DEPLOYMENT_GUIDE.md`
5. **Set up automated sync** every 6 hours

## ✅ **Success Indicators**

Your dashboard is working correctly when you see:

- ✅ Page loads at <http://localhost:3000>
- ✅ "Sync Now" button triggers sync process
- ✅ Contact statistics update after sync
- ✅ Google Sheet gets populated with data
- ✅ AI analysis provides meaningful contact insights

Enjoy your AI-powered funding CRM dashboard! 🚀
