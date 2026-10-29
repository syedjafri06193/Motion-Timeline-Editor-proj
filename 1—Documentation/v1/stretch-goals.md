# Stretch goals (§17): what was built

| Feature | Status | Where |
|---|---|---|
| **`offset-path` CSS export** | ✅ Built | `export/css/emit.ts`. Curved motion becomes exact in CSS (pixel-verified against the preview) |
| **Video export** | ✅ Built | WebM through `MediaRecorder` on `canvas.captureStream()`, driven frame by frame (`export/media.ts`) |
| **GIF export** | ✅ Built | gifenc with a per-frame 256-colour palette. APNG isn't built |
| **Expressions / drivers** | ◐ Drivers only | `Layer.drivers`: one property computed from another layer's (× multiply + add, optional delay). Baked on export. Arbitrary expressions aren't built |
| **Motion blur** | ✅ Built | Sub-frame accumulation, 180° shutter, in the preview and in GIF/WebM export |
| **Audio waveform track** | ✅ Built | Waveform under the ruler; plays in sync |
| **Spring physics easing** | ✅ Built | Damped harmonic oscillator, exported through `linear()` |
| **Collaborative editing** | ✗ Not built | Every edit is already an immutable state change through `History`, which is where a CRDT would go |
| **dotLottie export** | ✅ Built | `.lottie` export and import |
| **Figma or SVG animation import** | ◐ SVG shapes only | Static SVG becomes layers (`import/svg.ts`). SMIL animation and Figma aren't imported |

## Milestones (§14)

| Milestone | Done-when criterion | Result |
|---|---|---|
| M0 Capability matrix | Every capability has a stated outcome for each target | [export-matrix.md](export-matrix.md), generated from code |
| M1 Model + easing | Max error vs WAAPI < 1e-4 across the grid, in CI | 5.3e-6 over 756 curves (Chromium); CI runs Firefox and WebKit too |
| M2 Preview + onion | 3+3 skins at 60 fps on 20 layers | p99 10.4 ms for 20 layers, 8.7 ms for 50 (headless Chromium, software rendering) |
| M3 Timeline | 50 layers fluid; one undo step per drag | Redraw p99 1.7 ms with 50 layers expanded; tested: one drag = one step |
| M4 Curve editor | Target-aware handles, presets marked by CSS expressibility, preview dot | ✅ |
| M5 Lottie export | Preview and lottie-web pixel-comparable across the timeline | 0.000% of pixels differ in the worst of 30 frames |
| M6 CSS export | Generated CSS matches the preview, or the analysis says why | 0.000% baked, 0.002% offset-path; losses are reported before export |
| M7 Import | Lottie subset with clear errors; SVG import | Export → import → export is idempotent (tested) |
| M8 Value graph | Channels over time with tangent handles | ✅ |
