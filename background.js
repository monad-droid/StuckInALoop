const DEFAULTS = {
  loopThresholdMin: 10,
  snoozeDurationMin: 5,
  navResetsTimer: true,
  ytPausesTimer: true,
  clickResetsTimer: false,
  inactivePeriods: [{ start: 8, end: 17, days: [1, 2, 3, 4, 5] }], // default: don't monitor 8am–5pm, weekdays only
  ignoredSites: [], // [{domain, action: "pause"|"reset"}] — sites to skip tracking on
  chromeFocusLost: "pause", // "pause" or "reset" — what to do when Chrome loses focus
};

let config = { ...DEFAULTS };

let state = {
  lastTypingTime: Date.now(),
  sessionStartTime: Date.now(), // when the current browsing session started
  notifiedAt: 0, // last time we showed a notification (cooldown)
  enabled: true,
  pausedForVideo: false, // true when actively playing a YouTube video
  pausedAt: 0, // timestamp when pause started (to freeze the timer)
  videoTabId: null, // tab ID of the YouTube video we're tracking
  snoozedAt: 0, // timestamp when snooze started (0 = not snoozing)
  onIgnoredSite: false, // true when active tab is on an ignored site
  ignoredSitePausedAt: 0, // timestamp when ignored-site pause started
  ignoredSiteFrozenMs: 0, // frozen timer value to display while on ignored site
  chromeUnfocusedAt: 0, // timestamp when Chrome lost focus (0 = focused)
  ready: false, // true once persisted state has been loaded
};

// Reset stats on extension install/reload/update (but keep configs)
chrome.runtime.onInstalled.addListener(async (details) => {
  state.lastTypingTime = Date.now();
  state.notifiedAt = 0;
  state.pausedForVideo = false;
  state.pausedAt = 0;
  state.videoTabId = null;
  chrome.storage.local.remove(["lastHeartbeat", "tabSwitches", "minTabSwitches", "chromeUnfocusedAt", "declinedIgnoreSites"]);
  chrome.storage.local.set({
    lastTypingTime: state.lastTypingTime,
    notifiedAt: state.notifiedAt,
  });
  // Inject content script into all existing tabs so typing/click
  // detection works without requiring a page refresh.
  // Must use async/await with per-tab try/catch so a failure on one
  // restricted or discarded tab doesn't kill the entire loop.
  const allTabs = await chrome.tabs.query({});
  for (const tab of allTabs) {
    if (tab.url && tab.url.startsWith("http")) {
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id, allFrames: false },
          files: ["content.js"],
        });
      } catch (e) {
        // Tab may be discarded, suspended, or restricted — skip it
      }
    }
  }
});

// Load persisted state and config
chrome.storage.local.get(
  ["enabled", "loopThresholdMin", "snoozeDurationMin", "navResetsTimer", "ytPausesTimer", "clickResetsTimer", "inactivePeriods", "ignoredSites", "chromeFocusLost", "lastTypingTime", "notifiedAt", "snoozedAt", "pausedForVideo", "pausedAt", "videoTabId"],
  (result) => {
    if (result.enabled !== undefined) {
      state.enabled = result.enabled;
    }
    if (result.loopThresholdMin !== undefined) {
      config.loopThresholdMin = result.loopThresholdMin;
    }
    if (result.snoozeDurationMin !== undefined) {
      config.snoozeDurationMin = result.snoozeDurationMin;
    }
    if (result.navResetsTimer !== undefined) {
      config.navResetsTimer = result.navResetsTimer;
    }
    if (result.ytPausesTimer !== undefined) {
      config.ytPausesTimer = result.ytPausesTimer;
    }
    if (result.clickResetsTimer !== undefined) {
      config.clickResetsTimer = result.clickResetsTimer;
    }
    if (result.inactivePeriods !== undefined) {
      config.inactivePeriods = result.inactivePeriods;
    }
    if (result.ignoredSites !== undefined) {
      config.ignoredSites = result.ignoredSites;
    }
    if (result.chromeFocusLost !== undefined) {
      config.chromeFocusLost = result.chromeFocusLost;
    }
    // Restore persisted state so it survives service worker restarts
    if (result.lastTypingTime) {
      state.lastTypingTime = result.lastTypingTime;
    }
    if (result.notifiedAt) {
      state.notifiedAt = result.notifiedAt;
    }
    if (result.snoozedAt) {
      state.snoozedAt = result.snoozedAt;
    }
    if (result.pausedForVideo) {
      state.pausedForVideo = result.pausedForVideo;
    }
    if (result.pausedAt) {
      state.pausedAt = result.pausedAt;
    }
    if (result.videoTabId != null) {
      state.videoTabId = result.videoTabId;
    }
    state.ready = true;
    // chromeUnfocusedAt is not persisted — it defaults to 0 (focused) on restart.
    // The onFocusChanged listener will set it if Chrome is actually unfocused.
    validateVideoState().then(() => {
      checkForLoop();
      scheduleLoopCheck();
    });
  }
);

