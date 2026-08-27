# Raster candidates

The SVG candidates in this folder are hand-authored geometry. This file is the
second authoring route: generate raster concepts with an image model, trace
them to vector, and drop the result here as `r1-*.svg`, `r2-*.svg`, and so on
so they sit next to the hand-authored marks on the brand sheet.

## Prompts

Use these as written; change only the bracketed parts.

1. Flat geometric logo mark of a guard dog head in profile facing right, ears
   up, alert, built from 6 to 10 straight cuts, single solid fill, one small
   amber circle for the eye, no outline, no gradient, no text, centered on a
   plain [warm black | bone white] background, vector style, minimal.
2. Minimal angular dog head icon, side view, closed mouth, calm and watchful,
   like a chess knight but a dog, one flat color plus a single amber eye,
   scalable to 16 pixels, no detail lines, no shading, plain background.
3. Geometric St. Bernard head silhouette in profile, folded ear, heavy jaw,
   flat single fill, one amber eye dot, logo mark, no text, plain background.

Reject any output with a visible collar, tongue, teeth, gradient, or more than
two colors. Rabid or snarling reads are off-brand (see `brand/brand.md`).

## Trace recipe

```bash
# PNG to PBM to SVG with potrace (brew install potrace imagemagick)
magick concept.png -threshold 50% concept.pbm
potrace concept.pbm --svg --alphamax 0 --turdsize 20 -o r1-concept.svg
```

`--alphamax 0` keeps corners sharp so the result matches the geometric style.
Then, by hand in the SVG: delete the eye from the traced path, add
`<circle fill="#f2a900" .../>`, set the head fill to `currentColor`, and set
`viewBox="0 0 64 64"` with the head occupying roughly 10 to 58 on both axes so
it aligns with the other candidates. Run `pnpm --filter @cujo/brand render` and
check the 16 px output before keeping it.
