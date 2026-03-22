# Stuck In A Loop

A browser extension that detects when you're mindlessly switching tabs and scrolling without actually doing anything — and snaps you out of it.

## How It Works

The extension tracks two signals:

1. **Time since you last typed** — typing anywhere on a page, searching in the URL bar, or navigating to a new URL all count as engagement
2. **Tab switch frequency** — how often you're flipping between tabs

If you go **15 minutes** (configurable) without typing and have switched tabs **5+ times** (configurable), it triggers a full-screen overlay and browser notification asking: *"What did you actually sit down to do?"*

### YouTube Detection

The timer automatically pauses when a YouTube video is **actually playing** (detected via the browser's built-in audio indicator — no microphone access). If you land on a video page but never hit play, the timer keeps running. When the video stops, the timer resumes with credit for time spent watching.

## Install

1. Clone this repo
2. Open `chrome://extensions` (or `brave://extensions`)
3. Enable **Developer mode**
4. Click **Load unpacked** and select the `StuckInALoop` folder

## Settings

All configurable from the popup:

| Setting | Default | Description |
|---------|---------|-------------|
| Time without typing | 15 min | How long without typing before triggering |
| Min tab switches | 5 | Minimum tab switches in the window to count as looping |
| Snooze duration | 5 min | How long the snooze button suppresses alerts (must be less than the typing threshold) |
| URL bar typing resets timer | On | Searching or navigating via the address bar counts as engagement |
| Pause when YouTube is playing | On | Pauses the timer while a video is audibly playing |

## What Resets the Timer

- Typing on any webpage (letters, backspace, enter)
- Typing a URL or search query in the address bar
- Clicking "Got it, refocusing" on the alert overlay
- A YouTube video starting to play (pauses + resets)

## What Doesn't Reset the Timer

- Scrolling
- Clicking links
- Switching tabs
- Landing on a YouTube video without playing it

## Alert Behavior

When triggered, you get:

- A full-screen dark overlay with a prompt to refocus
- A persistent browser notification
- Two options: **"Got it, refocusing"** (resets everything and can alert again immediately after threshold) or **"Snooze X min"** (resets stats, suppresses alerts for the configured snooze duration)

## Permissions

| Permission | Why |
|------------|-----|
| `tabs` | Track tab switches and detect YouTube video tabs |
| `activeTab` | Send overlay to the active tab |
| `notifications` | Show browser notifications |
| `storage` | Persist settings and timer state across service worker restarts |
| `scripting` | Inject overlay into the active tab |
| `alarms` | Periodic loop checks |
| `webNavigation` | Detect URL bar navigation |
