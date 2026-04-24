# Nostalgia Theme Spec

> **Purpose:** A single editable source of truth for the terminal's visual
> language. Two token layers — primitives + group semantics — let you retune
> a single family (e.g. every picker dialog's primary button) OR cascade a
> palette change across every family that reads it.

## Architecture

```
common/tokens.js       primitive palette + group semantic tokens
common/theme.js        shared builders — buildCard, buildStaticCard,
                       buildNavCard, buildActionCard, color utils
terminal/theme-manager POS-specific chrome — buildPillButton, buildNumKey,
                       buildNumpadChassis, buildPinBox, buildPinRow.
                       Re-exports the shared builders for legacy consumers.
```

---

## Layer 1 — Primitive Palette

All hex values live in `common/tokens.js`. Change these to cascade across
every consumer.

### Backgrounds (three-tier depth)

| Token | Hex | Used for |
|---|---|---|
| `T.bg` | `#383c42` | Scene background (slate) |
| `T.card` | `#2e3236` | Card surface, darker than bg |
| `T.well` | `#22252a` | Deep inset — numpad chassis, buildStaticCard default |
| `T.moon` | `#7e8896` | Neutral tile background (seat tiles, toggles) |
| `T.moonDk` | `#4a5059` | Darker moon for press state |
| `T.moonText` | `#22252a` | Label color on moon-fill surfaces |

### Semantic colors

| Token | Hex | Semantic role |
|---|---|---|
| `T.green` | `#86efac` | Affirm / confirm / mint primary |
| `T.greenDk` | *paired* | Press shadow for green |
| `T.greenWarm` | — | Warm affirm (SAVE, goGreen variant) |
| `T.verm` | `#e8472a` | Destructive / danger / cancel |
| `T.vermDk` | *paired* | Press shadow for verm |
| `T.gold` | `#e8c84e` | Decision / highlight / money |
| `T.goldDk` | *paired* | Press shadow for gold |
| `T.elec` | `#22d3ee` | Neutral action / cyan / info |
| `T.elecDk` | *paired* | Press shadow for elec |
| `T.lavender` | — | Secondary accent (DISC button) |
| `T.warning` | — | Attention / tip adjust |
| `T.text` | `#e8eaed` | Primary text |
| `T.border` | — | Neutral dividers, ghost button outlines |

### Dynamic palettes (index into)

| Token | Length | Used for |
|---|---|---|
| `T.seatPalette` | 8 | Per-seat accent (S1..Sn). Rotates mod 8. |
| `T.srvPalette` | 8 | Per-server chip color. Rotates mod 8. |

### Typography

| Token | Meaning |
|---|---|
| `T.fh` | Heading font family (Outfit) |
| `T.fb` | Body font family (JetBrains Mono) |
| `T.fwBold`, `T.fwMed` | Weights |
| `T.fsHero`, `T.fsH1`, `T.fsH2`, `T.fsH3` | Heading sizes |
| `T.fsB1`, `T.fsB2`, `T.fsB3` | Body sizes |

### Geometry & motion

| Token | Value | Used for |
|---|---|---|
| `T.headerH` | 52 | Header bar height |
| `T.pcLeftW` | 340 | Summary column width |
| `T.colGap` | 20 | Default column gap |
| `T.colGapSm` | 12 | Tight column gap |
| `T.scenePad` | 24 | Scene edge padding |
| `T.chamferCard` | 10 | Card chamfer clip-path |
| `T.chamferBtn` | 6 | Default button radius |
| `T.chamferWell` | 10 | Well chamfer |
| `T.chamferKey` | 12 | Numpad key chamfer |
| `T.chamferPin` | 10 | PIN box chamfer |
| `T.pillRadius` | 999px | Pill-shape buttons |
| `T.accentBarW` | — | Card left-accent bar width |
| `T.transitionFast`, `T.transitionMed` | — | Animation durations |

---

## Layer 2 — Group Semantic Tokens (`T.groups.*`)

**This is the per-family edit point.** Each group namespace maps to one
visual family. Defaults reference primitives; changing a group token
retunes only that family, changing the primitive cascades everywhere.

```js
T.groups = {

  // Manager landing + server landing — card grids & info panels
  landing: {
    tileAccent:        T.green,          // check-tile left accent bar
    infoAccent:        T.green,          // sales overview / tips card accent
    srvChipAccent:     'srvPalette',     // dynamic — rotates per server
    newCheckBorder:    T.green,          // dashed new-check tile outline
  },

  // co-zero-confirm, co-void-confirm, co-finalize-confirm
  confirmation: {
    shellAccentDanger: T.verm,           // zero / void shell accent
    shellAccentOk:     T.green,          // finalize shell accent
    cancel:            'ghost',          // CANCEL variant
    confirmAffirm:     'mint',           // OK-style CONFIRM variant
    confirmDelete:     'verm',           // destructive CONFIRM variant
  },

  // co-transfer-picker, co-discount-picker, disc-select, server-picker,
  // co-item-menu
  picker: {
    shellAccent:       T.elec,           // neutral-action shell accent
    shellAccentAuth:   T.gold,           // auth-flavor pickers (disc-select)
    cancel:            'ghost',
    apply:             'elec',
    optionDefault:     'ghost',          // option pills with no semantic color
    optionSelected:    T.elec,           // selected-tile border color
  },

  // co-manager-pin, disc-pin, seat-count
  auth: {
    shellAccent:       T.gold,           // decision / auth flavor
  },

  // seat-assign, qty-edit
  composite: {
    shellAccent:       T.green,
    selectAll:         'elec',           // helper variant
    cancel:            'verm',           // destructive exit
    confirm:           'mint',           // primary CTA variant
    stepper:           'elec',           // qty-edit -/+ variant
  },

  // buildDenomTile, split-select fraction tiles
  paymentPreset: {
    tileAccent:        T.green,          // buildActionCard accent bar
    tapFlashFill:      T.green,          // bg during the pointerup flash
    tapFlashLabel:     T.well,           // label color during the flash
  },

  // check-overview main bottom action bar
  actionBar: {
    disc:              T.lavender,
    void:              T.verm,
    pay:               T.gold,
    addItems:          T.green,
    editSeats:         T.moon,
    print:             T.elec,
    radius:            '14px',           // shared action-bar button radius
  },

  // seat tiles (seat-assign, check-overview picker grid)
  selectionGrid: {
    unselectedBg:      T.moon,
    unselectedFg:      'seatPalette',    // dynamic — seatPalette[(sn-1)%8]
    selectedBg:        'seatPalette',    // dynamic — same index
    selectedFg:        T.moonText,
    radius:            '14px',
  },
};
```

---

## Scene Family Catalog

Each family lists its member scenes, the canonical reference implementation,
the shared visual pattern, and which `T.groups.*` tokens it consumes.

### 1. Landing pages

| | |
|---|---|
| **Scenes** | `manager-landing`, `server-landing` |
| **Reference** | `terminal/scenes/server-landing.js:205` |
| **Group** | `T.groups.landing` |

**Shared pattern:** working-layer scene with a card-grid of `buildActionCard`
check tiles + `buildStaticCard` info panels (sales overview, tips row) +
filter pills + new-check button.

### 2. Confirmation interrupts

| | |
|---|---|
| **Scenes** | `co-zero-confirm`, `co-void-confirm`, `co-finalize-confirm` |
| **Reference** | `terminal/scenes/checkout-core.js:528` |
| **Group** | `T.groups.confirmation` |

**Shared pattern:** `buildStaticCard` shell with semantic accent (verm
destructive, green affirm). Body: title + summary copy. Footer: `ghost`
CANCEL + variant CONFIRM (`mint` or `verm` per semantic).

### 3. Picker interrupts

| | |
|---|---|
| **Scenes** | `co-transfer-picker`, `co-discount-picker`, `disc-select`, `server-picker`, `co-item-menu` |
| **Reference** | `terminal/scenes/checkout-core.js:1049` (transfer-picker) |
| **Group** | `T.groups.picker` |

**Shared pattern:** `buildStaticCard` shell. Body: tile grid or list with
selection state. Footer: `ghost` CANCEL + `elec` primary (APPLY/CONFIRM),
promoted from disabled via `setDisabled(false)` when a selection exists.

### 4. Auth / numpad interrupts

| | |
|---|---|
| **Scenes** | `co-manager-pin`, `disc-pin`, `seat-count` |
| **Reference** | `terminal/scenes/checkout-core.js:576` (manager-pin) |
| **Group** | `T.groups.auth` |

**Shared pattern:** `buildStaticCard` shell (gold accent) wrapping a
`buildNumpad` — no action buttons, numpad's own ENT/CLR drive the flow.

### 5. Composite editors

| | |
|---|---|
| **Scenes** | `seat-assign`, `qty-edit` |
| **Reference** | `terminal/scenes/order-entry.js:465` (seat-assign) |
| **Group** | `T.groups.composite` |

**Shared pattern:** `buildStaticCard` shell with substantial interior
padding + min-height (420px). Item list or stepper fills the body. Footer:
left column of stacked helpers (SELECT ALL `elec` + CANCEL `verm`, 36px
each) + right column full-height primary CONFIRM (`mint`, 80px).

### 6. Payment presets

| | |
|---|---|
| **Builders** | `buildDenomTile` in `payment.js`, `split-select` fraction tiles |
| **Reference** | `terminal/scenes/payment.js:920` (buildDenomTile) |
| **Group** | `T.groups.paymentPreset` |

**Shared pattern:** `buildActionCard` raised tile with green accent bar,
large number label + sub-label, mint flash on `pointerup`. Single-tap-to-
commit UX.

### 7. Action bars

| | |
|---|---|
| **Scenes** | `check-overview` main action bar (DISC/VOID/PAY/ADD ITEMS/EDIT SEATS/PRINT), `server-checkout` action column |
| **Reference** | `terminal/scenes/check-overview.js:1162` |
| **Group** | `T.groups.actionBar` |

**Shared pattern:** `buildPillButton` with per-role variant (DISC=lavender,
VOID=verm, PAY=gold, ADD ITEMS=green, EDIT SEATS=moon, PRINT=elec),
`borderRadius: 14px`, flex-centered text.

### 8. Selection grids

| | |
|---|---|
| **Scenes** | `seat-assign` tile row, `check-overview` picker grid |
| **Reference** | `terminal/scenes/order-entry.js:515` (makeSeatTile) |
| **Group** | `T.groups.selectionGrid` |

**Shared pattern:** per-seat `buildPillButton` tiles. Unselected = moon bg
+ seat-palette label. Selected = seat-palette fill + `T.moonText` label.
`borderRadius: 14px`, flex-centered.

---

## Edit Cookbook

**"Change the destructive red across the whole app."**
Edit `T.verm` in `common/tokens.js`. Every group that references it
(`confirmation.shellAccentDanger`, `composite.cancel`, `actionBar.void`,
etc.) updates.

**"Make picker primary buttons purple — but don't change `T.elec` globally."**
1. Add `T.purple = '#a78bfa'` to the primitive palette.
2. Edit `T.groups.picker.apply = 'purple'` (or a new purple variant).
Cascades to APPLY in co-transfer-picker, co-discount-picker only.

**"Retheme just the landing page tiles."**
Edit `T.groups.landing.tileAccent`. Cascades to manager-landing +
server-landing check tiles without touching any interrupt.

**"All CANCEL buttons should be filled verm instead of ghost outline."**
Change `T.groups.confirmation.cancel`, `T.groups.picker.cancel`,
`T.groups.composite.cancel` to `'verm'`. Or add `T.groups.global.cancel`
if you want a single edit point.

**"Bump the header height."**
Edit `T.headerH` in `common/tokens.js`. Also update the literal `52px` in
`terminal/index.html` (line 41 `#header { height: 52px; }` and line 52
`#layer-* { top: 52px; }`) to match — those are the pre-JS-paint values.

**"Change the seat-picker selected-state glow."**
Currently the selected seat uses `T.seatPalette[i]` as fill and
`T.moonText` as label. Edit `T.groups.selectionGrid.selectedFg` to
change the label color on selected seats.

---

## Forbidden Patterns

These are the legacy patterns sundowned during the initial migration.
Future contributors should not reintroduce them. A CI grep (or the
`npm test` equivalent) can enforce.

| Anti-pattern | Replacement |
|---|---|
| `border: 3px solid T.X` (all sides) | `buildStaticCard` or `borderLeft` accent only |
| `color: T.card` pill on a `T.card` shell | Use a `variant` + ensure shell bg differs |
| Hand-rolled `<div>` with CANCEL/CONFIRM text | `buildPillButton({ variant: 'verm' \| 'mint' \| 'ghost' })` |
| `buildCard(...)` for an interrupt shell | `buildStaticCard(...)` |
| Hardcoded `36px` for header | `T.headerH` (value: 52) |
| Local `COL_GAP` constant | `T.colGap` / `T.colGapSm` |
| `frameInterruptDecision` / `frameInterruptCritical` | Removed — use group token or primitive |
| `buildButton(...)` (legacy) | `buildPillButton({ variant })` |
| SM2 / Vz1.5 / pre-Nostalgia comments | Scrub |

---

## Implementation Roadmap

This spec defines the target state. Implementation lands in phases so
nothing breaks mid-flight.

**Phase 1 — Stand up the group layer (no visual change).**
Add the `T.groups` namespace in `common/tokens.js` with defaults that map
exactly to current primitive usage. Run tests. Commit. Visually identical.

**Phase 2 — Migrate scenes to consume groups (family by family).**
For each family in the catalog above, update its scenes to read
`T.groups.<family>.<role>` instead of directly naming a variant or
primitive. One commit per family. Tests green after each.

**Phase 3 — Enforce the contract.**
Add greps (or simple CI checks) that fail on:
- New `border: Npx solid T.X` (all-sides) outside `buildStaticCard`
- New `color: T.card` pill button where the shell bg is also `T.card`
- New hand-rolled `<div>` with button text content inside an interrupt

**Phase 4 — Overseer port (deferred).**
When overseer moves its tokens into `common/tokens.js`, it picks up the
`T.groups` namespace automatically and can map its own scenes to it.

---

## Files

- `common/tokens.js` — primitives + `T.groups` namespace
- `common/theme.js` — shared builders (cards, color utilities)
- `terminal/theme-manager.js` — POS-specific chrome
- `terminal/scenes/*.js` — consumers; see family catalog for roster
- Backend static mount serves `common/` at `/common/` for the browser
  (see `backend/app/main.py`)
