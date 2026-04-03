"""Shared MCP tool call routing for AFD servers."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Awaitable, Callable, List, Optional

from afd.core.batch import BatchRequest, is_batch_request
from afd.core.commands import CommandContext, CommandDefinition
from afd.core.pipeline import PipelineRequest, is_pipeline_request
from afd.core.result import CommandResult, error
from afd.server.lazy_tools import execute_detail, execute_discover
from afd.server.tools import derive_group_action, derive_group_name


@dataclass
class ToolRouterDeps:
    execute_command: Callable[[str, Any, Optional[CommandContext]], Awaitable[CommandResult[Any]]]
    execute_batch: Callable[[BatchRequest | dict[str, Any], Optional[CommandContext]], Awaitable[Any]]
    execute_pipeline: Callable[[PipelineRequest | dict[str, Any], Optional[CommandContext]], Awaitable[Any]]
    commands: List[CommandDefinition]
    tool_strategy: str
    group_by_fn: Optional[Callable[[CommandDefinition], Optional[str]]] = None
    all_commands: Optional[List[CommandDefinition]] = None
    exposed_command_names: Optional[set[str]] = None
    context_state: Any = None


def is_command_accessible(
    command: Optional[CommandDefinition],
    active_context: Optional[str],
) -> bool:
    """Return whether the command is visible in the active context."""
    if not active_context or command is None:
        return True
    if not command.contexts:
        return True
    return active_context in command.contexts


def create_tool_router(deps: ToolRouterDeps):
    """Create a router that dispatches built-in, grouped, or direct MCP tools."""
    all_commands = deps.all_commands or deps.commands
    exposed_command_names = deps.exposed_command_names or {
        command.name for command in deps.commands
    }

    async def route_tool_call(tool_name: str, args: Any) -> Any:
        active_context = deps.context_state.get_active() if deps.context_state else None
        visible_commands = [
            command
            for command in deps.commands
            if is_command_accessible(command, active_context)
        ]

        if tool_name == "afd-call":
            payload = args or {}
            command_name = payload.get("command") if isinstance(payload, dict) else None
            if not command_name or not isinstance(command_name, str):
                return error(
                    "VALIDATION_ERROR",
                    "Missing required field: command",
                    suggestion="Provide { command: 'command-name', input: {...} }.",
                )

            command = next((cmd for cmd in visible_commands if cmd.name == command_name), None)
            if command is None:
                registered = next((cmd for cmd in all_commands if cmd.name == command_name), None)
                if registered is not None:
                    if not is_command_accessible(registered, active_context):
                        return error(
                            "COMMAND_NOT_IN_CONTEXT",
                            f"Command '{command_name}' is not available in context '{active_context}'",
                            suggestion="Use afd-context-list to see contexts or afd-context-enter to switch.",
                        )
                    return error(
                        "COMMAND_NOT_EXPOSED",
                        f"Command '{command_name}' exists but is not exposed via this server",
                        suggestion="Enable MCP exposure for the command or use a different interface.",
                    )
                return error(
                    "COMMAND_NOT_FOUND",
                    f"Command '{command_name}' not found",
                    suggestion="Use afd-discover or afd-help to list available commands.",
                )

            if not is_command_accessible(command, active_context):
                return error(
                    "COMMAND_NOT_IN_CONTEXT",
                    f"Command '{command_name}' is not available in context '{active_context}'",
                    suggestion="Use afd-context-list to see contexts or afd-context-enter to switch.",
                )

            return await deps.execute_command(
                command_name,
                payload.get("input", {}),
                CommandContext(
                    trace_id=f"afd-call-{command_name}",
                    extra={"interface": "mcp", "active_context": active_context},
                ),
            )

        if tool_name == "afd-discover":
            visible_commands = [
                command
                for command in deps.commands
                if is_command_accessible(command, active_context)
            ]
            return execute_discover(visible_commands, args or {})

        if tool_name == "afd-detail":
            visible_all_commands = [
                command
                for command in all_commands
                if is_command_accessible(command, active_context)
            ]
            return execute_detail(visible_all_commands, exposed_command_names, args or {})

        if tool_name == "afd-batch":
            if not is_batch_request(args):
                return error(
                    "INVALID_BATCH_REQUEST",
                    "Invalid batch request format",
                    suggestion="Provide { commands: [...] } with command objects.",
                )
            return await deps.execute_batch(
                args,
                CommandContext(
                    trace_id="afd-batch",
                    extra={"interface": "mcp", "active_context": active_context},
                ),
            )

        if tool_name == "afd-pipe":
            if not is_pipeline_request(args):
                return error(
                    "INVALID_PIPELINE_REQUEST",
                    "Invalid pipeline request format",
                    suggestion="Provide { steps: [...] } with pipeline step objects.",
                )
            return await deps.execute_pipeline(
                args,
                CommandContext(
                    trace_id="afd-pipe",
                    extra={"interface": "mcp", "active_context": active_context},
                ),
            )

        if deps.tool_strategy == "grouped":
            payload = args or {}
            action = payload.get("action") if isinstance(payload, dict) else None
            get_group = deps.group_by_fn or derive_group_name
            all_group_commands = [
                command for command in all_commands if (get_group(command) or "general") == tool_name
            ]
            group_commands = [
                command for command in visible_commands if (get_group(command) or "general") == tool_name
            ]

            if not group_commands and all_group_commands:
                if isinstance(action, str):
                    hidden_command = next(
                        (
                            item
                            for item in all_group_commands
                            if derive_group_action(item) == action
                            and not is_command_accessible(item, active_context)
                        ),
                        None,
                    )
                    if hidden_command is not None:
                        return error(
                            "COMMAND_NOT_IN_CONTEXT",
                            f"Command '{hidden_command.name}' is not available in context '{active_context}'",
                            suggestion="Use afd-context-list to see contexts or afd-context-enter to switch.",
                        )

                inaccessible_commands = [
                    item for item in all_group_commands if not is_command_accessible(item, active_context)
                ]
                if inaccessible_commands:
                    return error(
                        "COMMAND_NOT_IN_CONTEXT",
                        f"Grouped tool '{tool_name}' is not available in context '{active_context}'",
                        suggestion="Use afd-context-list to see contexts or afd-context-enter to switch.",
                    )

            if group_commands and not isinstance(action, str):
                available_actions = [derive_group_action(command) for command in group_commands]
                return error(
                    "INVALID_GROUPED_CALL",
                    f"Grouped tool '{tool_name}' requires an action parameter",
                    suggestion=(
                        "Provide { action: '<action>', params: {...} }. "
                        f"Available actions: {', '.join(available_actions)}"
                    ),
                )

            if group_commands and isinstance(action, str):
                command = next(
                    (
                        item
                        for item in group_commands
                        if derive_group_action(item) == action
                    ),
                    None,
                )
                if command is None:
                    hidden_command = next(
                        (
                            item
                            for item in all_group_commands
                            if derive_group_action(item) == action
                            and not is_command_accessible(item, active_context)
                        ),
                        None,
                    )
                    if hidden_command is not None:
                        return error(
                            "COMMAND_NOT_IN_CONTEXT",
                            f"Command '{hidden_command.name}' is not available in context '{active_context}'",
                            suggestion="Use afd-context-list to see contexts or afd-context-enter to switch.",
                        )
                    return error(
                        "COMMAND_NOT_FOUND",
                        f"Action '{action}' is not available for grouped tool '{tool_name}'",
                        suggestion="Use afd-discover or afd-help to inspect available actions.",
                    )
                if not is_command_accessible(command, active_context):
                    return error(
                        "COMMAND_NOT_IN_CONTEXT",
                        f"Command '{command.name}' is not available in context '{active_context}'",
                        suggestion="Use afd-context-list to see contexts or afd-context-enter to switch.",
                    )
                return await deps.execute_command(
                    command.name,
                    payload.get("params", {}),
                    CommandContext(
                        trace_id=f"grouped-{command.name}",
                        extra={"interface": "mcp", "active_context": active_context},
                    ),
                )

        command = next((cmd for cmd in visible_commands if cmd.name == tool_name), None)
        if not is_command_accessible(command, active_context):
            return error(
                "COMMAND_NOT_IN_CONTEXT",
                f"Command '{tool_name}' is not available in context '{active_context}'",
                suggestion="Use afd-context-list to see contexts or afd-context-enter to switch.",
            )

        return await deps.execute_command(
            tool_name,
            args or {},
            CommandContext(
                trace_id=f"tool-{tool_name}",
                extra={"interface": "mcp", "active_context": active_context},
            ),
        )

    return route_tool_call