// Persist timing state to storage so it survives service worker restarts
function persistState() {
  chrome.storage.local.set({
    lastTypingTime: state.lastTypingTime,
    notifiedAt: state.notifiedAt,
    snoozedAt: state.snoozedAt,
    pausedForVideo: state.pausedForVideo,
    pausedAt: state.pausedAt,
    videoTabId: state.videoTabId,
  });
}

// Verify the tracked video tab is still on a video page and audible.
// If not, unpause immediately. Returns a Promise that resolves to true
// if video state was cleared.
function validateVideoState() {
  return new Promise((resolve) => {
    if (!state.pausedForVideo || state.videoTabId == null) return resolve(false);
    chrome.tabs.get(state.videoTabId, (tab) => {
      if (chrome.runtime.lastError || !tab) {
        unPauseVideo();
        state.videoTabId = null;
        return resolve(true);
      }
      const url = tab.url || "";
      const isYtVideo = url.includes("youtube.com/watch") || url.includes("youtube.com/shorts/");
      if (!isYtVideo || !tab.audible) {
        unPauseVideo();
        state.videoTabId = null;
        return resolve(true);
      }
      resolve(false);
    });
  });
}

// Track tab activations for ignored site detection and video validation
chrome.tabs.onActivated.addListener((activeInfo) => {
  if (!state.enabled) return;
  // Inject content script if not already loaded (covers pre-install tabs)
  chrome.scripting.executeScript({
    target: { tabId: activeInfo.tabId },
    files: ["content.js"],
  }).catch(() => {});
  validateVideoState().then(() => {
    updateIgnoredSiteState();
    checkForLoop();
  });
});

// Re-check ignored site state when a tab's URL changes
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url && state.enabled) {
    // Only care if this is the active tab
    chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
      if (tabs && tabs[0] && tabs[0].id === tabId) {
        updateIgnoredSiteState();
      }
    });
  }
});

// Detect when a YouTube video actually starts/stops playing via audible state
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!state.enabled || !config.ytPausesTimer) return;
  if (changeInfo.audible === undefined) return; // not an audible change

  const url = tab.url || "";
  const isYtVideo = url.includes("youtube.com/watch") || url.includes("youtube.com/shorts/");
  if (!isYtVideo) return;

  if (changeInfo.audible && !state.pausedForVideo) {
    // Video started playing — pause the timer
    state.lastTypingTime = Date.now();
    state.pausedForVideo = true;
    state.pausedAt = Date.now();
    state.videoTabId = tabId;
    persistState();
  } else if (!changeInfo.audible && state.pausedForVideo && state.videoTabId === tabId) {
    // Video stopped playing (paused, ended, muted) — unpause
    unPauseVideo();
  }
});

// Track window focus changes (switching between browser windows or apps)
chrome.windows.onFocusChanged.addListener((windowId) => {
  if (!state.enabled) return;
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    // Chrome lost focus to another application
    if (state.chromeUnfocusedAt === 0) {
      state.chromeUnfocusedAt = Date.now();
      persistState();
    }
  } else {
    // Chrome regained focus (or switched between Chrome windows)
    if (state.chromeUnfocusedAt > 0) {
      // Returning to Chrome — apply the configured action
      if (config.chromeFocusLost === "reset") {
        resetAllTimers();
      } else {
        // Pause mode — credit the away time
        const awayDuration = Date.now() - state.chromeUnfocusedAt;
        state.lastTypingTime += awayDuration;
        state.chromeUnfocusedAt = 0;
        persistState();
        scheduleLoopCheck();
      }
    }
  }
});

// If the video tab is closed while paused, unpause
chrome.tabs.onRemoved.addListener((tabId) => {
  if (state.pausedForVideo && state.videoTabId === tabId) {
    unPauseVideo();
    state.videoTabId = null;
  }
});

