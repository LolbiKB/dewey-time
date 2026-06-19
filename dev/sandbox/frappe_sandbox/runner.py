from __future__ import annotations

import subprocess


def run_all(commands: list[list[str]], *, cwd: str | None = None,
            dry_run: bool = False) -> int:
    for cmd in commands:
        line = " ".join(cmd)
        if dry_run:
            print(line)
            continue
        print(f"$ {line}")
        result = subprocess.run(cmd, cwd=cwd)
        if result.returncode != 0:
            return result.returncode
    return 0
