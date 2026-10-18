/* FCM background — importScripts từ Workbox SW. Config public (không secret). */
/* eslint-disable no-undef */
importScripts('https://www.gstatic.com/firebasejs/12.19.0/firebase-app-compat.js')
importScripts('https://www.gstatic.com/firebasejs/12.19.0/firebase-messaging-compat.js')

firebase.initializeApp({
  apiKey: 'AIzaSyCN7epp-CSUD6ak8kGiSwT6xJzAMbKrNGk',
  authDomain: 'echiptime.firebaseapp.com',
  databaseURL: 'https://echiptime-default-rtdb.firebaseio.com',
  projectId: 'echiptime',
  storageBucket: 'echiptime.firebasestorage.app',
  messagingSenderId: '819158838064',
  appId: '1:819158838064:web:a3f9cfd87a96dbdcf176f5',
})

const messaging = firebase.messaging()

messaging.onBackgroundMessage((payload) => {
  const title = payload.data?.title || payload.notification?.title || 'QTR Challenge'
  const body = payload.data?.body || payload.notification?.body || ''
  const url = payload.data?.url || '/notifications'
  const tag = payload.data?.tag || 'qtr-push'
  return self.registration.showNotification(title, {
    body,
    icon: '/icon-192.png',
    badge: '/favicon.png',
    data: { url },
    tag,
    renotify: true,
  })
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = event.notification.data?.url || '/notifications'
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ('focus' in client) {
          if ('navigate' in client) return client.navigate(url).then((c) => c?.focus())
          return client.focus()
        }
      }
      if (clients.openWindow) return clients.openWindow(url)
    }),
  )
})
