# Final Public Landing Page Redesign

## Scope
- Redesign only the signed-out homepage at `/`; authenticated calendar screens and behavior remain unchanged.
- Use the two supplied real product screenshots as page assets, with the desktop Month view as the main product visual and the mobile Day view as the phone showcase.
- Preserve the existing logo, warm brand palette, typography, buttons, authentication links, and legal footer.

## Page structure
1. Build a compact responsive header with branding, Sign in, and Get started actions.
2. Replace the sparse opening with the requested two-column desktop / stacked mobile hero, clear conversion copy, CTAs, reassurance line, and a large uncropped Month screenshot.
3. Add concise full-width sections for the scheduling problem, at-a-glance benefits, mobile product showcase, caregiver access, four setup steps, comparison, email summaries, FAQ, and final CTA.
4. Keep the layout product-led rather than card-heavy: generous whitespace, restrained framed screenshots, soft dividers/surfaces, and responsive comparison treatment.
5. Keep Privacy and Terms in the existing footer.

## Content and trust
- Use the supplied wording and only claims supported by current functionality.
- Explain colors, childcare visibility, Google Calendar connection, caregiver access controls, email summaries, and phone/computer access without fabricated social proof.
- Add concise, accurate answers for all seven requested FAQ questions.

## SEO and sharing
- Set the exact requested title and meta description; preserve the canonical URL and `index, follow`.
- Add landing-page Open Graph/Twitter metadata using a share-sized version of the real desktop Month screenshot.
- Add FAQPage JSON-LD matching the visible FAQ content.

## Technical details
- Store the supplied screenshots through the project asset system; create a 1200×630 social crop derived from the desktop screenshot.
- Keep implementation focused in the homepage and its landing-page presentation styles/assets.
- Verify with focused static checks and the preview build status only; no broad regression or browser QA.
