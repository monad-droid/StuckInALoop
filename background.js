const DEFAULTS = {
  loopThresholdMin: 15,
  minTabSwitches: 5,
  navResetsTimer: true,
  ytPausesTimer: true,
};

let config = { ...DEFAULTS };

let state = {
  lastTypingTime: Date.now(),
  tabSwitches: [], // timestamps of tab switches
  notifiedAt: 0, // last time we showed a notification (cooldown)
  enabled: true,
  pausedForVideo: false, // true when watching a YouTube video
  pausedAt: 0, // timestamp when pause started (to freeze the timer)
};

// Load persisted state and config
chrome.storage.local.get(["enabled", "loopThresholdMin", "minTabSwitches", "navResetsTimer", "ytPausesTimer"], (result) => {
  if (result.enabled !== undefined) {
    state.enabled = result.enabled;
  }
  if (result.loopThresholdMin !== undefined) {
    config.loopThresholdMin = result.loopThresholdMin;
  }
  if (result.minTabSwitches !== undefined) {
    config.minTabSwitches = result.minTabSwitches;
  }
  if (result.navResetsTimer !== undefined) {
    config.navResetsTimer = result.navResetsTimer;
  }
  if (result.ytPausesTimer !== undefined) {
    config.ytPausesTimer = result.ytPausesTimer;
  }
  // Always reset lastTypingTime on service worker start
  state.lastTypingTime = Date.now();
});

// Track tab switches
chrome.tabs.onActivated.addListener((activeInfo) => {
  if (!state.enabled) return;
  state.tabSwitches.push(Date.now());
  pruneOldSwitches();

  // If paused for a YouTube video and user switched tabs, unpause
  if (state.pausedForVideo) {
    chrome.tabs.get(activeInfo.tabId, (tab) => {
      if (chrome.runtime.lastError) return;
      const url = tab.url || "";
      const isYtVideo = url.includes("youtube.com/watch") || url.includes("youtube.com/shorts/");
      if (!isYtVideo) {
        unPauseVideo();
      }
    });
  }

  checkForLoop();
});

// Track window focus changes (switching between browser windows)
chrome.windows.onFocusChanged.addListener((windowId) => {
  if (!state.enabled) return;
  if (windowId !== chrome.windows.WINDOW_ID_NONE) {
    state.tabSwitches.push(Date.now());
    pruneOldSwitches();
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
  }
});

// Listen for typing reports from content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "typing") {
    state.lastTypingTime = Date.now();
    sendResponse({ ok: true });
  } else if (message.type === "ytVideo") {
    // User navigated to a YouTube video — reset timer and pause
    if (config.ytPausesTimer) {
      state.lastTypingTime = Date.now();
      state.pausedForVideo = true;
      state.pausedAt = Date.now();
    }
    sendResponse({ ok: true });
  } else if (message.type === "ytLeft") {
    // User left the video page (navigated within YouTube)
    unPauseVideo();
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
    sendResponse({ ok: true });
  } else if (message.type === "dismiss") {
    // User acknowledged the alert — reset the timer
    state.lastTypingTime = Date.now();
    state.tabSwitches = [];
    state.notifiedAt = Date.now();
    sendResponse({ ok: true });
  } else if (message.type === "setConfig") {
    if (message.loopThresholdMin !== undefined) {
      config.loopThresholdMin = message.loopThresholdMin;
      chrome.storage.local.set({ loopThresholdMin: config.loopThresholdMin });
    }
    if (message.minTabSwitches !== undefined) {
      config.minTabSwitches = message.minTabSwitches;
      chrome.storage.local.set({ minTabSwitches: config.minTabSwitches });
    }
    if (message.navResetsTimer !== undefined) {
      config.navResetsTimer = message.navResetsTimer;
      chrome.storage.local.set({ navResetsTimer: config.navResetsTimer });
    }
    if (message.ytPausesTimer !== undefined) {
      config.ytPausesTimer = message.ytPausesTimer;
      chrome.storage.local.set({ ytPausesTimer: config.ytPausesTimer });
    }
    sendResponse({ ok: true });
  }
  return true; // keep channel open for async sendResponse
});

// Periodic check via alarms
chrome.alarms.create("loopCheck", { periodInMinutes: 0.5 });
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

  return (
    timeSinceTyping >= thresholdMs &&
    state.tabSwitches.length >= config.minTabSwitches
  );
}

function checkForLoop() {
  if (!state.enabled) return;

  const now = Date.now();
  const NOTIFY_COOLDOWN_MS = 5 * 60 * 1000; // don't re-notify within 5min

  if (isInLoop() && now - state.notifiedAt > NOTIFY_COOLDOWN_MS) {
    state.notifiedAt = now;
    triggerAlert();
  }
}

function triggerAlert() {
  const minutes = Math.round(
    (Date.now() - state.lastTypingTime) / 1000 / 60
  );

  // Show browser notification
  chrome.notifications.create("loop-alert-" + Date.now(), {
    type: "basic",
    iconUrl: "icons/icon128.png",
    title: "You're stuck in a loop!",
    message: `You've been switching tabs for ${minutes} minutes without typing anything. Take a breath — what did you actually want to do?`,
    priority: 2,
    requireInteraction: true,
  });

  // Also inject an overlay into the active tab
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]) {
      chrome.tabs.sendMessage(tabs[0].id, { type: "showOverlay", minutes });
    }
  });
}
