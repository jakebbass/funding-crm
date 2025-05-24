#!/bin/bash

# Funding CRM Setup Script
# This script sets up the required Google Cloud resources

set -e

echo "🔧 Funding CRM Setup Script"
echo "==========================="

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

# Prompt for required information
read -p "📝 Enter your Google Sheet ID: " GOOGLE_SHEET_ID
read -p "🔑 Enter your OpenAI API key (or press Enter to skip): " OPENAI_API_KEY
read -p "🔑 Enter your Gemini API key (or press Enter to skip): " GEMINI_API_KEY
read -p "🔑 Enter your Fireflies.ai API key: " FIREFLIES_API_KEY

if [ -z "$OPENAI_API_KEY" ] && [ -z "$GEMINI_API_KEY" ]; then
    echo "❌ You must provide either OpenAI or Gemini API key"
    exit 1
fi

if [ -z "$FIREFLIES_API_KEY" ]; then
    echo "❌ Fireflies.ai API key is required"
    exit 1
fi

echo "🔧 Enabling required APIs..."
gcloud services enable run.googleapis.com
gcloud services enable cloudbuild.googleapis.com
gcloud services enable sheets.googleapis.com
gcloud services enable calendar.googleapis.com
gcloud services enable secretmanager.googleapis.com
gcloud services enable cloudscheduler.googleapis.com

echo "👤 Creating service account..."
SERVICE_ACCOUNT_NAME="funding-crm-sa"
SERVICE_ACCOUNT_EMAIL="${SERVICE_ACCOUNT_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"

# Check if service account already exists
if gcloud iam service-accounts describe $SERVICE_ACCOUNT_EMAIL &> /dev/null; then
    echo "ℹ️  Service account already exists: $SERVICE_ACCOUNT_EMAIL"
else
    gcloud iam service-accounts create $SERVICE_ACCOUNT_NAME \
        --description="Service account for Funding CRM" \
        --display-name="Funding CRM Service Account"
fi

echo "🔐 Granting permissions..."
gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:${SERVICE_ACCOUNT_EMAIL}" \
    --role="roles/sheets.editor"

gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:${SERVICE_ACCOUNT_EMAIL}" \
    --role="roles/calendar.readonly"

echo "🔑 Creating service account key..."
KEY_FILE="service-account-key.json"
gcloud iam service-accounts keys create $KEY_FILE \
    --iam-account=$SERVICE_ACCOUNT_EMAIL

# Extract private key from the JSON file
PRIVATE_KEY=$(cat $KEY_FILE | jq -r .private_key)

echo "🔒 Storing secrets in Secret Manager..."

# Store private key
echo "$PRIVATE_KEY" | gcloud secrets create google-private-key --data-file=-

# Store API keys
if [ ! -z "$OPENAI_API_KEY" ]; then
    echo -n "$OPENAI_API_KEY" | gcloud secrets create openai-api-key --data-file=-
fi

if [ ! -z "$GEMINI_API_KEY" ]; then
    echo -n "$GEMINI_API_KEY" | gcloud secrets create gemini-api-key --data-file=-
fi

echo -n "$FIREFLIES_API_KEY" | gcloud secrets create fireflies-api-key --data-file=-

# Generate CRON secret
CRON_SECRET=$(openssl rand -base64 32)
echo -n "$CRON_SECRET" | gcloud secrets create cron-secret --data-file=-

echo "📄 Creating .env file for local development..."
cat > .env << EOF
# Google Sheets Configuration
GOOGLE_SHEET_ID=$GOOGLE_SHEET_ID
GOOGLE_SERVICE_EMAIL=$SERVICE_ACCOUNT_EMAIL
GOOGLE_PRIVATE_KEY="$PRIVATE_KEY"

# AI Configuration
EOF

if [ ! -z "$OPENAI_API_KEY" ]; then
    echo "OPENAI_API_KEY=$OPENAI_API_KEY" >> .env
fi

if [ ! -z "$GEMINI_API_KEY" ]; then
    echo "GEMINI_API_KEY=$GEMINI_API_KEY" >> .env
fi

cat >> .env << EOF

# Meeting Transcripts
FIREFLIES_API_KEY=$FIREFLIES_API_KEY

# Security
CRON_SECRET=$CRON_SECRET

# Optional: For manual sync testing
NEXT_PUBLIC_CRON_SECRET=$CRON_SECRET
EOF

# Set environment variables for deployment
export GOOGLE_SHEET_ID
export GOOGLE_SERVICE_EMAIL=$SERVICE_ACCOUNT_EMAIL
export CRON_SECRET

echo ""
echo "✅ Setup completed successfully!"
echo "================================"
echo "📧 Service Account Email: $SERVICE_ACCOUNT_EMAIL"
echo "📊 Google Sheet ID: $GOOGLE_SHEET_ID"
echo "🔑 CRON Secret: $CRON_SECRET"
echo ""
echo "📝 Next Steps:"
echo "1. Share your Google Sheet with: $SERVICE_ACCOUNT_EMAIL"
echo "   - Give it 'Editor' permissions"
echo "   - Create 'Contacts' and 'Sync' sheets in your document"
echo "2. Run './deploy.sh' to deploy the application"
echo "3. Clean up the service account key file: rm $KEY_FILE"
echo ""
echo "🔧 For local development:"
echo "1. npm install"
echo "2. npm run dev"
echo ""
