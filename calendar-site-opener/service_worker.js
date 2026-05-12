const DEFAULT_SETTINGS = {
  calendarId: "primary",
  marker: "[OPEN]",
  defaultUrl: "https://chatgpt.com/",
  skipNoUrlEvents: false,
  targetWindowName: "",
  lookAheadHours: 72,
  refreshMinutes: 15,
  missedGraceMinutes: 10,
  openActiveTab: true,
  loopStartDelaySeconds: 10,
  volumeApplyDelaySeconds1: 0,
  volumeApplyDelaySeconds2: 1,
  volumeApplyDelaySeconds3: 2
};

const ALARM_REFRESH = "refresh-calendar-events";
const ALARM_OPEN_NEXT = "open-next-calendar-site";
const ALARM_CLOSE_NEXT = "close-next-calendar-site-tab";
const DEBUG_PREFIX = "[Calendar Site Opener]";

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
    return;
  }

  if (alarm.name === ALARM_CLOSE_NEXT) {
    closeDueEventTabAndReschedule().catch(saveLastError);
  }
});

chrome.commands.onCommand.addListener((command) => {
  if (command === "open-create-event-form") {
    openCreateEventWindow().catch(saveLastError);
  }
});

const MESSAGE_HANDLERS = {
  connect: () => connectGoogle(),
  refresh: () => syncAndScheduleNext(false),
  getState: () => getState(),
  saveSettings: (message) => saveSettings(message.settings),
  disconnect: () => disconnectGoogle(),
  listCalendars: () => listCalendars(),
  openCreateEventWindow: (message) => openCreateEventWindow(message?.initialUrl || ""),
  createEvent: (message) => createEvent(message.event)
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handler = MESSAGE_HANDLERS[message?.type];

  if (!handler) {
    return false;
  }

  Promise.resolve()
    .then(() => handler(message, sender))
    .then((payload) => sendResponse({ ok: true, ...(payload || {}) }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));

  return true;
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
    skipNoUrlEvents: Boolean(settings.skipNoUrlEvents),
    targetWindowName: String(settings.targetWindowName || "").trim(),
    lookAheadHours: clampInteger(settings.lookAheadHours, 1, 24 * 30, DEFAULT_SETTINGS.lookAheadHours),
    refreshMinutes: clampInteger(settings.refreshMinutes, 1, 24 * 60, DEFAULT_SETTINGS.refreshMinutes),
    missedGraceMinutes: clampInteger(settings.missedGraceMinutes, 0, 24 * 60, DEFAULT_SETTINGS.missedGraceMinutes),
    openActiveTab: Boolean(settings.openActiveTab),
    loopStartDelaySeconds: clampInteger(settings.loopStartDelaySeconds, 0, 30, DEFAULT_SETTINGS.loopStartDelaySeconds),
    volumeApplyDelaySeconds1: clampInteger(settings.volumeApplyDelaySeconds1, 0, 60, DEFAULT_SETTINGS.volumeApplyDelaySeconds1),
    volumeApplyDelaySeconds2: clampInteger(settings.volumeApplyDelaySeconds2, 0, 60, DEFAULT_SETTINGS.volumeApplyDelaySeconds2),
    volumeApplyDelaySeconds3: clampInteger(settings.volumeApplyDelaySeconds3, 0, 60, DEFAULT_SETTINGS.volumeApplyDelaySeconds3)
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

  await chrome.storage.local.remove(["upcomingEvents", "nextEvent", "lastError", "openedTabs"]);
  await chrome.alarms.clear(ALARM_OPEN_NEXT);
  await chrome.alarms.clear(ALARM_CLOSE_NEXT);
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
  const text = joinEventText(event, ["description", "location", "summary"]);

  const matches = text.match(/https?:\/\/[^\s<>"']+/gi) || [];
  const candidates = matches
    .map((url) => safeUrl(url.replace(/[),.。]+$/, "")))
    .filter(Boolean);

  if (!candidates.length) {
    return settings.skipNoUrlEvents ? null : settings.defaultUrl;
  }

  const randomIndex = Math.floor(Math.random() * candidates.length);
  return candidates[randomIndex];
}

function extractWindowName(event, settings) {
  const text = joinEventText(event, ["summary", "description", "location"]);

  const token = text.match(/\[WIN:([^\]\n]+)\]/i) || text.match(/#win:([^\s\n]+)/i);
  if (!token) {
    return settings.targetWindowName || "";
  }

  return String(token[1] || "").trim() || settings.targetWindowName || "";
}

function extractCloseToken(event) {
  const text = joinEventText(event, ["summary", "description", "location"]);

  const token = text.match(/\[CLOSE:([^\]\n]+)\]/i) || text.match(/#close:([^\s\n]+)/i);
  return token ? String(token[1] || "").trim() : "";
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

  return events.reduce((result, event) => {
    if (!event.summary?.includes(settings.marker) || !event.start?.dateTime) {
      return result;
    }

      const startTime = new Date(event.start.dateTime).getTime();
      if (!Number.isFinite(startTime)) {
        return result;
      }

      const url = extractUrl(event, settings);
      if (!url) {
        return result;
      }

      const windowName = extractWindowName(event, settings);
      const closeToken = extractCloseToken(event);
      const volume = extractVolume(event);
      debugLog("event normalized", { id: event.id, title: event.summary || "", start: event.start.dateTime, volume, url });

      result.push({
        key: `${event.id}:${event.start.dateTime}`,
        eventId: event.id,
        title: event.summary || "",
        startTime,
        startIso: event.start.dateTime,
        endTime: closeToken && event.end?.dateTime ? new Date(event.end.dateTime).getTime() : null,
        url,
        windowName,
        closeToken,
        volume
      });
      return result;
    }, []).sort((a, b) => a.startTime - b.startTime);
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
  await scheduleNextTabClose();

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

  const windowId = await getOrCreateTargetWindow(event.windowName || settings.targetWindowName);
  const createdTab = await chrome.tabs.create({ url: buildOpenUrl(event.url), active: settings.openActiveTab, windowId });
  debugLog("tab created", { tabId: createdTab?.id, url: event.url, title: event.title });

  if (createdTab?.id) {
    if (Number.isFinite(event.volume)) {
      const volumeDelays = [settings.volumeApplyDelaySeconds1, settings.volumeApplyDelaySeconds2, settings.volumeApplyDelaySeconds3];
      debugLog("volume schedule", { tabId: createdTab.id, delaySeconds: volumeDelays, volume: event.volume });
      scheduleVolumeApplyAttempts(createdTab.id, event.volume, volumeDelays, event.url);
    } else {
      debugLog("volume skipped", {
        tabId: createdTab.id,
        reason: "volume not configured",
        url: event.url,
        volume: event.volume
      });
    }

    debugLog("loop schedule", { tabId: createdTab.id, afterSeconds: settings.loopStartDelaySeconds });
    setTimeout(() => {
      applyLoopToggleInTab(createdTab.id).catch((error) => {
        debugError("loop apply failed", error, { tabId: createdTab.id, url: event.url });
      });
    }, settings.loopStartDelaySeconds * 1000);

    if (Number.isFinite(event.endTime) && event.endTime > Date.now()) {
      await rememberOpenedTab(event, createdTab.id);
      await scheduleNextTabClose();
    }
  }

  await markEventFired(event);
}


async function applyLoopToggleInTab(tabId) {
  debugLog("loop apply start", { tabId });
  await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: () => {
      const K = "__yt_loop_on";
      const T = "__yt_loop_timer";
      const ID = "__yt_loop_badge";
      console.log("[Calendar Site Opener][content] loop script start");
      window[K] = true;
      clearInterval(window[T]);
      const text = "ループ中";
      const getBox = () => {
        const video = document.querySelector("video");
        if (video) return video.getBoundingClientRect();
        const player = document.querySelector("#movie_player,.html5-video-player,ytd-player");
        return player ? player.getBoundingClientRect() : null;
      };
      const putBadge = () => {
        let badge = document.getElementById(ID);
        if (!badge) {
          badge = document.createElement("div");
          badge.id = ID;
          document.body.appendChild(badge);
        }
        if (!window[K]) {
          badge.remove();
          return;
        }
        const rect = getBox();
        if (!rect) return;
        badge.textContent = text;
        const left = Math.max(8, rect.left + 16);
        const top = Math.max(8, rect.bottom - 108);
        badge.style.cssText = `all:initial!important;position:fixed!important;left:${left}px!important;top:${top}px!important;z-index:2147483647!important;padding:7px 11px!important;background:rgba(255,0,0,.9)!important;color:white!important;font-size:28px!important;font-weight:700!important;border-radius:9px!important;pointer-events:none!important;font-family:sans-serif!important;line-height:1!important;display:block!important;`;
      };
      const apply = () => {
        document.querySelectorAll("video, audio").forEach((media) => {
          media.loop = !!window[K];
        });
        putBadge();
      };
      apply();
      console.log("[Calendar Site Opener][content] loop enabled");
      if (window[K]) window[T] = setInterval(apply, 500);
    }
  });
  debugLog("loop apply done", { tabId });
}

