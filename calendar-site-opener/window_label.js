const name = new URLSearchParams(location.search).get("name") || "default";
document.title = `Window: ${name}`;
const nameEl = document.getElementById("name");
if (nameEl) {
  nameEl.textContent = `Window: ${name}`;
}
