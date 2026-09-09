# Long-press event drag

- Strengthen the existing time-grid drag hook so a recognized long press takes ownership of the active touch and continues receiving vertical movement on mobile browsers.
- Convert finger movement and timeline auto-scroll into snapped 15-minute time changes using the existing hour scale and ghost preview.
- Prevent vertical calendar scrolling only after the long press activates; preserve normal scrolling before activation.
- Commit through the existing reschedule flow on release in Day, mobile 3-Day, and desktop/tablet Week views.
- Add focused hook coverage for movement, scroll blocking, release, and cancellation; do not change event or backend behavior.
