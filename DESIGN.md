# Wabi-Press interface

All five extension pages use the editorial surface from AzSkills Wabi-Press,
reviewed at 52e51f3d99d4f1eb42ce72d41ae1efceb34c21f8.

The shared tokens in src/ui/styles/ui.css define warm paper (#F5F3EC),
ink (#1C1A17), cinnabar (#A6382A), and moss (#3B5848). Dark surfaces use
#131416, #1B1C20 and #25272D with #EDEAE2 text. Headings use the system
serif stack; body text uses sans serif; paths and IDs use monospace.

Rules, generous vertical spacing, square geometry and restrained color establish
hierarchy. Controls use 2px corners, visible keyboard focus, explicit active states
and reduced-motion support. Surfaces have no elevation, glow or hover movement.
Theme illustrations use inline geometric sun and moon shapes.

ui-system.css owns shared editorial components; ui-overrides.css retains page
layout rules; extension-backup.css owns the existing package manager components.
Popup width is capped by the viewport. Settings navigation stacks on narrow screens.

DOM checks on local HTML fixtures covered popup, settings (all four panels),
history, guide and extension recovery at 320x900 and 1440x900, both languages and
both themes: 64 combinations, no visible control/heading/paragraph/table bounding
boxes outside the viewport. At 1440x900, doubling each element's computed font
size also produced no such overflow on the five pages. These are DOM measurements,
not screenshot review or an installed-extension end-to-end test.
