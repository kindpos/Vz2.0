import sys
import os
import uvicorn

if getattr(sys, 'frozen', False):
    # Inside PyInstaller bundle — modules are in sys._MEIPASS
    base = sys._MEIPASS
    # Add backend dir so 'app' package resolves
    backend_dir = os.path.join(base, 'backend')
    if os.path.isdir(backend_dir):
        sys.path.insert(0, backend_dir)
    # Also try base directly
    sys.path.insert(0, base)
else:
    base = os.path.dirname(os.path.abspath(__file__))
    sys.path.insert(0, os.path.join(base, 'backend'))

from app.main import app

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8000)
