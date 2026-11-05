const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const archiver = require('archiver');
const QRCode = require('qrcode');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const {
  S3Client,
  PutObjectCommand,
  ListObjectsV2Command,
  GetObjectCommand,
  HeadObjectCommand
} = require('@aws-sdk/client-s3');

const app = express();
const PORT = process.env.PORT || 3000;
const FAMILY_PIN = (process.env.FAMILY_PIN || '3030').trim();
const MAX_STORAGE_MB = parseInt(process.env.MAX_STORAGE_MB || '5000', 10);
const MAX_STORAGE_BYTES = MAX_STORAGE_MB * 1024 * 1024; // 5 GB default
const STORAGE_MODE = (process.env.STORAGE_MODE || 'local').toLowerCase();

// AWS S3 Client setup
let s3Client = null;
const S3_BUCKET = process.env.S3_BUCKET_NAME || '';
const AWS_REGION = process.env.AWS_REGION || 'us-east-1';

if (STORAGE_MODE === 's3' && process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
  s3Client = new S3Client({
    region: AWS_REGION,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }
  });
}

// Local storage directories
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const METADATA_FILE = path.join(UPLOADS_DIR, 'metadata.json');

if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}
if (!fs.existsSync(METADATA_FILE)) {
  fs.writeFileSync(METADATA_FILE, JSON.stringify([]));
}

// Allowed photo MIME types - STRICTLY NO VIDEOS
const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'image/gif'
]);

// Helper: load local metadata
function loadLocalMetadata() {
  try {
    if (fs.existsSync(METADATA_FILE)) {
      return JSON.parse(fs.readFileSync(METADATA_FILE, 'utf-8'));
    }
  } catch (err) {
    console.error('Error reading metadata.json:', err);
  }
  return [];
}

