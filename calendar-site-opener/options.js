const form = document.getElementById("settingsForm");
const statusEl = document.getElementById("status");

const fields = {
  calendarId: document.getElementById("calendarId"),
  marker: document.getElementById("marker"),
  defaultUrl: document.getElementById("defaultUrl"),
  lookAheadHours: document.getElementById("lookAheadHours"),
  refreshMinutes: document.getElementById("refreshMinutes"),
  missedGraceMinutes: document.getElementById("missedGraceMinutes"),
  openActiveTab: document.getElementById("openActiveTab")
};

loadSettings();

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  setStatus("保存中...");

  const settings = {
    calendarId: fields.calendarId.value,
    marker: fields.marker.value,
    defaultUrl: fields.defaultUrl.value,
    lookAheadHours: fields.lookAheadHours.value,
    refreshMinutes: fields.refreshMinutes.value,
    missedGraceMinutes: fields.missedGraceMinutes.value,
    openActiveTab: fields.openActiveTab.checked
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
  setStatus("読み込みました。");
}

function populate(settings) {
  fields.calendarId.value = settings.calendarId;
  fields.marker.value = settings.marker;
  fields.defaultUrl.value = settings.defaultUrl;
  fields.lookAheadHours.value = settings.lookAheadHours;
  fields.refreshMinutes.value = settings.refreshMinutes;
  fields.missedGraceMinutes.value = settings.missedGraceMinutes;
  fields.openActiveTab.checked = settings.openActiveTab;
}

function setStatus(text) {
  statusEl.textContent = text;
}
