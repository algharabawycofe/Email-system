/* ═══════════════════════════════════════════════════════════
   Mail System Service Worker v7.0
   FCM Push + PWA Cache (Network-first for HTML/JS/CSS)
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
   CACHE CONFIG
   ═══════════════════════════════════════════════════════ */
const CACHE_NAME = 'mail-system-v7.0';
const BASE = '/Email-system/';

/* ───── Install ───── */
self.addEventListener('install', (event) => {
  console.log('📦 SW Install v7.0');
  // ⭐ مهم: فعّل الـ SW الجديد فوراً
  self.skipWaiting();
});

/* ───── Activate ───── */
self.addEventListener('activate', (event) => {
  console.log('✅ SW Activate v7.0');
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
  // ⭐ مهم: سيطر على كل الصفحات المفتوحة حالاً
  self.clients.claim();
});

/* ───── Fetch - NETWORK FIRST for HTML/JS/CSS ───── */
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // تجاهل طلبات Firebase
  if (
    url.hostname.includes('firebase') ||
    url.hostname.includes('googleapis') ||
    url.hostname.includes('gstatic.com') ||
    url.pathname.startsWith('/v1/')
  ) {
    return;
  }

  // تجاهل الطلبات الخارجية
  if (url.hostname !== location.hostname) return;

  // ⭐ استراتيجية Network-First لكل الملفات المحلية
  // (HTML, JS, CSS) — دايماً تجيب النسخة الجديدة
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // خزّن النسخة الجديدة في الكاش
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(c => c.put(event.request, clone)).catch(() => {});
        }
        return response;
      })
      .catch(() => {
        // لو الشبكة فشلت، ارجع للكاش
        return caches.match(event.request).then(cached => {
          return cached || caches.match(BASE);
        });
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
    silent: false,
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

console.log('🚀 SW v7.0 loaded — Network-first strategy');
