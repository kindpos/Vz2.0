import requests, uuid, json, sys, os

EMBEDDED_KEY = "KIND-B2C3-D4E5-F6G7"

def activate():
    fingerprint = str(uuid.getnode())
    try:
        r = requests.post(
            "https://kindpos-license.myers-alexanderk.workers.dev/activate",
            json={"key": EMBEDDED_KEY, "fingerprint": fingerprint},
            timeout=10
        )
        if r.ok:
            lic = r.json()
            lic_dir = os.path.join(
                os.environ.get('APPDATA', 'C:/ProgramData'), 'KINDpos'
            )
            os.makedirs(lic_dir, exist_ok=True)
            with open(os.path.join(lic_dir, 'kindpos.lic'), 'w') as f:
                json.dump(lic, f)
    except Exception:
        lic_dir = os.path.join(
            os.environ.get('APPDATA', 'C:/ProgramData'), 'KINDpos'
        )
        os.makedirs(lic_dir, exist_ok=True)
        with open(os.path.join(lic_dir, 'kindpos.lic'), 'w') as f:
            json.dump({"trial": True, "expires": "30d"}, f)

if __name__ == "__main__":
    activate()
