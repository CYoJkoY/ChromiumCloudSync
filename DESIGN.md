# Wabi-Press interface

All five extension pages use the editorial surface from AzSkills Wabi-Press,
reviewed at 52e51f3d99d4f1eb42ce72d41ae1efceb34c21f8.

Repository artwork uses the same material. The extension icon and README
hero, section icons, and support CTA use warm paper, ink, russet and moss;
hero and CTA artwork provide dark variants.

The shared tokens in src/ui/styles/ui.css define warm paper (#F3F1E9),
ink (#1B1915), russet (#8A4E2E), and moss (#3C5847). Dark surfaces use
#121316, #1A1B20 and #23252B with #ECE9E1 text. Headings use the system
serif stack; body text uses sans serif; paths and IDs use monospace.

Rules, generous vertical spacing, square geometry and restrained color establish
hierarchy. Controls use 2px corners, visible keyboard focus, explicit active states
and reduced-motion support. Surfaces have no elevation, glow or hover movement.
Theme illustrations use inline geometric sun and moon shapes.

ui-system.css owns shared editorial components; ui-overrides.css retains page
layout rules.
Popup width is a definite 500px. Settings navigation stacks on narrow screens.

DOM checks on local HTML fixtures covered popup, settings (all four panels),
history, guide and extension recovery at 320x900 and 1440x900, both languages and
both themes: 64 combinations, no visible control/heading/paragraph/table bounding
boxes outside the viewport. At 1440x900, doubling each element's computed font
size also produced no such overflow on the five pages. These are DOM measurements,
not screenshot review or an installed-extension end-to-end test.
