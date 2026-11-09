#!/usr/bin/python3 -I
"""Run the existing scoped node release planner for the pending event repair."""
import hashlib
import runpy
from pathlib import Path

HERE = Path(__file__).resolve().parent
ENGINE = HERE.parent / "powcat/release.py"
if hashlib.sha256(ENGINE.read_bytes()).hexdigest() != "bff08af2cf46467ec633f744674052678bd69931c6c485dd15b3efba03d86a96":
    raise RuntimeError("Unexpected scoped node release engine")
engine = runpy.run_path(str(ENGINE))
original = engine["controller"]


def controller():
    body, footer = original().rsplit(b"\nif __name__ == '__main__': main()", 1)
    prefix = b"backup = BACKUPS/('powcat-'"
    if footer.strip() or body.count(prefix) != 1:
        raise RuntimeError("Unexpected node controller")
    return (body.replace(prefix, b"backup = BACKUPS/('pending-work-publication-'")
            + b"\n" + (HERE / "profile.py").read_bytes()
            + b"\nif __name__ == '__main__': main()\n")


if __name__ == "__main__":
    engine["main"].__globals__["controller"] = controller
    engine["main"]()
