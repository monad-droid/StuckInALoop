const statusEl = document.getElementById("status");
const statusSubtitle = document.getElementById("status-subtitle");
const typingTimeEl = document.getElementById("typing-time");
const enabledToggle = document.getElementById("enabled-toggle");
const statusDot = document.getElementById("status-dot");
const statusPing = document.getElementById("status-ping");
const thresholdInput = document.getElementById("threshold-min");
const thresholdBadge = document.getElementById("threshold-badge");
const snoozeDurationInput = document.getElementById("snooze-duration");
const snoozeBadge = document.getElementById("snooze-badge");
const mouseIdleInput = document.getElementById("mouse-idle");
const idleBadge = document.getElementById("idle-badge");
const navResetsToggle = document.getElementById("nav-resets-toggle");
const ytPauseToggle = document.getElementById("yt-pause-toggle");
const igReelsToggle = document.getElementById("ig-reels-toggle");
const xVideosToggle = document.getElementById("x-videos-toggle");
const fbVideosToggle = document.getElementById("fb-videos-toggle");
const tiktokVideosToggle = document.getElementById("tiktok-videos-toggle");
const clickResetsToggle = document.getElementById("click-resets-toggle");
const chromeFocusToggle = document.getElementById("chrome-focus-toggle");
const inactiveList = document.getElementById("inactive-periods-list");
const addPeriodBtn = document.getElementById("add-period-btn");
const ignoredSitesList = document.getElementById("ignored-sites-list");
const addSiteInput = document.getElementById("add-site-input");
const addSiteBtn = document.getElementById("add-site-btn");

let currentEnabled = true;
// True once we've received real state from the background. Until then the
// local lists hold placeholder defaults and must never be saved, or they
// would overwrite the user's stored config.
let stateSynced = false;
let currentInactivePeriods = [{ start: 8, end: 17, days: [1, 2, 3, 4, 5] }];
let currentIgnoredSites = []; // [{domain, action: "pause"|"reset"}]
let currentChromeFocusLost = "pause";
const DAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];