// When navResetsTimer is on, any main-frame navigation resets the inactivity
// timer — the user is actively browsing, not zoned out.
function handleNavigation(details) {
  if (!state.enabled || state.onIgnoredSite) return;
  if (details.frameId === 0) {
    state.lastTypingTime = Date.now();
    persistState();
    scheduleLoopCheck();
  }
}
chrome.webNavigation.onCommitted.addListener((details) => {
  if (!state.enabled || details.frameId !== 0) return;
  if (config.navResetsTimer && ["typed", "generated", "form_submit", "auto_bookmark"].includes(details.transitionType)) {
    handleNavigation(details);
  } else if (config.clickResetsTimer && details.transitionType === "link") {
    handleNavigation(details);
  }
});
// SPA navigations (pushState/replaceState) don't fire onCommitted
chrome.webNavigation.onHistoryStateUpdated.addListener((details) => {
  if (config.navResetsTimer || config.clickResetsTimer) {
    handleNavigation(details);
  }
});

// Listen for typing reports from content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "typing") {
    // If paused for video, update both so the frozen display stays at 0
    if (state.pausedForVideo) {
      state.lastTypingTime = Date.now();
      state.pausedAt = Date.now();
    } else {
      state.lastTypingTime = Date.now();
    }
    persistState();
    scheduleLoopCheck();
    sendResponse({ ok: true });
  } else if (message.type === "click") {
    if (config.clickResetsTimer) {
      if (state.pausedForVideo) {
        state.lastTypingTime = Date.now();
        state.pausedAt = Date.now();
      } else {
        state.lastTypingTime = Date.now();
      }
      persistState();
      scheduleLoopCheck();
    }
    sendResponse({ ok: true });
  } else if (message.type === "urlChange") {
    // SPA navigation (pushState/replaceState/hashchange) detected by content script
    if (config.navResetsTimer || config.clickResetsTimer) {
      if (state.pausedForVideo) {
        state.lastTypingTime = Date.now();
        state.pausedAt = Date.now();
      } else {
        state.lastTypingTime = Date.now();
      }
      persistState();
      scheduleLoopCheck();
    }
    sendResponse({ ok: true });
  } else if (message.type === "ytVideo") {
    // User navigated to a YouTube video — track the tab but don't pause yet.
    // Pause only happens when the video actually starts playing (audible).
    if (config.ytPausesTimer && sender.tab) {
      state.videoTabId = sender.tab.id;
    }
    sendResponse({ ok: true });
  } else if (message.type === "ytLeft") {
    // User left the video page (navigated within YouTube) — unpause if active
    unPauseVideo();
    state.videoTabId = null;
    sendResponse({ ok: true });
  } else if (message.type === "getState") {
    // Validate video state before responding so popup always sees current truth
    validateVideoState().then(() => {
      const now = Date.now();
      // If paused (video, ignored site, or Chrome unfocused), report time as frozen
      let timeSinceTyping = now - state.lastTypingTime;
      if (state.pausedForVideo) {
        timeSinceTyping = state.pausedAt - state.lastTypingTime;
      } else if (state.onIgnoredSite) {
        timeSinceTyping = state.ignoredSiteFrozenMs;
      } else if (state.chromeUnfocusedAt > 0) {
        timeSinceTyping = state.chromeUnfocusedAt - state.lastTypingTime;
      }
      sendResponse({
        enabled: state.enabled,
        timeSinceTyping,
        sessionStartTime: state.sessionStartTime,
        isInLoop: isInLoop(),
        pausedForVideo: state.pausedForVideo,
        onIgnoredSite: state.onIgnoredSite,
        loopThresholdMin: config.loopThresholdMin,
        snoozeDurationMin: config.snoozeDurationMin,
        navResetsTimer: config.navResetsTimer,
        ytPausesTimer: config.ytPausesTimer,
        clickResetsTimer: config.clickResetsTimer,
        inactivePeriods: config.inactivePeriods,
        ignoredSites: config.ignoredSites,
        chromeFocusLost: config.chromeFocusLost,
        chromeUnfocused: state.chromeUnfocusedAt > 0,
        isInInactivePeriod: isInInactivePeriod(),
      });
    });
  } else if (message.type === "setEnabled") {
    state.enabled = message.enabled;
    chrome.storage.local.set({ enabled: message.enabled });
    if (message.enabled) {
      // Reset when re-enabling
      state.lastTypingTime = Date.now();
      state.sessionStartTime = Date.now();
      state.snoozedAt = 0;
    }
    // Always clear video pause when toggling
    state.pausedForVideo = false;
    state.pausedAt = 0;
    state.videoTabId = null;
    persistState();
    // If re-enabling with ytPausesTimer on, check for already-audible YouTube
    if (message.enabled && config.ytPausesTimer) {
      chrome.tabs.query({ audible: true }, (tabs) => {
        if (!tabs) return;
        for (const tab of tabs) {
          const url = tab.url || "";
          if ((url.includes("youtube.com/watch") || url.includes("youtube.com/shorts/")) && !state.pausedForVideo) {
            state.lastTypingTime = Date.now();
            state.pausedForVideo = true;
            state.pausedAt = Date.now();
            state.videoTabId = tab.id;
            persistState();
            break;
          }
        }
      });
    }
    scheduleLoopCheck();
    sendResponse({ ok: true });
  } else if (message.type === "dismiss") {
    // User acknowledged the alert — reset the typing timer but clear
    // the cooldown so the next loop can be detected fresh
    state.lastTypingTime = Date.now();
    state.sessionStartTime = Date.now();
    state.snoozedAt = 0;
    state.notifiedAt = 0;
    state.pausedForVideo = false;
    state.pausedAt = 0;
    state.videoTabId = null;
    persistState();
    scheduleLoopCheck();
    // Dismiss overlay in ALL tabs, not just the one that clicked
    chrome.tabs.query({ url: ["http://*/*", "https://*/*"] }, (tabs) => {
      for (const tab of tabs) {
        chrome.tabs.sendMessage(tab.id, { type: "dismissOverlay" }).catch(() => {});
      }
    });
    sendResponse({ ok: true });
  } else if (message.type === "snooze") {
    // User snoozed — re-fire after snoozeDurationMin
    // Offset lastTypingTime so isInLoop() becomes true when snooze expires
    const snoozeCooldownMs = config.snoozeDurationMin * 60 * 1000;
    const thresholdMs = config.loopThresholdMin * 60 * 1000;
    const NOTIFY_COOLDOWN_MS = 2 * 60 * 1000;
    state.snoozedAt = Date.now();
    state.lastTypingTime = Date.now() - thresholdMs + snoozeCooldownMs;
    state.notifiedAt = Date.now() - NOTIFY_COOLDOWN_MS + snoozeCooldownMs;
    state.pausedForVideo = false;
    state.pausedAt = 0;
    state.videoTabId = null;
    persistState();
    scheduleLoopCheck();
    // Dismiss overlay in ALL tabs
    chrome.tabs.query({ url: ["http://*/*", "https://*/*"] }, (tabs) => {
      for (const tab of tabs) {
        chrome.tabs.sendMessage(tab.id, { type: "dismissOverlay" }).catch(() => {});
      }
    });
    sendResponse({ ok: true });
  } else if (message.type === "setConfig") {
    if (message.loopThresholdMin !== undefined) {
      config.loopThresholdMin = message.loopThresholdMin;
      chrome.storage.local.set({ loopThresholdMin: config.loopThresholdMin });
      // Clamp snooze to stay below new threshold
      if (config.snoozeDurationMin >= config.loopThresholdMin) {
        config.snoozeDurationMin = Math.max(0, config.loopThresholdMin - 1);
        chrome.storage.local.set({ snoozeDurationMin: config.snoozeDurationMin });
      }
    }
    if (message.snoozeDurationMin !== undefined) {
      config.snoozeDurationMin = Math.min(message.snoozeDurationMin, config.loopThresholdMin - 1);
      chrome.storage.local.set({ snoozeDurationMin: config.snoozeDurationMin });
    }
    if (message.navResetsTimer !== undefined) {
      config.navResetsTimer = message.navResetsTimer;
      chrome.storage.local.set({ navResetsTimer: config.navResetsTimer });
    }
    if (message.ytPausesTimer !== undefined) {
      config.ytPausesTimer = message.ytPausesTimer;
      chrome.storage.local.set({ ytPausesTimer: config.ytPausesTimer });
      if (!message.ytPausesTimer) {
        // Turning off YouTube detection — clear any active video pause
        unPauseVideo();
        state.videoTabId = null;
      } else {
        // Turning on — check if a YouTube video is already audible
        chrome.tabs.query({ audible: true }, (tabs) => {
          if (!tabs) return;
          for (const tab of tabs) {
            const url = tab.url || "";
            if ((url.includes("youtube.com/watch") || url.includes("youtube.com/shorts/")) && !state.pausedForVideo) {
              state.lastTypingTime = Date.now();
              state.pausedForVideo = true;
              state.pausedAt = Date.now();
              state.videoTabId = tab.id;
              persistState();
              break;
            }
          }
        });
      }
    }
    if (message.clickResetsTimer !== undefined) {
      config.clickResetsTimer = message.clickResetsTimer;
      chrome.storage.local.set({ clickResetsTimer: config.clickResetsTimer });
    }
    if (message.inactivePeriods !== undefined) {
      config.inactivePeriods = message.inactivePeriods;
      chrome.storage.local.set({ inactivePeriods: config.inactivePeriods });
      // If we just entered an inactive period, reset the timer
      if (isInInactivePeriod()) {
        state.lastTypingTime = Date.now();
        persistState();
      }
    }
    if (message.ignoredSites !== undefined) {
      config.ignoredSites = message.ignoredSites;
      chrome.storage.local.set({ ignoredSites: config.ignoredSites });
    }
    if (message.chromeFocusLost !== undefined) {
      config.chromeFocusLost = message.chromeFocusLost;
      chrome.storage.local.set({ chromeFocusLost: config.chromeFocusLost });
    }
    scheduleLoopCheck();
    sendResponse({ ok: true });
  }
  return true; // keep channel open for async sendResponse
});

