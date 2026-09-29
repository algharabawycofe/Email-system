/* ═══════════════════════════════════════════════════════════
   Mail System v4.0 - Firebase Configuration & Core Services
   ═══════════════════════════════════════════════════════════ */

import { initializeApp, deleteApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  updateProfile,
  sendPasswordResetEmail,
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  serverTimestamp,
  onSnapshot,
  writeBatch,
  enableIndexedDbPersistence
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import {
  getMessaging,
  getToken,
  onMessage,
  deleteToken
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging.js";

/* ═══════════════════════════════════════════════════════
   CONFIG
   ═══════════════════════════════════════════════════════ */
export const firebaseConfig = {
  apiKey: "AIzaSyAZTWVHsdv0U3XSEFyZG9RtVNJJwiTxPBA",
  authDomain: "email-system-51538.firebaseapp.com",
  projectId: "email-system-51538",
  storageBucket: "email-system-51538.firebasestorage.app",
  messagingSenderId: "520124834460",
  appId: "1:520124834460:web:98114c58001ddd2be3c359"
};

export const EMAIL_DOMAIN = "algharbawy.com";
export const VAPID_KEY = "BBua7yXB4zAM7TpSFCbmw8reNoFDOCk-iI1lukpyaVWQ8jhIL-0SxxCFGJZDJZkw-1EyLhgthiLM7Qo6AlFfpWI";
export const SW_PATH = "/Email-system/firebase-messaging-sw.js";
export const APP_URL = "https://algharabawycofye.github.io/Email-system/";

/* ═══════════════════════════════════════════════════════
   INITIALIZE
   ═══════════════════════════════════════════════════════ */
export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

export let messaging = null;
try {
  messaging = getMessaging(app);
} catch (e) {
  console.warn("FCM not supported in this browser:", e);
}

// تفعيل Offline Persistence
enableIndexedDbPersistence(db).catch((err) => {
  if (err.code === 'failed-precondition') {
    console.warn('Persistence failed: multiple tabs open');
  } else if (err.code === 'unimplemented') {
    console.warn('Persistence not supported by browser');
  }
});

/* ═══════════════════════════════════════════════════════
   EXPORTS - Auth
   ═══════════════════════════════════════════════════════ */
export {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  updateProfile,
  sendPasswordResetEmail,
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
  deleteApp,
  getToken,
  onMessage,
  deleteToken
};

/* ═══════════════════════════════════════════════════════
   EXPORTS - Firestore
   ═══════════════════════════════════════════════════════ */
export {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  serverTimestamp,
  onSnapshot,
  writeBatch
};

/* ═══════════════════════════════════════════════════════
   HELPER: Create Auth User (بدون طرد الأدمن)
   ═══════════════════════════════════════════════════════ */
export async function createAuthUser(email, password) {
  const secondaryApp = initializeApp(firebaseConfig, 'Sec-' + Date.now());
  const secondaryAuth = getAuth(secondaryApp);
  try {
    const cred = await createUserWithEmailAndPassword(secondaryAuth, email, password);
    const uid = cred.user.uid;
    await signOut(secondaryAuth);
    await deleteApp(secondaryApp);
    return uid;
  } catch (e) {
    await deleteApp(secondaryApp);
    throw e;
  }
}

/* ═══════════════════════════════════════════════════════
   HELPER: Send Password Reset
   ═══════════════════════════════════════════════════════ */
export async function resetUserPassword(email) {
  try {
    await sendPasswordResetEmail(auth, email, {
      url: APP_URL,
      handleCodeInApp: false
    });
    return { success: true };
  } catch (e) {
    return { success: false, error: e.code, message: e.message };
  }
}

console.log('🔥 Firebase initialized:', firebaseConfig.projectId);
