import hashlib
import json
import os
import shutil
import socket
import ssl
import subprocess
import sys
import threading
import tkinter as tk
import traceback
import urllib.error
import urllib.request
import uuid
import zipfile

REPO_ZIP = "https://github.com/kindpos/Vz2.0/archive/refs/heads/main.zip"
PYTHON_URL = "https://www.python.org/ftp/python/3.11.9/python-3.11.9-embed-amd64.zip"
GET_PIP_URL = "https://bootstrap.pypa.io/get-pip.py"
INSTALL_DIR = "C:\\KINDpos"
EMBEDDED_KEY = "KIND-XXXX-XXXX-XXXX"
ACTIVATION_URL = "https://kindpos-license.myers-alexanderk.workers.dev/activate"

_SSL_CTX = ssl.create_default_context()
_SSL_CTX.check_hostname = False
_SSL_CTX.verify_mode = ssl.CERT_NONE

BG = "#383c42"
CARD = "#2e3236"
GREEN = "#86efac"
TEXT = "#e8eaed"
WELL = "#22252a"
GOLD = "#e8c84e"
RED = "#f08080"
YELLOW = "#e8c84e"

FONT_BODY = ("Courier New", 11)
FONT_TITLE = ("Courier New", 14, "bold")
FONT_HUGE = ("Courier New", 28, "bold")
FONT_MONO = ("Courier New", 9)

SEGMENT_COUNT = 20

LAUNCH_BAT = (
    "@echo off\r\n"
    "cd /d C:\\KINDpos\r\n"
    "python\\python.exe -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000\r\n"
)


def _no_window_flags():
    if sys.platform == "win32":
        return subprocess.CREATE_NO_WINDOW
    return 0


