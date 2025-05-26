# 🚀 Funding CRM - Google Cloud Platform Deployment Guide

This guide walks you through deploying your funding CRM application to Google Cloud Platform using Cloud Run.

## 📋 Prerequisites

1. **Google Cloud Platform Account** with billing enabled
2. **gcloud CLI** installed and authenticated
3. **Docker** installed (for local testing)
4. **Project created** in GCP console

## 🔧 Step 1: Initial GCP Setup

### 1.1 Set your project ID
```bash
export PROJECT_ID="your-project-id"
gcloud config set project $PROJECT_ID
```

### 1.2 Enable required APIs
```bash
# Run the automated setup script
chmod +x setup.sh
./setup.sh

# OR manually enable APIs:
gcloud services enable cloudbuild.googleapis.com
gcloud services enable run.googleapis.com
gcloud services enable sheets.googleapis.com
gcloud services enable calendar-json.googleapis.com
gcloud services enable artifactregistry.googleapis.com
```

### 1.3 Create Artifact Registry repository
```bash
gcloud artifacts repositories create funding-crm \
    --repository-format=docker \
    --location=us-central1 \
    --description="Funding CRM Docker repository"
```

## 🔐 Step 2: Google Service Account Setup

### 2.1 Create service account
```bash
gcloud iam service-accounts create funding-crm-service \
    --display-name="Funding CRM Service Account" \
    --description="Service account for funding CRM application"
```

### 2.2 Grant necessary permissions
```bash
# Service account email
SERVICE_EMAIL="funding-crm-service@$PROJECT_ID.iam.gserviceaccount.com"

# Grant required roles
gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:$SERVICE_EMAIL" \
    --role="roles/sheets.editor"

gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:$SERVICE_EMAIL" \
    --role="roles/calendar.readonly"
```

### 2.3 Create and download service account key
```bash
gcloud iam service-accounts keys create service-account.json \
    --iam-account=$SERVICE_EMAIL
```

### 2.4 Extract credentials for environment variables
```bash
# Get the service account email
cat service-account.json | jq -r '.client_email'

# Get the private key (will need to be formatted for env var)
cat service-account.json | jq -r '.private_key'
```

## 📊 Step 3: Google Sheets Setup

