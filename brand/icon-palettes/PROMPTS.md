# Aside palette candidates

Generated with the built-in image_gen tool. Edit target: brand/aside-film-transparent/aside-icon.png.

Shared prompt: Edit the attached Aside movie logo by changing COLORS ONLY. Preserve the exact hand-drawn speech-frame film shape, play triangle, upper-right quotation mark, proportions, composition, and paper texture. No redesign, no new outlines, no added objects, no letters. Exterior must be genuine transparent alpha, no backdrop, checkerboard, or shadow. Return one isolated square PNG icon, matching reference framing.

- lavender.png: Muted lavender palette: replace near-black greenish strokes, play triangle and quote with deep aubergine #443A52; replace cream interior with pale dusty lavender #DFD3EC. Premium quiet, high contrast.
- graphite.png: Neutral graphite palette: replace greenish dark strokes, triangle and quote with charcoal graphite #33343C; replace cream fill with cool pearl #ECECF1. Completely remove green undertone. Quiet monochrome.
- apricot.png: Warm apricot palette: replace dark greenish strokes, triangle and quote with dark warm umber #514238; replace cream fill with soft desaturated apricot #F0CDA7. Subtle warm contrast for purple glass UI, not bright orange.

All three masters are 1254px RGBA PNGs with transparent exteriors. Candidate assets only; not referenced by the shipped extension yet.

## Lighter interior revision

Built-in image_gen edit of lavender.png, saved as lavender-light-fill.png. User correction: keep the original dark grey-purple exterior color; lighten only the interior fill.

Prompt: A precise one-region color edit to this existing PNG logo. The user likes the EXISTING DARK GREY-PURPLE exterior frame color and says DO NOT LIGHTEN THE OUTSIDE. Keep the dark purple outline/frame, dark play triangle, and dark quotation mark EXACTLY the current colors from this attached reference. Change ONLY the large light-purple interior fill of the speech frame, including the pale edging around the quote, to a MUCH LIGHTER near-white milky lavender around #F6F2FA. It should read as milky white with just a delicate purple undertone. Preserve all geometry, original framing, hand-drawn silhouette, paper texture and transparent alpha exterior. No redesign, no change to the dark elements, no shadows, no extra outlines, no backdrop or checkerboard. Clean antialiased boundaries, no magenta fringe or stray colored pixels. One PNG same proportions as original.

Selection: The user approved lavender-light-fill.png (dark purple exterior, pale lavender-white interior). As of 1.9.10 it is copied to brand/aside-film-transparent/aside-icon-purple.png and used by gen_icons.py for production exports.
