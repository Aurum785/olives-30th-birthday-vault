const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { S3Client, ListObjectsV2Command, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');

async function testS3() {
  console.log('Testing S3 connection...');
  console.log('Bucket:', process.env.S3_BUCKET_NAME);
  console.log('Region:', process.env.AWS_REGION);
  console.log('AccessKeyId prefix:', process.env.AWS_ACCESS_KEY_ID ? process.env.AWS_ACCESS_KEY_ID.substring(0, 8) + '...' : 'NONE');

  const s3 = new S3Client({
    region: process.env.AWS_REGION,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }
  });

  try {
    // 1. List bucket contents
    const listRes = await s3.send(new ListObjectsV2Command({ Bucket: process.env.S3_BUCKET_NAME, MaxKeys: 5 }));
    console.log('SUCCESS: Connected to S3 bucket!');
    console.log('Current object count:', listRes.KeyCount || 0);

    // 2. Put a tiny test file
    const testKey = `test-connection-${Date.now()}.txt`;
    await s3.send(new PutObjectCommand({
      Bucket: process.env.S3_BUCKET_NAME,
      Key: testKey,
      Body: 'Olive 30th Birthday S3 Connection Verified',
      ContentType: 'text/plain'
    }));
    console.log('SUCCESS: Successfully uploaded test file to S3:', testKey);

    // 3. Clean up the test file
    await s3.send(new DeleteObjectCommand({
      Bucket: process.env.S3_BUCKET_NAME,
      Key: testKey
    }));
    console.log('SUCCESS: Successfully cleaned up test file from S3.');
    console.log('ALL S3 CHECKS PASSED PERFECTLY! 🎉');
  } catch (err) {
    console.error('S3 Connection Error:', err.message);
    process.exit(1);
  }
}

testS3();
