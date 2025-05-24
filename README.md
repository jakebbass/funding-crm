# Funding CRM - AI-Powered Investor Relationship Management

A production-ready web application deployed on Google Cloud Platform that automatically syncs calendar events, meeting transcripts, and contact data to provide AI-powered insights for investor relationships.

## 🔧 Tech Stack

- **Frontend**: Next.js 14 with React 18+
- **Backend**: Next.js API Routes (serverless functions)
- **Hosting**: Google Cloud Run (containerized)
- **Database**: Google Sheets (as CRM backend)
- **AI**: OpenAI GPT-4 or Google Gemini Pro
- **Build**: Docker + Cloud Build
- **Scheduling**: Google Cloud Scheduler

## 🚀 Features

- **Automated Data Sync**: Pulls calendar events and meeting transcripts every 6 hours
- **AI Analysis**: Automatically analyzes meeting transcripts to extract:
  - Investment status
  - Next steps
  - Key insights and notes
- **Real-time Dashboard**: Beautiful web interface with contact management
- **Secure API**: Protected endpoints with CRON_SECRET authentication
- **Auto-scaling**: Cloud Run automatically scales based on traffic
- **Production Ready**: Optimized Docker containers with health checks

## 📋 Prerequisites

1. **Google Cloud Platform Account** with billing enabled
2. **Google Cloud CLI** installed and configured
3. **Google Sheets** for CRM data storage
4. **Service Account** with appropriate permissions
5. **API Keys** for OpenAI/Gemini and Fireflies.ai

## 🛠️ Setup Instructions

### Step 1: Enable Google Cloud APIs

```bash
# Set your project ID
export PROJECT_ID="your-project-id"
gcloud config set project $PROJECT_ID

# Enable required APIs
gcloud services enable run.googleapis.com
gcloud services enable cloudbuild.googleapis.com
gcloud services enable sheets.googleapis.com
gcloud services enable calendar.googleapis.com
gcloud services enable secretmanager.googleapis.com
gcloud services enable cloudscheduler.googleapis.com
```

### Step 2: Create Service Account

```bash
# Create service account
gcloud iam service-accounts create funding-crm-sa \
    --description="Service account for Funding CRM" \
    --display-name="Funding CRM Service Account"

# Get the service account email
export SERVICE_ACCOUNT_EMAIL="funding-crm-sa@${PROJECT_ID}.iam.gserviceaccount.com"

# Grant necessary permissions
gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:${SERVICE_ACCOUNT_EMAIL}" \
    --role="roles/sheets.editor"

gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:${SERVICE_ACCOUNT_EMAIL}" \
    --role="roles/calendar.readonly"

# Create and download service account key
gcloud iam service-accounts keys create ./service-account-key.json \
    --iam-account=$SERVICE_ACCOUNT_EMAIL
```

### Step 3: Set Up Google Sheets

1. Create a new Google Sheet
2. Share it with your service account email (found in the JSON key file)
3. Create two sheets within the document:
   - **Contacts** (for CRM data)
   - **Sync** (for tracking sync timestamps)
4. Copy the Sheet ID from the URL

### Step 4: Store Secrets in Secret Manager

```bash
# Store API keys and sensitive data
gcloud secrets create google-private-key --data-file=<(cat service-account-key.json | jq -r .private_key)
gcloud secrets create openai-api-key --data-file=<(echo -n "your-openai-api-key")
gcloud secrets create fireflies-api-key --data-file=<(echo -n "your-fireflies-api-key")

# Generate a secure CRON secret
export CRON_SECRET=$(openssl rand -base64 32)
echo $CRON_SECRET
```

### Step 5: Deploy to Cloud Run

```bash
# Clone and enter the project directory
git clone <your-repo-url>
cd funding-crm

# Deploy using Cloud Build
gcloud builds submit --config cloudbuild.yaml \
    --substitutions=_GOOGLE_SHEET_ID="your-sheet-id",_GOOGLE_SERVICE_EMAIL="$SERVICE_ACCOUNT_EMAIL",_CRON_SECRET="$CRON_SECRET"
```

### Alternative: Manual Deployment

```bash
# Build and deploy manually
gcloud run deploy funding-crm \
    --source . \
    --region us-central1 \
    --allow-unauthenticated \
    --port 3000 \
    --memory 1Gi \
    --cpu 1 \
    --min-instances 0 \
    --max-instances 10 \
    --set-env-vars NODE_ENV=production,GOOGLE_SHEET_ID="your-sheet-id",GOOGLE_SERVICE_EMAIL="$SERVICE_ACCOUNT_EMAIL",CRON_SECRET="$CRON_SECRET" \
    --set-secrets GOOGLE_PRIVATE_KEY=google-private-key:latest,OPENAI_API_KEY=openai-api-key:latest,FIREFLIES_API_KEY=fireflies-api-key:latest
```

### Step 6: Set Up Cloud Scheduler

