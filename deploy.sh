#!/bin/bash

# Funding CRM Deployment Script
# This script automates the deployment process to Google Cloud Run

set -e

echo "🚀 Funding CRM Deployment Script"
echo "================================="

# Check if gcloud is installed
if ! command -v gcloud &> /dev/null; then
    echo "❌ gcloud CLI is not installed. Please install it first."
    exit 1
fi

# Check if user is logged in
if ! gcloud auth list --filter=status:ACTIVE --format="value(account)" &> /dev/null; then
    echo "❌ Please login to gcloud first: gcloud auth login"
    exit 1
fi

# Get project ID
PROJECT_ID=$(gcloud config get-value project 2>/dev/null)
if [ -z "$PROJECT_ID" ]; then
    echo "❌ No project set. Please set your project: gcloud config set project YOUR_PROJECT_ID"
    exit 1
fi

echo "📋 Using project: $PROJECT_ID"

# Check for required environment variables
if [ -z "$GOOGLE_SHEET_ID" ]; then
    echo "❌ Please set GOOGLE_SHEET_ID environment variable"
    exit 1
fi

if [ -z "$CRON_SECRET" ]; then
    echo "⚠️  CRON_SECRET not set. Generating one..."
    export CRON_SECRET=$(openssl rand -base64 32)
    echo "🔑 Generated CRON_SECRET: $CRON_SECRET"
    echo "💾 Please save this secret for your Cloud Scheduler setup!"
fi

echo "🔧 Enabling required APIs..."
gcloud services enable run.googleapis.com
gcloud services enable cloudbuild.googleapis.com
gcloud services enable sheets.googleapis.com
gcloud services enable calendar.googleapis.com
gcloud services enable secretmanager.googleapis.com
gcloud services enable cloudscheduler.googleapis.com

echo "🏗️  Building and deploying to Cloud Run..."

# Deploy using Cloud Build if cloudbuild.yaml exists
if [ -f "cloudbuild.yaml" ]; then
    echo "📦 Using Cloud Build..."
    gcloud builds submit --config cloudbuild.yaml \
        --substitutions=_GOOGLE_SHEET_ID="$GOOGLE_SHEET_ID",_GOOGLE_SERVICE_EMAIL="$GOOGLE_SERVICE_EMAIL",_CRON_SECRET="$CRON_SECRET"
else
    echo "📦 Using direct deployment..."
    gcloud run deploy funding-crm \
        --source . \
        --region us-central1 \
        --allow-unauthenticated \
        --port 3000 \
        --memory 1Gi \
        --cpu 1 \
        --min-instances 0 \
        --max-instances 10 \
        --set-env-vars "NODE_ENV=production,GOOGLE_SHEET_ID=$GOOGLE_SHEET_ID,GOOGLE_SERVICE_EMAIL=$GOOGLE_SERVICE_EMAIL,CRON_SECRET=$CRON_SECRET" \
        --set-secrets "GOOGLE_PRIVATE_KEY=google-private-key:latest,OPENAI_API_KEY=openai-api-key:latest,FIREFLIES_API_KEY=fireflies-api-key:latest"
fi

# Get service URL
echo "🔍 Getting service URL..."
SERVICE_URL=$(gcloud run services describe funding-crm --region=us-central1 --format="value(status.url)")

echo "✅ Deployment completed!"
echo "🌐 Service URL: $SERVICE_URL"

# Ask if user wants to set up Cloud Scheduler
read -p "🕒 Would you like to set up Cloud Scheduler for automatic syncing? (y/n): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "⏰ Setting up Cloud Scheduler..."
    
    # Check if job already exists
    if gcloud scheduler jobs describe sync-funding-crm --location=us-central1 &> /dev/null; then
        echo "📅 Updating existing scheduler job..."
        gcloud scheduler jobs update http sync-funding-crm \
            --schedule="0 */6 * * *" \
            --uri="${SERVICE_URL}/api/sync" \
            --http-method=POST \
            --headers="Content-Type=application/json,x-cron-secret=$CRON_SECRET" \
            --location=us-central1
    else
        echo "📅 Creating new scheduler job..."
        gcloud scheduler jobs create http sync-funding-crm \
            --schedule="0 */6 * * *" \
            --uri="${SERVICE_URL}/api/sync" \
            --http-method=POST \
            --headers="Content-Type=application/json,x-cron-secret=$CRON_SECRET" \
            --location=us-central1 \
            --description="Sync funding CRM data every 6 hours"
    fi
    
    echo "✅ Cloud Scheduler configured to run every 6 hours"
fi

echo ""
echo "🎉 Deployment Summary"
echo "===================="
echo "✅ Application deployed to Cloud Run"
echo "🌐 URL: $SERVICE_URL"
echo "🔑 CRON_SECRET: $CRON_SECRET"
echo ""
echo "📝 Next Steps:"
echo "1. Share your Google Sheet with the service account email"
echo "2. Test the sync endpoint: curl -X POST $SERVICE_URL/api/sync -H 'x-cron-secret: $CRON_SECRET'"
echo "3. Visit your dashboard: $SERVICE_URL"
echo ""
echo "🔧 Monitor logs: gcloud logs tail \"resource.type=cloud_run_revision\""
echo ""
