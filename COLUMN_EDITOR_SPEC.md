# COLUMN EDITOR SPEC

Extracted from: `terminal/scenes/column-editor.js`  
Scene name: `'column-editor'` (transactional)

---

## 1. DOM STRUCTURE

### Root Container
```
root (absolute, inset: 0, z-index: T.zTransactional)
├─ header (T.headerH px)
├─ hint bar (28px)
├─ columns area (flex: 1, flex-direction: row, gap: 8px)
│  └─ column cards (flex: 1 each, overflow: auto)
│     ├─ header (sticky, top: 0, z: 2)
│     │  ├─ left: [seat label] [subtotal]
│     │  └─ right: item count
│     └─ item list (flex col, gap: 5px, pad: 6px 8px 8px)
│        ├─ split preview cards (if in split mode)
│        └─ item rows
├─ bottom bar (116px, flex col, gap: 6px)
│  ├─ seat row (flex row, gap: 7px)
│  │  ├─ seat strip OR just DISC/VOID
│  │  │  ├─ seat tiles (1–∞, built dynamically)
│  │  │  ├─ ALL tile
│  │  │  └─ + tile
│  │  └─ DISC/VOID buttons
│  └─ tool row (52px, flex row, gap: 8px, stretch)
│     ├─ left grid (3 cols: MOVE / SPLIT / MERGE)
│     ├─ divider (1px, vertical)
│     └─ right grid (3 cols: UNDO / CANCEL / CONFIRM)
└─ seat grid overlay (absolute, bottom: 122px, width: 70%, z: 5) [grid mode only]
   └─ 10-column grid (pad: 6px, gap: 4px, max-height: 134px)
```

### Column Card (buildColumn)
- **Container**: `flex: 1; min-width: 0; display: flex; flex-direction: column; overflow-y: auto;`
- **Styling**: 
  - Border left (4px): accent color (T.elec on split target, T.greenWarm on merge target, T.green default)
  - Border top (3px), right (3px), bottom (3px): bevel style (lighten/darken T.bg)
  - Border radius: T.chamferCard
  - Background: T.card
  - Box shadow: `0 0 0 1px [accentColor]` (if target)

### Column Header (sticky)
- **Layout**: flex row, sticky top 0, z: 2
- **Styling**: bg T.well, pad 8px 12px, border-bottom 2px darken(T.bg, 0.2)
- **Left section**: flex row, gap 8px
  - Seat label: bold 24px T.fh, color: accent (T.elec/T.greenWarm/T.green)
  - Subtotal: bold 17px T.fb, color: T.gold (e.g., "$15.99")
- **Right section**: item count (T.fb, T.fsB4, color: T.moon)

### Item Row
- **Layout**: flex row, align-items center, gap 8px
- **Styling**: 
  - Pad 7px 8px, border-bottom 1px T.border, border-radius 4px
  - Background: `hexToRgba(T.green, 0.12)` if selected
  - Cursor: pointer
- **Content**:
  - Name (qty prefix if > 1): flex 1, T.fb T.fsB3, color: T.green if selected else T.text
  - Price: right-aligned, T.fb bold T.fsB3, color: T.green if selected else T.gold

### Split Preview Card
- **Styling**: 1.5px dashed T.elec border, border-radius 8px, pad 5px 9px
- **Content**:
  - Label: "split preview" (T.fb T.fsB4, italic, T.elec)
  - Row: name (T.fsB3 T.fb T.text) + price (T.fsB3 T.fb bold T.elec)

### Action Button (buildActBtn)
- **Base styling**:
  - Height: 46px (or configurable)
  - Border radius: 10px
  - Font: T.fh or T.fb, T.fwBold, T.fsB3 (or configurable)
  - Letter spacing: 0.04em
  - Flex display, center align/justify, pointer events auto
  - Touch action: manipulation
  - User select: none
  - Flex shrink: 0
  - Transition: transform 0.07s, box-shadow 0.07s
  - Gap: 6px
- **Shadow**: 
  - Rest: `0 4px 0 [darkColor]`
  - Press: `0 1px 0 [darkColor]`
  - Ghost (inverted): `0 3px 0 [darkColor]`
- **Press animation**: `translateY(3px)` + shadow change
- **Colors**: Customizable bg, dk, color; can restyle() dynamically

