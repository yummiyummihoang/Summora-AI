"""Start the Summora FastAPI service with python -m summora."""

import argparse

import uvicorn

from .api import create_app


def main():
    parser = argparse.ArgumentParser(description="Summora FastAPI service")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()
    uvicorn.run(create_app(), host="127.0.0.1", port=args.port, access_log=False)


if __name__ == "__main__":
    main()
