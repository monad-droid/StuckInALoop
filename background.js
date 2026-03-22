const DEFAULTS = {
  loopThresholdMin: 15,
  minTabSwitches: 5,
};

let config = { ...DEFAULTS };

let state = {
  lastTypingTime: Date.now(),
  tabSwitches: [], // timestamps of tab switches
  notifiedAt: 0, // last time we showed a notification (cooldown)
  enabled: true,
};

// Load persisted state and config
chrome.storage.local.get(["enabled", "loopThresholdMin", "minTabSwitches"], (result) => {
  if (result.enabled !== undefined) {
    state.enabled = result.enabled;
  }
  if (result.loopThresholdMin !== undefined) {
    config.loopThresholdMin = result.loopThresholdMin;
  }
  if (result.minTabSwitches !== undefined) {
    config.minTabSwitches = result.minTabSwitches;
  }
  // Always reset lastTypingTime on service worker start
  state.lastTypingTime = Date.now();
});

// Track tab switches
chrome.tabs.onActivated.addListener((activeInfo) => {
  if (!state.enabled) return;
  state.tabSwitches.push(Date.now());
  pruneOldSwitches();
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

// Listen for typing reports from content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "typing") {
    state.lastTypingTime = Date.now();
    sendResponse({ ok: true });
  } else if (message.type === "getState") {
    const now = Date.now();
    pruneOldSwitches();
    sendResponse({
      enabled: state.enabled,
      timeSinceTyping: now - state.lastTypingTime,
      tabSwitchCount: state.tabSwitches.length,
      isInLoop: isInLoop(),
      loopThresholdMin: config.loopThresholdMin,
      minTabSwitches: config.minTabSwitches,
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

function pruneOldSwitches() {
  const windowMs = config.loopThresholdMin * 60 * 1000;
  const cutoff = Date.now() - windowMs;
  state.tabSwitches = state.tabSwitches.filter((t) => t > cutoff);
}

function isInLoop() {
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
