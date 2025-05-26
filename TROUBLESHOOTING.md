# 🚨 Troubleshooting Guide - Fix Sync Issues

Based on the error logs, here are the specific issues and how to fix them:

## ❌ **Current Issues Identified**

1. **Google Sheets Error**: `Unable to parse range: Contacts!A:G`
2. **Sync Authentication**: CRON_SECRET mismatch when clicking "Sync Now"
3. **Server Port**: Running on port 3001 instead of 3000

## 🔧 **Fix 1: Set Up Google Sheet Correctly**

### Step 1: Open Your Google Sheet

1. Go to: <https://docs.google.com/spreadsheets/d/1_la4y2U7QrBjNxG5ZNLwUQ6nECnfQenqku5vF68i4No/edit>
2. If you can't access it, create a new sheet and update the GOOGLE_SHEET_ID in .env

### Step 2: Create Required Tabs

Your sheet needs exactly these two tabs:

**Tab 1: "Contacts"** (rename Sheet1 if needed)

- Right-click on tab at bottom → Rename to "Contacts"
- Add these headers in row 1:
  - A1: Name
  - B1: Email
  - C1: Status
  - D1: Next Step
  - E1: Notes
  - F1: Last Meeting
  - G1: Created At

### Tab 2: "Sync"

- Click "+" at bottom to add new sheet
- Rename to "Sync"
- Add headers in row 1:
  - A1: Last Sync
  - B1: (leave empty)

### Step 3: Share with Service Account

1. Click "Share" button in top right
2. Add this email: `id-crm-autopilot-service@crm-autopilot.iam.gserviceaccount.com`
3. Give it "Editor" permissions
4. Click "Send"

## 🔧 **Fix 2: Update Frontend to Send CRON_SECRET**

The frontend needs to send the CRON_SECRET when clicking "Sync Now":

### Update the dashboard sync function

1. Open your browser at: <http://localhost:3001> (note: port 3001, not 3000)
2. Open browser developer tools (F12)
3. The sync button should work after the sheet fixes

## 🔧 **Fix 3: Test Individual Components**

### Test Google Sheets Access

```bash
# Test contacts API directly
curl http://localhost:3001/api/contacts
```

### Test Sync with correct CRON_SECRET

```bash
# Test sync API with your CRON_SECRET
curl -X POST http://localhost:3001/api/sync \
  -H "Content-Type: application/json" \
  -H "x-cron-secret: jibberjabberlost23" \
  -d '{"cronSecret":"jibberjabberlost23"}'
```

## ✅ **Quick Verification Steps**

### 1. Check Google Sheet Setup

- [ ] Sheet has "Contacts" tab with headers
- [ ] Sheet has "Sync" tab with headers  
- [ ] Service account email has Editor access
- [ ] Sheet ID matches .env file

### 2. Test API Endpoints

- [ ] <http://localhost:3001/api/contacts> returns data (not 500 error)
- [ ] Sync API accepts CRON_SECRET properly
- [ ] No more "Unable to parse range" errors

### 3. Verify Dashboard

- [ ] Dashboard loads at <http://localhost:3001>
- [ ]