### Header (buildHeader)
- **Layout**: flex row, h: T.headerH, align-items center, pad 0 12px, gap 10px
- **Content**:
  - Check label: bold T.fsB2 T.fh T.green, letter-spacing 0.06em, flex 1
  - CLEAR button: pill (ghost, chamfer) T.fsB4
  - SELECT ALL button: pill (ghost, chamfer) T.fsB4

### Hint Bar
- **Height**: 28px
- **Styling**: bg T.well, border-bottom 1px darken(T.bg, 0.2), pad 0 14px, center aligned
- **Font**: T.fb T.fsB4 italic T.text
- **Content**: Dynamic status text (getStatusText)

### Bottom Bar Layout
- **Total height**: 116px (6px pad top + 52px tool row + 6px gap + 46px seat row + 7px pad bottom)
- **Row 1 (Seat Row, ~46px)**: 
  - **Strip mode** (≤5 seats): horiz scrolling strip, gap 6px, scrollbar hidden
  - **Grid mode** (>5 seats): just DISC/VOID on right
  - Seat tiles: dynamic width, height 46px (strip) or 28px (grid)
  - Font size: T.fsB3 (strip) or 12px (grid)
- **Row 2 (Tool Row, 52px)**:
  - Left grid (3 cols): MOVE / SPLIT / MERGE
  - Divider (1px vert, bg T.border, margin 4px 0)
  - Right grid (3 cols): UNDO / CANCEL / CONFIRM

### Seat Tiles (buildActBtn variant)
- **Strip mode**: height 46px, font T.fsB3, min-width 48px, pad 0 12px
- **Grid mode**: height 28px, font 12px, min-width 0, pad 0 6px
- **Active**: bg [T.green or T.moon], color T.well, no border
- **Inactive**: bg T.card, color T.green or T.text, border 1px T.border

### Seat Grid Overlay
- **Position**: absolute, bottom: 122px (bar 116 + gap 6), left: 8px, width: 70%
- **Styling**:
  - bg T.well, z: 5, border-radius T.chamferCard
  - Border: 3px beveled (top/left lighten, right/bottom darken T.bg)
  - Box shadow: `0 -6px 20px rgba(0,0,0,0.45)`
  - Overflow hidden
- **Grid**: 10 columns, gap 4px, pad 6px, max-height 134px (4 rows × 28px + gaps)
- **Scroll**: scrollbar-width none, touch-action pan-y

### Pin Overlay (openPinOverlay)
- **Scrim**: position absolute inset 0, z: 20, bg hexToRgba(T.well, 0.88), flex center
- **Card**: 340px width, pad 20px 22px 22px, flex col gap 14px
  - Border: 5px beveled (left T.gold, top lighten T.bg, right/bottom darken T.bg)
  - Border radius: 12px
  - Box shadow: inset 0 1px 0 rgba(255,255,255,0.06), 3px 5px 0 rgba(0,0,0,0.55)
- **Title**: MANAGER PIN, T.fh bold T.fsB3, letter-spacing 0.18em, T.gold
- **Subtitle**: T.fb T.fsB4 italic T.moon
- **Dots**: 4 × 14px circles, gap 10px, center
- **Numpad**: 3 cols grid, 12 buttons (1–9, CLR, 0, ENT), gap 6px, 44px height
- **Cancel button**: 38px height

---

## 2. DATA MODEL

### State Object Shape
```javascript
{
  // UI state
  listeners:      [],          // Event listeners for cleanup
  columnsArea:    Element,     // Container for column cards
  toolRowEl:      Element,     // Tool button row container
  seatSelectorEl: Element,     // Seat tile container (strip or grid)
  discBtnEl:      Element,     // DISC button reference
  voidBtnEl:      Element,     // VOID button reference
  hintBarEl:      Element,     // Status text bar
  undoBtnEl:      Element,     // UNDO button reference
  colEls:         [],          // [{el, hdr, itemList}, ...]

  // Data: columns & items
  columns:        [],          // Active columns (filtered by visibleColIds)
  allColumns:     [],          // All available seats
  visibleColIds:  [],          // IDs of currently displayed columns

  // Mode & selection
  mode:           null,        // 'move' | 'split' | 'merge' | null
  selectedItems:  [],          // [{colIdx, itemIdx}, ...]
  splitTargets:   [],          // Column indices for split destinations
  mergeTarget:    null,        // Column index to merge into

  // History
  actionLog:      [],          // [{label, columns: deepCopy}, ...]
  snapshot:       [],          // Initial state (for undo-all)
  _lpTimer:       timer,       // Long-press timer for undo-all

  // Callbacks
  onSave:         function,    // Called with newColumns on confirm
  _params:        object,      // Scene params (columns, allColumns, focusedIds, etc.)
}
```

