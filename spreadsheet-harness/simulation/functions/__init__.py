"""Excel function registry.

Every function module registers its implementations via the
:func:`register` decorator at import time.  The engine looks up
functions by upper-cased name from :data:`FUNCTION_REGISTRY`.
"""

from __future__ import annotations

from typing import Any, Callable, Dict

FUNCTION_REGISTRY: Dict[str, Callable] = {}


def register(name: str):
    """Decorator that registers an Excel function implementation.

    Usage::

        @register("SUM")
        def _sum(evaluator, args):
            ...
    """
    def decorator(fn: Callable) -> Callable:
        FUNCTION_REGISTRY[name.upper()] = fn
        return fn
    return decorator


def get_function(name: str) -> Callable | None:
    return FUNCTION_REGISTRY.get(name.upper())


def ensure_loaded() -> None:
    """Import all function modules to populate the registry."""
    import simulation.functions.math_funcs        # noqa: F401
    import simulation.functions.logic_funcs       # noqa: F401
    import simulation.functions.lookup_funcs      # noqa: F401
    import simulation.functions.conditional_funcs # noqa: F401
    import simulation.functions.text_funcs        # noqa: F401
    import simulation.functions.date_funcs        # noqa: F401
