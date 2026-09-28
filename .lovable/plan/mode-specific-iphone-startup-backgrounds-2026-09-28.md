# Mode-specific iPhone startup backgrounds

## Changes
- Classify startup rendering as native Capacitor, Safari Home Screen, or regular browser.
- Keep document background and `theme-color` blue only in native Capacitor, with overlap-safe restoration.
- Use the neutral app background as the normal web and Home Screen browser color instead of restoring blue browser chrome.
- Keep the existing heart reveal for native and regular mobile Safari, but use a simple overlay fade in Safari Home Screen mode.
- Preserve the current logo, loading sequence, authentication, calendar behavior, and native launch configuration.

## Technical details
- Update `StartupSplash` to detect standalone display mode and select the reveal effect without adding another overlay.
- Update the existing splash styles with one fade animation and reduced-motion handling.
- Set the root and manifest browser theme colors to the existing cream background so Safari chrome and Home Screen safe areas remain neutral when the overlay ends.
- Do not run QA or rebuild iOS.
