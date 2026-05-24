# Rain City Cyberdeck Reference Import

Skin id: `ai-cyberdeck-reference-v1`
Profile: `mobileCompact`
Role: `variant`
Prototype theme preset: `neon-shrine`

This source pack was seeded from a local image-generation bitmap reference that
is intentionally not committed. The committed source pack keeps only the
contract-sized, sanitized artboards and runtime crops.

The import keeps that generated image as reference material, normalizes it to
the fixed contract size, darkens it, and sanitizes live regions so Phaser still
owns map tiles, text, icons, HP values, log rows, inventory rows, and button
labels. The state sheet and materials remain contract-aligned source files from
`skin:source-prototype`.

Promotion checks:

```bash
pnpm -C frontend validate:skin-source-packs src/skins/neo-tokyo-console/fixed/ai-cyberdeck-reference-v1
pnpm -C frontend validate:skins
VISUAL_SCENARIOS=production pnpm -C frontend inspect:visual
```

This is now a production compact variant and the short-mobile default.
