# Wrangler's `main` directory is the Python import root, so this shim lives in src/.
from naval.worker.entry import Default

__all__ = ["Default"]
