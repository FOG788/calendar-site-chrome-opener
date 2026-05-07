const statusEl = document.getElementById("status");
const nextEventEl = document.getElementById("nextEvent");

const connectButton = document.getElementById("connect");
const refreshButton = document.getElementById("refresh");
const openOptionsButton = document.getElementById("openOptions");
const createEventButton = document.getElementById("createEvent");
const newTitleEl = document.getElementById("newTitle");
const newStartEl = document.getElementById("newStart");
const newUrlEl = document.getElementById("newUrl");

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

createEventButton.addEventListener("click", async () => {
  setStatus("予定を追加中...");
  const result = await chrome.runtime.sendMessage({
    type: "createEvent",
    event: {
      title: newTitleEl.value,
      startLocal: newStartEl.value,
      url: newUrlEl.value
    }
  });

  if (!result.ok) {
    setStatus(`追加に失敗: ${result.error}`);
    return;
  }

  setStatus("予定を追加しました。");
  await loadState();
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
}

function renderNextEvent(event) {
  const url = event.url.length > 90 ? `${event.url.slice(0, 90)}...` : event.url;
  const win = event.windowName ? `\nwindow: ${event.windowName}` : "";
  nextEventEl.textContent = `${event.title}\n${formatDateTime(event.startTime)}\n${url}${win}`;
}

function setStatus(text) {
  statusEl.textContent = text;
}

function formatDateTime(value) {
  return new Intl.DateTimeFormat("ja-JP", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}
