import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getMessaging } from 'firebase-admin/messaging';
import { getStorage } from 'firebase-admin/storage';
import { randomUUID } from 'node:crypto';
import { HttpError } from '../lib/rules.js';
function app() {
  if (!process.env.FIREBASE_PROJECT_ID) throw new HttpError(503, 'Firebase is not configured');
  return getApps()[0] || initializeApp({ credential: cert({ projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL, privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n') }) });
}
export async function verifyCustomer(token) {
  try { return await getAuth(app()).verifyIdToken(token, true); }
  catch (e) { if (e.status) throw e; throw new HttpError(401, 'Invalid or expired Firebase token'); }
}

/// True once the Firebase service account is set -- then product photos and
/// chat attachments can be stored in Firebase (Google Cloud) Storage instead
/// of Cloudinary (services/storage.js prefers Cloudinary when both are set).
export function firebaseStorageConfigured() {
  return !!process.env.FIREBASE_PROJECT_ID;
}

function bucket() {
  // New Firebase projects use <project>.firebasestorage.app; older ones
  // <project>.appspot.com. Override with FIREBASE_STORAGE_BUCKET if needed.
  const name = process.env.FIREBASE_STORAGE_BUCKET || `${process.env.FIREBASE_PROJECT_ID}.firebasestorage.app`;
  return getStorage(app()).bucket(name);
}

/// Stores a file buffer in Firebase Storage under `folder/` and returns a
/// public download URL. Uses a Firebase download token rather than a public
/// ACL, so it works even on buckets with uniform access (the default).
export async function uploadToFirebase(buffer, { folder, ext, contentType }) {
  const b = bucket();
  const name = `${folder}/${randomUUID()}.${ext}`;
  const token = randomUUID();
  await b.file(name).save(buffer, {
    resumable: false,
    contentType,
    metadata: { contentType, cacheControl: 'public, max-age=31536000', metadata: { firebaseStorageDownloadTokens: token } },
  });
  return `https://firebasestorage.googleapis.com/v0/b/${b.name}/o/${encodeURIComponent(name)}?alt=media&token=${token}`;
}
export async function notifyOrder(user, order) {
  if (!user?.fcmToken || !process.env.FIREBASE_PROJECT_ID) return;
  try { await getMessaging(app()).send({ token: user.fcmToken, notification: { title: 'NTSA order update', body: `Your order is ${order.status.toLowerCase().replaceAll('_', ' ')}` }, data: { orderId: order.id } }); }
  catch { console.warn('FCM notification failed for order', order.id); }
}
/// A push to one customer's phone, with whatever text the caller wants. Never
/// throws: a missed push must not undo the order update that caused it.
export async function pushToUser(user, { title, body, data = {} }) {
  if (!user?.fcmToken || !process.env.FIREBASE_PROJECT_ID) return;
  try { await getMessaging(app()).send({ token: user.fcmToken, notification: { title, body }, data: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])) }); }
  catch { console.warn('FCM notification failed for user', user.id); }
}