function scheduleVolumeApplyAttempts(tabId, volumeNormalized, delaySecondsList, eventUrl = "") {
  const scheduleMs = (delaySecondsList || [])
    .map((seconds) => Math.max(0, Number(seconds || 0) * 1000))
    .slice(0, 3);

  const attempts = scheduleMs.length ? scheduleMs : [0];
  attempts.forEach((delayMs) => {
    setTimeout(() => {
      applyVolumeWhenReady(tabId, volumeNormalized).catch((error) => {
        debugError("volume apply failed", error, { tabId, url: eventUrl, delayMs });
      });
    }, delayMs);
  });
}

async function applyVolumeWhenReady(tabId, volumeNormalized) {
  const targetVolume = Math.round(Math.min(1, Math.max(0, volumeNormalized)) * 100);
  debugLog("volume apply start", { tabId, targetVolume });

  await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: (volumePercent) => {
      console.log("[Calendar Site Opener][content] volume script start", { volumePercent });
      const applyOnce = () => {
        const player = document.getElementById("movie_player");
        if (player && typeof player.setVolume === "function") {
          player.setVolume(volumePercent);
          if (typeof player.unMute === "function") player.unMute();
          console.log("[Calendar Site Opener][content] volume applied by movie_player", { volumePercent });
          return;
        }

        const media = document.querySelector("video, audio");
        if (media) {
          media.volume = Math.min(1, Math.max(0, volumePercent / 100));
          if (volumePercent > 0) {
            media.muted = false;
          }
          console.log("[Calendar Site Opener][content] volume applied by media element", { volumePercent });
          return;
        }

        console.log("[Calendar Site Opener][content] volume skipped (player/media not ready)");
      };

      applyOnce();
    },
    args: [targetVolume]
  });
  debugLog("volume apply done", { tabId, targetVolume });
}

