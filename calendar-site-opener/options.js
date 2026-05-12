const form = document.getElementById("settingsForm");
const statusEl = document.getElementById("status");
const openShortcutsButton = document.getElementById("openShortcuts");

const fields = {
  calendarId: document.getElementById("calendarId"),
  marker: document.getElementById("marker"),
  defaultUrl: document.getElementById("defaultUrl"),
  skipNoUrlEvents: document.getElementById("skipNoUrlEvents"),
  targetWindowName: document.getElementById("targetWindowName"),
  lookAheadHours: document.getElementById("lookAheadHours"),
  refreshMinutes: document.getElementById("refreshMinutes"),
  missedGraceMinutes: document.getElementById("missedGraceMinutes"),
  openActiveTab: document.getElementById("openActiveTab"),
  loopStartDelaySeconds: document.getElementById("loopStartDelaySeconds"),
  volumeApplyDelaySeconds1: document.getElementById("volumeApplyDelaySeconds1"),
  volumeApplyDelaySeconds2: document.getElementById("volumeApplyDelaySeconds2"),
  volumeApplyDelaySeconds3: document.getElementById("volumeApplyDelaySeconds3")
};

loadSettings();

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  setStatus("保存中...");

  const settings = {
    calendarId: fields.calendarId.value,
    marker: fields.marker.value,
    defaultUrl: fields.defaultUrl.value,
    skipNoUrlEvents: fields.skipNoUrlEvents.checked,
    targetWindowName: fields.targetWindowName.value,
    lookAheadHours: fields.lookAheadHours.value,
    refreshMinutes: fields.refreshMinutes.value,
    missedGraceMinutes: fields.missedGraceMinutes.value,
    openActiveTab: fields.openActiveTab.checked,
    loopStartDelaySeconds: fields.loopStartDelaySeconds.value,
    volumeApplyDelaySeconds1: fields.volumeApplyDelaySeconds1.value,
    volumeApplyDelaySeconds2: fields.volumeApplyDelaySeconds2.value,
    volumeApplyDelaySeconds3: fields.volumeApplyDelaySeconds3.value
  };

  const result = await chrome.runtime.sendMessage({
    type: "saveSettings",
    settings
  });

  if (!result.ok) {
    setStatus(`保存に失敗: ${result.error}`);
    return;
  }

  populate(result.settings);
  setStatus(`保存しました。取得予定数: ${result.eventCount ?? 0}`);
});

async function loadSettings() {
  const result = await chrome.runtime.sendMessage({ type: "getState" });

  if (!result.ok) {
    setStatus(`読み込み失敗: ${result.error}`);
    return;
  }

  populate(result.settings);
  await loadCalendarOptions(result.settings.calendarId);
  setStatus("読み込みました。");
}

function populate(settings) {
  fields.calendarId.value = settings.calendarId;
  fields.marker.value = settings.marker;
  fields.defaultUrl.value = settings.defaultUrl;
  fields.skipNoUrlEvents.checked = settings.skipNoUrlEvents;
  fields.targetWindowName.value = settings.targetWindowName;
  fields.lookAheadHours.value = settings.lookAheadHours;
  fields.refreshMinutes.value = settings.refreshMinutes;
  fields.missedGraceMinutes.value = settings.missedGraceMinutes;
  fields.openActiveTab.checked = settings.openActiveTab;
  fields.loopStartDelaySeconds.value = settings.loopStartDelaySeconds;
  fields.volumeApplyDelaySeconds1.value = settings.volumeApplyDelaySeconds1;
  fields.volumeApplyDelaySeconds2.value = settings.volumeApplyDelaySeconds2;
  fields.volumeApplyDelaySeconds3.value = settings.volumeApplyDelaySeconds3;
}

async function loadCalendarOptions(selectedId) {
  const result = await chrome.runtime.sendMessage({ type: "listCalendars" });
  fields.calendarId.innerHTML = "";

  if (!result.ok || !result.calendars?.length) {
    addCalendarOption(selectedId || "primary", selectedId || "primary");
    return;
  }

  for (const cal of result.calendars) {
    addCalendarOption(cal.id, `${cal.summary} (${cal.id})`);
  }

  fields.calendarId.value = selectedId;
  if (fields.calendarId.value !== selectedId) {
    addCalendarOption(selectedId, `${selectedId} (手入力)`);
    fields.calendarId.value = selectedId;
  }
}

function addCalendarOption(value, label) {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = label;
  fields.calendarId.append(option);
}

function setStatus(text) {
  statusEl.textContent = text;
}


openShortcutsButton?.addEventListener("click", async () => {
  await chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
});
