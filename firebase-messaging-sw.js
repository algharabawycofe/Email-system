/* ═══════════════════════════════════════════════════════════
   Mail System Service Worker v5.0
   FCM Push + PWA Offline Cache (Safe Mode)
   ═══════════════════════════════════════════════════════════ */

importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

/* ───── Firebase ───── */
firebase.initializeApp({
  apiKey: "AIzaSyAZTWVHsdv0U3XSEFyZG9RtVNJJwiTxPBA",
  authDomain: "email-system-51538.firebaseapp.com",
  projectId: "email-system-51538",
  storageBucket: "email-system-51538.firebasestorage.app",
  messagingSenderId: "520124834460",
  appId: "1:520124834460:web:98114c58001ddd2be3c359"
});

const messaging = firebase.messaging();

/* ═══════════════════════════════════════════════════════
   PWA - Safe Cache Configuration
   ═══════════════════════════════════════════════════════ */
const CACHE_NAME = 'mail-system-v5.1';
const BASE = '/Email-system/';

// ✅ ملفات محلية فقط - مفيش CDN
const PRECACHE_URLS = [
  BASE,
  BASE + 'index.html',
  BASE + 'styles.css',
  BASE + 'app.js',
  BASE + 'utils.js',
  BASE + 'firebase.js',
  BASE + 'manifest.json'
];

/* ───── Install ───── */
self.addEventListener('install', (event) => {
  console.log('📦 SW Install');
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('📦 Caching local assets only');
      return Promise.all(
        PRECACHE_URLS.map(url =>
          cache.add(url).catch(err => {
            console.warn('⚠️ Failed to cache:', url, err.message);
          })
        )
      );
    }).catch(err => console.error('Cache open error:', err))
  );
  self.skipWaiting();
});

/* ───── Activate ───── */
self.addEventListener('activate', (event) => {
  console.log('✅ SW Activate');
  event.waitUntil(
    caches.keys().then((names) => {
      return Promise.all(
        names.filter(name => name !== CACHE_NAME).map(name => {
          console.log('🗑️ Deleting old cache:', name);
          return caches.delete(name);
        })
      );
    })
  );
  self.clients.claim();
});

/* ───── Fetch ───── */
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Skip non-GET
  if (event.request.method !== 'GET') return;

  // Skip Firebase, Firestore, FCM, external APIs
  if (
    url.hostname.includes('firebase') ||
    url.hostname.includes('googleapis') ||
    url.hostname.includes('gstatic.com') ||
    url.hostname.includes('firestore') ||
    url.pathname.startsWith('/v1/') ||
    url.protocol !== 'http:' && url.protocol !== 'https:'
  ) {
    return;
  }

  // Skip non-GET and external CDN (let browser handle)
  if (url.hostname !== location.hostname) {
    return;
  }

  // Navigation requests → network first
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(c => c.put(event.request, clone)).catch(() => {});
          }
          return response;
        })
        .catch(() => caches.match(event.request).then(r => r || caches.match(BASE)))
    );
    return;
  }

  // Local assets → cache first, then network
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (!response || response.status !== 200) return response;
        const clone = response.clone();
        caches.open(CACHE_NAME).then(c => c.put(event.request, clone)).catch(() => {});
        return response;
      }).catch(() => cached);
    })
  );
});

/* ═══════════════════════════════════════════════════════
   FCM - Background Messages
   ═══════════════════════════════════════════════════════ */
messaging.onBackgroundMessage((payload) => {
  console.log('📬 Background message:', payload);
  const { title, body } = payload.notification || {};
  const data = payload.data || {};

  const options = {
    body: body || '',
    tag: data.threadId || data.messageId || 'msg',
    renotify: true,
    silent: true,
    vibrate: [100, 50, 100],
    dir: 'rtl',
    lang: 'ar',
    data: { url: 'https://algharabawycofye.github.io/Email-system/' }
  };

  self.registration.showNotification(title || 'رسالة جديدة', options);
});

/* ───── Notification Click ───── */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || 'https://algharabawycofye.github.io/Email-system/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if (c.url.includes('Email-system') && 'focus' in c) return c.focus();
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});

/* ───── Message from page ───── */
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

console.log('🚀 SW v5.0 loaded (Safe Mode)');
