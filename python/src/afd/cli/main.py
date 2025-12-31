"""
AFD CLI main module.

Provides the Click-based command-line interface.
"""

import asyncio
import json
import sys
from pathlib import Path
from typing import Any

import click
from rich.console import Console

from afd.cli.output import (
    console,
    error_console,
    print_connecting,
    print_disconnecting,
    print_error,
    print_info,
    print_result,
    print_success,
    print_tool_detail,
    print_tools,
)
from afd.transports import FastMCPTransport, MockTransport, Transport, TransportConfig

# State file for persistent connection info
STATE_FILE = Path.home() / ".afd" / "state.json"


def _load_state() -> dict[str, Any]:
    """Load CLI state from disk."""
    if STATE_FILE.exists():
        try:
            return json.loads(STATE_FILE.read_text())
        except (json.JSONDecodeError, OSError):
            pass
    return {}


def _save_state(state: dict[str, Any]) -> None:
    """Save CLI state to disk."""
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    STATE_FILE.write_text(json.dumps(state, indent=2))


def _get_transport(server: str | None = None) -> Transport:
    """
    Get a transport instance.
    
    Args:
        server: Server name or URL. Special values:
            - "mock" or "mock:" prefix for MockTransport
            - Otherwise uses FastMCPTransport
    
    Returns:
        Configured transport instance
    """
    if server is None:
        # Load from state
        state = _load_state()
        server = state.get("server")
        if not server:
            raise click.ClickException(
                "No server connected. Use 'afd connect <server>' first."
            )
    
    # Check for mock transport
    if server == "mock" or server.startswith("mock:"):
        return MockTransport()
    
    # Default to FastMCP transport
    return FastMCPTransport(server_name=server)


@click.group()
@click.version_option(package_name="afd")
@click.option("--json", "json_output", is_flag=True, help="Output raw JSON")
@click.option("--quiet", "-q", is_flag=True, help="Suppress non-essential output")
@click.pass_context
def cli(ctx: click.Context, json_output: bool, quiet: bool) -> None:
    """
    AFD - Agent-First Development CLI.

    Interact with MCP servers using the AFD command pattern.

    \b
    Examples:
        afd connect my-server
        afd tools
        afd call user.create '{"name": "Alice"}'
    """
    ctx.ensure_object(dict)
    ctx.obj["json_output"] = json_output
    ctx.obj["quiet"] = quiet


@cli.command()
@click.argument("server")
@click.option("--timeout", "-t", default=30.0, help="Connection timeout in seconds")
@click.pass_context
def connect(ctx: click.Context, server: str, timeout: float) -> None:
    """
    Connect to an MCP server.

    SERVER can be a server name, URL, or special value:
    \b
    - mock         Use mock transport for testing
    - <name>       Connect to named server
    
    \b
    Examples:
        afd connect my-server
        afd connect mock
    """
    quiet = ctx.obj.get("quiet", False)
    
    if not quiet:
        print_connecting(server)
    
    async def _connect() -> None:
        transport = _get_transport(server)
        try:
            await transport.connect()
            
            # Save connection state
            _save_state({"server": server})
            
            if not quiet:
                print_success(f"Connected to {server}")
                
                # List available tools
                tools = await transport.list_tools()
                if tools:
                    print_info(f"Available tools: {len(tools)}")
        finally:
            await transport.disconnect()
    
    try:
        asyncio.run(_connect())
    except Exception as e:
        print_error(str(e))
        sys.exit(1)


@cli.command()
@click.pass_context
def disconnect(ctx: click.Context) -> None:
    """
    Disconnect from the current server.

    Clears the saved connection state.
    """
    quiet = ctx.obj.get("quiet", False)
    
    state = _load_state()
    server = state.get("server")
    
    if not server:
        if not quiet:
            print_info("No active connection")
        return
    
    if not quiet:
        print_disconnecting()
    
    # Clear state
    _save_state({})
    
    if not quiet:
        print_success(f"Disconnected from {server}")


@cli.command()
@click.option("--server", "-s", help="Server to query (uses saved connection if omitted)")
@click.option("--filter", "-f", "pattern", help="Filter tools by name pattern")
@click.option("--detail", "-d", "tool_name", help="Show detailed info for a specific tool")
@click.pass_context
def tools(ctx: click.Context, server: str | None, pattern: str | None, tool_name: str | None) -> None:
    """
    List available tools from the connected server.

    \b
    Examples:
        afd tools
        afd tools --filter user
        afd tools --detail user.create
    """
    json_output = ctx.obj.get("json_output", False)
    
    async def _list_tools() -> None:
        transport = _get_transport(server)
        try:
            await transport.connect()
            tool_list = await transport.list_tools()
            
            # Filter if pattern provided
            if pattern:
                tool_list = [t for t in tool_list if pattern.lower() in t.name.lower()]
            
            # Show detail for specific tool
            if tool_name:
                matching = [t for t in tool_list if t.name == tool_name]
                if not matching:
                    raise click.ClickException(f"Tool '{tool_name}' not found")
                
                if json_output:
                    import json as json_module
                    console.print(json_module.dumps({
                        "name": matching[0].name,
                        "description": matching[0].description,
                        "input_schema": matching[0].input_schema,
                    }, indent=2))
                else:
                    print_tool_detail(matching[0])
                return
            
            # List all tools
            if json_output:
                import json as json_module
                console.print(json_module.dumps([
                    {"name": t.name, "description": t.description}
                    for t in tool_list
                ], indent=2))
            else:
                print_tools(tool_list)
        finally:
            await transport.disconnect()
    
    try:
        asyncio.run(_list_tools())
    except click.ClickException:
        raise
    except Exception as e:
        print_error(str(e))
        sys.exit(1)


