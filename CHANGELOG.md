# Changelog

## 0.3.3 - 2026-10-19 (release candidate)

- Restrict local storage to trusted extension contexts. Content scripts bootstrap through the background and receive validated state-only messages; learning archives and playback storage changes are no longer delivered to content scripts.
- Keep overlay updates and prevent a delayed initial state response from replacing a newer pushed state.
- Add 7 privacy/state regression tests; all 113 Node tests pass. Updated Python UI harnesses have not been rerun; native and live-site checks remain pending.
- Prepare public source distribution with MIT license, installation/privacy/publishing guidance and deterministic allowlist-based store packaging.
- Exclude the accidental nested older ZIP from the release. Existing installed files and user data are untouched by this preparation.

## 0.3.2 - 2026-10-14

- Video-page clock numbers stay hidden until the timer area is hovered or receives visible keyboard focus. Moving away hides them again, including after a mouse click.
- Countdown and count-up continue normally while hidden; no layout shift on reveal. Learning-space clocks are unchanged.
- Both idle and active video-page panels include an Open Learning Space button, without ending/resetting the session or replacing the video tab.
- Only trusted UI clicks open options; sender/frame checks and record-read restrictions remain. Failures show a retryable error.
- One-click start/end, whitelists, records, permissions and storage keys are unchanged.
- 106 unit/background tests and 47 offline UI checks pass. Native extension / real-site integration remains unverified.

## 0.3.1 - 2026-10-14

- One-click end on normal video pages and whitelisted uploader video listings, next to existing start/timing controls.
- No options-page navigation, confirmation dialog, or typed phrase is needed to end a session.
- The options page also offers a direct end button; destructive history deletion retains its confirmation.
- Final playback sampling before archiving, a visible saved-status message, and restoration of normal browsing.
- Session-ID checks, authorized sender checks, idempotent end handling, and failed-save rollback.
- Existing timing modes, whitelists, records, daily totals, storage keys and permissions are unchanged.
- 101 unit/background tests and 35 offline UI checks pass. Native extension / real-site integration is still unverified.

## 0.3.0 - 2026-10-12

- Count-up and countdown on the video page and in settings.
- Direct switching between whitelisted uploaders without resetting a session.
- Local per-session history with start/end, mode, video/part, uploader and observed playback duration.
- Calendar-day aggregates with cross-midnight splitting.
- Separate session wall time from observed foreground/PiP playback wall time.
- Progress sampling rejects stalls, seek jumps, long gaps and overlapping tab intervals.
- Daily Markdown and full JSON export; confirmed history deletion outside active sessions.
- Backward-compatible whitelist storage, 300-session / approximately 4 MB archive retention.
- 83 unit/background tests and 30 offline UI checks pass. Native extension and real-site integration remain unverified.

## 0.2.0

- Video-page start, UID whitelist and read-only learning directory.
- Ending a session requires confirmation in extension settings.

## 0.1.0

- BV whitelist, countdown and distraction hiding.
