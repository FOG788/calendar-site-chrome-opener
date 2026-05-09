# AI / Codex Notes: Media control design guardrails

## Purpose
This note records recurring pitfalls and the current preferred design for loop + volume control.

## Recurring mistake to avoid
- **Do not repeatedly enforce volume in any periodic loop/badge timer.**
- If volume is re-applied on an interval (e.g. every 500ms), user manual volume changes can appear broken.

## Current safe design
1. **Loop control path (separate concern)**
   - Handles loop toggling for `video/audio` elements.
   - Handles optional visual badge updates.
   - May run on interval for loop state propagation.
   - **Must not apply volume repeatedly.**

2. **Volume control path (separate concern)**
   - Runs in a bounded retry window at startup.
   - Uses configured wait seconds and fixed retry interval to compute max attempts.
   - Stops when player is ready or max attempts are reached.
   - After this window, user manual volume control must remain untouched.

## Implementation checklist before merge
- [ ] Volume writes are not called from loop-refresh interval callbacks.
- [ ] Volume auto-apply has explicit max retry count (bounded).
- [ ] Loop and volume code paths are separated by responsibility.
- [ ] `node --check service_worker.js` passes.

## Why this exists
This regression has occurred multiple times. Keep this file and re-check it when editing media automation logic.
