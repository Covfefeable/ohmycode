import json
import shutil
import tempfile
from pathlib import Path

from .metrics import collect_metrics, metric_value
from .source import Trace

DATA = Path(__file__).parent


def fixture_files(case: dict) -> dict[str, Path]:
    files = {}
    for name in case["fixtures"]:
        root = DATA / "fixtures" / name
        if not root.is_dir():
            raise ValueError(f"评测素材不存在：{name}")
        for path in sorted(root.rglob("*")):
            if path.is_file() and "__pycache__" not in path.relative_to(root).parts:
                files[path.relative_to(root).as_posix()] = path
    return files


def load_cases() -> list[dict]:
    cases = json.loads((DATA / "cases.json").read_text(encoding="utf-8"))
    identifiers = [case["id"] for case in cases]
    if len(identifiers) != len(set(identifiers)):
        raise ValueError("用例 ID 重复")
    metrics = collect_metrics(Trace([], [], ""))
    for case in cases:
        fixture_files(case)
        for direction in ("min", "max"):
            for path in case.get(direction, {}):
                metric_value(metrics, path)
    return cases


def prepare_case(case: dict) -> Path:
    workspace = Path(tempfile.mkdtemp(prefix="ohmycode-eval-")) / "workspace"
    workspace.mkdir()
    for name, source in fixture_files(case).items():
        destination = workspace / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, destination)
    return workspace
