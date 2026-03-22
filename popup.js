const statusEl = document.getElementById("status");
const typingTimeEl = document.getElementById("typing-time");
const switchCountEl = document.getElementById("switch-count");
const enabledToggle = document.getElementById("enabled-toggle");

function formatTime(ms) {
  const totalSec = Math.floor(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return sec > 0 ? `${min}m ${sec}s` : `${min}m`;
}

function update() {
  chrome.runtime.sendMessage({ type: "getState" }, (response) => {
    if (!response) return;

    enabledToggle.checked = response.enabled;

    if (!response.enabled) {
      statusEl.textContent = "Paused";
      statusEl.className = "status-value";
      typingTimeEl.textContent = "--";
      switchCountEl.textContent = "--";
      return;
    }

    typingTimeEl.textContent = formatTime(response.timeSinceTyping);
    switchCountEl.textContent = response.tabSwitchCount;

    if (response.isInLoop) {
      statusEl.textContent = "Stuck in a loop!";
      statusEl.className = "status-value danger";
    } else if (response.timeSinceTyping > 10 * 60 * 1000) {
      statusEl.textContent = "Drifting...";
      statusEl.className = "status-value warning";
    } else {
      statusEl.textContent = "Focused";
      statusEl.className = "status-value safe";
    }
  });
}

enabledToggle.addEventListener("change", () => {
  chrome.runtime.sendMessage({
    type: "setEnabled",
    enabled: enabledToggle.checked,
  });
  setTimeout(update, 100);
});

update();
setInterval(update, 1000);
