import hashlib
import json
from pathlib import Path

from .cases import fixture_files
from .metrics import collect_metrics, metric_value
from .source import Trace


def case_digest(case: dict) -> str:
    digest = hashlib.sha256(json.dumps(case, sort_keys=True, ensure_ascii=False).encode())
    for name, path in sorted(fixture_files(case).items()):
        digest.update(name.encode())
        digest.update(hashlib.sha256(path.read_bytes()).digest())
    return digest.hexdigest()


def score(
    case: dict, trace: Trace, *, label: str, review: str | None, workspace: Path | None
) -> dict:
    metrics = collect_metrics(trace)
    checks = [
        {
            "name": "trace_complete",
            "expected": True,
            "actual": metrics["trace_complete"],
            "status": "passed" if metrics["trace_complete"] else "unavailable",
        },
        {
            "name": "status",
            "expected": case["status"],
            "actual": trace.status,
            "status": "passed" if trace.status == case["status"] else "failed",
        },
    ]
    for direction in ("min", "max"):
        for path, expected in case.get(direction, {}).items():
            actual = metric_value(metrics, path)
            checks.append(
                {
                    "name": f"{direction}:{path}",
                    "expected": expected,
                    "actual": actual,
                    "status": "unavailable"
                    if actual is None or not metrics["trace_complete"]
                    else (
                        "passed"
                        if (actual >= expected if direction == "min" else actual <= expected)
                        else "failed"
                    ),
                }
            )
    answer = "\n\n".join(trace.answers)
    for text in case.get("answer_contains", []):
        checks.append(
            {
                "name": "answer_contains",
                "expected": text,
                "status": "passed" if text in answer else "failed",
            }
        )
    for artifact in case.get("files", []):
        status = "unavailable"
        if workspace is not None:
            path = (workspace / artifact["path"]).resolve()
            path.relative_to(workspace.resolve())
            if artifact.get("absent"):
                passed = not path.exists()
            elif artifact.get("unchanged"):
                passed = (
                    path.is_file()
                    and path.read_bytes() == fixture_files(case)[artifact["path"]].read_bytes()
                )
            else:
                passed = path.is_file() and path.read_text(encoding="utf-8") == artifact["equals"]
            status = "passed" if passed else "failed"
        checks.append({"name": f"file:{artifact['path']}", "status": status})
    checks.extend(
        {"name": f"review:{criterion}", "status": review or "unavailable"}
        for criterion in case["review"]
    )
    states = {check["status"] for check in checks}
    outcome = (
        "failed" if "failed" in states else "incomplete" if "unavailable" in states else "passed"
    )
    return {
        "case_id": case["id"],
        "case_digest": case_digest(case),
        "label": label,
        "run_ids": [str(run.id) for run in trace.runs],
        "model_ids": sorted(
            {str(run.model_configuration_id) for run in trace.runs if run.model_configuration_id}
        ),
        "outcome": outcome,
        "metrics": metrics,
        "checks": checks,
    }


def compare(before: list[dict], after: list[dict]) -> dict:
    def index(reports):
        result = {}
        for report in reports:
            key = report["case_id"]
            if key in result:
                raise ValueError(f"用例 {key} 出现多次；每次对比为每个用例选择一份报告")
            result[key] = report
        return result

    old, new = index(before), index(after)
    if old.keys() != new.keys():
        raise ValueError("两组报告的用例不一致")
    rows = []
    for case_id, current in new.items():
        baseline = old[case_id]
        if baseline["case_digest"] != current["case_digest"]:
            raise ValueError(f"用例 {case_id} 的要求已变化，不能直接对比")
        previous_metrics = _numeric_metrics(baseline["metrics"])
        current_metrics = _numeric_metrics(current["metrics"])
        changes = {}
        for key in sorted(previous_metrics.keys() | current_metrics.keys()):
            value, previous = current_metrics.get(key, 0), previous_metrics.get(key, 0)
            changes[key] = value - previous if value is not None and previous is not None else None
        rows.append(
            {
                "case_id": case_id,
                "before": baseline["outcome"],
                "after": current["outcome"],
                "metric_deltas": changes,
            }
        )
    return {
        "cases": rows,
        "passed_before": sum(item["outcome"] == "passed" for item in before),
        "passed_after": sum(item["outcome"] == "passed" for item in after),
    }


def _numeric_metrics(metrics: dict, prefix: str = "") -> dict:
    result = {}
    for key, value in metrics.items():
        name = f"{prefix}.{key}" if prefix else key
        if isinstance(value, dict):
            result.update(_numeric_metrics(value, name))
        elif value is None or isinstance(value, (int, float)) and not isinstance(value, bool):
            result[name] = value
    return result
