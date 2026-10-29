# Easing evaluation

## The solver

`src/easing/bezier.ts` follows §5.2: it solves *x(t) = x* for the bezier parameter, then evaluates *y(t)*.

- Newton–Raphson runs for up to 8 iterations and stops early if the slope falls below 1e-3.
- If Newton doesn't converge, bisection takes over (up to 40 halvings, precision 1e-7).
- `src/easing/cache.ts` keeps an 11-entry spline table per curve, used as the starting guess for four Newton steps. It agrees with the full solver to 5e-7.

## Verified against the browser (§5.3, §16.1)

`npm run test:browser` animates `translateX` with each `cubic-bezier()` through the Web Animations API, pauses at 101 points and compares `getComputedStyle` with our solver.

The grid is the guide's §16.1 control points, 6 × 5 × 5 × 5 = 750 curves. Six pathological ones are added: `(1,0,0,1)`, `(0,0,1,1)`, heavy overshoot, `(0.1,2,0.9,-1)`, `(0,1,1,0)` and `(1,1,0,0)`.

| Browser | Curves | Max error | Budget |
|---|---|---|---|
| Chromium (this run) | 756 | 5.3 × 10⁻⁶ | 10⁻⁴ ✓ |
| Firefox, WebKit | 756 | measured in CI | 10⁻⁴ |

The browser rounds computed values to about six significant figures. The test therefore animates over 100,000 px, so the measured error reflects the solver rather than that rounding.

## How wrong the naive version is

Using *t* as time (§5.1) is wrong by these measured peak amounts (`tests/unit/easing.test.ts`):

| Curve | Peak error |
|---|---|
| `ease-in-out` (0.42, 0, 0.58, 1) | 2.9% |
| `ease` (0.25, 0.1, 0.25, 1) | 28.7% |
| Material standard (0.2, 0, 0, 1) | 47.4% |

The design guide gives about 6% for `ease-in-out`. The true figure for that curve is 2.9%. It happens to be one of the *least* affected curves, because it's symmetric: most curves are off by 10–50%.

## Curves a bezier can't make (§9.3)

Bounce, elastic and spring easing oscillate, which a cubic bezier can't do. Presets marked **linear()** in the curve list export to CSS as `linear()`. Its sample points are chosen adaptively, so they're dense where the curve bends and sparse where it's flat. The error target is 0.002; `bounce-out` measures 0.0018 with fewer than 120 points.