### 3.1 Create Google Sheet
1. Go to [Google Sheets](https://sheets.google.com)
2. Create a new spreadsheet named "Funding CRM"
3. Create two sheets: "Contacts" and "Sync"

### 3.2 Set up Contacts sheet headers
In the "Contacts" sheet, add these headers in row 1:
- A1: Name
- B1: Email  
- C1: Status
- D1: Next Step
- E1: Notes
- F1: Last Meeting
- G1: Created At

### 3.3 Set up Sync sheet
In the "Sync" sheet, add:
- A1: Last Sync
- B1: (leave empty - will be populated by app)

### 3.4 Share with service account
1. Get your service account email from step 2.4
2. Share the Google Sheet with that email address
3. Give it "Editor" permissions
4. Copy the Sheet ID from the URL (between `/d/` and `/edit`)

## 🔐 Step 4: Environment Variables Setup

### 4.1 Prepare your environment variables
Create a file called `env-vars.txt` with your actual values:

```bash
# Google Sheets
GOOGLE_SHEET_ID=your_sheet_id_here
GOOGLE_SERVICE_EMAIL=funding-crm-service@your-project.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYour_private_key_here\n-----END PRIVATE KEY-----"

# AI APIs (choose one)
OPENAI_API_KEY=your_openai_api_key_here
# OR
GEMINI_API_KEY=your_gemini_api_key_here

# Fireflies.ai
FIREFLIES_API_KEY=your_fireflies_api_key_here

# Security
CRON_SECRET=your_secure_random_string_here
```

**Important**: Format the private key properly by replacing actual line breaks with `\n`

## 🐳 Step 5: Build and Deploy to Cloud Run

### 5.1 Build using Cloud Build
```bash
# Submit build to Cloud Build
gcloud builds submit --config cloudbuild.yaml \
    --substitutions=_PROJECT_ID=$PROJECT_ID
```

### 5.2 Deploy to Cloud Run
```bash
# Deploy with environment variables
gcloud run deploy funding-crm \
    --image us-central1-docker.pkg.dev/$PROJECT_ID/funding-crm/funding-crm:latest \
    --platform managed \
    --region us-central1 \
    --allow-unauthenticated \
    --set-env-vars="$(cat env-vars.txt | tr '\n' ',')"
```

### 5.3 Alternative: Use automated deployment script
```bash
# Make script executable and run
chmod +x deploy.sh
./deploy.sh
```

## ⏰ Step 6: Set Up Cloud Scheduler (Automated Sync)

### 6.1 Enable Cloud Scheduler API
```bash
gcloud services enable cloudscheduler.googleapis.com
```

### 6.2 Get your Cloud Run service URL
```bash
gcloud run services describe funding-crm \
    --platform managed \
    --region us-central1 \
    --format 'value(status.url)'
```

### 6.3 Create scheduled job
```bash
# Replace YOUR_SERVICE_URL with the URL from step 6.2
# Replace YOUR_CRON_SECRET with your actual secret

gcloud scheduler jobs create http funding-crm-sync \
    --schedule="0 */6 * * *" \
    --uri="YOUR_SERVICE_URL/api/sync" \
    --http-method=POST \
    --headers="Content-Type=application/json,x-cron-secret=YOUR_CRON_SECRET" \
    --message-body='{"cronSecret":"YOUR_CRON_SECRET"}' \
    --location=us-central1
```

## 🧪 Step 7: Test Your Deployment

### 7.1 Test the application
```bash
# Get your service URL
SERVICE_URL=$(gcloud run services describe funding-crm --platform managed --region us-central1 --format 'value(status.url)')

# Test the main dashboard
curl $SERVICE_URL

# Test the contacts API
curl $SERVICE_URL/api/contacts

# Test the sync API (replace with your CRON_SECRET)
curl -X POST $SERVICE_URL/api/sync \
    -H "Content-Type: application/json" \
    -H "x-cron-secret: YOUR_CRON_SECRET" \
    -d '{"cronSecret":"YOUR_CRON_SECRET"}'
```

### 7.2 Monitor logs
```bash
# View Cloud Run logs
gcloud logs tail "resource.type=cloud_run_revision" --limit=50
```

## 🔧 Step 8: Optional Customizations

### 8.1 Set up custom domain
```bash
gcloud run domain-mappings create \
    --service funding-crm \
    --domain your-domain.com \
    --region us-central1
```

### 8.2 Configure scaling
```bash
gcloud run services update funding-crm \
    --min-instances=0 \
    --max-instances=10 \
    --concurrency=80 \
    --region us-central1
```

## 📊 Step 9: Monitoring and Maintenance

### 9.1 Set up monitoring
- Go to Cloud Console > Cloud Run > funding-crm
- Set up alerts for errors, latency, and resource usage

### 9.2 View application
Your application will be available at the Cloud Run service URL from step 6.2

## 🚨 Troubleshooting

### Common Issues:

1. **Authentication errors**: Check service account permissions and private key formatting
2. **API quota errors**: Verify APIs are enabled in your project  
3. **Build failures**: Check Dockerfile and dependencies
4. **Sheet access errors**: Verify sheet is shared with service account email

### Debug commands:
```bash
# Check service status
gcloud run services describe funding-crm --region us-central1

# View detailed logs
gcloud logs read "resource.type=cloud_run_revision" --limit=100 --format="table(timestamp,severity,textPayload)"

# Check environment variables
gcloud run services describe funding-crm --region us-central1 --format="export" | grep env
```

## ✅ Success!

Your funding CRM application is now deployed and running on Google Cloud Platform with:
- ✅ Automatic scaling with Cloud Run
- ✅ Scheduled sync every 6 hours
- ✅ Secure authentication with service accounts
- ✅ AI-powered meeting analysis
- ✅ Production-ready monitoring

Visit your Cloud Run service URL to access your funding CRM dashboard!