// Schedule a single check right when the threshold will be hit
let loopTimeout = null;
function scheduleLoopCheck() {
  if (loopTimeout) clearTimeout(loopTimeout);
  if (!state.enabled || state.pausedForVideo || state.onIgnoredSite || state.chromeUnfocusedAt > 0) return;

  const thresholdMs = config.loopThresholdMin * 60 * 1000;
  const elapsed = Date.now() - state.lastTypingTime;
  const remaining = thresholdMs - elapsed;

  if (remaining <= 0) {
    checkForLoop();
  } else {
    // Add 1s buffer so it never fires early
    loopTimeout = setTimeout(() => {
      checkForLoop();
    }, remaining + 1000);
  }
}

// Backup alarm in case the service worker restarts and loses the timeout.
// Chrome MV3 minimum alarm period is 0.5 minutes (30 seconds).
chrome.alarms.create("loopCheck", { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "loopCheck" && state.enabled) {
    checkForLoop();
  }
});

// Use chrome.idle to detect when the user returns from sleep/lock/away.
// Always reset on idle→active so opening the laptop never shows a stale alert.
chrome.idle.setDetectionInterval(60);
chrome.idle.onStateChanged.addListener((newState) => {
  if (newState === "active" && state.enabled) {
    resetAllTimers();
  }
});

