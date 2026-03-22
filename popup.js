const statusEl = document.getElementById("status");
const statusSubtitle = document.getElementById("status-subtitle");
const typingTimeEl = document.getElementById("typing-time");
const activeTimeEl = document.getElementById("active-time");
const switchCountEl = document.getElementById("switch-count");
const enabledToggle = document.getElementById("enabled-toggle");
const statusDot = document.getElementById("status-dot");
const statusPing = document.getElementById("status-ping");
const thresholdInput = document.getElementById("threshold-min");
const thresholdBadge = document.getElementById("threshold-badge");
const switchesBadge = document.getElementById("switches-badge");
const switchesFill = document.getElementById("switches-fill");
const switchesDec = document.getElementById("switches-dec");
const switchesInc = document.getElementById("switches-inc");
const snoozeDurationInput = document.getElementById("snooze-duration");
const snoozeBadge = document.getElementById("snooze-badge");
const navResetsToggle = document.getElementById("nav-resets-toggle");
const ytPauseToggle = document.getElementById("yt-pause-toggle");
const clickResetsToggle = document.getElementById("click-resets-toggle");

let currentEnabled = true;
let currentMinSwitches = 0;
const MAX_SWITCHES = 20;

function formatTimer(ms) {
  if (ms < 0) ms = 0;
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec.toString().padStart(2, "0")}`;
}

function formatActiveTime(ms) {
  const totalSec = Math.floor(ms / 1000);
  const hrs = Math.floor(totalSec / 3600);
  const min = Math.floor((totalSec % 3600) / 60);
  const sec = totalSec % 60;
  if (hrs > 0) return `${hrs}:${min.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
  return `${min}:${sec.toString().padStart(2, "0")}`;
}

function updateSwitchesFill() {
  const pct = Math.min(100, (currentMinSwitches / MAX_SWITCHES) * 100);
  switchesFill.style.width = pct + "%";
  switchesBadge.textContent = currentMinSwitches;
}

function setToggleState(btn, on) {
  btn.classList.toggle("on", on);
  btn.classList.toggle("off", !on);
}

function setEnabledUI(enabled) {
  statusDot.classList.toggle("inactive", !enabled);
  statusPing.classList.toggle("inactive", !enabled);
}

function update() {
  chrome.runtime.sendMessage({ type: "getState" }, (response) => {
    if (!response) return;

    currentEnabled = response.enabled;
    currentMinSwitches = response.minTabSwitches;
    setEnabledUI(response.enabled);

    // Sync config inputs (only when not actively dragging)
    if (document.activeElement !== thresholdInput) {
      thresholdInput.value = response.loopThresholdMin;
      thresholdBadge.textContent = response.loopThresholdMin + " min";
    }
    updateSwitchesFill();
    if (document.activeElement !== snoozeDurationInput) {
      snoozeDurationInput.value = response.snoozeDurationMin;
      snoozeDurationInput.max = Math.max(1, response.loopThresholdMin - 1);
      snoozeBadge.textContent = response.snoozeDurationMin + " min";
    }
    setToggleState(navResetsToggle, response.navResetsTimer);
    setToggleState(ytPauseToggle, response.ytPausesTimer);
    setToggleState(clickResetsToggle, response.clickResetsTimer);

    if (!response.enabled) {
      statusEl.textContent = "Off";
      statusEl.className = "state-value";
      statusSubtitle.textContent = "Detection disabled";
      typingTimeEl.textContent = "--:--";
      switchCountEl.textContent = "--";
      activeTimeEl.textContent = "--";
      return;
    }

    typingTimeEl.textContent = formatTimer(response.timeSinceTyping);
    switchCountEl.textContent = response.tabSwitchCount;
    activeTimeEl.textContent = formatActiveTime(Date.now() - response.sessionStartTime);

    const warningThreshold = response.loopThresholdMin * 0.66 * 60 * 1000;

    if (response.pausedForVideo) {
      statusEl.textContent = "Watching Video";
      statusEl.className = "state-value";
      statusSubtitle.textContent = "Timer paused for playback";
    } else if (response.isInLoop) {
      statusEl.textContent = "Stuck in a Loop!";
      statusEl.className = "state-value danger";
      statusSubtitle.textContent = "Time to refocus";
    } else if (response.timeSinceTyping > warningThreshold) {
      statusEl.textContent = "Drifting...";
      statusEl.className = "state-value warning";
      statusSubtitle.textContent = "Getting close to threshold";
    } else {
      statusEl.textContent = "Flow Active";
      statusEl.className = "state-value";
      statusSubtitle.textContent = "No loop detected";
    }
  });
}

// Enable/Disable toggle (click dot or sensor icon)
function toggleEnabled() {
  currentEnabled = !currentEnabled;
  chrome.runtime.sendMessage({ type: "setEnabled", enabled: currentEnabled });
  setEnabledUI(currentEnabled);
  setTimeout(update, 100);
}
enabledToggle.addEventListener("click", toggleEnabled);

// Threshold slider
thresholdInput.addEventListener("input", () => {
  thresholdBadge.textContent = thresholdInput.value + " min";
});
thresholdInput.addEventListener("change", saveConfig);

// Min tab switches stepper
switchesDec.addEventListener("click", () => {
  if (currentMinSwitches > 1) {
    currentMinSwitches--;
    updateSwitchesFill();
    saveConfig();
  }
});
switchesInc.addEventListener("click", () => {
  if (currentMinSwitches < MAX_SWITCHES) {
    currentMinSwitches++;
    updateSwitchesFill();
    saveConfig();
  }
});

// Snooze slider
snoozeDurationInput.addEventListener("input", () => {
  snoozeBadge.textContent = snoozeDurationInput.value + " min";
});
snoozeDurationInput.addEventListener("change", saveConfig);

// Toggle buttons
navResetsToggle.addEventListener("click", () => {
  const isOn = navResetsToggle.classList.contains("on");
  setToggleState(navResetsToggle, !isOn);
  chrome.runtime.sendMessage({ type: "setConfig", navResetsTimer: !isOn });
});
ytPauseToggle.addEventListener("click", () => {
  const isOn = ytPauseToggle.classList.contains("on");
  setToggleState(ytPauseToggle, !isOn);
  chrome.runtime.sendMessage({ type: "setConfig", ytPausesTimer: !isOn });
});
clickResetsToggle.addEventListener("click", () => {
  const isOn = clickResetsToggle.classList.contains("on");
  setToggleState(clickResetsToggle, !isOn);
  chrome.runtime.sendMessage({ type: "setConfig", clickResetsTimer: !isOn });
});

function saveConfig() {
  const loopThresholdMin = Math.max(1, Math.min(60, parseInt(thresholdInput.value) || 15));
  const minTabSwitches = Math.max(1, Math.min(MAX_SWITCHES, currentMinSwitches));
  const maxSnooze = Math.max(1, loopThresholdMin - 1);
  const snoozeDurationMin = Math.max(0, Math.min(maxSnooze, parseInt(snoozeDurationInput.value) || 0));
  snoozeDurationInput.max = maxSnooze;
  chrome.runtime.sendMessage({
    type: "setConfig",
    loopThresholdMin,
    minTabSwitches,
    snoozeDurationMin,
  });
}

update();
setInterval(update, 1000);
