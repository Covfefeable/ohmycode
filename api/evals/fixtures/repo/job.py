import argparse
import time
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument("--seconds", type=float, default=0)
parser.add_argument("--exit-code", type=int, default=0)
parser.add_argument("--output", type=Path)
parser.add_argument("--interactive", action="store_true")
args = parser.parse_args()
message = "done"
if args.interactive:
    message = "accepted" if input("Continue? Yes/No: ").strip().lower() == "yes" else "declined"
print("started", flush=True)
time.sleep(args.seconds)
if args.output:
    args.output.write_text(message + "\n", encoding="utf-8")
print(message, flush=True)
raise SystemExit(args.exit_code)