### Column Object
```javascript
{
  id:     string,     // 'S-001', 'S-002', 'NEW-5', etc.
  label:  string,     // 'S-001' (formatted seat number)
  items:  []          // Array of item objects
}
```

### Item Object
```javascript
{
  name:         string,
  qty:          number,
  price:        decimal,       // Price per unit
  item_id:      string,        // Backend item ID (may be null)
  menu_item_id: string,        // Menu item reference
  category:     string,
  mods:         [],            // [{price, ...}, ...]
  notes:        string,
  _splitRef:    string         // Marker for split items ('sr-[timestamp]-[idx]' or item_id)
}
```

### Selection & Mode
- **selectedItems**: Array of `{colIdx: number, itemIdx: number}`
  - `colIdx`: Index in `state.columns`
  - `itemIdx`: Index in `state.columns[colIdx].items`
- **splitTargets**: Array of column indices where split items will be distributed
- **mergeTarget**: Single column index (or null) where all other columns merge
- **mode**: 
  - `null`: Normal browse, no action in progress
  - `'move'`: Items selected, ready to move
  - `'split'`: Items selected, tap seats to pick split destinations
  - `'merge'`: Merge all columns into one (tap seat header to choose destination)

### Price Calculation
- **sumColumn(colIdx)**: Sum of `qty × price` for all items in column
- **projectedColTotal(colIdx)**: Subtotal after pending split operations
  - If items are selected for split, divides price across targets
  - Remainder goes to last target
  - Accounts for mods in split: `modSum = mods.reduce((a, m) => a + (m.price || 0), 0)`
  - Effective price: `(item.price + modSum) / numTargets`

---

## 3. ENTRY POINTS

### SceneManager.openTransactional Invocation
```javascript
SceneManager.openTransactional('column-editor', {
  columns:      columns,           // Array of column objects (visible seats)
  allColumns:   allColumns,        // Array of all seat column objects
  focusedIds:   focusedIds,        // Array of seat IDs to show initially
  checkNumber:  state.checkNumber, // e.g., "42" → "CHECK #42"
  orderId:      state.orderId,     // Backend order ID (for context)
  onSave: function(newColumns) {
    // Called when CONFIRM button pressed
    // newColumns: modified columns array
  }
});
```

### Trigger Conditions (from check-overview.js)
1. **autoSplit mode**: `params.autoSplit === true`
   - Opens with all items selected, SPLIT mode active
2. **Long-press on seat**: On column header long-press
3. **Menu button**: "EDIT SEATS" option
4. **Explicit call**: Inside callback after certain operations

### Initial State Derivation
- **focusedIds**: If `params.autoSplit`, all seats. Otherwise:
  - First unpaid seat (if available)
  - Else empty (falls back to first column)
- **columns**: Filtered from `params.columns` using `focusedIds`
- **visibleColIds**: Starts as focusedIds
- **snapshot**: Deep copy of initial columns (for undo-all)
- **actionLog**: Empty on mount

### Scene Params
- `columns`: Full list of seat columns with items
- `allColumns`: All available seats (for seat selector)
- `focusedIds`: Array of seat IDs to show initially
- `checkNumber`: String, displayed in header
- `orderId`: Order identifier (optional, passed to onSave context)
- `autoSplit`: Boolean (optional, triggers auto-split mode)
- `onDiscount`: Function called when discount PIN validated
- `onSave`: Function called on CONFIRM

---

## 4. INTERACTIONS

### Item Tap (handleItemTap)
- **In normal mode** (mode === null):
  - Toggle item selection
  - Auto-activate MOVE mode on first selection
  - Auto-deactivate when last item deselected
- **In SPLIT mode**: Ignored (tapping column targets split destination instead)
- **In MERGE mode**: Ignored (tapping column chooses merge target instead)
- **Visual feedback**: Selected item row bg = hexToRgba(T.green, 0.12)

### Column Header Tap (handleColTap)
- **In MOVE mode**: Move all selected items to this column
- **In SPLIT mode**: Toggle this column as a split target
  - Multiple targets allowed
  - Last target receives remainder in price division
- **In MERGE mode**: Set this column as merge destination
  - All other columns' items move here, then that column is removed

