# Verification — BiliFocus 0.3.3 release candidate

Date: 2026-10-19. This is a pre-release; it has not been store-reviewed.

## Current verification

- 113 Node.js logic/background/content tests passed: the original 106 regression cases plus 7 storage-privacy and state-broadcast cases.
- The new cases cover trusted storage access before reads/writes, failure blocking reads, no archive/playback records in tab broadcasts, no broadcast on history-only writes, content bootstrap without storage access, trusted start/end updates, and delayed bootstrap ordering.
- Runtime JavaScript syntax, MV3 manifest/resource inclusion, version consistency, icon PNG dimensions and store ZIP are checked by npm run check and npm run pack.

The test environment mocks Chrome APIs and uses synthetic video state. It cannot certify native browser behavior.

## Historical checks

The original 0.3.2 documentation reported 106 logic/background tests and 47 offline UI checks. The JSON reports under tests/ are retained as historical evidence, not current 0.3.3 UI results.

Both Python UI mock harnesses have been adjusted for the 0.3.3 storage/message API changes. They were **not rerun** in this environment because Python is unavailable. Their historical Linux Chromium paths may require adapting for another development machine.

## Pending release checks

- Native extension loading in Chrome/Edge, service-worker suspension/restart, actual DNR redirects and options-tab opening.
- Real Bilibili video/player variants, SPA navigation, uploader metadata lookup and failure behavior.
- Count-up/countdown, pause/seek/speed changes, foreground/background/PiP and multi-tab deduplication.
- Native storage access restriction, state updates after options changes and no data loss when updating.
- Real screenshots for store assets; no simulated image should be presented as a real-site verification.

See [docs/PUBLISHING.md](docs/PUBLISHING.md) for the manual release checklist. Do not advertise this version as fully compatible or store-approved before completing those checks.
