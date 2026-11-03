# 🚀 AWS S3 & Deployment Guide: Olive's 30th Birthday Vault

This guide walks you through setting up your **AWS S3 bucket** to store all photos in original quality, keeping costs at **\$0.00 (AWS Free Tier)**, and deploying the app.

---

## 1. Create Your AWS S3 Bucket

1. Log into your **AWS Management Console** at [aws.amazon.com](https://aws.amazon.com/).
2. In the top search bar, type **S3** and click **S3**.
3. Click the orange **Create bucket** button:
   * **Bucket name**: Choose a globally unique name, e.g.: `olives-30th-birthday-vault-2026`
   * **AWS Region**: Select the region closest to you (e.g. `us-east-1` or `eu-west-1`).
   * **Block Public Access settings for this bucket**: 
     * Leave "Block *all* public access" **checked (ON)** for complete privacy. The server securely communicates with S3 using private AWS credentials so random internet users cannot access your bucket directly.
   * **Bucket Versioning**: Keep Disabled (saves storage).
   * **Default encryption**: Amazon S3 managed keys (SSE-S3) (Free).
4. Click **Create bucket** at the bottom.

---

## 2. Create IAM Credentials for the App

To allow this app to save photos into your S3 bucket without exposing your main root AWS account:

1. Search for **IAM** in the top search bar.
2. Click **Users** on the left menu, then click **Create user**.
3. Name it: `olive-vault-uploader`.
4. Click **Next** (do NOT check console access).
5. On the *Set permissions* screen:
   * Select **Attach policies directly**.
   * Search for `AmazonS3FullAccess` (or create a custom policy restricted only to your bucket).
   * Check the box next to `AmazonS3FullAccess`.
6. Click **Next**, then **Create user**.
7. Click on the newly created user `olive-vault-uploader`.
8. Go to the **Security credentials** tab.
9. Scroll down to **Access keys** and click **Create access key**:
   * Select **Application running outside AWS** (or Other).
   * Click **Next**, then **Create access key**.
10. Copy your **Access Key ID** and **Secret Access Key**.

---

## 3. Configure Your `.env` File

Open the `.env` file in `C:\Users\HP\Desktop\olive's deliverables\.env` and update:

```env
PORT=3000
FAMILY_PIN=3030
MAX_STORAGE_MB=5000
STORAGE_MODE=s3

# Paste your AWS credentials here:
AWS_ACCESS_KEY_ID=AKIA...YOUR_ACCESS_KEY...
AWS_SECRET_ACCESS_KEY=your_secret_access_key...
AWS_REGION=us-east-1
S3_BUCKET_NAME=olives-30th-birthday-vault-2026
```

---

## 4. Cost Breakdown (Why this is practically FREE)

* **AWS Free Tier (First 12 Months):**
  * **5 GB of S3 Standard Storage**: 100% Free.
  * **20,000 GET requests** (viewing photos): 100% Free.
  * **2,000 PUT requests** (uploading photos): 100% Free.
* **Even without Free Tier:**
  * 5 GB of standard S3 storage is only **\$0.11 / month**.
  * 600 photo uploads cost less than **\$0.01**.
  * Total project cost on S3: **Less than 15 cents**.

---

## 5. Hosting & Deployment Options

When you are ready to make the link public so guests can access it via phone from the hotel:

### Option A: Free Cloud Hosting (Recommended & Instant)
You can deploy this project in 2 minutes on **Render.com** or **Railway.app** (Free tier):
1. Push this folder to your GitHub repo.
2. On Render/Railway, click **New Web Service** and connect the repo.
3. Add your environment variables (`STORAGE_MODE=s3`, `AWS_ACCESS_KEY_ID`, etc.).
4. You will get a live secure URL: `https://olives-30th-birthday.onrender.com`.

### Option B: Deploy Directly on AWS (App Runner)
1. In the AWS Console, search for **AWS App Runner**.
2. Connect your code repository.
3. App Runner automatically provisions an HTTPS endpoint and auto-scales with zero server maintenance.

---

## 6. Getting the QR Code for the Invitation Card

1. Start the server and visit `http://localhost:3000/qr-generator.html` (or your live deployed link).
2. Enter your final domain in the URL box.
3. Click **Download High-Res PNG**.
4. Send the downloaded image to Olive or whoever is designing the hotel invitation cards!
