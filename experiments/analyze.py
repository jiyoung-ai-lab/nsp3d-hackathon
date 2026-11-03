"""Deprecated shim — real home is python/analyze.py (kept so old commands keep working)."""
import sys
import warnings
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "python"))
warnings.warn("experiments/analyze.py is a shim; use python/analyze.py", DeprecationWarning, stacklevel=2)
from analyze import main  # noqa: E402

sys.exit(main())
