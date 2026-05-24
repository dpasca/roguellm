# Premium Cyberdeck V2 Source Notes

`premium-cyberdeck-v2` is a mobileCompact demo candidate for the fixed Phaser
skin pipeline.

- The chassis source began as generated cyberdeck art and was contract-cleaned
  so live regions remain quiet for Phaser runtime text, map, and drawers.
- Controls, state sprites, and material sheets currently derive from the
  existing `ai-cyberdeck-reference-v1` source pack to keep this candidate
  aligned and demoable while the dedicated widget/state generation pass is still
  pending.
- This profile is registered as a `variant`, not the default mobile skin.
- Promotion evidence: strict source review passes with 0 issues and 0 warnings;
  focused visual inspection passes diagnostics, log, inventory, defeat, victory,
  and restart states.

Next art pass: replace the borrowed widget, state, and material sheets with
source-owned `premium-cyberdeck-v2` assets using the same fixed crop contract.
