import argparse
import json
import os
from pathlib import Path
from uuid import UUID

from .cases import load_cases, prepare_case
from .report import compare, score
from .source import load_trace


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="OhMyCode Harness 评测")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("list", help="列出固定任务")
    prepare = commands.add_parser("prepare", help="准备独立的临时工作区")
    prepare.add_argument("case")
    evaluate = commands.add_parser("score", help="读取真实运行记录并评分")
    evaluate.add_argument("case")
    source = evaluate.add_mutually_exclusive_group(required=True)
    source.add_argument("--run-id", type=UUID)
    source.add_argument("--task-id", type=UUID)
    evaluate.add_argument("--label", required=True, help="代码版本、模型和试验编号")
    evaluate.add_argument("--workspace", type=Path)
    evaluate.add_argument("--review", choices=["passed", "failed"])
    evaluate.add_argument("--output", type=Path, required=True)
    comparison = commands.add_parser("compare", help="对比相同用例的前后结果")
    comparison.add_argument("--before", nargs="+", type=Path, required=True)
    comparison.add_argument("--after", nargs="+", type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        cases = {case["id"]: case for case in load_cases()}
        if args.command == "list":
            for case in cases.values():
                print(f"{case['id']}  {case['title']}")
            return 0
        if args.command == "compare":
            result = compare(
                [json.loads(path.read_text(encoding="utf-8")) for path in args.before],
                [json.loads(path.read_text(encoding="utf-8")) for path in args.after],
            )
            print(json.dumps(result, ensure_ascii=False, indent=2))
            return 0
        if args.case not in cases:
            raise ValueError(f"用例不存在：{args.case}")
        case = cases[args.case]
        if args.command == "prepare":
            workspace = prepare_case(case)
            print(f"工作区：{workspace}\n\n{case['prompt']}")
            for instruction in case.get("setup", []):
                print(f"准备：{instruction}")
            for criterion in case["review"]:
                print(f"验收：{criterion}")
            return 0
        from app import create_app

        app = create_app(os.getenv("APP_ENV", "development"))
        with app.app_context():
            result = score(
                case,
                load_trace(run_id=args.run_id, task_id=args.task_id),
                label=args.label,
                review=args.review,
                workspace=args.workspace,
            )
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(
            json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        print(f"{case['id']}: {result['outcome']} → {args.output}")
        return {"passed": 0, "failed": 1, "incomplete": 2}[result["outcome"]]
    except (ValueError, KeyError, OSError) as error:
        parser.error(str(error))
