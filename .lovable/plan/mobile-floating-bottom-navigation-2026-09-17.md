# Mobile floating bottom navigation

## Scope
- Restyle only the phone bottom navigation in the shared app shell.
- Keep Today, Calendar, Activities, and Family routes, icons, labels, preloading, and active behavior unchanged.

## Changes
- Replace the edge-to-edge phone bar with a nearly full-width floating surface using modest side margins, a light background, rounded corners, subtle border, and soft shadow.
- Place the bar above the iPhone home indicator with safe-area-aware bottom spacing.
- Keep four equal-width, generously sized tap targets with icon above label.
- Use muted inactive tabs and the existing blue accent with a soft blue rounded panel for the active tab.
- Increase mobile page-bottom clearance so scrolling content can pass beneath the floating bar without its final content being hidden.

## Validation
- Check the focused source diff and the latest preview build status. No broad regression testing.