### Seat Tile Tap
- **Active seat**: Remove from visible, hide column
- **Inactive seat**: Re-add to visible, show column from `allColumns`
- **Constraint**: At least 1 seat always visible

### ALL Tile
- If some seats hidden: Show all seats
- If all visible: Hide all except first

### + (Add Seat) Tile (handleAddSeat)
- Auto-generate next seat number (find first unused N in S-NNN format)
- Create new column: `{id: 'NEW-' + n, label: 'S-' + padStart(n, 3, '0'), items: []}`
- Add to `state.columns` and `state.visibleColIds`
- Show toast: "Added S-X"

### Button Taps (Action Bar)

#### MOVE Button
- Requires: `selectedItems.length > 0`
- Toggles mode on/off
- When active: Column tap moves items
- Status: Shows "Moving from X items" hint per-column

#### SPLIT Button
- Requires: `selectedItems.length > 0`
- Toggles mode on/off
- When active:
  - Column tap toggles split target
  - Shows split preview cards in targeted columns
  - CONFIRM required with ≥2 targets
- Status: Shows "Splitting across N seats" hint

#### MERGE Button
- Requires: `selectedItems.length > 0`
- Toggles mode on/off
- When active:
  - Column header tap sets merge destination
  - All items move into chosen column
  - Other columns removed
- Status: Shows "Merge into X" hint

#### UNDO Button
- **Short tap**: Pop last action from log, restore columns
- **Long press (600ms)**: Fill animation (scaleX 0→1 over 200ms), then undo-all
- Shows badge with action count if > 0
- Disabled if log empty

#### CANCEL Button
- Clear mode, deselect all items
- Reset splitTargets and mergeTarget

#### CONFIRM Button
- Calls `onSave(state.columns)`
- Closes scene with `SceneManager.closeTransactional('column-editor')`
- Only functional if valid action state (e.g., split with 2+ targets)

#### DISC / VOID Buttons
- **State**: Disabled (opacity 0.35, pointerEvents none) if no items selected
- **Enabled**: Restyle to T.lavender (DISC) or T.verm (VOID)
- **DISC**: Opens PIN overlay, calls `params.onDiscount(selectedItems)` on valid PIN
- **VOID**: Opens PIN overlay, calls `handleVoidSelected()` on valid PIN (removes items)

### Undo Button Long-Press Animation
```javascript
// On pointerdown (>600ms):
undoFill.style.transition = 'transform 0.2s linear';
undoFill.style.transform = 'scaleX(1)';  // Fill left→right

// After 200ms:
undoFill.style.transition = 'none';
undoFill.style.transform = 'scaleX(0)';   // Reset
handleUndoAll(state);
```

### Drag/Drop Pattern
- **Not drag-oriented**: Item movement is tap-based (select → choose destination → confirm)
- **Immediate feedback**: Item colors change on selection, column headers show accent on target mode

---

## 5. ACTION BAR

### Layout
```
[Tool Row: 52px height, flex row, gap 8px, stretch align]
├─ [Left Grid: 3 cols, gap 6px, flex 1]
│  ├─ MOVE button
│  ├─ SPLIT button
│  └─ MERGE button
├─ [Divider: 1px vert, T.border, margin 4px 0]
└─ [Right Grid: 3 cols, gap 6px, flex 1]
   ├─ UNDO button (with badge)
   ├─ CANCEL button
   └─ CONFIRM button
```

### MOVE Button
- **Inactive**: bg T.card, color T.text, border 1px T.border, opacity 0.35 if no selection
- **Active**: bg T.green, color T.well, dk T.greenDk
- **Action**: Toggle move mode; tap column to move items there

### SPLIT Button
- **Inactive**: bg T.card, color T.text, border 1px T.border, opacity 0.35 if no selection
- **Active**: bg T.elec, color T.well, dk T.elecDk
- **Action**: Toggle split mode; tap columns to mark targets; shows split preview

### MERGE Button
- **Inactive**: bg T.card, color T.text, border 1px T.border, opacity 0.35 if no selection
- **Active**: bg T.gold, color T.well, dk T.goldDk
- **Action**: Toggle merge mode; tap column header to choose merge destination

### UNDO Button
- **Appearance**: bg T.card, color T.text, border 1px T.border, ghost-style
- **Badge**: Appears top-right if actionLog.length > 0, bg T.elec, T.fsB4, pad 1px 5px
- **State**: Disabled (opacity 0.4, pointerEvents none) if actionLog empty
- **Interaction**: Short tap = undo 1; long press = undo all with fill animation

