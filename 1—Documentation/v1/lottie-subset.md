# Lottie subset

What v1 writes and reads (design guide §8.2). If a file uses anything outside this list, import stops with an error that names the feature, or, where marked, carries on with a warning. Nothing is dropped without telling you.

## Written

| Area | Emitted |
|---|---|
| Container | `v` 5.9.0, `fr`, `ip` 0, `op`, `w`, `h`, `nm`, `ddd` 0, `assets: []`. `.lottie` (dotLottie) wraps the same JSON with a `manifest.json` |
| Layers | `ty: 4` shape layers; `ty: 3` null layers (parenting, and the orbit pivot for rotate-then-translate layers); `ind`, `parent`, `ip`/`op`, `st: 0`, `sr: 1`. The top layer comes first in `layers` |
| Shapes | One group per layer: `rc` (rect, optional corner radius), `el` (ellipse) or `sh` (bezier path, from SVG path data), plus one `fl` fill and an identity `tr` |
| Transform `ks` | `a` anchor, `p` position, `s` scale (percent), `r` rotation (degrees, accumulating: 720 means two turns), `o` opacity (0–100) |
| Keyframes | `t` in frames (fractional frames allowed, see below), `s` value, `o`/`i` easing (arrays of length 1 = shared, length N = per-dimension), `to`/`ti` spatial tangents as offsets from the keyframe, `h: 1` hold |
| Static values | A property with one keyframe is written `a: 0` (static), never as a one-element keyframe array |
| Background | A full-size rect layer named "Background" at the bottom. Import turns it back into the composition's background |

### Converted before writing

- **Bounce, elastic and spring easing** become extra linear keyframes. Lottie has only bezier easing.
- **OKLab colour interpolation** is the editor's default. It's baked into extra keyframes so that players, which lerp sRGB, follow the same path within ΔE 1.
- **Drivers** are sampled to keyframes.
- **Fill alpha** isn't written; players ignore it. You get a warning, and the fix is to use layer opacity.
- **Keyframes between frames** are legal Lottie, but many players round them. The export warns and reports the largest shift. Use *snap to frames* (`snapToFrames`) to remove it.

## Read

Everything above, plus:

- the legacy keyframe format with `e` end values;
- split position (`p.s: true` with `x`/`y`), combined into one channel. Where the two dimensions have different keyframe times, it's resampled and baked;
- `rz` rotation;
- group transforms and multiple shapes, flattened into one path;
- imported colours keep sRGB interpolation, so the file keeps the meaning it had.

| Not supported | Import result |
|---|---|
| Precomps, images, text, solids, audio, cameras (`ty` 0, 2, 5, 1, 6, 13) | error |
| Masks, track mattes, time remapping, 3D (`ddd: 1`) | error |
| Strokes, gradients, trim paths, repeaters, merge paths, round corners | warning, skipped |
| Effects, expressions, time stretch, start-time offset | warning, ignored |
| Animated shape geometry or group transforms | warning, first keyframe used |

## Verified against a real player

`npm run test:browser` renders the demo scene with lottie-web (SVG renderer) at 30 times across its 3 seconds and compares it pixel by pixel with the editor's canvas preview (§16.2). The demo covers curved paths, bounce, per-dimension easing, 720° rotation, OKLab colour, holds, a null-parented orbit and a path shape. In Chromium, 0.000% of pixels differed in the worst frame (pixelmatch threshold 0.2, anti-aliasing excluded).
