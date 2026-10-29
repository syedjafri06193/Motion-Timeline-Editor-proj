# Using the editor

```bash
cd v1
npm install
npm run dev      # http://localhost:5173
npm run build    # static site in v1/dist
```

## Layout

| Area | What it's for |
|---|---|
| **Preview** (centre) | Drawn on a canvas by the editor's own evaluator. **Onion** shows ghosts: 3 frames before (red) and 3 after (green), stepping every 2 frames or by keyframe. Ghosts are hidden during playback. **Path** draws the selected layer's motion path, with a dot every frame. **Blur** adds motion blur (180° shutter, 8 samples). **vs lottie-web** plays the current Lottie export next to the preview |
| **Inspector** (right) | Values at the playhead. Editing an animated property sets a keyframe; editing a static one changes its value. ◆ / ◇ adds or removes a keyframe. Rotation is entered as *revolutions* + *degrees* (§6.2) |
| **Segment easing** | Drag the two handles of the segment that leaves the selected keyframe. A dot replays the easing. With CSS as a target, the legal x range [0, 1] is shaded and handles stop at its edge (§11.2). Presets tagged *linear()* can't be a cubic bezier and export to CSS as `linear()` |
| **Export analysis** | Updates live. For each animated property it says whether CSS or Lottie export is exact, approximated, baked or unrepresentable, with keyframe counts and the maximum deviation |
| **Timeline** (bottom) | Canvas-drawn. Click ▸ to show a layer's properties. Drag keys to move them; they snap to keyframes, the playhead, in/out points and frames (hold ⌘ or Ctrl to stop snapping). Shift-click to add to the selection, drag on empty space for a marquee, drag the handles at the ends of a selection to retime it. Ctrl/⌘-scroll zooms |
| **Value graph** (bottom tab) | Every numeric channel plotted against time, with tangent handles. Dragging one dimension's handle gives that dimension its own easing |

## Keys

| Key | Action |
|---|---|
| Space | Play / pause |
| ← / → | Step one frame |
| K | Add keyframes at the playhead on the layer's animated properties |
| H | Toggle hold on the selected keyframes |
| R | Reverse the selected keyframes |
| ⌫ | Delete the selected keyframes |
| ⌘C / ⌘V | Copy, then paste at the playhead |
| ⌘A | Select all keys on the layer |
| ⌘Z / ⇧⌘Z | Undo / redo. A whole drag is one step |
| O / P | Onion skin / motion path |

## Import and export

- **Import…** accepts Lottie `.json`, `.lottie` and `.svg`. Anything outside the [subset](lottie-subset.md) is listed after import.
- **Lottie**, **.lottie** and **CSS** each show the analysis before downloading. The CSS export is a standalone HTML page using individual `translate`, `rotate` and `scale` properties.
- **offset-path** in the toolbar exports curved motion exactly with CSS `offset-path`, instead of baking it into keyframes.
- **GIF** and **WebM** render the preview frame by frame, with motion blur if **Blur** is on.
- **Audio…** loads a soundtrack: its waveform appears under the ruler and it plays in sync.

From the command line, `npm run export -- [file.json]` writes Lottie, .lottie and both CSS variants, and prints the analysis.
