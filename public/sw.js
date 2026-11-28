const CACHE_NAME = 'wah-safety-pwa-v8';
const REMINDER_META_CACHE = 'wah-reminder-meta';
const REMINDER_META_URL = './__wah_reminder_state.json';

const STATIC_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-192.png',
  './icon-maskable-512.png',
  './logo.png'
];

self.addEventListener('install', (evt) => {
  evt.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch((e) => console.warn('PWA Precache note:', e));
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (evt) => {
  evt.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter(k => k !== CACHE_NAME && k !== REMINDER_META_CACHE)
          .map(k => caches.delete(k))
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (evt) => {
  if (evt.request.method !== 'GET') return;
  const url = evt.request.url;
  // Bypass caching for live Firestore sync and Google OAuth
  if (url.includes('firestore.googleapis.com') || url.includes('identitytoolkit') || url.includes('accounts.google.com')) {
    return;
  }

  evt.respondWith(
    fetch(evt.request)
      .then((networkRes) => {
        if (networkRes && networkRes.status === 200) {
          const clone = networkRes.clone();
          caches.open(CACHE_NAME).then(c => c.put(evt.request, clone));
        }
        return networkRes;
      })
      .catch(() => {
        return caches.match(evt.request).then(cached => {
          if (cached) return cached;
          if (evt.request.mode === 'navigate') {
            return caches.match('./index.html');
          }
        });
      })
  );
});

// Handle user tapping on an Android / Desktop PWA notification
self.addEventListener('notificationclick', (evt) => {
  evt.notification.close();
  const data = evt.notification.data || {};
  const targetUrl = './?notify_nav=' + encodeURIComponent(JSON.stringify(data));

  evt.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          client.focus();
          client.postMessage({ type: 'NAVIGATE_FROM_NOTIFICATION', data });
          return;
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});

// Helper: UK YYYY-MM-DD in Service Worker
function getUKDateISOSW() {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/London',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(new Date());
  } catch (e) {
    return new Date().toISOString().slice(0, 10);
  }
}

function daysBetweenISO(fromISO, toISO) {
  if (!fromISO || !toISO) return null;
  const d1 = new Date(fromISO + 'T00:00:00');
  const d2 = new Date(toISO + 'T00:00:00');
  const diff = Math.floor((d2 - d1) / (1000 * 60 * 60 * 24));
  return isNaN(diff) ? null : diff;
}

// Background Periodic Sync on Android Chrome (when installed as WebAPK)
self.addEventListener('periodicsync', (evt) => {
  if (evt.tag === 'wah-periodic-reminders') {
    evt.waitUntil(runBackgroundReminderCheck());
  }
});

async function runBackgroundReminderCheck() {
  try {
    const cache = await caches.open(REMINDER_META_CACHE);
    const res = await cache.match(REMINDER_META_URL);
    if (!res) return;
    const snap = await res.json();
    if (!snap || !snap.ownerActive) return;

    const todayISO = getUKDateISOSW();
    const prefs = snap.notifyPrefs || {};
    const lastNotified = snap.lastNotifiedMap || {};
    let updated = false;

    const anyDays = daysBetweenISO(snap.lastAnyReviewISO, todayISO);
    const fourWeekDays = daysBetweenISO(snap.lastFourWeekISO, todayISO);
    const probeDays = daysBetweenISO(snap.lastProbeISO, todayISO);
    const weeklyCount = snap.weeklyCount || 0;
    const cycleWeek = Math.min(4, (weeklyCount % 4) + 1);

    const isFourWeekDue = (fourWeekDays === null)
      ? (anyDays === null || anyDays >= 28 || weeklyCount >= 3)
      : (fourWeekDays >= 28 || (weeklyCount >= 3 && anyDays !== null && anyDays >= 7));

    const isWeeklyDue = !isFourWeekDue && (anyDays === null || anyDays >= 7);
    const isProbeDue = (probeDays === null || probeDays >= 30);

    if (prefs.fourWeekReview !== false && isFourWeekDue && lastNotified.four_week_review !== todayISO) {
      await self.registration.showNotification('📋 4-Week Manager Review & Gas Hose Audit Due', {
        body: fourWeekDays === null
          ? 'Your 28-day SFBB manager audit & 5-year LPG hose check is due. Tap to complete.'
          : `${fourWeekDays} days since your last 4-week audit. Tap to sign off & inspect LPG hose.`,
        icon: './icon-192.png',
        badge: './icon-192.png',
        tag: 'wah-four-week-review',
        vibrate: [200, 100, 200],
        data: { mainTab: 'today', subTab: 'sub-weekly', reviewType: 'Four-Week Review' }
      });
      lastNotified.four_week_review = todayISO;
      updated = true;
    } else if (prefs.weeklyReview !== false && isWeeklyDue && lastNotified.weekly_review !== todayISO) {
      await self.registration.showNotification(`📅 Weekly SFBB Review Due (Week ${cycleWeek} of 4)`, {
        body: anyDays === null
          ? 'Time for your 7-day SFBB diary review. Tap to verify & archive logs.'
          : `${anyDays} days since your last review. Tap to complete Week ${cycleWeek} sign-off.`,
        icon: './icon-192.png',
        badge: './icon-192.png',
        tag: 'wah-weekly-review',
        vibrate: [200, 100, 200],
        data: { mainTab: 'today', subTab: 'sub-weekly', reviewType: 'Weekly Review' }
      });
      lastNotified.weekly_review = todayISO;
      updated = true;
    }

    if (prefs.probeCalibration !== false && isProbeDue && lastNotified.probe_calibration !== todayISO) {
      await self.registration.showNotification('🌡️ Monthly Digital Probe Calibration Due', {
        body: probeDays === null
          ? 'No monthly probe check logged. Tap to record ice/boiling water verification.'
          : `Last calibrated ${probeDays} days ago. Tap to log monthly probe check (±1°C).`,
        icon: './icon-192.png',
        badge: './icon-192.png',
        tag: 'wah-probe-calibration',
        vibrate: [200, 100, 200],
        data: { mainTab: 'today', subTab: 'sub-probe' }
      });
      lastNotified.probe_calibration = todayISO;
      updated = true;
    }

    if (prefs.docsAndExpiry !== false && Array.isArray(snap.pendingDocTitles) && snap.pendingDocTitles.length > 0 && lastNotified.docs_expiry !== todayISO) {
      await self.registration.showNotification('📄 Compliance Document / Setup Action Due', {
        body: `${snap.pendingDocTitles.length} item(s) need attention: ${snap.pendingDocTitles.slice(0, 2).join(', ')}.`,
        icon: './icon-192.png',
        badge: './icon-192.png',
        tag: 'wah-docs-expiry',
        vibrate: [150, 80, 150],
        data: { mainTab: 'documents' }
      });
      lastNotified.docs_expiry = todayISO;
      updated = true;
    }

    if (updated) {
      snap.lastNotifiedMap = lastNotified;
      await cache.put(REMINDER_META_URL, new Response(JSON.stringify(snap), {
        headers: { 'Content-Type': 'application/json' }
      }));
    }
  } catch (err) {
    console.warn('Background reminder check note:', err);
  }
}
