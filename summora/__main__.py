"""Start the local Summora workspace with python -m summora."""

import argparse
import threading
import webbrowser

import uvicorn

from .api import create_app


def main():
    parser = argparse.ArgumentParser(description="Summora local workspace")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--open", action="store_true")
    args = parser.parse_args()
    if args.open:
        threading.Timer(0.8, lambda: webbrowser.open(f"http://127.0.0.1:{args.port}")).start()
    uvicorn.run(create_app(), host="127.0.0.1", port=args.port, access_log=False)


if __name__ == "__main__":
    main()