function debugLog(message, detail = null) {
  if (detail) {
    console.log(`${DEBUG_PREFIX} ${message}`, detail);
    return;
  }
  console.log(`${DEBUG_PREFIX} ${message}`);
}

function debugError(message, error, detail = null) {
  console.error(`${DEBUG_PREFIX} ${message}`, {
    error: error?.message || String(error),
    ...(detail || {})
  });
}

async function rememberOpenedTab(event, tabId) {
  const openedTabs = await loadOpenedTabs();
  openedTabs[event.key] = {
    tabId,
    closeAt: event.endTime
  };
  await saveOpenedTabs(openedTabs);
}

async function scheduleNextTabClose() {
  const openedTabs = await loadOpenedTabs({ pruneClosedTabs: true });
  const now = Date.now();
  const next = getNextCloseFromOpenedTabs(openedTabs);

  await chrome.alarms.clear(ALARM_CLOSE_NEXT);

  if (!next) {
    return;
  }

  if (next.closeAt <= now) {
    await closeEventTab(next.eventKey, next.tabId);
    await scheduleNextTabClose();
    return;
  }

  await chrome.alarms.create(ALARM_CLOSE_NEXT, { when: next.closeAt });
}

async function loadOpenedTabs({ pruneClosedTabs = false } = {}) {
  const { openedTabs = {} } = await chrome.storage.local.get({ openedTabs: {} });
  if (!pruneClosedTabs) {
    return openedTabs;
  }

  return await cleanupClosedOpenedTabs(openedTabs);
}

