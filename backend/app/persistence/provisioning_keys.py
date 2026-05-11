"""
Canonical key constants for the provisioning key-value table.
All values match OVERSEER_AUTH.md §3.2.
"""

# Set to 'true' on SD image creation; cleared after first activation phone-home.
FIRST_BOOT_PENDING = "first_boot_pending"

# Identifies the store on kindpos.com. Sent in every phone-home payload.
STORE_REF = "store_ref"

# Bearer token for phone-home calls. Plaintext only on SD image; never re-exposed.
CUSTOMER_API_KEY = "customer_api_key"

# Base URL of the kindpos.com API. Allows override without code changes.
KINDPOS_API_BASE = "kindpos_api_base"

# Ed25519 keys for terminal token signing. OVERSEER_AUTH.md §7.
OVERSEER_PRIVATE_KEY = "overseer_private_key"
OVERSEER_PUBLIC_KEY = "overseer_public_key"

# argon2id hash of the printed recovery code. OVERSEER_AUTH.md §11.1.
RECOVERY_CODE_HASH = "recovery_code_hash"
