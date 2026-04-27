from decimal import Decimal
from pydantic import BaseModel, Field
from typing import List, Optional, Dict

class StoreInfo(BaseModel):
    restaurant_name: str = "KINDpos"
    legal_entity_name: Optional[str] = None
    address_line_1: str = ""
    address_line_2: Optional[str] = None
    city: str = ""
    state: str = ""
    zip: str = ""
    phone: str = ""
    email: Optional[str] = None
    website: Optional[str] = None

class StoreBranding(BaseModel):
    logo_url: Optional[str] = None
    logo_mime_type: Optional[str] = None

class StoreTheme(BaseModel):
    id: str
    label: str
    slots: Dict[str, str]

class CCProcessingRate(BaseModel):
    rate_percent: float = 2.9
    per_transaction_fee: Decimal = Decimal("0.30")

class TaxRule(BaseModel):
    tax_rule_id: str
    name: str
    rate_percent: float
    applies_to: str # "all" or "category"
    category_id: Optional[str] = None

class OperatingHours(BaseModel):
    open: str
    close: str
    enabled: bool

class StoreOperatingHours(BaseModel):
    hours: Dict[str, OperatingHours]

class StoreOrderTypes(BaseModel):
    enabled_types: List[str]

class StoreAutoGratuity(BaseModel):
    enabled: bool
    party_size_threshold: int = 6
    rate_percent: float = 20.0
    applies_to_order_types: List[str] = ["dine_in"]

class StoreConfigBundle(BaseModel):
    info: StoreInfo
    branding: StoreBranding = StoreBranding()
    themes: List[StoreTheme] = []
    active_theme_id: str = "terminal-glow"
    tax_rules: List[TaxRule]
    cc_processing: CCProcessingRate
    operating_hours: Dict[str, OperatingHours]
    order_types: StoreOrderTypes
    auto_gratuity: StoreAutoGratuity
    cash_discount_rate: float = 0.0

# Employee Models
class Role(BaseModel):
    role_id: str
    name: str
    permission_level: str  # Standard, Elevated, Manager
    permissions: Dict[str, bool]
    tipout_eligible: bool
    can_receive_tips: bool
    can_be_tipped_out_to: bool

class Employee(BaseModel):
    employee_id: str
    first_name: str = ""
    last_name: str = ""
    display_name: str = ""
    name: Optional[str] = None
    role_ids: List[str] = []
    role_id: Optional[str] = None
    pin: str = ""
    hourly_rate: Decimal = Decimal("0")
    permissions_override: Optional[Dict[str, bool]] = None
    active: bool = True

    def __init__(self, **data):
        # Migrate legacy "name" field to first_name/last_name/display_name
        if 'name' in data and 'first_name' not in data:
            parts = data['name'].split(' ', 1)
            data['first_name'] = parts[0]
            data['last_name'] = parts[1] if len(parts) > 1 else ''
            data.setdefault('display_name', data['name'])
        if 'display_name' not in data or not data.get('display_name'):
            data['display_name'] = f"{data.get('first_name', '')} {data.get('last_name', '')}".strip()
        # Migrate legacy single role_id to role_ids list
        if 'role_id' in data and 'role_ids' not in data:
            rid = data.pop('role_id')
            data['role_ids'] = [rid] if rid else []
        super().__init__(**data)

class TipoutRule(BaseModel):
    rule_id: str
    role_from: str
    role_to: str
    percentage: float
    calculation_base: str # Net Sales, Gross Tips, Net Tips
    # Optional category filter. When non-empty and calculation_base is
    # "Net Sales", the basis is the sum of net sales for items in these
    # categories only (typically applied per-server, e.g. "2% of
    # alcohol net sales to bar"). Empty list -> full net sales.
    categories: List[str] = []


class TipPoolSchedule(BaseModel):
    start: Optional[str] = None  # "HH:MM" 24-hour
    end: Optional[str] = None    # "HH:MM" 24-hour
    days: List[str] = []         # ['mon', 'tue', ...]; empty = all days


class TipPool(BaseModel):
    pool_id: str
    name: str
    role_ids: List[str] = []
    split_method: str = "hours"  # "hours" | "even"
    active: bool = True
    schedule: Optional[TipPoolSchedule] = None


# =============================================================================
# MENU MODELS — schedule windows + special metadata added for Overseer v2.
# =============================================================================

class ScheduleWindow(BaseModel):
    """One time window within a category schedule.

    Authored in Overseer's menu-categories scene. Terminal evaluates
    `active` per category by checking whether any window is currently
    open (union semantics). When a category has `price_adjustment_pct`
    set on the currently-active window, items in that category reprice
    by the adjustment at order-entry.
    """
    label: str = ""
    days: List[int] = [1, 1, 1, 1, 1, 1, 1]  # Mon..Sun, 1 = active
    start: str = "09:00"  # HH:MM
    end: str = "21:00"
    price_adjustment_pct: float = 0.0


class CategorySchedule(BaseModel):
    """Schedule container on a MenuCategory.

    `enabled=False` (default) = category always available.
    `enabled=True` + empty windows = category never available (operator
    should either add a window or toggle enabled off).
    """
    enabled: bool = False
    grace_minutes: int = 10
    windows: List[ScheduleWindow] = []


