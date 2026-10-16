import json
from collections import Counter
from datetime import UTC, datetime

from .source import Trace


def _utc(value: datetime) -> datetime:
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


def collect_metrics(trace: Trace) -> dict:
    events = [event for run in trace.runs for event in run.events]
    event_counts = Counter(event.event_type for event in events)
    calls = Counter()
    signatures = Counter()
    results = {}
    requested = {}
    for run in trace.runs:
        for event in run.events:
            if event.event_type == "tool.requested":
                for call in event.payload["toolCalls"]:
                    function = call["function"]
                    name = function["name"]
                    arguments = json.loads(function["arguments"] or "{}")
                    signature = (
                        run.id,
                        name,
                        json.dumps(arguments, sort_keys=True, ensure_ascii=False),
                    )
                    signatures[signature] += 1
                    calls[name] += 1
                    requested[(run.id, call["id"])] = name
            elif event.event_type == "tool.output":
                for item in event.payload["results"]:
                    results[(run.id, item["callId"])] = item["result"]
    repeats = Counter()
    for (_run_id, name, _arguments), count in signatures.items():
        repeats[name] += count - 1
    failures = Counter()
    for key, result in results.items():
        if (
            key in requested
            and isinstance(result, dict)
            and (
                result.get("error")
                or result.get("isError") is True
                or result.get("exitCode") not in (None, 0)
            )
        ):
            failures[requested[key]] += 1
    durations = [
        (_utc(run.completed_at) - _utc(run.started_at)).total_seconds() * 1000
        for run in trace.runs
        if run.completed_at is not None
    ]
    return {
        "trace_complete": all(
            [event.sequence for event in run.events] == list(range(1, run.last_event_sequence + 1))
            and run.last_event_sequence > 0
            for run in trace.runs
        ),
        "runs": len(trace.runs),
        "model_steps": event_counts["context.prepared"],
        "compactions": event_counts["context.compacted"],
        "tool_call_count": sum(calls.values()),
        "pending_tools": len(requested.keys() - results.keys()),
        "tool_calls": calls,
        "repeated_calls": repeats,
        "tool_failures": failures,
        "events": event_counts,
        "input_tokens": (
            sum(run.input_tokens for run in trace.runs)
            if all(run.input_tokens is not None for run in trace.runs)
            else None
        ),
        "output_tokens": (
            sum(run.output_tokens for run in trace.runs)
            if all(run.output_tokens is not None for run in trace.runs)
            else None
        ),
        "run_duration_ms": round(sum(durations)) if len(durations) == len(trace.runs) else None,
    }


def metric_value(metrics: dict, path: str):
    section, separator, key = path.partition(".")
    return metrics[section][key] if separator else metrics[section]