// Reset all timers to now — used on wake from sleep, idle→active, etc.
function resetAllTimers() {
  state.lastTypingTime = Date.now();
  state.sessionStartTime = Date.now();
  state.snoozedAt = 0;
  state.notifiedAt = 0;
  state.pausedForVideo = false;
  state.pausedAt = 0;
  state.videoTabId = null;
  state.onIgnoredSite = false;
  state.ignoredSitePausedAt = 0;
  state.ignoredSiteFrozenMs = 0;
  state.chromeUnfocusedAt = 0;
  persistState();
  scheduleLoopCheck();
}

function unPauseVideo() {
  if (!state.pausedForVideo) return;
  // Credit the time spent watching — shift lastTypingTime forward
  const pauseDuration = Date.now() - state.pausedAt;
  state.lastTypingTime += pauseDuration;
  state.pausedForVideo = false;
  state.pausedAt = 0;
  persistState();
  scheduleLoopCheck();
}

// Check if the current time falls within any configured inactive period
function isInInactivePeriod() {
  if (!config.inactivePeriods || config.inactivePeriods.length === 0) return false;
  const now = new Date();
  const hour = now.getHours();
  const day = now.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  return config.inactivePeriods.some((p) => {
    // Check day of week (default to all days for legacy periods without days)
    const days = p.days || [0, 1, 2, 3, 4, 5, 6];
    if (!days.includes(day)) return false;
    if (p.start <= p.end) {
      return hour >= p.start && hour < p.end;
    }
    // Wraps midnight (e.g. 22–6)
    return hour >= p.start || hour < p.end;
  });
}

