const statusEl = document.getElementById("status");
const createEventButton = document.getElementById("createEvent");
const newTitleEl = document.getElementById("newTitle");
const newStartEl = document.getElementById("newStart");
const newUrlEl = document.getElementById("newUrl");

initialize();

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

  setStatus("予定を追加しました。2秒後に閉じます。");
  setTimeout(() => window.close(), 2000);
});

async function initialize() {
  newStartEl.value = toLocalDatetimeValue(new Date());
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.url && /^https?:/i.test(tab.url)) {
    newUrlEl.value = tab.url;
  }
  setStatus("入力内容を確認して追加してください。");
}

function toLocalDatetimeValue(date) {
  const pad = (v) => String(v).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function setStatus(text) {
  statusEl.textContent = text;
}