### CANCEL Button
- **Appearance**: bg T.verm, color white, dk T.vermDk
- **Action**: Clear all selections and mode

### CONFIRM Button
- **Appearance**: bg T.greenWarm, color T.well, dk T.greenWarmDk
- **Action**: Call onSave(state.columns), close scene
- **Guard**: Only executes if valid state (e.g., for split: selectedItems.length > 0 && splitTargets.length >= 2)

### Seat Row (Above Tool Row)
- **Height**: ~46px (flex 1 in container, auto height)
- **Layout**:
  - Strip mode (≤5 seats): Horiz scrolling, 46px height tiles
  - Grid mode (>5 seats): Just DISC/VOID on right; grid overlay floats above
- **Seat Tiles**: One per seat (active = green, inactive = outline)
- **ALL Tile**: Toggles show/hide all
- **+ Tile**: Adds new seat

### DISC / VOID Buttons
- **Position**: Bottom right of seat row
- **Styling**: T.lavender (DISC) / T.verm (VOID)
- **State**: Disabled by default, enabled when items selected
- **Action**: Open PIN overlay; on valid PIN, apply discount or void items

---

## 6. EXIT / COMMIT

### closeTransactional Call
```javascript
SceneManager.closeTransactional('column-editor');
```

### onSave Callback
```javascript
onSave: function(newColumns) {
  // newColumns: array of column objects with modified items
  
  // Caller is responsible for:
  // 1. Mapping columns back to seat objects
  // 2. Syncing item_id changes to backend
  // 3. Removing empty seats
  // 4. Creating new seat numbers for NEW-* columns
  
  // Example (from check-overview.js):
  sentIndices.forEach(function(origIdx, colIdx) {
    var seat = state.seats[origIdx];
    if (newColumns[colIdx]) {
      seat.items = newColumns[colIdx].items;
    } else {
      seat.items = [];  // Merged away
    }
  });
}
```

### No Direct API Calls
- **Column editor does NOT make backend calls**
- All state changes are local (columns array mutations)
- Caller must:
  - Validate new structure
  - Make PATCH/POST to `/api/orders/{orderId}/seats` or equivalent
  - Handle sync of item_id, seat_number, _splitRef

### Return Value
- Scene returns via `onSave(newColumns)` callback
- `newColumns`: Array of column objects (possibly fewer than input if merge occurred)
- New columns added (id: 'NEW-*') must be assigned real seat numbers by caller

### State Snapshots in History
- `actionLog.push({label: '...', columns: deepCopyColumns(state.columns)})`
- Each action stores a snapshot (deep copy) for undo
- No shallow refs; safe to replay from log

---

## 7. VISUAL TOKENS

### Colors (T.*)
| Token | Usage |
|-------|-------|
| T.bg | Root background, column areas |
| T.well | Headers, button backgrounds, overlays |
| T.card | Column cards, inactive button bg |
| T.text | Primary text color |
| T.moon | Secondary/dim text |
| T.moonDk | Button shadow color (default) |
| T.green | Seat numbers, MOVE button, active states |
| T.greenDk | MOVE button shadow |
| T.greenWarm | CONFIRM button, merge target accent |
| T.greenWarmDk | CONFIRM button shadow |
| T.elec | Split target accent, SPLIT button, preview borders |
| T.elecDk | SPLIT button shadow |
| T.gold | Subtotals, MERGE button, split preview prices |
| T.goldDk | MERGE button shadow |
| T.verm | VOID button, delete actions |
| T.vermDk | VOID/CANCEL button shadow |
| T.lavender | DISC button, discount actions |
| T.border | Dividers, item borders, disabled states |