// Helper: save local metadata
function saveLocalMetadata(data) {
  try {
    fs.writeFileSync(METADATA_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('Error writing metadata.json:', err);
  }
}

// Helper: get all vault photos (reliably from S3 or local)
async function getVaultPhotos() {
  if (STORAGE_MODE === 's3' && s3Client && S3_BUCKET) {
    let s3Meta = [];
    try {
      const getMetaCmd = new GetObjectCommand({
        Bucket: S3_BUCKET,
        Key: 'metadata.json'
      });
      const metaRes = await s3Client.send(getMetaCmd);
      const str = await metaRes.Body.transformToString();
      s3Meta = JSON.parse(str);
    } catch (e) {
      s3Meta = [];
    }

    try {
      let continuationToken = null;
      const existingKeys = new Set(s3Meta.map(m => m.key || `photos/${m.id}`));
      let foundNew = false;

      do {
        const listCmd = new ListObjectsV2Command({
          Bucket: S3_BUCKET,
          Prefix: 'photos/',
          ContinuationToken: continuationToken
        });
        const listRes = await s3Client.send(listCmd);

        if (listRes.Contents) {
          for (const item of listRes.Contents) {
            if (item.Key === 'photos/' || item.Size === 0) continue;

            if (!existingKeys.has(item.Key)) {
              let guestName = 'Anonymous Guest';
              let guestWish = '';
              let originalName = path.basename(item.Key);

              try {
                const headRes = await s3Client.send(new HeadObjectCommand({
                  Bucket: S3_BUCKET,
                  Key: item.Key
                }));
                if (headRes.Metadata) {
                  if (headRes.Metadata.guestname) guestName = decodeURIComponent(headRes.Metadata.guestname);
                  if (headRes.Metadata.guestwish) guestWish = decodeURIComponent(headRes.Metadata.guestwish);
                  if (headRes.Metadata.originalfilename) originalName = decodeURIComponent(headRes.Metadata.originalfilename);
                }
              } catch (err) {
                console.warn('HeadObject failed for', item.Key, err.message);
              }

              const photoId = path.basename(item.Key);
              const rec = {
                id: photoId,
                key: item.Key,
                filename: originalName,
                size: item.Size,
                mimetype: 'image/jpeg',
                guestName,
                guestWish,
                uploadedAt: item.LastModified ? item.LastModified.toISOString() : new Date().toISOString(),
                url: `/api/photo/${photoId}`
              };

              s3Meta.push(rec);
              existingKeys.add(item.Key);
              foundNew = true;
            }
          }
        }
        continuationToken = listRes.NextContinuationToken;
      } while (continuationToken);

      if (foundNew && s3Meta.length > 0) {
        try {
          await s3Client.send(new PutObjectCommand({
            Bucket: S3_BUCKET,
            Key: 'metadata.json',
            Body: JSON.stringify(s3Meta, null, 2),
            ContentType: 'application/json'
          }));
        } catch (err) {
          console.warn('Failed to save metadata.json to S3:', err.message);
        }
      }

      s3Meta.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
      return s3Meta;
    } catch (err) {
      console.error('Failed to list S3 photos:', err);
      return s3Meta;
    }
  } else {
    const meta = loadLocalMetadata();
    meta.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
    return meta;
  }
}

// Helper: save photos metadata (to S3 or local)
async function saveVaultPhotos(records) {
  saveLocalMetadata(records);
  if (STORAGE_MODE === 's3' && s3Client && S3_BUCKET) {
    try {
      await s3Client.send(new PutObjectCommand({
        Bucket: S3_BUCKET,
        Key: 'metadata.json',
        Body: JSON.stringify(records, null, 2),
        ContentType: 'application/json'
      }));
    } catch (err) {
      console.error('Failed to save metadata.json to S3:', err);
    }
  }
}

// Helper: get total storage used in bytes
async function getTotalStorageUsed() {
  if (STORAGE_MODE === 's3' && s3Client && S3_BUCKET) {
    try {
      let totalBytes = 0;
      let continuationToken = null;
      do {
        const cmd = new ListObjectsV2Command({
          Bucket: S3_BUCKET,
          ContinuationToken: continuationToken
        });
        const res = await s3Client.send(cmd);
        if (res.Contents) {
          for (const item of res.Contents) {
            totalBytes += item.Size || 0;
          }
        }
        continuationToken = res.NextContinuationToken;
      } while (continuationToken);
      return totalBytes;
    } catch (err) {
      console.error('Failed to calculate S3 bucket size:', err);
      return 0;
    }
  } else {
    // Local storage size calculation
    let totalBytes = 0;
    const files = fs.readdirSync(UPLOADS_DIR);
    for (const f of files) {
      if (f !== 'metadata.json') {
        const stats = fs.statSync(path.join(UPLOADS_DIR, f));
        totalBytes += stats.size;
      }
    }
    return totalBytes;
  }
}

// Multer memory storage (allows checking quota before committing to disk/S3)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB per individual high-res photo limit
  },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME_TYPES.has(file.mimetype.toLowerCase())) {
      return cb(
        new Error('Strict Photos Only: Videos and non-image files are not allowed.'),
        false
      );
    }
    cb(null, true);
  }
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOADS_DIR));

