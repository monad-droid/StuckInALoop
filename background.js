const DEFAULTS = {
  loopThresholdMin: 15,
  minTabSwitches: 5,
  snoozeDurationMin: 5,
  navResetsTimer: true,
  ytPausesTimer: true,
};

let config = { ...DEFAULTS };

let state = {
  lastTypingTime: Date.now(),
  tabSwitches: [], // timestamps of tab switches
  notifiedAt: 0, // last time we showed a notification (cooldown)
  enabled: true,
  pausedForVideo: false, // true when actively playing a YouTube video
  pausedAt: 0, // timestamp when pause started (to freeze the timer)
  videoTabId: null, // tab ID of the YouTube video we're tracking
  ready: false, // true once persisted state has been loaded
};

// Reset stats on extension install/reload/update (but keep configs)
chrome.runtime.onInstalled.addListener(() => {
  state.lastTypingTime = Date.now();
  state.tabSwitches = [];
  state.notifiedAt = 0;
  state.pausedForVideo = false;
  state.pausedAt = 0;
  state.videoTabId = null;
  chrome.storage.local.set({
    lastTypingTime: state.lastTypingTime,
    notifiedAt: state.notifiedAt,
    tabSwitches: state.tabSwitches,
  });
});

// Load persisted state and config
chrome.storage.local.get(
  ["enabled", "loopThresholdMin", "minTabSwitches", "snoozeDurationMin", "navResetsTimer", "ytPausesTimer", "lastTypingTime", "notifiedAt", "tabSwitches"],
  (result) => {
    if (result.enabled !== undefined) {
      state.enabled = result.enabled;
    }
    if (result.loopThresholdMin !== undefined) {
      config.loopThresholdMin = result.loopThresholdMin;
    }
    if (result.minTabSwitches !== undefined) {
      config.minTabSwitches = result.minTabSwitches;
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
    // Restore persisted state so it survives service worker restarts
    if (result.lastTypingTime) {
      state.lastTypingTime = result.lastTypingTime;
    }
    if (result.notifiedAt) {
      state.notifiedAt = result.notifiedAt;
    }
    if (result.tabSwitches) {
      state.tabSwitches = result.tabSwitches;
    }
    state.ready = true;
    // Run an immediate check now that state is loaded
    checkForLoop();
    scheduleLoopCheck();
  }
);

// Persist timing state to storage so it survives service worker restarts
function persistState() {
  chrome.storage.local.set({
    lastTypingTime: state.lastTypingTime,
    notifiedAt: state.notifiedAt,
    tabSwitches: state.tabSwitches,
  });
}

// Track tab switches
chrome.tabs.onActivated.addListener((activeInfo) => {
  if (!state.enabled) return;

  // Don't count tab switches while paused for video
  if (!state.pausedForVideo) {
    state.tabSwitches.push(Date.now());
    pruneOldSwitches();
    persistState();
  }

  checkForLoop();
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

// Track window focus changes (switching between browser windows)
chrome.windows.onFocusChanged.addListener((windowId) => {
  if (!state.enabled) return;
  if (windowId !== chrome.windows.WINDOW_ID_NONE) {
    state.tabSwitches.push(Date.now());
    pruneOldSwitches();
    persistState();
  }
});

// If the video tab is closed while paused, unpause
chrome.tabs.onRemoved.addListener((tabId) => {
  if (state.pausedForVideo && state.videoTabId === tabId) {
    unPauseVideo();
    state.videoTabId = null;
  }
});

// Treat URL bar navigation as intentional engagement (resets typing timer)
chrome.webNavigation.onCommitted.addListener((details) => {
  if (!state.enabled || !config.navResetsTimer) return;
  // Only count top-level navigations initiated from the address bar
  // transitionQualifiers includes "from_address_bar" for any omnibox usage
  // (searches, typed URLs, autocomplete selections)
  if (
    details.frameId === 0 &&
    details.transitionQualifiers &&
    details.transitionQualifiers.includes("from_address_bar")
  ) {
    state.lastTypingTime = Date.now();
    persistState();
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
    const now = Date.now();
    pruneOldSwitches();
    // If paused for video, report time as frozen at pause point
    let timeSinceTyping = now - state.lastTypingTime;
    if (state.pausedForVideo) {
      timeSinceTyping = state.pausedAt - state.lastTypingTime;
    }
    sendResponse({
      enabled: state.enabled,
      timeSinceTyping,
      tabSwitchCount: state.tabSwitches.length,
      isInLoop: isInLoop(),
      pausedForVideo: state.pausedForVideo,
      loopThresholdMin: config.loopThresholdMin,
      minTabSwitches: config.minTabSwitches,
      snoozeDurationMin: config.snoozeDurationMin,
      navResetsTimer: config.navResetsTimer,
      ytPausesTimer: config.ytPausesTimer,
    });
  } else if (message.type === "setEnabled") {
    state.enabled = message.enabled;
    chrome.storage.local.set({ enabled: message.enabled });
    if (message.enabled) {
      // Reset when re-enabling
      state.lastTypingTime = Date.now();
      state.tabSwitches = [];
    }
    // Always clear video pause when toggling
    state.pausedForVideo = false;
    state.pausedAt = 0;
    state.videoTabId = null;
    persistState();
    scheduleLoopCheck();
    sendResponse({ ok: true });
  } else if (message.type === "dismiss") {
    // User acknowledged the alert — reset the typing timer but clear
    // the cooldown so the next loop can be detected fresh
    state.lastTypingTime = Date.now();
    state.tabSwitches = [];
    state.notifiedAt = 0;
    state.pausedForVideo = false;
    state.pausedAt = 0;
    state.videoTabId = null;
    persistState();
    scheduleLoopCheck();
    sendResponse({ ok: true });
  } else if (message.type === "snooze") {
    // User snoozed — reset stats, set cooldown for snooze duration
    // We offset notifiedAt so it expires after snoozeDurationMin
    const snoozeCooldownMs = config.snoozeDurationMin * 60 * 1000;
    const NOTIFY_COOLDOWN_MS = 5 * 60 * 1000;
    state.lastTypingTime = Date.now();
    state.tabSwitches = [];
    state.notifiedAt = Date.now() - NOTIFY_COOLDOWN_MS + snoozeCooldownMs;
    state.pausedForVideo = false;
    state.pausedAt = 0;
    state.videoTabId = null;
    persistState();
    scheduleLoopCheck();
    sendResponse({ ok: true });
  } else if (message.type === "setConfig") {
    if (message.loopThresholdMin !== undefined) {
      config.loopThresholdMin = message.loopThresholdMin;
      chrome.storage.local.set({ loopThresholdMin: config.loopThresholdMin });
      // Clamp snooze to stay below new threshold
      if (config.snoozeDurationMin >= config.loopThresholdMin) {
        config.snoozeDurationMin = Math.max(1, config.loopThresholdMin - 1);
        chrome.storage.local.set({ snoozeDurationMin: config.snoozeDurationMin });
      }
    }
    if (message.minTabSwitches !== undefined) {
      config.minTabSwitches = message.minTabSwitches;
      chrome.storage.local.set({ minTabSwitches: config.minTabSwitches });
    }
    if (message.snoozeDurationMin !== undefined) {
      // Enforce snooze < threshold
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
  if (!state.enabled || state.pausedForVideo) return;

  const thresholdMs = config.loopThresholdMin * 60 * 1000;
  const elapsed = Date.now() - state.lastTypingTime;
  const remaining = thresholdMs - elapsed;

  if (remaining <= 0) {
    checkForLoop();
  } else {
    loopTimeout = setTimeout(() => {
      checkForLoop();
    }, remaining);
  }
}

// Backup alarm in case the service worker restarts and loses the timeout
chrome.alarms.create("loopCheck", { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "loopCheck" && state.enabled) {
    checkForLoop();
  }
});

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

function pruneOldSwitches() {
  const windowMs = config.loopThresholdMin * 60 * 1000;
  const cutoff = Date.now() - windowMs;
  state.tabSwitches = state.tabSwitches.filter((t) => t > cutoff);
}

function isInLoop() {
  if (state.pausedForVideo) return false;
  const now = Date.now();
  const timeSinceTyping = now - state.lastTypingTime;
  const thresholdMs = config.loopThresholdMin * 60 * 1000;
  pruneOldSwitches();

  // Trigger if typing threshold is exceeded — either you've been
  // tab-switching (looping) or zoned out on one page (drifting).
  // Both are unproductive.
  return timeSinceTyping >= thresholdMs;
}

function checkForLoop() {
  if (!state.enabled || !state.ready) return;

  const now = Date.now();
  const NOTIFY_COOLDOWN_MS = 5 * 60 * 1000; // don't re-notify within 5min
  if (isInLoop() && now - state.notifiedAt > NOTIFY_COOLDOWN_MS) {
    triggerAlert();
  }
}

function triggerAlert() {
  const minutes = Math.round(
    (Date.now() - state.lastTypingTime) / 1000 / 60
  );

  // Set cooldown immediately to prevent repeated triggers
  state.notifiedAt = Date.now();
  persistState();

  // Always show browser notification (works on any page)
  chrome.notifications.create("loop-alert-" + Date.now(), {
    type: "basic",
    iconUrl: "icons/icon128.png",
    title: "You're stuck in a loop!",
    message: `You've been ${minutes} minutes without typing anything. Take a breath — what did you actually want to do?`,
    priority: 2,
    requireInteraction: true,
  });

  // Try to inject overlay into the active tab (only works on http pages)
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs && tabs[0];
    if (!tab || !tab.url || !tab.url.startsWith("http")) return;

    chrome.tabs.sendMessage(tab.id, { type: "showOverlay", minutes, snoozeDurationMin: config.snoozeDurationMin }, (response) => {
      if (chrome.runtime.lastError) {
        // Content script not loaded — inject dynamically
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ["content.js"],
        }, () => {
          if (chrome.runtime.lastError) return;
          setTimeout(() => {
            chrome.tabs.sendMessage(tab.id, { type: "showOverlay", minutes, snoozeDurationMin: config.snoozeDurationMin });
          }, 100);
        });
      }
    });
  });
}
