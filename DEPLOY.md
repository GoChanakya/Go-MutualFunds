# Deploying GoMutualFunds

Run these in **Google Cloud Shell** (bash) — it avoids Windows quoting issues and is already logged in.
Everything runs in **asia-south1 (Mumbai)**.

```bash
PROJECT=gochanakya-main          # Cloud Run, buckets, Gemini
FB_PROJECT=go-mutualfunds               # Firebase / Firestore (users)
REGION=asia-south1
SERVING=gomf-serving             # new bucket for this product
IMAGE=$REGION-docker.pkg.dev/$PROJECT/gomf/app
```

## 1. Firebase project + Firestore (console, once)
1. https://console.firebase.google.com → **Add project** → name `Go-MutualFunds` (project ID: `go-mutualfunds`).
2. **Build → Firestore Database → Create database** → **Native mode**, location **asia-south1 (Mumbai)**.
   ⚠️ The location can never be changed later.
3. **Rules** tab → paste the contents of `firestore.rules` (deny all client access) → **Publish**.

## 2. Serving bucket (private)
```bash
gcloud storage buckets create gs://$SERVING --project=$PROJECT --location=$REGION \
  --uniform-bucket-level-access --public-access-prevention
# delete old builds after 14 days (the app only reads the one manifest.json points to)
cat > /tmp/lifecycle.json <<'J'
{"rule":[{"action":{"type":"Delete"},"condition":{"age":14,"matchesPrefix":["serving/2"]}}]}
J
gcloud storage buckets update gs://$SERVING --lifecycle-file=/tmp/lifecycle.json
```

## 3. Service accounts (least privilege)
```bash
gcloud iam service-accounts create gomf-app --project=$PROJECT --display-name="GoMF app"
gcloud iam service-accounts create gomf-builder --project=$PROJECT --display-name="GoMF data builder"
gcloud iam service-accounts create gomf-scheduler --project=$PROJECT --display-name="GoMF scheduler"
APP_SA=gomf-app@$PROJECT.iam.gserviceaccount.com
BUILDER_SA=gomf-builder@$PROJECT.iam.gserviceaccount.com
SCHED_SA=gomf-scheduler@$PROJECT.iam.gserviceaccount.com

# builder: read origin data, write serving bucket
gcloud storage buckets add-iam-policy-binding gs://mf-data-public --member=serviceAccount:$BUILDER_SA --role=roles/storage.objectViewer
gcloud storage buckets add-iam-policy-binding gs://$SERVING --member=serviceAccount:$BUILDER_SA --role=roles/storage.objectAdmin

# app: read serving bucket, call Gemini, use Firestore in the Firebase project
gcloud storage buckets add-iam-policy-binding gs://$SERVING --member=serviceAccount:$APP_SA --role=roles/storage.objectViewer
gcloud projects add-iam-policy-binding $PROJECT --member=serviceAccount:$APP_SA --role=roles/aiplatform.user
gcloud projects add-iam-policy-binding $FB_PROJECT --member=serviceAccount:$APP_SA --role=roles/datastore.user
```

## 4. Session secret
```bash
gcloud services enable secretmanager.googleapis.com --project=$PROJECT
openssl rand -base64 48 | gcloud secrets create gomf-session-secret --project=$PROJECT --data-file=-
gcloud secrets add-iam-policy-binding gomf-session-secret --project=$PROJECT --member=serviceAccount:$APP_SA --role=roles/secretmanager.secretAccessor
```

## 5. Build the image
Upload this folder to Cloud Shell (or `git clone` the repo), then:
```bash
gcloud services enable artifactregistry.googleapis.com cloudbuild.googleapis.com --project=$PROJECT
gcloud artifacts repositories create gomf --repository-format=docker --location=$REGION --project=$PROJECT
gcloud builds submit --tag $IMAGE:v1 --project=$PROJECT --region=$REGION
```

## 6. Data builder job (+ first run)
```bash
gcloud run jobs create gomf-builder --image=$IMAGE:v1 --region=$REGION --project=$PROJECT \
  --service-account=$BUILDER_SA --command=npx --args=tsx,scripts/build-serving.ts \
  --set-env-vars=SERVING_BUCKET=$SERVING --memory=2Gi --cpu=1 --task-timeout=10m --max-retries=1
gcloud run jobs execute gomf-builder --region=$REGION --project=$PROJECT --wait
gcloud storage cat gs://$SERVING/serving/manifest.json      # should show build_id, counts, nav date
```

## 7. Run it daily (02:30 IST, after upstream pipelines finish ~01:00 IST)
```bash
gcloud services enable cloudscheduler.googleapis.com --project=$PROJECT
gcloud run jobs add-iam-policy-binding gomf-builder --region=$REGION --project=$PROJECT --member=serviceAccount:$SCHED_SA --role=roles/run.invoker
gcloud scheduler jobs create http gomf-builder-daily --location=$REGION --project=$PROJECT \
  --schedule="30 2 * * *" --time-zone="Asia/Kolkata" --http-method=POST \
  --uri="https://run.googleapis.com/v2/projects/$PROJECT/locations/$REGION/jobs/gomf-builder:run" \
  --oauth-service-account-email=$SCHED_SA
```

## 8. Deploy the app
```bash
gcloud run deploy gomf-app --image=$IMAGE:v1 --region=$REGION --project=$PROJECT \
  --service-account=$APP_SA --allow-unauthenticated \
  --set-env-vars=SERVING_BUCKET=$SERVING,FIRESTORE_PROJECT=$FB_PROJECT,GOOGLE_CLOUD_PROJECT=$PROJECT,GOOGLE_CLOUD_LOCATION=$REGION,PARSER=gemini \
  --set-secrets=SESSION_SECRET=gomf-session-secret:latest \
  --memory=1Gi --cpu=1 --min-instances=0 --max-instances=3 --concurrency=40 --timeout=30 --cpu-boost
```
`--max-instances=3` caps the bill if someone floods the site. Raise it when real traffic grows.

## 9. Budget alerts (console)
Billing → Budgets & alerts → create a budget on `gochanakya-main` with alerts at ₹2,000 / ₹5,000 / ₹10,000.

## 10. Give someone Pro (until payments exist)
They must sign in once first. From this folder on your laptop (uses your gcloud login):
```bash
FIRESTORE_PROJECT=go-mutualfunds npx tsx --conditions=react-server scripts/set-plan.ts 9876543210 pro 30
```

## Updating later
```bash
gcloud builds submit --tag $IMAGE:v2 --project=$PROJECT --region=$REGION
gcloud run deploy gomf-app --image=$IMAGE:v2 --region=$REGION --project=$PROJECT
gcloud run jobs update gomf-builder --image=$IMAGE:v2 --region=$REGION --project=$PROJECT
```
