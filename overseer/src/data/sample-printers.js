/* ============================================
   KINDpos Overseer — Printer Constants
   Color mappings and role options for printer UI.
   Device data comes live from the discovery scan.
   ============================================ */

export const ROLE_COLORS = {
    receipt:  'var(--color-mint)',
    kitchen:  'var(--color-gold)',
    bar:      '#70a1ff',
    expo:     '#b48efa',
    delivery: '#ff6b6b',
    general:  'rgba(var(--color-mint-rgb), 0.5)',
};

export const STATUS_COLORS = {
    online:   'var(--color-green)',
    offline:  'var(--color-vermillion)',
    idle:     'var(--color-gold)',
    error:    'var(--color-vermillion)',
    unknown:  'rgba(var(--color-mint-rgb), 0.4)',
};

export const ROLE_OPTIONS = [
    { value: 'receipt',  label: 'Receipt'  },
    { value: 'kitchen',  label: 'Kitchen'  },
    { value: 'bar',      label: 'Bar'      },
    { value: 'expo',     label: 'Expo'     },
    { value: 'delivery', label: 'Delivery' },
    { value: 'general',  label: 'General'  },
];

export const SAMPLE_NETWORK = {
    subnet: '10.0.0.0/24',
    gateway: '10.0.0.1',
    devices: [],
};
