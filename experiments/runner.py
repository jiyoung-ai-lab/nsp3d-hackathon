"""Deprecated shim — real home is python/runner.py (kept so old commands keep working)."""
import sys
import warnings
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "python"))
warnings.warn("experiments/runner.py is a shim; use python/runner.py", DeprecationWarning, stacklevel=2)
from runner import main  # noqa: E402

sys.exit(main())
