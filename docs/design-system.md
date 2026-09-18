# The design system

The visual language of the site, and the rules that keep it coherent. Tokens live in
`src/app/globals.css`; the tier palette lives in `src/lib/tiers.ts`.

## Direction

The discipline of a dense product interface — sharp type, controlled space, no clutter —
with a colour identity taken from Arena itself rather than invented. The lever is the
augment rarity system (silver / gold / prismatic), which already exists in the data: it
becomes the site's signature instead of a generic gradient.

**Three colour roles, strictly separated:**

| Role | Colour | Used for |
|---|---|---|
| Primary (interactive) | hextech cyan | links, active tab, focus, selection |
| Signal (excellence) | gold | S tier, first place, best in class |
| Prismatic (identity) | game opal | logo, wordmark, prismatic rarity |
| *Reserved* | green / red | **only** the quality of a statistic. Never branding. |

That last row is the rule that does the most work. Green means "good number" in the
% Top 1 and % Top 3 columns, so green used anywhere else would read as a verdict.

## Tokens

```css
--bg-base:    #0A0B0F;   /* page — bluish charcoal, not default zinc */
--bg-raised:  #111318;   /* cards, tables */
--bg-overlay: #171A21;   /* popovers, row hover */
--bg-inset:   #08090C;   /* recessed areas: inputs */

--text-primary: #F2F4F8;  --text-secondary: #9BA3B4;  --text-muted: #7A8294;
--border-subtle: #1E222B; --border-default: #272C37;  --border-strong: #39414F;

--accent: #35D0E8;        /* hextech cyan */
--gold:   #F2B640;
```

**Elevation** is what makes a surface look finished: a light inner hairline along the top
edge, not a drop shadow.

```css
--elev-1: inset 0 1px 0 rgba(255,255,255,0.03);                       /* cards, tables */
--elev-2: … + 0 1px 2px rgba(0,0,0,.4), 0 8px 24px -8px rgba(0,0,0,.5);  /* hover, active */
--elev-3: … + 0 4px 8px rgba(0,0,0,.5), 0 16px 48px -12px rgba(0,0,0,.7); /* popovers */
```

## The tier scale

Gold → cyan → indigo → slate → grey. It must read as a **descent in preciousness**, legible
even in greyscale, and it must never contain green.

| Tier | Text | Extra |
|---|---|---|
| S | `#F2B640` gold | glow `0 0 16px -4px rgba(242,182,64,.45)` |
| A | `#35D0E8` cyan | — |
| B | `#7C8CF8` indigo | — |
| C | `#8792A8` slate | — |
| D | `#70798C` grey | — |

Tier A's cyan is the same as the interactive accent, which appears to contradict the
three-roles rule. That is deliberate: the tier ramp is a closed scale, always shown in a
fixed-width badge in its own column, where confusion with a link is impossible. Inventing a
sixth hue to "fix" it would break the descent, which is the thing that carries meaning.

## Typography

Two families, each with a job. **Bricolage Grotesque** for display (headings, large
numbers, wordmark) and **Geist Sans** for UI text — a single well-made sans used alone is
the strongest signal of an untouched template, and adding a display face is enough to
break it. Table numbers use **Geist Mono** with explicit `tabular-nums` everywhere figures
align in a column.

| Token | Size / leading | Tracking | Family |
|---|---|---|---|
| `display-lg` | 3rem / 1.05 | −0.03em | display |
| `display` | 2rem / 1.1 | −0.02em | display |
| `h1` | 1.5rem / 1.2 | −0.02em | display |
| `h2` | 1.125rem / 1.3 | −0.01em | display |
| `body` | 0.875rem / 1.5 | 0 | sans |
| `small` | 0.8125rem / 1.45 | 0 | sans |
| `micro` | 0.6875rem / 1.4 | 0.04em (uppercase) | sans |

## Rules that came out of auditing real screenshots

The layout was audited on captures at 1440 / 1279 / 820 / 390 px, and most of the rules
below exist because something was actually wrong at one of those widths.

- **Average placement leads.** Where one metric has to come first, it is Avg Placement —
  it is the only metric that accounts for every result rather than a threshold. The stat
  pills give it a wider card and a stronger colour; sorts default to it.
- **One container width.** Pages used three different maximum widths, which read as
  misalignment when navigating between them.
- **The 768–1279 px band matters most.** It was the worst-served range on the site: too
  wide for the mobile layout, too narrow for the desktop one.
- **Labels are written once.** The five stat labels above a list, not repeated on every
  card — 75 repetitions became 5.
- **A tier band is a heading, not a row.** Bands are sized to separate groups visually;
  the per-row badge stays because the band scrolls out of view.
- **Focus is always visible**, and every contrast meets AA. Both were checked, not assumed.

## Motion

Motion confirms an action; it never announces itself. Tab and sort changes slide a
highlight rather than cutting; clicking a control scales it slightly; grids fade in on
change. Everything respects `prefers-reduced-motion`, and no transition exceeds 250 ms.