async function cleanupClosedOpenedTabs(openedTabs) {
  let dirty = false;

  for (const [eventKey, record] of Object.entries(openedTabs)) {
    if (!Number.isFinite(record?.tabId)) {
      continue;
    }

    const tab = await chrome.tabs.get(record.tabId).catch(() => null);
    if (!tab?.id) {
      delete openedTabs[eventKey];
      dirty = true;
    }
  }

  if (dirty) {
    await saveOpenedTabs(openedTabs);
  }

  return openedTabs;
}

async function saveOpenedTabs(openedTabs) {
  await chrome.storage.local.set({ openedTabs });
}

async function closeDueEventTabAndReschedule() {
  const openedTabs = await loadOpenedTabs();
  const now = Date.now();
  const dueEntries = Object.entries(openedTabs).filter(([, record]) => Number.isFinite(record?.closeAt) && record.closeAt <= now);

  for (const [eventKey, record] of dueEntries) {
    await closeEventTab(eventKey, record.tabId);
  }

  await scheduleNextTabClose();
}

async function closeEventTab(eventKey, tabId) {
  if (Number.isFinite(tabId)) {
    await chrome.tabs.remove(tabId).catch(() => {});
  }

  const openedTabs = await loadOpenedTabs();
  delete openedTabs[eventKey];
  await saveOpenedTabs(openedTabs);
}

async function getOrCreateTargetWindow(windowName) {
  if (!windowName) {
    const current = await chrome.windows.getCurrent().catch(() => null);
    return current?.id;
  }

  const key = `windowName:${windowName}`;
  const { windowNames = {} } = await chrome.storage.local.get({ windowNames: {} });
  const knownId = windowNames[key];

  if (knownId) {
    const existing = await chrome.windows.get(knownId).catch(() => null);
    if (existing?.id) {
      return existing.id;
    }
  }

  const labelUrl = chrome.runtime.getURL(`window_label.html?name=${encodeURIComponent(windowName)}`);
  const created = await chrome.windows.create({ focused: false, url: labelUrl });
  windowNames[key] = created.id;
  await chrome.storage.local.set({ windowNames });
  return created.id;
}

