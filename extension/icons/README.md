# Zo Co-browse — Icon Set

The **Zo Pegasus on a globe** — the Pegasus carries your ideas across the web.

| File | Size | Use |
|------|------|-----|
| `icon.svg` | — | Source vector (editable) |
| `icon16.png` | 16×16 | Favicon / small references |
| `icon32.png` | 32×32 | Windows favicon |
| `icon48.png` | 48×48 | Toolbar icon (primary) |
| `icon128.png` | 128×128 | Chrome Web Store, install dialog |
| `icon256.png` | 256×256 | Store promo / hi-res |

## Design

- **Pegasus**: official Zo brand mark — rearing winged horse, the noble steed of the mind. Warm off-white (#f9f6ee) for contrast against the globe.
- **Globe**: deep navy gradient (#2152a8 → #08183a) with clean equatorial meridian lines — "co-browse the web." A subtle gradient arc catches light at the top-left.
- **Ring**: thin gold accent border (#7a6a3a, 55% opacity).
- **Background**: near-black (#0a1228) for depth.

## Rendering

From `icon.svg`:

```bash
rsvg-convert icon.svg -w $size -h $size -o icon${size}.png
```
