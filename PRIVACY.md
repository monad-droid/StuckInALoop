# Privacy Policy — Stuck In A Loop

**Last updated:** March 2026

## Summary

Stuck In A Loop does not collect, transmit, or share any user data. All data stays on your device.

## Data Storage

The extension stores the following data locally on your device using the Chrome Storage API (`chrome.storage.local`):

- Your configuration preferences (timer threshold, tab switch count, snooze duration, toggle settings)
- Session state (timestamps, tab switch counts, notification cooldowns)

This data never leaves your browser.

## Permissions

The extension requests the following permissions and uses them solely for its core functionality:

| Permission | Why it's needed |
|---|---|
| `tabs` | Detect tab switches to identify distraction loops |
| `activeTab` | Read the active tab for status display in the popup |
| `notifications` | Show a system notification when a loop is detected |
| `storage` | Persist your settings and session state locally |
| `alarms` | Schedule periodic checks for loop detection |
| `webNavigation` | Detect URL bar navigation as a sign of engagement |
| `scripting` | Inject the overlay prompt into tabs |
| `idle` | Detect when your system wakes from sleep to avoid false alerts |

The `<all_urls>` content script match is required to detect typing and link clicks on any webpage, and to display the full-screen overlay prompt.

## Network Requests

This extension makes **no network requests** of its own. The only external resources loaded are Google Fonts (Manrope, Inter, Material Symbols) for the popup and overlay UI.

## Third Parties

No data is shared with third parties. No analytics, tracking, or telemetry of any kind is included.

## Contact

If you have questions about this privacy policy, open an issue on the [GitHub repository](https://github.com/monad-droid/StuckInALoop).