async function listCalendars() {
  const token = await getAuthToken(false);
  const response = await fetch("https://www.googleapis.com/calendar/v3/users/me/calendarList", {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!response.ok) throw new Error("カレンダー一覧を取得できませんでした。");
  const data = await response.json();
  return { calendars: (data.items || []).map((item) => ({ id: item.id, summary: item.summary || item.id })) };
}

async function createEvent(input) {
  const settings = await getSettings();
  const token = await getAuthToken(true);
  const start = new Date(input.startLocal);
  if (!Number.isFinite(start.getTime())) throw new Error("開始日時が不正です。");
  const defaultEnd = new Date(start.getTime() + 30 * 60 * 1000);
  const candidateEnd = input.endLocal ? new Date(input.endLocal) : null;
  const end = Number.isFinite(candidateEnd?.getTime()) ? candidateEnd : defaultEnd;
  if (end.getTime() <= start.getTime()) throw new Error("終了日時は開始日時より後にしてください。");
  const marker = settings.marker || DEFAULT_SETTINGS.marker;
  const url = safeUrl(input.url || "");
  const title = String(input.title || "新規予定").trim();
  const windowName = String(input.windowName || "").trim();
  const closeToken = String(input.closeToken || "").trim();
  const volumePercent = clampInteger(input.volumePercent, 0, 100, null);

  const descriptionLines = [];
  if (url) descriptionLines.push(url);
  if (windowName) descriptionLines.push(`[WIN:${windowName}]`);
  if (closeToken) descriptionLines.push(`[CLOSE:${closeToken}]`);
  if (Number.isFinite(volumePercent)) descriptionLines.push(`[VOL:${volumePercent}]`);

  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const payload = {
    summary: `${title} ${marker}`.trim(),
    description: descriptionLines.join("\n"),
    start: { dateTime: start.toISOString(), timeZone },
    end: { dateTime: end.toISOString(), timeZone }
  };

  const recurrence = buildRecurrence(input.repeatType);
  if (recurrence) {
    payload.recurrence = [recurrence];
  }

  const response = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(settings.calendarId)}/events`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`予定作成に失敗: ${response.status} ${text}`);
  }

  const syncResult = await syncAndScheduleNext(false);
  await chrome.runtime.sendMessage({ type: "eventCreated" }).catch(() => {});
  return syncResult;
}

function buildRecurrence(repeatType) {
  switch (repeatType) {
    case "daily":
      return "RRULE:FREQ=DAILY";
    case "weekdays":
      return "RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR";
    case "weekly":
      return "RRULE:FREQ=WEEKLY";
    case "monthly":
      return "RRULE:FREQ=MONTHLY";
    default:
      return "";
  }
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
  const openedTabs = await loadOpenedTabs();
  const result = await chrome.storage.local.get([
    "upcomingEvents",
    "nextEvent",
    "lastSyncAt",
    "lastError",
    "fired"
  ]);
  const nextClose = getNextCloseFromOpenedTabs(openedTabs);

  return {
    settings,
    upcomingEvents: result.upcomingEvents || [],
    nextEvent: result.nextEvent || null,
    nextClose,
    lastSyncAt: result.lastSyncAt || null,
    lastError: result.lastError || null,
    fired: result.fired || {},
    openedTabs
  };
}

function getNextCloseFromOpenedTabs(openedTabs) {
  let next = null;

  for (const [eventKey, record] of Object.entries(openedTabs || {})) {
    if (!Number.isFinite(record?.closeAt)) {
      continue;
    }

    if (!next || record.closeAt < next.closeAt) {
      next = { eventKey, tabId: record.tabId, closeAt: record.closeAt };
    }
  }

  return next;
}

async function saveLastError(error) {
  await chrome.storage.local.set({
    lastError: {
      message: error?.message || String(error),
      at: Date.now()
    }
  });
}


function buildOpenUrl(rawUrl) {
  const safe = safeUrl(rawUrl);
  if (!safe) {
    return rawUrl;
  }

  const parsed = new URL(safe);
  return parsed.href;
}

async function getCurrentTabUrl() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (tab?.url && /^https?:/i.test(tab.url)) {
    return tab.url;
  }

  return "";
}

async function openCreateEventWindow(initialUrl = "") {
  const current = await chrome.windows.getCurrent();
  const width = 540;
  const height = 560;
  const left = Math.max(0, Math.round(current.left + (current.width - width) / 2));
  const top = Math.max(0, Math.round(current.top + (current.height - height) / 2));

  const safeInitialUrl = safeUrl(initialUrl) || (await getCurrentTabUrl()) || "";
  const createUrl = new URL(chrome.runtime.getURL("create_event.html"));
  if (safeInitialUrl) {
    createUrl.searchParams.set("url", safeInitialUrl);
  }

  await chrome.windows.create({
    url: createUrl.href,
    type: "popup",
    width,
    height,
    left,
    top,
    focused: true
  });
}

function extractVolume(event) {
  const text = joinEventText(event, ["summary", "description", "location"]);

  const token = text.match(/\[VOL:(\d{1,3})\]/i) || text.match(/#vol:(\d{1,3})/i);
  if (!token) {
    return null;
  }

  const value = Number.parseInt(token[1], 10);
  if (!Number.isFinite(value)) {
    return null;
  }

  return Math.min(100, Math.max(0, value)) / 100;
}

function joinEventText(event, keys) {
  return keys.map((key) => event[key] || "").join("\n");
}
