"""
AFD CLI Module.

A command-line interface for interacting with AFD/MCP servers.

Example:
    $ afd connect my-server
    $ afd tools
    $ afd call user.create '{"name": "Alice"}'
"""

from afd.cli.main import cli, main
from afd.cli.output import (
    print_error,
    print_result,
    print_success,
    print_tools,
    print_warning,
)

__all__ = [
    # Main CLI
    "cli",
    "main",
    # Output helpers
    "print_result",
    "print_error",
    "print_success",
    "print_warning",
    "print_tools",
]
