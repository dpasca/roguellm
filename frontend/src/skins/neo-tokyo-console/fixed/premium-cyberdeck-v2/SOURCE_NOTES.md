# Premium Cyberdeck V2 Source Notes

`premium-cyberdeck-v2` is a mobileCompact technical prototype for the fixed
Phaser skin pipeline. It is intentionally not classified as a production demo
skin.

- The chassis source began as generated cyberdeck art and was contract-cleaned
  so live regions remain quiet for Phaser runtime text, map, and drawers.
- Controls, state sprites, and material sheets currently derive from the
  existing `ai-cyberdeck-reference-v1` source pack to keep this candidate
  aligned while the dedicated widget/state generation pass is still pending.
- This profile is registered as a `prototype`, not a production `variant` or
  default mobile skin.
- Validation evidence: strict source review passes with 0 issues and 0 warnings;
  focused visual inspection passes diagnostics, log, inventory, defeat, victory,
  and restart states. Human visual review rejected it as too flat/hybrid to use
  as the showcase demo.

Next art pass: replace the borrowed widget, state, and material sheets with
source-owned `premium-cyberdeck-v2` assets and avoid flattening the live-region
presentation so aggressively that the generated hardware loses its appeal.
