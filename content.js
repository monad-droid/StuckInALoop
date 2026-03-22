// Guard against double-injection (manifest content_scripts + dynamic executeScript)
if (window.__stuckInALoopLoaded) {
  // Already loaded — just re-register the message listener for overlay
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "showOverlay") showLoopOverlay(message.minutes);
  });
} else {
window.__stuckInALoopLoaded = true;

// Report typing activity to background script
let typingTimeout = null;

function reportTyping() {
  chrome.runtime.sendMessage({ type: "typing" }).catch(() => {
    // Extension context may be invalidated, ignore
  });
}

// Debounce typing reports — send at most once per 2 seconds
document.addEventListener("keydown", (e) => {
  // Only count actual content typing, not just modifier keys
  if (e.key.length === 1 || e.key === "Backspace" || e.key === "Enter") {
    if (!typingTimeout) {
      reportTyping();
      typingTimeout = setTimeout(() => {
        typingTimeout = null;
      }, 2000);
    }
  }
});

// YouTube video detection — YouTube is an SPA so we need to watch for URL changes
if (location.hostname === "www.youtube.com" || location.hostname === "youtube.com") {
  let wasOnVideo = false;

  function checkYouTubePage() {
    const isVideo = location.pathname === "/watch" || location.pathname.startsWith("/shorts/");
    if (isVideo && !wasOnVideo) {
      // Just landed on a video
      chrome.runtime.sendMessage({ type: "ytVideo" }).catch(() => {});
    } else if (!isVideo && wasOnVideo) {
      // Left a video page (went to homepage, search, etc.)
      chrome.runtime.sendMessage({ type: "ytLeft" }).catch(() => {});
    }
    wasOnVideo = isVideo;
  }

  // YouTube fires this custom event on SPA navigations
  document.addEventListener("yt-navigate-finish", checkYouTubePage);
  // Also check on initial load
  checkYouTubePage();
}

// Listen for overlay trigger from background
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "showOverlay") {
    showLoopOverlay(message.minutes);
  }
});

function showLoopOverlay(minutes) {
  // Don't stack overlays
  if (document.getElementById("stuck-in-loop-overlay")) return;

  const overlay = document.createElement("div");
  overlay.id = "stuck-in-loop-overlay";
  overlay.innerHTML = `
    <div id="stuck-in-loop-box">
      <div id="stuck-in-loop-icon">&#x1F300;</div>
      <h1>You're stuck in a loop</h1>
      <p>You've been switching tabs and scrolling for <strong id="stuck-in-loop-minutes"></strong> without typing anything.</p>
      <p class="stuck-sub">What did you actually sit down to do?</p>
      <button id="stuck-in-loop-dismiss">Got it, refocusing</button>
      <button id="stuck-in-loop-snooze">Snooze 5 min</button>
    </div>
  `;

  const style = document.createElement("style");
  style.textContent = `
    #stuck-in-loop-overlay {
      position: fixed;
      inset: 0;
      z-index: 2147483647;
      background: rgba(0, 0, 0, 0.85);
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      animation: stuck-fade-in 0.3s ease-out;
    }
    @keyframes stuck-fade-in {
      from { opacity: 0; }
      to { opacity: 1; }
    }
    #stuck-in-loop-box {
      background: #1a1a2e;
      border: 2px solid #e94560;
      border-radius: 16px;
      padding: 48px;
      max-width: 480px;
      text-align: center;
      color: #fff;
      box-shadow: 0 0 60px rgba(233, 69, 96, 0.3);
    }
    #stuck-in-loop-icon {
      font-size: 64px;
      margin-bottom: 16px;
      animation: stuck-spin 3s linear infinite;
    }
    @keyframes stuck-spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
    #stuck-in-loop-box h1 {
      margin: 0 0 12px;
      font-size: 28px;
      color: #e94560;
      font-weight: 700;
    }
    #stuck-in-loop-box p {
      margin: 0 0 8px;
      font-size: 16px;
      line-height: 1.5;
      color: #ccc;
    }
    #stuck-in-loop-box .stuck-sub {
      font-size: 18px;
      color: #fff;
      margin: 16px 0 24px;
      font-style: italic;
    }
    #stuck-in-loop-box button {
      padding: 12px 28px;
      border: none;
      border-radius: 8px;
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
      margin: 0 8px;
      transition: transform 0.1s;
    }
    #stuck-in-loop-box button:hover {
      transform: scale(1.05);
    }
    #stuck-in-loop-dismiss {
      background: #e94560;
      color: #fff;
    }
    #stuck-in-loop-snooze {
      background: transparent;
      color: #888;
      border: 1px solid #444 !important;
    }
  `;

  document.documentElement.appendChild(style);
  document.documentElement.appendChild(overlay);

  document.getElementById("stuck-in-loop-minutes").textContent = `${minutes} minutes`;

  document.getElementById("stuck-in-loop-dismiss").addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "dismiss" }).catch(() => {});
    overlay.remove();
    style.remove();
  });

  document.getElementById("stuck-in-loop-snooze").addEventListener("click", () => {
    // Snooze resets the timer too, but keeps the 5min cooldown
    chrome.runtime.sendMessage({ type: "snooze" }).catch(() => {});
    overlay.remove();
    style.remove();
  });
}

} // end guard
