const statusEl = document.getElementById("status");
const createEventButton = document.getElementById("createEvent");
const newTitleEl = document.getElementById("newTitle");
const newStartEl = document.getElementById("newStart");
const newEndEl = document.getElementById("newEnd");
const newUrlEl = document.getElementById("newUrl");
const newWindowNameEl = document.getElementById("newWindowName");
const newCloseTokenEl = document.getElementById("newCloseToken");
const newVolumeEl = document.getElementById("newVolume");
const autoCloseToggleEl = document.getElementById("autoCloseToggle");
const fullOpenToggleEl = document.getElementById("fullOpenToggle");
const repeatTypeEl = document.getElementById("repeatType");

initialize();

createEventButton.addEventListener("click", async () => {
  setStatus("予定を追加中...");
  const result = await chrome.runtime.sendMessage({
    type: "createEvent",
    event: {
      title: newTitleEl.value,
      startLocal: newStartEl.value,
      endLocal: newEndEl.value,
      url: newUrlEl.value,
      windowName: newWindowNameEl.value,
      closeToken: newCloseTokenEl.value,
      fullOpen: fullOpenToggleEl.checked,
      volumePercent: newVolumeEl.value,
      repeatType: repeatTypeEl.value
    }
  });

  if (!result.ok) {
    setStatus(`追加に失敗: ${result.error}`);
    return;
  }

  setStatus("予定を追加しました。2秒後に閉じます。");
  setTimeout(() => window.close(), 2000);
});

async function initialize() {
  const start = new Date();
  const end = new Date(start.getTime() + 30 * 60 * 1000);
  newStartEl.value = toLocalDatetimeValue(start);
  newEndEl.value = toLocalDatetimeValue(end);

  const params = new URLSearchParams(window.location.search);
  const initialUrl = params.get("url");
  if (initialUrl && /^https?:/i.test(initialUrl)) {
    newUrlEl.value = initialUrl;
  } else {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (tab?.url && /^https?:/i.test(tab.url)) {
      newUrlEl.value = tab.url;
    }
  }

  setStatus("入力内容を確認して追加してください。");
  autoCloseToggleEl.checked = false;
  fullOpenToggleEl.checked = false;
  newCloseTokenEl.value = "";
  newVolumeEl.value = "";
}

autoCloseToggleEl.addEventListener("change", () => {
  if (fullOpenToggleEl.checked) {
    autoCloseToggleEl.checked = false;
    return;
  }

  if (autoCloseToggleEl.checked) {
    newCloseTokenEl.value = "close";
    return;
  }
  newCloseTokenEl.value = "";
});

fullOpenToggleEl.addEventListener("change", () => {
  if (fullOpenToggleEl.checked) {
    autoCloseToggleEl.checked = false;
    newCloseTokenEl.value = "";
  }
});


function toLocalDatetimeValue(date) {
  const pad = (v) => String(v).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function setStatus(text) {
  statusEl.textContent = text;
}
