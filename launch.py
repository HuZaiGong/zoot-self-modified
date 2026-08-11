import os
import sys
import threading
import time
import webbrowser

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
if sys.stdout:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if sys.stderr:
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

import app.main

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
TOKEN_FILE = os.path.join(BASE_DIR, "bootstrap_token.txt")


def refresh_token_loop(port: int, stop_event: threading.Event):
    while not stop_event.is_set():
        try:
            token = app.main.issue_local_bootstrap_token()
            with open(TOKEN_FILE, "w") as f:
                f.write(token)
        except Exception:
            pass
        time.sleep(5)


def open_browser_when_ready(port: int, stop_event: threading.Event):
    deadline = time.time() + 60
    while time.time() < deadline and not stop_event.is_set():
        try:
            import socket

            s = socket.create_connection(("127.0.0.1", port), timeout=1)
            s.close()
            break
        except OSError:
            time.sleep(1)
    token = app.main.issue_local_bootstrap_token()
    with open(TOKEN_FILE, "w") as f:
        f.write(token)
    webbrowser.open(
        f"http://127.0.0.1:{port}/__local/bootstrap?token={token}&next=%2Fstatic%2Findex.html"
    )


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 55000
    stop_event = threading.Event()
    threading.Thread(
        target=open_browser_when_ready, args=(port, stop_event), daemon=True
    ).start()
    threading.Thread(target=refresh_token_loop, args=(port, stop_event), daemon=True).start()
    app.main.start_server(port)