```bash
# Get your Cloud Run service URL
export SERVICE_URL=$(gcloud run services describe funding-crm --region=us-central1 --format="value(status.url)")

# Create Cloud Scheduler job (runs every 6 hours)
gcloud scheduler jobs create http sync-funding-crm \
    --schedule="0 */6 * * *" \
    --uri="${SERVICE_URL}/api/sync" \
    --http-method=POST \
    --headers="Content-Type=application/json,x-cron-secret=$CRON_SECRET" \
    --location=us-central1 \
    --description="Sync funding CRM data every 6 hours"
```

## 🔐 Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `GOOGLE_SHEET_ID` | Google Sheets document ID | ✅ |
| `GOOGLE_SERVICE_EMAIL` | Service account email | ✅ |
| `GOOGLE_PRIVATE_KEY` | Service account private key | ✅ |
| `OPENAI_API_KEY` | OpenAI API key (for GPT-4) | ✅* |
| `GEMINI_API_KEY` | Google Gemini API key | ✅* |
| `FIREFLIES_API_KEY` | Fireflies.ai API key | ✅ |
| `CRON_SECRET` | Secret for protecting sync endpoint | ✅ |

*Either OpenAI or Gemini API key is required

## 📊 API Endpoints

### `GET /`
Dashboard homepage with contact management interface

### `GET /api/contacts`
Returns all contacts from Google Sheets
```json
{
  "contacts": [...],
  "lastSync": "2024-01-01T00:00:00.000Z",
  "total": 25
}
```

### `POST /api/sync`
Triggers data synchronization (protected by CRON_SECRET)
```bash
curl -X POST https://your-app.run.app/api/sync \
  -H "Content-Type: application/json" \
  -H "x-cron-secret: your-cron-secret"
```

## 🔄 How It Works

1. **Calendar Sync**: Scans last 60 days for meetings with investor-related keywords
2. **Contact Extraction**: Extracts attendee emails and creates/updates contact records
3. **Transcript Analysis**: Fetches meeting transcripts from Fireflies.ai
4. **AI Processing**: Uses GPT-4/Gemini to analyze transcripts and extract:
   - Investment status (Interested, Follow-up, Rejected, etc.)
   - Next steps
   - Key insights and notes
5. **Data Storage**: Updates Google Sheets with enriched contact data
6. **Dashboard**: Displays real-time analytics and contact management

## 🏗️ Project Structure

```
funding-crm/
├── pages/
│   ├── index.js              # Dashboard homepage
│   ├── _app.js               # Next.js app wrapper
│   └── api/
│       ├── sync.js           # Main sync logic
│       └── contacts.js       # Contact data API
├── styles/
│   └── globals.css           # Global styles with Tailwind
├── public/                   # Static assets
├── Dockerfile                # Container configuration
├── cloudbuild.yaml          # Cloud Build configuration
├── next.config.js           # Next.js configuration
├── tailwind.config.js       # Tailwind CSS configuration
└── package.json             # Dependencies and scripts
```

## 🔍 Monitoring & Logs

View application logs:
```bash
gcloud logs read "resource.type=cloud_run_revision" --limit=50
```

Monitor Cloud Run metrics:
```bash
gcloud run services describe funding-crm --region=us-central1
```

## 🛡️ Security Features

- **CRON_SECRET**: Protects sync endpoint from unauthorized access
- **Service Account**: Limited permissions for Google APIs
- **Secret Manager**: Secure storage for API keys and sensitive data
- **HTTPS**: All traffic encrypted via Cloud Run
- **Container Security**: Non-root user in Docker container

## 🚨 Troubleshooting

### Common Issues

1. **Authentication Errors**
   - Verify service account has correct permissions
   - Check if Google Sheets is shared with service account email

2. **API Rate Limits**
   - Fireflies.ai and OpenAI have rate limits
   - Consider implementing exponential backoff

3. **Memory Issues**
   - Increase Cloud Run memory allocation if processing large transcripts
   - Monitor logs for out-of-memory errors

4. **Sync Failures**
   - Check Cloud Scheduler logs
   - Verify CRON_SECRET matches between scheduler and application

### Debug Commands

```bash
# Check service status
gcloud run services list

# View recent logs
gcloud logs tail "resource.type=cloud_run_revision" --log-filter="resource.labels.service_name=funding-crm"

# Test sync endpoint locally
curl -X POST http://localhost:3000/api/sync \
  -H "Content-Type: application/json" \
  -H "x-cron-secret: your-secret"
```

## 📈 Scaling Considerations

- **Auto-scaling**: Cloud Run automatically scales 0-10 instances
- **Memory**: Increase for large transcript processing
- **CPU**: 1 vCPU sufficient for most workloads
- **Timeout**: 300s timeout for long-running sync operations

## 🔄 Updates & Maintenance

To update the application:

```bash
# Update code
git pull origin main

# Redeploy
gcloud builds submit --config cloudbuild.yaml
```

## 📝 License

This project is licensed under the MIT License.

## 🤝 Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

**Built with ❤️ for efficient investor relationship management**