// 1. Get Storage Stats & Quota
app.get('/api/stats', async (req, res) => {
  try {
    const usedBytes = await getTotalStorageUsed();
    const isFull = usedBytes >= MAX_STORAGE_BYTES;
    const meta = await getVaultPhotos();

    res.json({
      usedBytes,
      maxBytes: MAX_STORAGE_BYTES,
      usedMB: (usedBytes / (1024 * 1024)).toFixed(2),
      maxMB: MAX_STORAGE_MB,
      percentUsed: Math.min(100, (usedBytes / MAX_STORAGE_BYTES) * 100).toFixed(1),
      photoCount: meta.length,
      isFull,
      storageMode: STORAGE_MODE
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve storage statistics' });
  }
});

// 2. Upload Photos Endpoint
app.post('/api/upload', (req, res) => {
  upload.array('photos', 50)(req, res, async (err) => {
    if (err) {
      return res.status(400).json({
        error: err.message || 'File upload error. Please ensure you are only selecting photos.'
      });
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'Please select at least one picture to upload.' });
    }

    // Check storage quota
    const incomingBytes = req.files.reduce((acc, f) => acc + f.size, 0);
    const currentUsed = await getTotalStorageUsed();

    if (currentUsed + incomingBytes > MAX_STORAGE_BYTES) {
      return res.status(413).json({
        error:
          "Storage limit reached (~5 GB cap). Thank you so much! Olive's photo vault is now full, but she truly appreciates your love and memories!"
      });
    }

    // Sanitize guest inputs
    const guestName = (req.body.name || 'Anonymous Guest').toString().trim().slice(0, 50);
    // Birthday wish strictly limited to 70 characters max
    const guestWish = (req.body.wish || '').toString().trim().slice(0, 70);

    const uploadedRecords = [];
    const currentMeta = await getVaultPhotos();

    for (const file of req.files) {
      const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
      const fileId = `${Date.now()}-${Math.random().toString(36).substring(2, 8)}${ext}`;

      if (STORAGE_MODE === 's3' && s3Client && S3_BUCKET) {
        // Upload to AWS S3
        const s3Key = `photos/${fileId}`;
        const putCmd = new PutObjectCommand({
          Bucket: S3_BUCKET,
          Key: s3Key,
          Body: file.buffer,
          ContentType: file.mimetype,
          Metadata: {
            guestname: encodeURIComponent(guestName),
            guestwish: encodeURIComponent(guestWish),
            originalfilename: encodeURIComponent(file.originalname)
          }
        });
        await s3Client.send(putCmd);

        const record = {
          id: fileId,
          key: s3Key,
          filename: file.originalname,
          size: file.size,
          mimetype: file.mimetype,
          guestName,
          guestWish,
          uploadedAt: new Date().toISOString(),
          url: `/api/photo/${fileId}`
        };
        uploadedRecords.push(record);
        currentMeta.unshift(record);
      } else {
        // Save to local uploads folder
        const localPath = path.join(UPLOADS_DIR, fileId);
        fs.writeFileSync(localPath, file.buffer);

        const record = {
          id: fileId,
          filename: file.originalname,
          size: file.size,
          mimetype: file.mimetype,
          guestName,
          guestWish,
          uploadedAt: new Date().toISOString(),
          url: `/uploads/${fileId}`
        };
        uploadedRecords.push(record);
        currentMeta.unshift(record);
      }
    }

    await saveVaultPhotos(currentMeta);

    res.json({
      success: true,
      message: `Successfully uploaded ${uploadedRecords.length} photo(s)!`,
      photos: uploadedRecords
    });
  });
});

