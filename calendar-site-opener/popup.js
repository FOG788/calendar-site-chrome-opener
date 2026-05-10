const statusEl = document.getElementById("status");
const nextEventEl = document.getElementById("nextEvent");
const nextCloseEl = document.getElementById("nextClose");

const connectButton = document.getElementById("connect");
const refreshButton = document.getElementById("refresh");
const openOptionsButton = document.getElementById("openOptions");
const openCreateEventFormButton = document.getElementById("openCreateEventForm");

connectButton.addEventListener("click", async () => {
  setStatus("接続中...");
  const result = await chrome.runtime.sendMessage({ type: "connect" });
  renderResult(result, "接続しました。");
});

refreshButton.addEventListener("click", async () => {
  setStatus("再読み込み中...");
  const result = await chrome.runtime.sendMessage({ type: "refresh" });
  renderResult(result, "再読み込みしました。");
});

openOptionsButton.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

openCreateEventFormButton.addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const initialUrl = tab?.url && /^https?:/i.test(tab.url) ? tab.url : "";
  await chrome.runtime.sendMessage({ type: "openCreateEventWindow", initialUrl });
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "eventCreated") {
    loadState().catch((error) => setStatus(`失敗: ${error.message}`));
  }
});

loadState();

async function loadState() {
  const result = await chrome.runtime.sendMessage({ type: "getState" });

  if (!result.ok) {
    setStatus(`失敗: ${result.error}`);
    return;
  }

  renderState(result);
}

function renderResult(result, successMessage) {
  if (!result.ok) {
    setStatus(`失敗: ${result.error}`);
    return;
  }

  setStatus(`${successMessage}\n取得予定数: ${result.eventCount ?? 0}`);

  if (result.nextEvent) {
    renderNextEvent(result.nextEvent);
  } else {
    nextEventEl.textContent = "該当予定なし";
  }

  renderNextClose(result.nextClose);
}

function renderState(state) {
  const parts = [];

  if (state.lastSyncAt) {
    parts.push(`最終同期: ${formatDateTime(state.lastSyncAt)}`);
  } else {
    parts.push("まだ同期していません。");
  }

  parts.push(`取得予定数: ${state.upcomingEvents.length}`);

  if (state.lastError) {
    parts.push(`直近エラー: ${state.lastError.message}`);
  }

  setStatus(parts.join("\n"));

  if (state.nextEvent) {
    renderNextEvent(state.nextEvent);
  } else {
    nextEventEl.textContent = "該当予定なし";
  }

  renderNextClose(state.nextClose);
}

function renderNextEvent(event) {
  const url = event.url.length > 90 ? `${event.url.slice(0, 90)}...` : event.url;
  const win = event.windowName ? `\nwindow: ${event.windowName}` : "";
  nextEventEl.textContent = `${event.title}\n${formatDateTime(event.startTime)}\n${url}${win}`;
}

function setStatus(text) {
  statusEl.textContent = text;
}

function renderNextClose(nextClose) {
  if (!nextClose || !Number.isFinite(nextClose.closeAt)) {
    nextCloseEl.textContent = "該当予定なし";
    return;
  }

  nextCloseEl.textContent = `${formatDateTime(nextClose.closeAt)} に閉じます\n(tabId: ${nextClose.tabId ?? "不明"})`;
}

function formatDateTime(value) {
  return new Intl.DateTimeFormat("ja-JP", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}
