importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyAZTWVHsdv0U3XSEFyZG9RtVNJJwiTxPBA",
  authDomain: "email-system-51538.firebaseapp.com",
  projectId: "email-system-51538",
  storageBucket: "email-system-51538.firebasestorage.app",
  messagingSenderId: "520124834460",
  appId: "1:520124834460:web:98114c58001ddd2be3c359"
});

const messaging = firebase.messaging();

// صوت الإشعار (بيشتغل والمتصفح مقفول)
const NOTIF_SOUND_URL = 'https://cdn.pixabay.com/download/audio/2022/03/15/audio_5fba7e4a30.mp3?filename=message-notification-106287.mp3';

messaging.onBackgroundMessage((payload) => {
  console.log('📬 Background message received:', payload);

  const { title, body } = payload.notification || {};
  const data = payload.data || {};

  const options = {
    body: body || '',
    icon: 'https://cdn-icons-png.flaticon.com/512/561/561127.png',
    badge: 'https://cdn-icons-png.flaticon.com/512/561/561127.png',
    tag: data.threadId || data.messageId || 'msg',
    renotify: true,
    requireInteraction: false,
    silent: false,
    vibrate: [200, 100, 200],
    dir: 'rtl',
    lang: 'ar',
    data: { url: data.url || 'https://algharabawycofye.github.io/Email-system/' }
  };

  self.registration.showNotification(title || 'رسالة جديدة', options);

  // بلّغ الصفحة لو مفتوحة
  self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
    clients.forEach(client => {
      client.postMessage({
        type: 'PLAY_SOUND',
        soundUrl: NOTIF_SOUND_URL
      });
    });
  });
});

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

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'PLAY_SOUND') {
    console.log('🔊 Sound requested from page');
  }
});