# Menu Models
class MenuItem(BaseModel):
    item_id: str
    name: str
    category_id: Optional[str] = None
    category: Optional[str] = None
    price: Decimal = Decimal("0")
    description: Optional[str] = None
    kitchen_name: Optional[str] = None
    tax_rule_id: Optional[str] = None
    revenue_category: str = "Food"
    prep_time: int = 0
    print_station: Optional[str] = None
    allergens: List[str] = []
    active: bool = True
    # Transient stockout flag. `active` is the permanent soft-delete;
    # `is_86ed` is the temporary "we ran out of this tonight" toggle
    # driven by MENU_ITEM_86D / MENU_ITEM_RESTORED events. Order-entry
    # must refuse to add an is_86ed item.
    is_86ed: bool = False
    display_order: int = 0
    # New-model modifier wiring: groups this item forces at order entry,
    # and atoms that come on by default (strikable with NO / ON SIDE).
    mandatory_group_ids: List[str] = []
    included_modifier_ids: List[str] = []

    def __init__(self, **data):
        if 'category_id' not in data and 'category' in data:
            data['category_id'] = data['category']
        super().__init__(**data)

class MenuCategory(BaseModel):
    category_id: str
    name: str
    display_order: int = 0
    hex_color: str = "#888888"
    color: Optional[str] = None
    tax_rule_id: Optional[str] = None
    enable_placement: bool = False
    half_placement: bool = False
    pizza_builder: bool = False
    active: bool = True
    # New-model: optional groups that become available on the OPT tab
    # for every item in this category at order entry.
    universal_group_ids: List[str] = []
    # Scheduling + special metadata (Overseer menu-categories v2).
    # Defaults keep older saved events projecting cleanly — a category
    # without scheduling just has enabled=False.
    schedule: CategorySchedule = Field(default_factory=CategorySchedule)
    special_active: bool = False
    special_label: str = ""

    def __init__(self, **data):
        if 'hex_color' not in data and 'color' in data:
            data['hex_color'] = data['color']
        super().__init__(**data)

# Modifier Models
class ModifierOption(BaseModel):
    modifier_id: str
    name: str
    price: Decimal = Decimal("0")
    # Price override keyed by the modifier_id of an option in a drives_pricing
    # mandatory group (e.g. {"size_md": 1.00, "size_xl": 2.00}). Falls back to
    # `price` when the current driver selection is not in this map.
    price_by_option: Dict[str, Decimal] = {}
    # Subatomic modifiers ("quarks"): atoms that come bundled with this atom.
    # When a server long-taps this atom on the OPT grid, the terminal opens a
    # sub-panel listing these for strike-off (NO / ON SIDE). Empty list =
    # leaf atom, regular tap behavior.
    included_modifier_ids: List[str] = []
    active: bool = True
    is_86d: bool = False

class ModifierGroup(BaseModel):
    group_id: str
    name: str
    modifier_ids: List[str] = []
    modifiers: List[ModifierOption] = []
    template_id: Optional[str] = None
    # New-model group behavior. These used to live on MandatoryAssignment; they
    # now sit on the group itself so a group carries its own shape wherever
    # it's wired (mandatory on an item, universal on a category).
    #
    # min_selections:
    #   0 — universal-wireable (optional). Server can skip entirely.
    #   1+ — mandatory-wireable. Panel gates progress until this many picked.
    # max_selections:
    #   1 — single-select (overlay auto-dismisses on pick).
    #   >1 — multi-select checklist with counter + DONE button.
    # drives_pricing:
    #   true only when max_selections == 1 (enforced at the editor). When set,
    #   the terminal reprices optional mods against this group's selection
    #   (pizza size -> topping prices).
    min_selections: int = 0
    max_selections: int = 1
    drives_pricing: bool = False
    color: Optional[str] = None
    category_id: Optional[str] = None
    hidden: bool = False
    owner_item_id: Optional[str] = None
    active: bool = True

class MicroMod(BaseModel):
    micromod_id: str
    name: str
    price: Decimal = Decimal("0")
    modifier_id: Optional[str] = None
    active: bool = True
    is_86d: bool = False

# Floor Plan Models
class TableElement(BaseModel):
    id: str
    name: str
    seats: int
    section_id: str
    shape: str
    x: int
    y: int
    width: int
    height: int
    rotation: int
    active: bool = True

class StructureElement(BaseModel):
    id: str
    type: str
    x: int
    y: int
    width: Optional[int] = None
    height: Optional[int] = None
    x2: Optional[int] = None
    y2: Optional[int] = None
    label: Optional[str] = None

class FixtureElement(BaseModel):
    id: str
    type: str
    device_id: Optional[str] = None
    x: int
    y: int
    width: int
    height: int
    label: Optional[str] = None

class FloorPlanLayout(BaseModel):
    canvas: Dict[str, int]
    tables: List[TableElement]
    structures: List[StructureElement]
    fixtures: List[FixtureElement]

class Section(BaseModel):
    section_id: str
    name: str
    color: str
    active: bool = True

# Hardware Models
class Terminal(BaseModel):
    terminal_id: str
    name: str
    role: str
    default_section_id: Optional[str] = None
    training_mode: bool = False

class Printer(BaseModel):
    printer_id: str
    name: str
    station: str
    ip_address: str
    mac_address: str
    paper_width: str = "80mm"
    print_logo: bool = True
    active: bool = True

class RoutingMatrix(BaseModel):
    matrix: Dict[str, List[str]] # category_id -> list of printer_ids

# Reporting Models
class DashboardConfig(BaseModel):
    widgets: List[Dict]

class CustomReport(BaseModel):
    report_id: str
    name: str
    query_definition: Dict

class AccountsMapping(BaseModel):
    accounts: Dict[str, str]

class PendingChange(BaseModel):
    event_type: str
    payload: Dict