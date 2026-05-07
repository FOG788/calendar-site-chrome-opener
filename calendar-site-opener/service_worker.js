const DEFAULT_SETTINGS = {
  calendarId: "primary",
  marker: "[OPEN]",
  defaultUrl: "https://chatgpt.com/",
  lookAheadHours: 72,
  refreshMinutes: 15,
  missedGraceMinutes: 10,
  openActiveTab: true
};

const ALARM_REFRESH = "refresh-calendar-events";
const ALARM_OPEN_NEXT = "open-next-calendar-site";

chrome.runtime.onInstalled.addListener(() => {
  bootstrap().catch(saveLastError);
});

chrome.runtime.onStartup.addListener(() => {
  bootstrap().catch(saveLastError);
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_REFRESH) {
    syncAndScheduleNext(false).catch(saveLastError);
    return;
  }

  if (alarm.name === ALARM_OPEN_NEXT) {
    openDueEventAndReschedule().catch(saveLastError);
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "connect") {
    connectGoogle()
      .then((payload) => sendResponse({ ok: true, ...payload }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "refresh") {
    syncAndScheduleNext(false)
      .then((payload) => sendResponse({ ok: true, ...payload }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "getState") {
    getState()
      .then((payload) => sendResponse({ ok: true, ...payload }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "saveSettings") {
    saveSettings(message.settings)
      .then((payload) => sendResponse({ ok: true, ...payload }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "disconnect") {
    disconnectGoogle()
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  return false;
});

async function bootstrap() {
  await ensureDefaultSettings();
  await ensureRefreshAlarm();
  await syncAndScheduleNext(false);
}

async function ensureDefaultSettings() {
  const { settings } = await chrome.storage.local.get("settings");

  if (!settings) {
    await chrome.storage.local.set({ settings: DEFAULT_SETTINGS });
    return DEFAULT_SETTINGS;
  }

  const merged = { ...DEFAULT_SETTINGS, ...settings };
  await chrome.storage.local.set({ settings: merged });
  return merged;
}

async function getSettings() {
  const { settings } = await chrome.storage.local.get("settings");
  return { ...DEFAULT_SETTINGS, ...(settings || {}) };
}

async function saveSettings(input) {
  const current = await getSettings();
  const next = normalizeSettings({ ...current, ...(input || {}) });

  await chrome.storage.local.set({ settings: next });
  await ensureRefreshAlarm();
  const syncResult = await syncAndScheduleNext(false);

  return {
    settings: next,
    ...syncResult
  };
}

function normalizeSettings(settings) {
  const marker = String(settings.marker || DEFAULT_SETTINGS.marker).trim();
  const calendarId = String(settings.calendarId || DEFAULT_SETTINGS.calendarId).trim();
  const defaultUrl = safeUrl(settings.defaultUrl) || DEFAULT_SETTINGS.defaultUrl;

  return {
    calendarId,
    marker,
    defaultUrl,
    lookAheadHours: clampInteger(settings.lookAheadHours, 1, 24 * 30, DEFAULT_SETTINGS.lookAheadHours),
    refreshMinutes: clampInteger(settings.refreshMinutes, 1, 24 * 60, DEFAULT_SETTINGS.refreshMinutes),
    missedGraceMinutes: clampInteger(settings.missedGraceMinutes, 0, 24 * 60, DEFAULT_SETTINGS.missedGraceMinutes),
    openActiveTab: Boolean(settings.openActiveTab)
  };
}

function clampInteger(value, min, max, fallback) {
  const number = Number.parseInt(value, 10);

  if (!Number.isFinite(number)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, number));
}

async function ensureRefreshAlarm() {
  const settings = await getSettings();

  await chrome.alarms.clear(ALARM_REFRESH);
  await chrome.alarms.create(ALARM_REFRESH, {
    periodInMinutes: settings.refreshMinutes
  });
}

async function connectGoogle() {
  await getAuthToken(true);
  return await syncAndScheduleNext(false);
}

function getAuthToken(interactive) {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive }, (token) => {
      if (chrome.runtime.lastError || !token) {
        reject(new Error(chrome.runtime.lastError?.message || "Google認証トークンを取得できませんでした。"));
        return;
      }

      resolve(token);
    });
  });
}

function removeCachedToken(token) {
  return new Promise((resolve) => {
    chrome.identity.removeCachedAuthToken({ token }, resolve);
  });
}

async function disconnectGoogle() {
  const token = await getAuthToken(false).catch(() => null);

  if (token) {
    await removeCachedToken(token);
  }

  await chrome.storage.local.remove(["upcomingEvents", "nextEvent", "lastError"]);
  await chrome.alarms.clear(ALARM_OPEN_NEXT);
}

async function fetchCalendarEvents(interactive = false) {
  const settings = await getSettings();
  const token = await getAuthToken(interactive);

  const now = new Date();
  const timeMax = new Date(now.getTime() + settings.lookAheadHours * 60 * 60 * 1000);

  const params = new URLSearchParams({
    timeMin: now.toISOString(),
    timeMax: timeMax.toISOString(),
    singleEvents: "true",
    orderBy: "startTime",
    q: settings.marker
  });

  const url =
    `https://www.googleapis.com/calendar/v3/calendars/` +
    `${encodeURIComponent(settings.calendarId)}/events?${params.toString()}`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  if (response.status === 401) {
    await removeCachedToken(token);
    throw new Error("Google認証が切れています。拡張機能のボタンから再接続してください。");
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Calendar API error: ${response.status} ${text}`);
  }

  const data = await response.json();
  return data.items || [];
}

function extractUrl(event, settings) {
  const text = [
    event.description || "",
    event.location || "",
    event.summary || ""
  ].join("\n");

  const match = text.match(/https?:\/\/[^\s<>"']+/i);

  if (!match) {
    return settings.defaultUrl;
  }

  return safeUrl(match[0].replace(/[),.。]+$/, "")) || settings.defaultUrl;
}

function safeUrl(url) {
  try {
    const parsed = new URL(String(url).trim());

    if (!["http:", "https:"].includes(parsed.protocol)) {
      return null;
    }

    return parsed.href;
  } catch {
    return null;
  }
}

async function normalizeEvents(events) {
  const settings = await getSettings();

  return events
    .filter((event) => event.summary?.includes(settings.marker))
    .filter((event) => event.start?.dateTime)
    .map((event) => {
      const startTime = new Date(event.start.dateTime).getTime();
      const url = extractUrl(event, settings);

      return {
        key: `${event.id}:${event.start.dateTime}`,
        eventId: event.id,
        title: event.summary || "",
        startTime,
        startIso: event.start.dateTime,
        url
      };
    })
    .filter((event) => Number.isFinite(event.startTime))
    .sort((a, b) => a.startTime - b.startTime);
}

async function syncAndScheduleNext(interactive = false) {
  const rawEvents = await fetchCalendarEvents(interactive);
  const events = await normalizeEvents(rawEvents);

  await chrome.storage.local.set({
    upcomingEvents: events,
    lastSyncAt: Date.now()
  });
  await chrome.storage.local.remove("lastError");

  await scheduleNextEvent(events);

  const { nextEvent } = await chrome.storage.local.get("nextEvent");

  return {
    eventCount: events.length,
    nextEvent: nextEvent || null
  };
}

async function scheduleNextEvent(events) {
  const settings = await getSettings();
  const now = Date.now();
  const { fired = {} } = await chrome.storage.local.get({ fired: {} });

  const next = events.find((event) => {
    const alreadyFired = fired[event.key];
    const notTooOld = event.startTime >= now - settings.missedGraceMinutes * 60 * 1000;

    return !alreadyFired && notTooOld;
  });

  await chrome.alarms.clear(ALARM_OPEN_NEXT);

  if (!next) {
    await chrome.storage.local.remove("nextEvent");
    return;
  }

  await chrome.storage.local.set({ nextEvent: next });

  if (next.startTime <= now) {
    await openEventIfDue(next);
    await syncAndScheduleNext(false);
    return;
  }

  await chrome.alarms.create(ALARM_OPEN_NEXT, {
    when: next.startTime
  });
}

async function openDueEventAndReschedule() {
  const { nextEvent } = await chrome.storage.local.get("nextEvent");

  if (nextEvent) {
    await openEventIfDue(nextEvent);
  }

  return await syncAndScheduleNext(false);
}

async function openEventIfDue(event) {
  const settings = await getSettings();
  const now = Date.now();
  const lateBy = now - event.startTime;

  if (lateBy < -30 * 1000) {
    return;
  }

  if (lateBy > settings.missedGraceMinutes * 60 * 1000) {
    await markEventFired(event);
    return;
  }

  await chrome.tabs.create({
    url: event.url,
    active: settings.openActiveTab
  });

  await markEventFired(event);
}

async function markEventFired(event) {
  const { fired = {} } = await chrome.storage.local.get({ fired: {} });

  fired[event.key] = Date.now();

  const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;

  for (const [key, timestamp] of Object.entries(fired)) {
    if (timestamp < cutoff) {
      delete fired[key];
    }
  }

  await chrome.storage.local.set({ fired });
}

async function getState() {
  const settings = await getSettings();
  const result = await chrome.storage.local.get([
    "upcomingEvents",
    "nextEvent",
    "lastSyncAt",
    "lastError",
    "fired"
  ]);

  return {
    settings,
    upcomingEvents: result.upcomingEvents || [],
    nextEvent: result.nextEvent || null,
    lastSyncAt: result.lastSyncAt || null,
    lastError: result.lastError || null,
    fired: result.fired || {}
  };
}

async function saveLastError(error) {
  await chrome.storage.local.set({
    lastError: {
      message: error?.message || String(error),
      at: Date.now()
    }
  });
}
