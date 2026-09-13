#!/usr/bin/env python3
"""Reference client for the Sidings browserless job API (stdlib only).

Submits one chat turn to an existing conversation and follows its event
stream via HTTP polling with a replay cursor:

    POST /api/jobs                {"sessionId": ..., "prompt": ...}
    GET  /api/jobs/<id>?cursor=N  -> {"job": {...}, "events": [seq > N]}

Usage:
    python3 scripts/automation-client.py --session conv-abc123 "Refactor the login flow"

The server also exposes a live WebSocket API at ws://<host>/_ws — send
{"type": "submit", "sessionId": ..., "prompt": ...} and receive
{"type": "event", ...} frames until {"type": "done", ...}. Use that from a
client with a websocket library; this script sticks to stdlib HTTP polling.
"""
import argparse
import json
import sys
import time
import urllib.error
import urllib.request

TERMINAL_STATUSES = {"done", "failed", "cancelled"}


def request_json(url, payload=None):
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            return json.loads(res.read().decode())
    except urllib.error.HTTPError as err:
        detail = err.read().decode(errors="replace")
        sys.exit(f"HTTP {err.code} from {url}: {detail}")
    except urllib.error.URLError as err:
        sys.exit(f"Cannot reach {url}: {err.reason}")


def main():
    parser = argparse.ArgumentParser(description="Submit a browserless chat turn to Sidings.")
    parser.add_argument("--base-url", default="http://127.0.0.1:3000", help="Sidings server URL")
    parser.add_argument("--session", required=True, help="conversation session id (conv-...)")
    parser.add_argument("--poll-interval", type=float, default=1.0, help="seconds between polls")
    parser.add_argument("prompt", help="prompt text to submit")
    args = parser.parse_args()

    base = args.base_url.rstrip("/")
    created = request_json(f"{base}/api/jobs", {"sessionId": args.session, "prompt": args.prompt})
    job = created["job"]
    print(f"job {job['id']} [{job['status']}] on session {job['sessionId']}", flush=True)

    cursor = 0
    while True:
        state = request_json(f"{base}/api/jobs/{job['id']}?cursor={cursor}")
        for event in state["events"]:
            cursor = event["seq"]
            data = f" {json.dumps(event['data'])}" if event.get("data") is not None else ""
            print(f"  #{event['seq']} {event['type']}{data}", flush=True)

        status = state["job"]["status"]
        if status in TERMINAL_STATUSES:
            result = state["job"].get("result") or {}
            message = result.get("lastAssistantMessage")
            if message:
                print("\n--- last assistant message ---\n" + message)
            if status == "failed":
                sys.exit(f"job failed: {state['job'].get('error', 'unknown error')}")
            print(f"job finished: {status}")
            return
        time.sleep(args.poll_interval)


if __name__ == "__main__":
    main()
