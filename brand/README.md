# brand/

The Cujo brand assets. `brand.md` says how to use them; this file says what is
here and how to regenerate it.

| Path | What |
| --- | --- |
| `tokens.css`, `tokens.json` | Colors, type, scale, radius, spacing. The CSS file is what the UI imports; the JSON is the same values for anything else. |
| `logo/mark.svg` | The mark. `currentColor` fill, amber eye. |
| `logo/mark-mono.svg` | Single-color mark for places that allow one color. |
| `logo/wordmark.svg` | `cujo` as outlines; needs no font. |
| `logo/lockup-h.svg` | Mark and wordmark side by side. |
| `logo/favicon.svg`, `logo/favicon-32.png` | Favicon cut: fixed bone fill on transparent, larger eye. |
| `logo/candidates/` | Every mark that was considered. |
| `readme/banner-*.svg` | README header, one per theme. No text, so GitHub renders it without fonts. |
| `video/` | 1920x1080 title card and lower third, and the severity badge sprite. These use the brand fonts by name; install them in the editor. |
| `tools/` | `render.mjs` rasterizes every mark at 16, 32, 64, and 512 px. `wordmark.mjs` regenerates the wordmark outlines from a font file. |

## Regenerate

```bash
pnpm install
pnpm --filter @cujo/brand render                 # PNGs into brand/logo/png (gitignored)
pnpm --filter @cujo/brand wordmark <font.ttf>    # rebuild logo/wordmark.svg
```

The font files are not committed. Fetch Bricolage Grotesque 700 and JetBrains
Mono 500 from Google Fonts (links in `tokens.json`).

## Choosing a different mark

Copy the winner over `logo/mark.svg`, then rebuild `favicon.svg`,
`lockup-h.svg`, the banners, and the video kit from its polygon points. The
eye stays at radius 3.5 in a 64 unit box, 5 in the favicon.