// Check if a URL matches any ignored site. Returns the matching entry or null.
function matchesIgnoredSite(url) {
  if (!url || !config.ignoredSites || config.ignoredSites.length === 0) return null;
  try {
    const hostname = new URL(url).hostname;
    return config.ignoredSites.find((entry) => {
      const domain = typeof entry === "string" ? entry : entry.domain;
      return hostname === domain || hostname.endsWith("." + domain);
    }) || null;
  } catch {
    return null;
  }
}

// Returns a promise that resolves to the active tab's URL (or "" if unavailable)
function getActiveTabUrl() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
      resolve(tabs && tabs[0] ? (tabs[0].url || "") : "");
    });
  });
}

// Check the active tab and enter/exit ignored site state as needed
function updateIgnoredSiteState() {
  getActiveTabUrl().then((url) => {
    const match = matchesIgnoredSite(url);
    if (match && !state.onIgnoredSite) {
      // Entering an ignored site — freeze the timer while here
      const action = (typeof match === "string") ? "reset" : (match.action || "reset");
      state.onIgnoredSite = true;
      state.ignoredSitePausedAt = Date.now();
      if (action === "reset") {
        // Reset to zero AND freeze
        state.ignoredSiteFrozenMs = 0;
        state.lastTypingTime = Date.now();
      } else {
        // Pause — save the current timer value to display while frozen
        state.ignoredSiteFrozenMs = Date.now() - state.lastTypingTime;
      }
      persistState();
    } else if (!match && state.onIgnoredSite) {
      // Leaving an ignored site
      if (state.ignoredSitePausedAt > 0) {
        // Was pausing — credit the time
        const pauseDuration = Date.now() - state.ignoredSitePausedAt;
        state.lastTypingTime += pauseDuration;
      }
      state.onIgnoredSite = false;
      state.ignoredSitePausedAt = 0;
      state.ignoredSiteFrozenMs = 0;
      persistState();
      scheduleLoopCheck();
    }
  });
}

function isInLoop() {
  if (state.pausedForVideo || state.onIgnoredSite || state.chromeUnfocusedAt > 0 || isInInactivePeriod()) return false;
  const now = Date.now();
  const timeSinceTyping = now - state.lastTypingTime;
  const thresholdMs = config.loopThresholdMin * 60 * 1000;

  // Trigger if typing threshold is exceeded — either you've been
  // tab-switching (looping) or zoned out on one page (drifting).
  // Both are unproductive.
  return timeSinceTyping >= thresholdMs;
}

function checkForLoop() {
  if (!state.enabled || !state.ready || state.onIgnoredSite || state.chromeUnfocusedAt > 0 || isInInactivePeriod()) return;

  const now = Date.now();
  const thresholdMs = config.loopThresholdMin * 60 * 1000;
  const elapsed = now - state.lastTypingTime;

  // If elapsed time is way past the threshold (2x+), the user was away
  // (laptop closed, slept, etc.) — not actually browsing. Reset silently.
  if (elapsed > thresholdMs * 2) {
    resetAllTimers();
    return;
  }

  const NOTIFY_COOLDOWN_MS = Math.min(2 * 60 * 1000, thresholdMs);
  if (isInLoop() && now - state.notifiedAt > NOTIFY_COOLDOWN_MS) {
    triggerAlert();
  }
}

function triggerAlert() {
  const minutes = Math.round(
    (Date.now() - state.lastTypingTime) / 1000 / 60
  );

  // Snooze has expired
  state.snoozedAt = 0;

  // Set cooldown immediately to prevent repeated triggers
  state.notifiedAt = Date.now();
  persistState();

  // Show browser notification
  chrome.notifications.create("loop-alert-" + Date.now(), {
    type: "basic",
    iconUrl: "icons/icon128.png",
    title: "You're stuck in a loop!",
    message: `You've been ${minutes} minutes without typing anything. Take a breath — what did you actually want to do?`,
    priority: 2,
    requireInteraction: true,
  });

  // Show overlay on all http tabs so the user always sees it
  chrome.tabs.query({}, (tabs) => {
    if (!tabs) return;
    for (const tab of tabs) {
      if (!tab.url || !tab.url.startsWith("http")) continue;
      tryShowOverlay(tab.id, minutes);
    }
  });
}

function tryShowOverlay(tabId, minutes) {
  chrome.scripting.executeScript({
    target: { tabId },
    files: ["content.js"],
  }, () => {
    if (chrome.runtime.lastError) return;
    setTimeout(() => {
      chrome.tabs.sendMessage(tabId, { type: "showOverlay", minutes, snoozeDurationMin: config.snoozeDurationMin }).catch(() => {});
    }, 200);
  });
}