// 3. Serve single photo from S3 if in S3 mode
app.get('/api/photo/:id', async (req, res) => {
  const photoId = req.params.id;
  if (STORAGE_MODE === 's3' && s3Client && S3_BUCKET) {
    try {
      const getCmd = new GetObjectCommand({
        Bucket: S3_BUCKET,
        Key: `photos/${photoId}`
      });
      const s3Res = await s3Client.send(getCmd);
      res.setHeader('Content-Type', s3Res.ContentType || 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      s3Res.Body.pipe(res);
    } catch (err) {
      res.status(404).json({ error: 'Photo not found in S3 vault.' });
    }
  } else {
    const localPath = path.join(UPLOADS_DIR, photoId);
    if (fs.existsSync(localPath)) {
      res.sendFile(localPath);
    } else {
      res.status(404).json({ error: 'Photo not found.' });
    }
  }
});

// 4. Family Gallery Authentication Check
app.post('/api/auth', (req, res) => {
  const { pin } = req.body;
  if (pin && pin.toString().trim() === FAMILY_PIN) {
    return res.json({ success: true, authorized: true });
  }
  return res.status(401).json({ success: false, error: 'Incorrect PIN. This gallery is private for Olive and family.' });
});

// 5. Get Photos for Private Family Gallery
app.get('/api/photos', async (req, res) => {
  const authPin = req.headers['x-family-pin'];
  if (!authPin || authPin.toString().trim() !== FAMILY_PIN) {
    return res.status(401).json({ error: 'Unauthorized: PIN required.' });
  }

  const meta = await getVaultPhotos();
  res.json({ photos: meta, count: meta.length });
});

// 6. Download All Photos as a ZIP archive
app.get('/api/download-all', async (req, res) => {
  const authPin = req.query.pin;
  if (!authPin || authPin.toString().trim() !== FAMILY_PIN) {
    return res.status(401).send('Unauthorized. Please provide the correct Family PIN to download photos.');
  }

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader(
    'Content-Disposition',
    'attachment; filename="Olives-30th-Birthday-All-Photos.zip"'
  );

  const archive = archiver('zip', { zlib: { level: 6 } });
  archive.on('error', (err) => res.status(500).send({ error: err.message }));
  archive.pipe(res);

  const meta = await getVaultPhotos();

  if (STORAGE_MODE === 's3' && s3Client && S3_BUCKET) {
    for (const item of meta) {
      try {
        const getCmd = new GetObjectCommand({
          Bucket: S3_BUCKET,
          Key: item.key || `photos/${item.id}`
        });
        const s3Res = await s3Client.send(getCmd);
        archive.append(s3Res.Body, { name: `${item.guestName || 'Guest'}_${item.id}` });
      } catch (e) {
        console.error('Error streaming photo from S3 to zip:', e);
      }
    }
  } else {
    for (const item of meta) {
      const filePath = path.join(UPLOADS_DIR, item.id);
      if (fs.existsSync(filePath)) {
        archive.file(filePath, { name: `${item.guestName || 'Guest'}_${item.id}` });
      }
    }
  }

  // Also include a nice summary text file of all guest wishes
  const wishesText = meta
    .map(
      (m, idx) =>
        `#${idx + 1} - From: ${m.guestName || 'Anonymous'}\nWish: "${m.guestWish || 'No message'}"\nUploaded: ${m.uploadedAt}\nPhoto: ${m.id}\n----------------------------------------\n`
    )
    .join('\n');
  archive.append(wishesText, { name: 'Olive_Birthday_Wishes.txt' });

  await archive.finalize();
});

// 7. Generate Invitation QR Code
app.get('/api/qr', async (req, res) => {
  try {
    const host = req.get('host');
    const protocol = req.protocol;
    const targetUrl = req.query.url || `${protocol}://${host}/`;

    const qrDataUrl = await QRCode.toDataURL(targetUrl, {
      width: 600,
      margin: 2,
      color: {
        dark: '#1e293b',
        light: '#ffffff'
      }
    });

    if (req.query.format === 'image') {
      const imgBuffer = Buffer.from(qrDataUrl.split(',')[1], 'base64');
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Content-Disposition', 'inline; filename="olives_invitation_qr.png"');
      return res.send(imgBuffer);
    }

    res.json({
      url: targetUrl,
      qrDataUrl
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate QR code' });
  }
});

app.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`✨ Olive's 30th Birthday Photo Vault is LIVE! ✨`);
  console.log(`* Local URL:       http://localhost:${PORT}/`);
  console.log(`* Family Gallery:  http://localhost:${PORT}/gallery.html`);
  console.log(`* QR Tool:         http://localhost:${PORT}/qr-generator.html`);
  console.log(`* Storage Mode:    ${STORAGE_MODE.toUpperCase()}`);
  console.log(`* Storage Cap:     ${MAX_STORAGE_MB} MB (~5 GB)`);
  console.log(`* Family PIN:      ${FAMILY_PIN}`);
  console.log(`====================================================`);
});
