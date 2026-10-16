from dotenv import load_dotenv

load_dotenv()

from .cli import main  # noqa: E402

raise SystemExit(main())
