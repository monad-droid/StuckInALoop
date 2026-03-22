// Read params from URL
const params = new URLSearchParams(window.location.search);
const minutes = parseInt(params.get("minutes")) || 0;
const snoozeDurationMin = parseInt(params.get("snooze")) || 5;

// Update body text with actual minutes
document.getElementById("body-text").textContent =
  `You've been ${minutes} minutes without typing anything. Take a breath — what did you actually want to do?`;

// Update snooze button label
document.getElementById("snooze-btn").textContent = `Snooze ${snoozeDurationMin} min`;

document.getElementById("dismiss-btn").addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "dismiss" }, () => {
    window.close();
  });
});

document.getElementById("snooze-btn").addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "snooze" }, () => {
    window.close();
  });
});
