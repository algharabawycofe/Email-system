/* ═══════════════════════════════════════════════════════════
   Mail System Service Worker
   Handles: FCM Push Notifications + PWA Offline Cache
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
   PWA - Cache Configuration
   ═══════════════════════════════════════════════════════ */
const CACHE_NAME = 'mail-system-v5.0';
const BASE = '/Email-system/';

const PRECACHE_URLS = [
  BASE,
  BASE + 'index.html',
  BASE + 'styles.css',
  BASE + 'app.js',
  BASE + 'utils.js',
  BASE + 'firebase.js',
  BASE + 'manifest.json',
  'https://cdn.tailwindcss.com',
  'https://unpkg.com/lucide@latest',
  'https://fonts.googleapis.com/css2?family=Cairo:wght@400;500;600;700&display=swap'
];

/* ───── Install: cache assets ───── */
self.addEventListener('install', (event) => {
  console.log('📦 SW Install');
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('📦 Caching assets');
      return cache.addAll(PRECACHE_URLS.map(url => new Request(url, { credentials: 'same-origin' })))
        .catch((err) => {
          console.warn('⚠️ Some assets failed to cache:', err);
        });
    })
  );
  self.skipWaiting();
});

/* ───── Activate: cleanup old caches ───── */
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

/* ───── Fetch: cache-first for assets, network-first for API ───── */
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Skip Firebase / Firestore / FCM / non-GET requests
  if (
    event.request.method !== 'GET' ||
    url.hostname.includes('firebase') ||
    url.hostname.includes('googleapis') ||
    url.hostname.includes('gstatic.com/firebasejs/') ||
    url.hostname.includes('firestore') ||
    url.pathname.startsWith('/v1/')
  ) {
    return;
  }

  // For navigation requests (HTML pages) → network first, fallback to cache
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, responseClone));
          return response;
        })
        .catch(() => caches.match(event.request).then(r => r || caches.match(BASE)))
    );
    return;
  }

  // For other assets → cache first, fallback network
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (!response || response.status !== 200 || response.type === 'opaque') {
          return response;
        }
        const responseClone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, responseClone));
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

  self.registration.showNotification(title || 'رسالة جديدة', {
    body: body || '',
    icon: 'https://cdn-icons-png.flaticon.com/512/561/561127.png',
    badge: 'https://cdn-icons-png.flaticon.com/192/561/561127.png',
    tag: data.threadId || data.messageId || 'msg',
    renotify: true,
    silent: true,
    vibrate: [100, 50, 100],
    dir: 'rtl',
    lang: 'ar',
    data: { url: 'https://algharabawycofye.github.io/Email-system/' }
  });
});

/* ───── Notification Click ───── */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || 'https://algharabawycofye.github.io/Email-system/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if (c.url.includes('Email-system') && 'focus' in c) {
          return c.focus();
        }
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

console.log('🚀 SW v5.0 loaded (PWA + FCM)');
