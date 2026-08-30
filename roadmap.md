# Roadmap

## Calendar horizontal navigation physics
- [x] Mobile 3-Day: continuous strip of single-day columns (~viewport/3 wide), one persistent horizontal scroll surface, snap one day at a time, buffered offscreen days, rebase only after settle with zero visible movement.
- [x] Mobile Day: same strip with one full-width column per snap point.
- [x] Soft settle for the day strip (month + desktop keep their existing page carousel): velocity + distance aware, ~30-35% threshold or fast flick, brief coast then ease-out settle 250-400ms proportional to remaining distance, no bounce, no visible rebase jump.
- [x] Header label updates only after settle; preserve vertical scroll, current-time positioning, event placement, long-press drag, filters, data, desktop Week.
