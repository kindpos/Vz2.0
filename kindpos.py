import sys
import os

# Ensure backend is on the path when running as PyInstaller bundle
if getattr(sys, 'frozen', False):
    base = sys._MEIPASS
    sys.path.insert(0, os.path.join(base, 'backend'))
else:
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'backend'))

from app.main import app

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)