@cli.command()
@click.argument("tool")
@click.argument("args", required=False, default="{}")
@click.option("--server", "-s", help="Server to use (uses saved connection if omitted)")
@click.pass_context
def call(ctx: click.Context, tool: str, args: str, server: str | None) -> None:
    """
    Call a tool on the connected server.

    TOOL is the name of the tool to call.
    ARGS is a JSON string of arguments (default: {}).

    \b
    Examples:
        afd call user.list
        afd call user.create '{"name": "Alice", "email": "alice@example.com"}'
        afd call doc.get '{"id": "123"}'
    """
    json_output = ctx.obj.get("json_output", False)
    
    # Parse args
    try:
        parsed_args = json.loads(args)
    except json.JSONDecodeError as e:
        print_error(f"Invalid JSON arguments: {e}")
        sys.exit(1)
    
    async def _call_tool() -> None:
        transport = _get_transport(server)
        try:
            await transport.connect()
            result = await transport.call_tool(tool, parsed_args)
            print_result(result, json_output=json_output)
        finally:
            await transport.disconnect()
    
    try:
        asyncio.run(_call_tool())
    except Exception as e:
        print_error(str(e))
        sys.exit(1)


@cli.command()
@click.pass_context
def status(ctx: click.Context) -> None:
    """
    Show current connection status.

    Displays the currently connected server and connection state.
    """
    json_output = ctx.obj.get("json_output", False)
    
    state = _load_state()
    server = state.get("server")
    
    if json_output:
        console.print(json.dumps({
            "connected": server is not None,
            "server": server,
        }, indent=2))
        return
    
    if server:
        print_success(f"Connected to: {server}")
    else:
        print_info("Not connected to any server")
        print_info("Use 'afd connect <server>' to connect")


@cli.command()
@click.option("--server", "-s", help="Server to validate")
@click.pass_context
def validate(ctx: click.Context, server: str | None) -> None:
    """
    Validate server connection and tools.

    Connects to the server, lists tools, and verifies each can be inspected.
    """
    quiet = ctx.obj.get("quiet", False)
    json_output = ctx.obj.get("json_output", False)
    
    async def _validate() -> None:
        transport = _get_transport(server)
        results: dict[str, Any] = {
            "connection": False,
            "tools_listed": False,
            "tool_count": 0,
            "errors": [],
        }
        
        try:
            await transport.connect()
            results["connection"] = True
            
            tools = await transport.list_tools()
            results["tools_listed"] = True
            results["tool_count"] = len(tools)
            
            if json_output:
                console.print(json.dumps(results, indent=2))
            else:
                print_success("Connection: OK")
                print_success(f"Tools listed: {len(tools)}")
                print_success("Validation passed!")
                
        except Exception as e:
            results["errors"].append(str(e))
            if json_output:
                console.print(json.dumps(results, indent=2))
            else:
                print_error(f"Validation failed: {e}")
            sys.exit(1)
        finally:
            await transport.disconnect()
    
    try:
        asyncio.run(_validate())
    except Exception as e:
        print_error(str(e))
        sys.exit(1)


@cli.command()
@click.pass_context
def shell(ctx: click.Context) -> None:
    """
    Start an interactive shell.

    Provides a REPL for calling tools interactively.
    Use 'exit' or Ctrl+D to quit.
    """
    from rich.prompt import Prompt
    
    state = _load_state()
    server = state.get("server")
    
    if not server:
        print_error("No server connected. Use 'afd connect <server>' first.")
        sys.exit(1)
    
    console.print(f"[bold]AFD Shell[/bold] - Connected to [cyan]{server}[/cyan]")
    console.print("[dim]Type 'help' for commands, 'exit' to quit[/dim]\n")
    
    async def _shell() -> None:
        transport = _get_transport(server)
        await transport.connect()
        
        try:
            while True:
                try:
                    line = Prompt.ask("[cyan]afd[/cyan]")
                except EOFError:
                    break
                
                line = line.strip()
                if not line:
                    continue
                
                if line in ("exit", "quit"):
                    break
                
                if line == "help":
                    console.print("""
[bold]Commands:[/bold]
  tools              List available tools
  call <tool> [args] Call a tool with optional JSON args
  help               Show this help
  exit               Exit the shell
""")
                    continue
                
                if line == "tools":
                    tool_list = await transport.list_tools()
                    print_tools(tool_list)
                    continue
                
                if line.startswith("call "):
                    parts = line[5:].strip().split(maxsplit=1)
                    tool_name = parts[0]
                    tool_args = json.loads(parts[1]) if len(parts) > 1 else {}
                    
                    result = await transport.call_tool(tool_name, tool_args)
                    print_result(result)
                    continue
                
                console.print(f"[yellow]Unknown command: {line}[/yellow]")
                
        finally:
            await transport.disconnect()
    
    try:
        asyncio.run(_shell())
    except KeyboardInterrupt:
        pass
    
    console.print("\n[dim]Goodbye![/dim]")


def main() -> None:
    """Entry point for the CLI."""
    cli()


if __name__ == "__main__":
    main()