function formatTimer(ms) {
  if (ms < 0) ms = 0;
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec.toString().padStart(2, "0")}`;
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
  if (!stateSynced) return;
  chrome.runtime.sendMessage({ type: "setConfig", inactivePeriods: currentInactivePeriods });
}

addPeriodBtn.addEventListener("click", () => {
  if (currentInactivePeriods.length === 0) {
    currentInactivePeriods.push({ start: 8, end: 17, days: [1, 2, 3, 4, 5] });
  } else {
    currentInactivePeriods.push({ start: 0, end: 24, days: [0, 1, 2, 3, 4, 5, 6] });
  }
  saveInactivePeriods();
  renderInactivePeriods();
});

// Ignored sites
function renderIgnoredSites() {
  ignoredSitesList.innerHTML = "";
  currentIgnoredSites.forEach((entry, i) => {
    const domain = typeof entry === "string" ? entry : entry.domain;
    const action = typeof entry === "string" ? "reset" : (entry.action || "reset");
    const row = document.createElement("div");
    row.className = "ignored-site-row";
    row.innerHTML = `
      <span></span>
      <div class="site-action-toggle">
        <button class="site-action-pause ${action === "pause" ? "active" : ""}" data-index="${i}">Pause</button>
        <button class="site-action-reset ${action === "reset" ? "active" : ""}" data-index="${i}">Reset</button>
      </div>
      <button class="remove-site" data-index="${i}" title="Remove">
        <span class="material-symbols-outlined" style="font-size:18px;">close</span>
      </button>
    `;
    // Domain is user-entered text — render it as text, never as markup
    row.querySelector("span").textContent = domain;
    ignoredSitesList.appendChild(row);
  });
  ignoredSitesList.querySelectorAll(".remove-site").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const idx = parseInt(e.currentTarget.dataset.index);
      currentIgnoredSites.splice(idx, 1);
      saveIgnoredSites();
      renderIgnoredSites();
    });
  });
  ignoredSitesList.querySelectorAll(".site-action-pause").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const idx = parseInt(e.target.dataset.index);
      setIgnoredSiteAction(idx, "pause");
    });
  });
  ignoredSitesList.querySelectorAll(".site-action-reset").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const idx = parseInt(e.target.dataset.index);
      setIgnoredSiteAction(idx, "reset");
    });
  });
}

function setIgnoredSiteAction(idx, action) {
  const entry = currentIgnoredSites[idx];
  if (typeof entry === "string") {
    currentIgnoredSites[idx] = { domain: entry, action };
  } else {
    entry.action = action;
  }
  saveIgnoredSites();
  renderIgnoredSites();
}

function saveIgnoredSites() {
  if (!stateSynced) return;
  chrome.runtime.sendMessage({ type: "setConfig", ignoredSites: currentIgnoredSites });
}

function addIgnoredSite() {
  let site = addSiteInput.value.trim().toLowerCase();
  if (!site) return;
  try {
    if (site.includes("://")) site = new URL(site).hostname;
    else if (site.includes("/")) site = site.split("/")[0];
  } catch {}
  if (site && !currentIgnoredSites.some((e) => (typeof e === "string" ? e : e.domain) === site)) {
    currentIgnoredSites.push({ domain: site, action: "pause" });
    saveIgnoredSites();
    renderIgnoredSites();
  }
  addSiteInput.value = "";
}

addSiteBtn.addEventListener("click", addIgnoredSite);
addSiteInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") addIgnoredSite();
});

function update() {
  chrome.runtime.sendMessage({ type: "getState" }, (response) => {
    if (!response) return;

    currentEnabled = response.enabled;
    setEnabledUI(response.enabled);

    // Sync config inputs (only when not actively dragging)
    if (document.activeElement !== thresholdInput) {
      thresholdInput.value = response.loopThresholdMin;
      thresholdBadge.textContent = response.loopThresholdMin + " min";
    }
    if (document.activeElement !== snoozeDurationInput) {
      snoozeDurationInput.value = response.snoozeDurationMin;
      snoozeDurationInput.max = Math.max(1, response.loopThresholdMin - 1);
      snoozeBadge.textContent = response.snoozeDurationMin + " min";
    }
    if (document.activeElement !== mouseIdleInput) {
      mouseIdleInput.value = response.mouseIdleMinutes;
      idleBadge.textContent = response.mouseIdleMinutes + " min";
    }
    setToggleState(navResetsToggle, response.navResetsTimer);
    setToggleState(ytPauseToggle, response.ytPausesTimer);
    setToggleState(igReelsToggle, response.pauseInstagramReels);
    setToggleState(xVideosToggle, response.pauseXVideos);
    setToggleState(fbVideosToggle, response.pauseFacebookVideos);
    setToggleState(tiktokVideosToggle, response.pauseTikTokVideos);
    setToggleState(clickResetsToggle, response.clickResetsTimer);

    // Sync Chrome focus setting
    if (response.chromeFocusLost !== undefined && response.chromeFocusLost !== currentChromeFocusLost) {
      currentChromeFocusLost = response.chromeFocusLost;
      updateChromeFocusToggle();
    }

    // Sync inactive periods (only re-render if changed)
    if (response.inactivePeriods !== undefined) {
      const newJson = JSON.stringify(response.inactivePeriods);
      if (newJson !== JSON.stringify(currentInactivePeriods)) {
        currentInactivePeriods = response.inactivePeriods;
        renderInactivePeriods();
      }
    }

    // Sync ignored sites
    if (response.ignoredSites !== undefined) {
      const newJson = JSON.stringify(response.ignoredSites);
      if (newJson !== JSON.stringify(currentIgnoredSites)) {
        currentIgnoredSites = response.ignoredSites;
        renderIgnoredSites();
      }
    }

    // Real state received — list edits may be saved from now on
    stateSynced = true;

    if (!response.enabled) {
      statusEl.textContent = "Off";
      statusEl.className = "state-value";
      statusSubtitle.textContent = "Detection disabled";
      typingTimeEl.textContent = "--:--";
      return;
    }

    typingTimeEl.textContent = formatTimer(response.timeSinceTyping);

    const warningThreshold = response.loopThresholdMin * 0.66 * 60 * 1000;

    if (response.userIdle) {
      statusEl.textContent = "Idle";
      statusEl.className = "state-value";
      statusSubtitle.textContent = "No activity detected";
      typingTimeEl.textContent = "0:00";
    } else if (response.chromeUnfocused) {
      statusEl.textContent = "Chrome Unfocused";
      statusEl.className = "state-value";
      if (response.chromeFocusLost === "pause") {
        statusSubtitle.textContent = "Timer paused while away";
      } else {
        statusSubtitle.textContent = "Timer will reset while away";
        typingTimeEl.textContent = "0:00";
      }
    } else if (response.onIgnoredSite) {
      statusEl.textContent = "Ignored Site";
      statusEl.className = "state-value";
      statusSubtitle.textContent = "Tracking paused for this site";
    } else if (response.isInInactivePeriod) {
      statusEl.textContent = "Inactive Period";
      statusEl.className = "state-value";
      typingTimeEl.textContent = "0:00";
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

// Snooze slider
snoozeDurationInput.addEventListener("input", () => {
  snoozeBadge.textContent = snoozeDurationInput.value + " min";
});
snoozeDurationInput.addEventListener("change", saveConfig);

// Mouse idle slider
mouseIdleInput.addEventListener("input", () => {
  idleBadge.textContent = mouseIdleInput.value + " min";
});
mouseIdleInput.addEventListener("change", () => {
  chrome.runtime.sendMessage({ type: "setConfig", mouseIdleMinutes: parseInt(mouseIdleInput.value) });
});

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
igReelsToggle.addEventListener("click", () => {
  const isOn = igReelsToggle.classList.contains("on");
  setToggleState(igReelsToggle, !isOn);
  chrome.runtime.sendMessage({ type: "setConfig", pauseInstagramReels: !isOn });
});
xVideosToggle.addEventListener("click", () => {
  const isOn = xVideosToggle.classList.contains("on");
  setToggleState(xVideosToggle, !isOn);
  chrome.runtime.sendMessage({ type: "setConfig", pauseXVideos: !isOn });
});
fbVideosToggle.addEventListener("click", () => {
  const isOn = fbVideosToggle.classList.contains("on");
  setToggleState(fbVideosToggle, !isOn);
  chrome.runtime.sendMessage({ type: "setConfig", pauseFacebookVideos: !isOn });
});
tiktokVideosToggle.addEventListener("click", () => {
  const isOn = tiktokVideosToggle.classList.contains("on");
  setToggleState(tiktokVideosToggle, !isOn);
  chrome.runtime.sendMessage({ type: "setConfig", pauseTikTokVideos: !isOn });
});
clickResetsToggle.addEventListener("click", () => {
  const isOn = clickResetsToggle.classList.contains("on");
  setToggleState(clickResetsToggle, !isOn);
  chrome.runtime.sendMessage({ type: "setConfig", clickResetsTimer: !isOn });
});

// Chrome focus lost toggle
function updateChromeFocusToggle() {
  const pauseBtn = chromeFocusToggle.querySelector(".chrome-focus-pause");
  const resetBtn = chromeFocusToggle.querySelector(".chrome-focus-reset");
  pauseBtn.classList.toggle("active", currentChromeFocusLost === "pause");
  resetBtn.classList.toggle("active", currentChromeFocusLost === "reset");
}
chromeFocusToggle.querySelector(".chrome-focus-pause").addEventListener("click", () => {
  currentChromeFocusLost = "pause";
  updateChromeFocusToggle();
  chrome.runtime.sendMessage({ type: "setConfig", chromeFocusLost: "pause" });
});
chromeFocusToggle.querySelector(".chrome-focus-reset").addEventListener("click", () => {
  currentChromeFocusLost = "reset";
  updateChromeFocusToggle();
  chrome.runtime.sendMessage({ type: "setConfig", chromeFocusLost: "reset" });
});

function saveConfig() {
  const loopThresholdMin = Math.max(1, Math.min(60, parseInt(thresholdInput.value) || 15));
  const maxSnooze = Math.max(1, loopThresholdMin - 1);
  const snoozeDurationMin = Math.max(0, Math.min(maxSnooze, parseInt(snoozeDurationInput.value) || 0));
  snoozeDurationInput.max = maxSnooze;
  chrome.runtime.sendMessage({
    type: "setConfig",
    loopThresholdMin,
    snoozeDurationMin,
  });
}

// One-time hint explaining the new autoplay blocker
chrome.storage.local.get(["autoplayHintSeen"], (result) => {
  if (!result.autoplayHintSeen) {
    const hint = document.getElementById("autoplay-hint");
    hint.style.display = "flex";
    document.getElementById("autoplay-hint-dismiss").addEventListener("click", () => {
      hint.style.display = "none";
      chrome.storage.local.set({ autoplayHintSeen: true });
    });
  }
});

// One-time hint for ignored websites
chrome.storage.local.get(["ignoredSitesHintSeen"], (result) => {
  if (!result.ignoredSitesHintSeen) {
    const hint = document.getElementById("ignored-hint");
    hint.style.display = "flex";
    document.getElementById("ignored-hint-dismiss").addEventListener("click", () => {
      hint.style.display = "none";
      chrome.storage.local.set({ ignoredSitesHintSeen: true });
    });
  }
});

renderInactivePeriods();
renderIgnoredSites();
update();
setInterval(update, 1000);
