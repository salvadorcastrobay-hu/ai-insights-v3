"""Streamlit Cloud entry point — delegates to dashboard/app.py."""

import os
import sys

_root = os.path.dirname(os.path.abspath(__file__))
_dashboard_dir = os.path.join(_root, "dashboard")
_app_path = os.path.join(_dashboard_dir, "app.py")

# Ensure imports in app.py resolve correctly
if _dashboard_dir not in sys.path:
    sys.path.insert(0, _dashboard_dir)
if _root not in sys.path:
    sys.path.insert(0, _root)

# Override __file__ so app.py path resolution works
__file__ = _app_path

with open(_app_path) as _f:
    exec(compile(_f.read(), _app_path, "exec"))
