// Guard against double-injection (manifest content_scripts + dynamic executeScript)
if (window.__stuckInALoopLoaded) {
  // Already loaded — just re-register the message listener for overlay
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "showOverlay") showLoopOverlay(message.minutes, message.snoozeDurationMin);
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
    showLoopOverlay(message.minutes, message.snoozeDurationMin);
  }
});

function showLoopOverlay(minutes, snoozeDurationMin) {
  snoozeDurationMin = snoozeDurationMin ?? 5;
  // Don't stack overlays
  if (document.getElementById("stuck-in-loop-overlay")) return;

  const overlay = document.createElement("div");
  overlay.id = "stuck-in-loop-overlay";
  overlay.innerHTML = `
    <div id="stuck-loop-ambient-1"></div>
    <div id="stuck-loop-ambient-2"></div>
    <div id="stuck-in-loop-card">
      <div id="stuck-loop-icon-wrap">
        <div id="stuck-loop-icon-glow"></div>
        <div id="stuck-loop-icon-box">
          <span id="stuck-loop-infinity">⌘</span>
        </div>
      </div>
      <h1 id="stuck-loop-headline">What did you actually sit down to do?</h1>
      <p id="stuck-loop-body">It looks like you've been looping for a while. Let's find your way back.</p>
      <div id="stuck-loop-actions">
        <button id="stuck-in-loop-dismiss">Got it, refocusing</button>
        ${snoozeDurationMin ? `<button id="stuck-in-loop-snooze">Snooze ${snoozeDurationMin} min</button>` : ''}
      </div>
    </div>
  `;

  const style = document.createElement("style");
  style.id = "stuck-in-loop-style";
  style.textContent = `
    @import url('https://fonts.googleapis.com/css2?family=Manrope:wght@400;600;700;800&family=Inter:wght@400;500;600&display=swap');
    @import url('https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap');

    .stuck-loop-icon-font {
      font-family: 'Material Symbols Outlined';
      font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24;
      -webkit-font-smoothing: antialiased;
    }

    #stuck-in-loop-overlay {
      position: fixed;
      inset: 0;
      z-index: 2147483647;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      background: rgba(0, 6, 102, 0.2);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      animation: stuck-fade-in 0.3s ease-out;
    }

    @keyframes stuck-fade-in {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    #stuck-loop-ambient-1 {
      position: absolute;
      top: -10%;
      left: -10%;
      width: 384px;
      height: 384px;
      background: rgba(26, 35, 126, 0.2);
      border-radius: 50%;
      filter: blur(120px);
      pointer-events: none;
    }

    #stuck-loop-ambient-2 {
      position: absolute;
      bottom: -10%;
      right: -10%;
      width: 384px;
      height: 384px;
      background: rgba(133, 150, 255, 0.2);
      border-radius: 50%;
      filter: blur(120px);
      pointer-events: none;
    }

    #stuck-in-loop-card {
      position: relative;
      width: 100%;
      max-width: 560px;
      background: #fff;
      border-radius: 32px;
      padding: 64px;
      border: 1px solid rgba(67, 85, 185, 0.12);
      box-shadow: 0 24px 48px -12px rgba(0, 6, 102, 0.15),
                  0 0 0 0 rgba(133, 150, 255, 0);
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      animation: stuck-border-pulse 3s ease-in-out infinite;
    }

    @keyframes stuck-border-pulse {
      0%, 100% {
        border-color: rgba(67, 85, 185, 0.2);
        box-shadow: 0 24px 48px -12px rgba(0, 6, 102, 0.15),
                    0 0 24px 2px rgba(133, 150, 255, 0.15);
      }
      50% {
        border-color: rgba(67, 85, 185, 0.8);
        box-shadow: 0 24px 48px -12px rgba(0, 6, 102, 0.15),
                    0 0 60px 8px rgba(133, 150, 255, 0.5);
      }
    }

    #stuck-loop-icon-wrap {
      position: relative;
      margin-bottom: 40px;
    }

    #stuck-loop-icon-glow {
      display: none;
    }

    #stuck-loop-icon-box {
      position: relative;
      width: 80px;
      height: 80px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 16px;
      background: #e7e8e9;
      color: #000666;
    }

    #stuck-loop-infinity {
      font-size: 48px;
      font-family: 'Manrope', system-ui, sans-serif;
    }

    #stuck-loop-headline {
      font-family: 'Manrope', sans-serif;
      font-weight: 800;
      font-size: 36px;
      color: #191c1d;
      letter-spacing: -0.02em;
      line-height: 1.1;
      margin: 0 0 24px;
    }

    #stuck-loop-body {
      font-family: 'Inter', sans-serif;
      font-size: 18px;
      color: #454652;
      line-height: 1.5;
      max-width: 384px;
      margin: 0 0 48px;
    }

    #stuck-loop-actions {
      width: 100%;
      display: flex;
      flex-direction: row;
      align-items: center;
      justify-content: center;
      gap: 16px;
      flex-wrap: wrap;
    }

    #stuck-in-loop-dismiss {
      padding: 16px 32px;
      background: linear-gradient(135deg, #000666 0%, #4355b9 100%);
      color: #fff;
      font-family: 'Inter', sans-serif;
      font-weight: 700;
      font-size: 13px;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      border: none;
      border-radius: 12px;
      cursor: pointer;
      box-shadow: 0 8px 24px -4px rgba(0, 6, 102, 0.3);
      transition: all 0.2s;
    }
    #stuck-in-loop-dismiss:hover {
      box-shadow: 0 12px 32px -4px rgba(0, 6, 102, 0.4);
    }
    #stuck-in-loop-dismiss:active {
      transform: scale(0.95);
    }

    #stuck-in-loop-snooze {
      padding: 16px 32px;
      background: #e7e8e9;
      color: #11278e;
      font-family: 'Inter', sans-serif;
      font-weight: 700;
      font-size: 13px;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      border: none;
      border-radius: 12px;
      cursor: pointer;
      transition: all 0.2s;
    }
    #stuck-in-loop-snooze:hover {
      background: #e1e3e4;
    }
    #stuck-in-loop-snooze:active {
      transform: scale(0.95);
    }
  `;

  document.documentElement.appendChild(style);
  document.documentElement.appendChild(overlay);

  document.getElementById("stuck-in-loop-dismiss").addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "dismiss" }).catch(() => {});
    overlay.remove();
    style.remove();
  });

  const snoozeBtn = document.getElementById("stuck-in-loop-snooze");
  if (snoozeBtn) {
    snoozeBtn.addEventListener("click", () => {
      chrome.runtime.sendMessage({ type: "snooze" }).catch(() => {});
      overlay.remove();
      style.remove();
    });
  }
}

} // end guard