class Installer:
    def __init__(self):
        self.root = tk.Tk()
        self.root.title("KINDpos Setup")
        self.root.geometry("660x480")
        self.root.resizable(False, False)
        self.root.configure(bg=BG)

        self.container = tk.Frame(self.root, bg=BG)
        self.container.pack(fill="both", expand=True)

        self.segments = []
        self.log_widget = None
        self.status_label = None
        self.install_title = None
        self.launch_btn = None
        self.close_btn = None
        self.retry_btn = None

        self.current_step_index = 0
        self.worker = None

        self._show_welcome()

    def run(self):
        self.root.mainloop()

    # ---------- screens ----------

    def _clear(self):
        for child in self.container.winfo_children():
            child.destroy()

    def _show_welcome(self):
        self._clear()

        wrap = tk.Frame(self.container, bg=BG)
        wrap.pack(fill="both", expand=True, padx=40, pady=30)

        tk.Label(wrap, text="KINDpos", bg=BG, fg=GOLD, font=FONT_HUGE).pack(anchor="w")
        tk.Label(wrap, text="Version 1.0", bg=BG, fg=GREEN, font=FONT_TITLE).pack(anchor="w", pady=(0, 24))

        card = tk.Frame(wrap, bg=CARD)
        card.pack(fill="x", pady=(0, 24))
        tk.Frame(card, bg=GREEN, width=4).pack(side="left", fill="y")
        inner = tk.Frame(card, bg=CARD)
        inner.pack(side="left", fill="both", expand=True, padx=16, pady=14)
        tk.Label(
            inner,
            text="Installs KINDpos to C:\\KINDpos",
            bg=CARD, fg=TEXT, font=FONT_BODY, anchor="w", justify="left",
        ).pack(anchor="w")
        tk.Label(
            inner,
            text="Requires: Windows 10+, 500MB free disk space, internet",
            bg=CARD, fg=TEXT, font=FONT_BODY, anchor="w", justify="left",
        ).pack(anchor="w", pady=(6, 0))

        btn = tk.Button(
            wrap,
            text="Install Now",
            bg=GREEN, fg="#1a1d20",
            activebackground=GREEN, activeforeground="#1a1d20",
            font=FONT_TITLE, bd=0, relief="flat",
            command=self._show_installing,
            cursor="hand2",
        )
        btn.pack(fill="x", ipady=12, pady=(8, 0))

    def _show_installing(self):
        self._clear()

        wrap = tk.Frame(self.container, bg=BG)
        wrap.pack(fill="both", expand=True, padx=30, pady=24)

        self.install_title = tk.Label(wrap, text="Installing...", bg=BG, fg=GREEN, font=FONT_TITLE)
        self.install_title.pack(anchor="w")

        bar_frame = tk.Frame(wrap, bg=BG)
        bar_frame.pack(fill="x", pady=(14, 8))
        self.segments = []
        for _ in range(SEGMENT_COUNT):
            seg = tk.Frame(bar_frame, bg=WELL, width=28, height=18)
            seg.pack(side="left", padx=1)
            seg.pack_propagate(False)
            self.segments.append(seg)

        self.status_label = tk.Label(wrap, text="Starting...", bg=BG, fg=TEXT, font=FONT_BODY, anchor="w")
        self.status_label.pack(fill="x", pady=(0, 10))

        log_box = tk.Frame(wrap, bg=WELL)
        log_box.pack(fill="both", expand=True)
        self.log_widget = tk.Text(
            log_box, bg=WELL, fg=GREEN, font=FONT_MONO,
            relief="flat", bd=0, height=10, wrap="word",
            insertbackground=GREEN, state="disabled",
        )
        self.log_widget.pack(fill="both", expand=True, padx=8, pady=8)
        self.log_widget.tag_config("err", foreground=RED)
        self.log_widget.tag_config("warn", foreground=YELLOW)
        self.log_widget.tag_config("ok", foreground=GREEN)

        self.button_row = tk.Frame(wrap, bg=BG)
        self.button_row.pack(fill="x", pady=(10, 0))

        self.current_step_index = 0
        self._start_worker()

    # ---------- ui helpers (called from main thread) ----------

    def _ui(self, fn, *args):
        self.root.after(0, lambda: fn(*args))

    def _set_progress(self, pct):
        if not self.segments:
            return
        pct = max(0, min(100, pct))
        filled = int(round(pct / 100.0 * SEGMENT_COUNT))
        for i, seg in enumerate(self.segments):
            seg.config(bg=GREEN if i < filled else WELL)

    def _set_status(self, text):
        if self.status_label is not None:
            self.status_label.config(text=text)

    def _log(self, msg, tag=None):
        if self.log_widget is None:
            return
        self.log_widget.config(state="normal")
        if tag:
            self.log_widget.insert("end", msg + "\n", tag)
        else:
            self.log_widget.insert("end", msg + "\n")
        self.log_widget.see("end")
        self.log_widget.config(state="disabled")

    def _show_retry(self):
        for child in self.button_row.winfo_children():
            child.destroy()
        self.retry_btn = tk.Button(
            self.button_row, text="Retry", bg=GREEN, fg="#1a1d20",
            activebackground=GREEN, activeforeground="#1a1d20",
            font=FONT_TITLE, bd=0, relief="flat", cursor="hand2",
            command=self._retry,
        )
        self.retry_btn.pack(side="left", ipadx=20, ipady=8, padx=(0, 10))
        tk.Button(
            self.button_row, text="Close", bg=CARD, fg=TEXT,
            activebackground=CARD, activeforeground=TEXT,
            font=FONT_BODY, bd=0, relief="flat", cursor="hand2",
            command=self.root.destroy,
        ).pack(side="left", ipadx=20, ipady=8)

    def _show_complete(self):
        if self.install_title is not None:
            self.install_title.config(text="KINDpos Ready!")
        self._set_progress(100)
        self._set_status("Installation complete.")
        for child in self.button_row.winfo_children():
            child.destroy()
        self.launch_btn = tk.Button(
            self.button_row, text="Launch KINDpos", bg=GREEN, fg="#1a1d20",
            activebackground=GREEN, activeforeground="#1a1d20",
            font=FONT_TITLE, bd=0, relief="flat", cursor="hand2",
            command=self._launch,
        )
        self.launch_btn.pack(side="left", ipadx=20, ipady=8, padx=(0, 10))
        self.close_btn = tk.Button(
            self.button_row, text="Close", bg=CARD, fg=TEXT,
            activebackground=CARD, activeforeground=TEXT,
            font=FONT_BODY, bd=0, relief="flat", cursor="hand2",
            command=self.root.destroy,
        )
        self.close_btn.pack(side="left", ipadx=20, ipady=8)

    def _retry(self):
        self.retry_btn = None
        for child in self.button_row.winfo_children():
            child.destroy()
        self._start_worker()

    def _launch(self):
        try:
            subprocess.Popen(
                ["cmd.exe", "/c", os.path.join(INSTALL_DIR, "launch.bat")],
                creationflags=_no_window_flags() if sys.platform == "win32" else 0,
            )
            self.root.destroy()
        except Exception as e:
            self._log(f"Launch failed: {e}", "err")

    # ---------- worker ----------

    def _start_worker(self):
        steps = [
            ("Creating install directory", 0, 10, self._step_make_dir),
            ("Downloading application", 10, 40, self._step_download_repo),
            ("Extracting application", 40, 60, self._step_extract_repo),
            ("Downloading Python runtime", 60, 70, self._step_download_python),
            ("Setting up Python runtime", 70, 85, self._step_setup_python),
            ("Installing dependencies", 85, 95, self._step_install_deps),
            ("Activating license", 95, 98, self._step_activate),
            ("Creating launcher", 98, 100, self._step_launcher),
        ]
        self.worker = threading.Thread(target=self._run_steps, args=(steps,), daemon=True)
        self.worker.start()

    def _run_steps(self, steps):
        for idx in range(self.current_step_index, len(steps)):
            label, start_pct, end_pct, fn = steps[idx]
            self.current_step_index = idx
            self._ui(self._set_status, label)
            self._ui(self._log, f"[{idx + 1}/{len(steps)}] {label}")
            self._ui(self._set_progress, start_pct)
            try:
                fn(start_pct, end_pct)
            except urllib.error.URLError as e:
                self._ui(self._log, f"Network error: {e}", "err")
                self._ui(self._log, "Check your internet connection.", "err")
                self._ui(self._show_retry)
                return
            except Exception as e:
                self._ui(self._log, f"Step failed: {e}", "err")
                self._ui(self._log, traceback.format_exc().rstrip(), "err")
                self._ui(self._show_retry)
                return
            self._ui(self._set_progress, end_pct)
            self._ui(self._log, f"  done.", "ok")
        self.current_step_index = len(steps)
        self._ui(self._show_complete)

    # ---------- steps ----------

    def _step_progress(self, start, end, fraction):
        fraction = max(0.0, min(1.0, fraction))
        self._ui(self._set_progress, start + (end - start) * fraction)

    def _download(self, url, dest, start_pct, end_pct):
        req = urllib.request.Request(url, headers={"User-Agent": "KINDpos-Installer/1.0"})
        with urllib.request.urlopen(req, timeout=60, context=_SSL_CTX) as resp:
            total = int(resp.headers.get("Content-Length") or 0)
            downloaded = 0
            with open(dest, "wb") as f:
                while True:
                    chunk = resp.read(65536)
                    if not chunk:
                        break
                    f.write(chunk)
                    downloaded += len(chunk)
                    if total > 0:
                        self._step_progress(start_pct, end_pct, downloaded / total)
            if total == 0:
                self._step_progress(start_pct, end_pct, 1.0)

    def _step_make_dir(self, start, end):
        os.makedirs(INSTALL_DIR, exist_ok=True)

    def _step_download_repo(self, start, end):
        self._tmp_zip = os.path.join(INSTALL_DIR, "_repo.zip")
        self._download(REPO_ZIP, self._tmp_zip, start, end)

    def _step_extract_repo(self, start, end):
        with zipfile.ZipFile(self._tmp_zip) as zf:
            names = zf.namelist()
            top = names[0].split("/")[0] if names else "Vz2.0-main"
            extract_root = os.path.join(INSTALL_DIR, "_extract")
            if os.path.isdir(extract_root):
                shutil.rmtree(extract_root)
            os.makedirs(extract_root, exist_ok=True)
            total = len(names)
            for i, name in enumerate(names):
                zf.extract(name, extract_root)
                if total:
                    self._step_progress(start, end, (i + 1) / total * 0.8)

        src_root = os.path.join(extract_root, top)
        for entry in os.listdir(src_root):
            dst = os.path.join(INSTALL_DIR, entry)
            if os.path.isdir(dst):
                shutil.rmtree(dst)
            elif os.path.isfile(dst):
                os.remove(dst)
            shutil.move(os.path.join(src_root, entry), dst)
        shutil.rmtree(extract_root, ignore_errors=True)
        try:
            os.remove(self._tmp_zip)
        except OSError:
            pass

    def _step_download_python(self, start, end):
        self._py_zip = os.path.join(INSTALL_DIR, "_python.zip")
        self._download(PYTHON_URL, self._py_zip, start, end)

    def _step_setup_python(self, start, end):
        py_dir = os.path.join(INSTALL_DIR, "python")
        if os.path.isdir(py_dir):
            shutil.rmtree(py_dir)
        os.makedirs(py_dir, exist_ok=True)
        with zipfile.ZipFile(self._py_zip) as zf:
            zf.extractall(py_dir)
        try:
            os.remove(self._py_zip)
        except OSError:
            pass
        self._step_progress(start, end, 0.4)

        pth_files = [f for f in os.listdir(py_dir) if f.endswith("._pth")]
        if pth_files:
            pth_path = os.path.join(py_dir, pth_files[0])
            with open(pth_path, "r", encoding="utf-8") as f:
                content = f.read()
            patched = content.replace("#import site", "import site")
            if "Lib\\site-packages" not in patched and "Lib/site-packages" not in patched:
                patched = patched.rstrip() + "\r\nLib\\site-packages\r\n"
            with open(pth_path, "w", encoding="utf-8") as f:
                f.write(patched)
        self._step_progress(start, end, 0.55)

        get_pip = os.path.join(py_dir, "get-pip.py")
        self._download(GET_PIP_URL, get_pip, start, end)
        self._step_progress(start, end, 0.85)

        py_exe = os.path.join(py_dir, "python.exe")
        result = subprocess.run(
            [py_exe, get_pip, "--no-warn-script-location"],
            cwd=py_dir,
            capture_output=True, text=True,
            creationflags=_no_window_flags(),
        )
        if result.returncode != 0:
            tail = (result.stderr or result.stdout or "").strip().splitlines()[-5:]
            raise RuntimeError("get-pip failed: " + " | ".join(tail))
        try:
            os.remove(get_pip)
        except OSError:
            pass

    def _step_install_deps(self, start, end):
        py_exe = os.path.join(INSTALL_DIR, "python", "python.exe")
        req = os.path.join(INSTALL_DIR, "backend", "requirements.txt")
        if not os.path.isfile(req):
            raise RuntimeError(f"requirements.txt not found at {req}")

        proc = subprocess.Popen(
            [py_exe, "-m", "pip", "install", "--no-warn-script-location", "-r", req],
            cwd=INSTALL_DIR,
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            text=True, bufsize=1,
            creationflags=_no_window_flags(),
        )
        line_count = 0
        for line in proc.stdout:
            line = line.rstrip()
            if line:
                self._ui(self._log, "  " + line[:120])
                line_count += 1
                self._step_progress(start, end, min(0.95, line_count / 60.0))
        rc = proc.wait()
        if rc != 0:
            raise RuntimeError(f"pip install failed (exit {rc})")

    def _fingerprint(self):
        mac = uuid.getnode()
        host = socket.gethostname()
        return hashlib.sha256(f"{mac}:{host}".encode("utf-8")).hexdigest()[:32]

    def _step_activate(self, start, end):
        lic_path = os.path.join(INSTALL_DIR, "kindpos.lic")
        fingerprint = self._fingerprint()
        body = json.dumps({"key": EMBEDDED_KEY, "fingerprint": fingerprint}).encode("utf-8")
        req = urllib.request.Request(
            ACTIVATION_URL, data=body,
            headers={"Content-Type": "application/json", "User-Agent": "KINDpos-Installer/1.0"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=20) as resp:
                payload = resp.read().decode("utf-8")
            with open(lic_path, "w", encoding="utf-8") as f:
                f.write(payload)
            self._ui(self._log, "  license activated", "ok")
        except Exception as e:
            self._ui(self._log, f"  activation failed ({e}); writing trial license", "warn")
            trial = json.dumps({
                "trial": True,
                "key": EMBEDDED_KEY,
                "fingerprint": fingerprint,
            })
            with open(lic_path, "w", encoding="utf-8") as f:
                f.write(trial)

    def _step_launcher(self, start, end):
        bat_path = os.path.join(INSTALL_DIR, "launch.bat")
        with open(bat_path, "w", encoding="ascii", newline="") as f:
            f.write(LAUNCH_BAT)

        ps = (
            "$desktop = [Environment]::GetFolderPath('Desktop'); "
            "$lnk = (New-Object -ComObject WScript.Shell).CreateShortcut($desktop + '\\KINDpos.lnk'); "
            f"$lnk.TargetPath = '{bat_path}'; "
            f"$lnk.WorkingDirectory = '{INSTALL_DIR}'; "
            "$lnk.WindowStyle = 7; "
            "$lnk.Save();"
        )
        result = subprocess.run(
            ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", ps],
            capture_output=True, text=True,
            creationflags=_no_window_flags(),
        )
        if result.returncode != 0:
            self._ui(self._log, f"  shortcut creation failed: {result.stderr.strip()}", "warn")
        else:
            self._ui(self._log, "  desktop shortcut created", "ok")


if __name__ == "__main__":
    Installer().run()
