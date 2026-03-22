const statusEl = document.getElementById("status");
const typingTimeEl = document.getElementById("typing-time");
const switchCountEl = document.getElementById("switch-count");
const enabledToggle = document.getElementById("enabled-toggle");
const thresholdInput = document.getElementById("threshold-min");
const minSwitchesInput = document.getElementById("min-switches");
const navResetsToggle = document.getElementById("nav-resets-toggle");
const ytPauseToggle = document.getElementById("yt-pause-toggle");

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

    // Sync config inputs (only when not focused, to avoid fighting the user)
    if (document.activeElement !== thresholdInput) {
      thresholdInput.value = response.loopThresholdMin;
    }
    if (document.activeElement !== minSwitchesInput) {
      minSwitchesInput.value = response.minTabSwitches;
    }
    navResetsToggle.checked = response.navResetsTimer;
    ytPauseToggle.checked = response.ytPausesTimer;

    if (!response.enabled) {
      statusEl.textContent = "Paused";
      statusEl.className = "status-value";
      typingTimeEl.textContent = "--";
      switchCountEl.textContent = "--";
      return;
    }

    typingTimeEl.textContent = formatTime(response.timeSinceTyping);
    switchCountEl.textContent = response.tabSwitchCount;

    const warningThreshold = response.loopThresholdMin * 0.66 * 60 * 1000;

    if (response.pausedForVideo) {
      statusEl.textContent = "Watching video";
      statusEl.className = "status-value safe";
    } else if (response.isInLoop) {
      statusEl.textContent = "Stuck in a loop!";
      statusEl.className = "status-value danger";
    } else if (response.timeSinceTyping > warningThreshold) {
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

function saveConfig() {
  const loopThresholdMin = Math.max(1, Math.min(120, parseInt(thresholdInput.value) || 15));
  const minTabSwitches = Math.max(1, Math.min(50, parseInt(minSwitchesInput.value) || 5));
  chrome.runtime.sendMessage({
    type: "setConfig",
    loopThresholdMin,
    minTabSwitches,
  });
}

thresholdInput.addEventListener("change", saveConfig);
minSwitchesInput.addEventListener("change", saveConfig);
navResetsToggle.addEventListener("change", () => {
  chrome.runtime.sendMessage({
    type: "setConfig",
    navResetsTimer: navResetsToggle.checked,
  });
});
ytPauseToggle.addEventListener("change", () => {
  chrome.runtime.sendMessage({
    type: "setConfig",
    ytPausesTimer: ytPauseToggle.checked,
  });
});

update();
setInterval(update, 1000);
