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
const inactiveList = document.getElementById("inactive-periods-list");
const inactiveBadge = document.getElementById("inactive-badge");
const addPeriodBtn = document.getElementById("add-period-btn");

let currentEnabled = true;
let currentMinSwitches = 0;
const MAX_SWITCHES = 20;
let currentInactivePeriods = [{ start: 8, end: 17, days: [0, 1, 2, 3, 4, 5, 6] }];
const DAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];

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

function formatHour(h) {
  if (h === 0 || h === 24) return "12 AM";
  if (h === 12) return "12 PM";
  return h < 12 ? h + " AM" : (h - 12) + " PM";
}

function buildHourOptions(selected) {
  let html = "";
  for (let h = 0; h <= 24; h++) {
    const label = h === 24 ? "12 AM (next day)" : formatHour(h);
    html += `<option value="${h}" ${h === selected ? "selected" : ""}>${label}</option>`;
  }
  return html;
}

function buildDayChips(periodIndex, activeDays) {
  const days = activeDays || [0, 1, 2, 3, 4, 5, 6];
  return DAY_LABELS.map((label, dayNum) => {
    const active = days.includes(dayNum) ? "active" : "";
    return `<button class="day-chip ${active}" data-period="${periodIndex}" data-day="${dayNum}">${label}</button>`;
  }).join("");
}

function renderInactivePeriods() {
  inactiveList.innerHTML = "";
  const allDay = currentInactivePeriods.some((p) => p.start === 0 && p.end === 24);

  currentInactivePeriods.forEach((period, i) => {
    const row = document.createElement("div");
    row.className = "inactive-period-row";
    row.style.flexWrap = "wrap";

    if (period.start === 0 && period.end === 24) {
      row.classList.add("all-day-row");
      row.style.flexWrap = "wrap";
      row.innerHTML = `
        <span style="font-size:12px;font-weight:500;color:#191c1d;">All day</span>
        <button class="remove-period" data-index="${i}" title="Remove">
          <span class="material-symbols-outlined" style="font-size:18px;">close</span>
        </button>
        <div class="day-chips" style="width:100%;">${buildDayChips(i, period.days)}</div>
      `;
    } else {
      row.innerHTML = `
        <select class="period-start" data-index="${i}">${buildHourOptions(period.start)}</select>
        <span class="period-label">to</span>
        <select class="period-end" data-index="${i}">${buildHourOptions(period.end)}</select>
        <button class="remove-period" data-index="${i}" title="Remove">
          <span class="material-symbols-outlined" style="font-size:18px;">close</span>
        </button>
        <div class="day-chips" style="width:100%;">${buildDayChips(i, period.days)}</div>
      `;
    }
    inactiveList.appendChild(row);
  });

  // Update badge
  if (currentInactivePeriods.length === 0) {
    inactiveBadge.textContent = "none";
  } else if (allDay) {
    inactiveBadge.textContent = "all day";
  } else {
    const n = currentInactivePeriods.length;
    inactiveBadge.textContent = n + (n === 1 ? " block" : " blocks");
  }

  // Bind time select events
  inactiveList.querySelectorAll(".period-start").forEach((sel) => {
    sel.addEventListener("change", (e) => {
      const idx = parseInt(e.target.dataset.index);
      currentInactivePeriods[idx].start = parseInt(e.target.value);
      saveInactivePeriods();
    });
  });
  inactiveList.querySelectorAll(".period-end").forEach((sel) => {
    sel.addEventListener("change", (e) => {
      const idx = parseInt(e.target.dataset.index);
      currentInactivePeriods[idx].end = parseInt(e.target.value);
      saveInactivePeriods();
    });
  });
  // Bind remove buttons
  inactiveList.querySelectorAll(".remove-period").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const idx = parseInt(e.currentTarget.dataset.index);
      currentInactivePeriods.splice(idx, 1);
      saveInactivePeriods();
      renderInactivePeriods();
    });
  });
  // Bind day chip toggles
  inactiveList.querySelectorAll(".day-chip").forEach((chip) => {
    chip.addEventListener("click", (e) => {
      const pi = parseInt(e.target.dataset.period);
      const day = parseInt(e.target.dataset.day);
      const period = currentInactivePeriods[pi];
      if (!period.days) period.days = [0, 1, 2, 3, 4, 5, 6];
      const idx = period.days.indexOf(day);
      if (idx >= 0) {
        period.days.splice(idx, 1);
      } else {
        period.days.push(day);
        period.days.sort();
      }
      saveInactivePeriods();
      renderInactivePeriods();
    });
  });
}

function saveInactivePeriods() {
  chrome.runtime.sendMessage({ type: "setConfig", inactivePeriods: currentInactivePeriods });
}

addPeriodBtn.addEventListener("click", () => {
  if (currentInactivePeriods.length === 0) {
    currentInactivePeriods.push({ start: 8, end: 17, days: [0, 1, 2, 3, 4, 5, 6] });
  } else {
    currentInactivePeriods.push({ start: 0, end: 24, days: [0, 1, 2, 3, 4, 5, 6] });
  }
  saveInactivePeriods();
  renderInactivePeriods();
});

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

    // Sync inactive periods (only re-render if changed)
    if (response.inactivePeriods !== undefined) {
      const newJson = JSON.stringify(response.inactivePeriods);
      if (newJson !== JSON.stringify(currentInactivePeriods)) {
        currentInactivePeriods = response.inactivePeriods;
        renderInactivePeriods();
      }
    }

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

    if (response.isInInactivePeriod) {
      statusEl.textContent = "Inactive Period";
      statusEl.className = "state-value";
      statusSubtitle.textContent = "Monitoring paused";
    } else if (response.pausedForVideo) {
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

renderInactivePeriods();
update();
setInterval(update, 1000);