### Fonts (T.*)
| Token | Usage |
|-------|-------|
| T.fh | Headline font (seat labels, check #, modal title) |
| T.fb | Body font (items, buttons, default) |
| T.fwBold | Bold weight (labels, prices) |
| T.fsB2 | Large: check # (headings) |
| T.fsB3 | Medium: item names, buttons, seat labels in tiles |
| T.fsB4 | Small: item count, hint bar |

### Sizing (T.*)
| Token | Value | Usage |
|-------|-------|-------|
| T.headerH | ~56px | Header height |
| T.chamferCard | ~12px | Border radius for cards & overlay |
| T.pillRadius | ~12px | Badge border radius |
| T.zTransactional | 20 | Scene z-index |

### Spacing
- **Gap in columns area**: 8px
- **Gap in item list**: 5px
- **Gap in seat row**: 7px (strip mode), 4px (grid mode)
- **Gap in tool row**: 8px
- **Column padding**: 6px 8px 8px
- **Item row padding**: 7px 8px
- **Header padding**: 8px 12px
- **Bottom bar padding**: 6px 8px 7px
- **Hint bar padding**: 0 14px

### Border & Shadow Details
- **Column card borders**: 
  - Top: 3px lighten(T.bg, 0.08)
  - Left: 4px accent color
  - Right/Bottom: 3px darken(T.bg, 0.2)
- **Column header border-bottom**: 2px darken(T.bg, 0.2)
- **Item row border-bottom**: 1px T.border
- **Button box-shadow (rest)**: `0 4px 0 [darkColor]`
- **Button box-shadow (press)**: `0 1px 0 [darkColor]`
- **Pin overlay scrim**: hexToRgba(T.well, 0.88)
- **Pin card shadow**: inset 0 1px 0 rgba(255,255,255,0.06), 3px 5px 0 rgba(0,0,0,0.55)
- **Seat grid overlay shadow**: `0 -6px 20px rgba(0,0,0,0.45)`

### Selection Highlighting
- **Selected item**: Background = hexToRgba(T.green, 0.12)
- **Selected item text**: Color = T.green
- **Selected item price**: Color = T.green
- **Split target column**: Border + box-shadow = T.elec
- **Merge target column**: Border + box-shadow = T.greenWarm

### Transitions
- **Button press**: transform 0.07s, box-shadow 0.07s
- **UNDO fill animation**: transform 0.2s linear (or none for instant reset)

### Letter Spacing
- **Check # label**: 0.06em
- **PIN title**: 0.18em
- **Buttons**: 0.04em

---

## REFERENCE: Key Functions

### Utility Helpers
- `deepCopyColumns(columns)`: Deep clone for undo/snapshot
- `sumColumn(colIdx, state)`: Total of all items in column
- `projectedColTotal(colIdx, state)`: Subtotal after split operations
- `_collapseSplitGroups(items)`: Merge split items back on recombine
- `formatSeatLabel(label)`: 'S-001' → 'S1'
- `fmt(n)`: Format number as '$X.XX'

### Rendering
- `renderColumns(state)`: Rebuild all column cards
- `buildColumn(colIdx, state)`: Create single column card
- `renderFooterToolbar(state)`: Rebuild action bar
- `renderSeatSelector(state)`: Rebuild seat tile row
- `buildSeatRow(state, params)`: Build seat strip/grid
- `buildSeatGridOverlay(state, params)`: Floating grid for >5 seats
- `buildBottomBar(state, params)`: Full bottom panel (rows 1 & 2)
- `buildHeader(state, params)`: Top header with CHECK # and buttons
- `buildActBtn(opts)`: Reusable action button factory

### Actions
- `doMove(targetColIdx, state)`: Execute item move
- `doSplit(state)`: Execute item split across targets
- `doMerge(targetColIdx, state)`: Execute column merge
- `handleVoidSelected(state)`: Remove selected items
- `handleAddSeat(state)`: Create new seat
- `handleUndo(state)`: Pop one action
- `handleUndoAll(state)`: Restore snapshot
- `handleConfirm(state)`: Call onSave and close scene
- `clearMode(state)`: Reset selections, mode, targets

### Hints & Status
- `getStatusText(state)`: Dynamic hint bar text
- `getColHint(colIdx, state)`: Per-column hint (Mode A info style)

### PIN Overlay
- `openPinOverlay(forAction, state)`: Show PIN entry modal (discount/void)

---

## CONSTRAINTS & INVARIANTS

1. **At least one column always visible** — empty columns must be re-added via seat tiles
2. **Decimal precision**: All prices use 2 decimal places; split remainder assigned to last target
3. **Split items marked with `_splitRef`**: For recombination detection
4. **No HTTP calls from editor** — caller responsible for backend sync
5. **Event listener cleanup on unmount** — prevent memory leaks
6. **_alive guard not needed** — no async fetches; scene callbacks are synchronous
7. **Mode auto-activation**: MOVE triggered on first item select if mode null
8. **Undo snapshot restored**: actionLog preserves order; actionLog[0] is oldest

