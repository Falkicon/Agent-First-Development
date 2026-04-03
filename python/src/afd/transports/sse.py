"""SSE (Server-Sent Events) transport for MCP communication.

Connects to a live MCP SSE endpoint using the upstream MCP client session
implementation, then exposes the result through the lighter AFD transport API.

Example:
    >>> from afd.transports import SseTransport
    >>>
    >>> transport = SseTransport("http://localhost:3100/sse")
    >>> await transport.connect()
    >>> result = await transport.call_tool("ping", {})
    >>> await transport.disconnect()
"""

from __future__ import annotations

from contextlib import AsyncExitStack
from typing import Any, Callable, Dict, List, Optional

from afd.transports.base import (
    ToolInfo,
    TransportError,
    TransportState,
)
from afd.transports._mcp_protocol import _HttpBasedTransport


class SseTransport(_HttpBasedTransport):
    """SSE transport backed by the upstream MCP client session."""

    def __init__(
        self,
        url: str,
        *,
        headers: Optional[Dict[str, str]] = None,
        timeout: float = 30.0,
        client_name: str = "afd-python-client",
        client_version: str = "0.2.0",
        on_close: Optional[Callable[[], None]] = None,
        on_error: Optional[Callable[[Exception], None]] = None,
    ) -> None:
        super().__init__(url, headers=headers, timeout=timeout, client_name=client_name, client_version=client_version)
        self._on_close = on_close
        self._on_error = on_error
        self._exit_stack: Optional[AsyncExitStack] = None
        self._session: Any = None

    async def connect(self) -> None:
        """Connect to the SSE endpoint and initialize an MCP client session."""
        if self._state == TransportState.CONNECTED:
            return

        self._state = TransportState.CONNECTING

        try:
            try:
                from mcp.client.session import ClientSession
                from mcp.client.sse import sse_client
            except ImportError as exc:  # pragma: no cover - optional dependency
                raise ImportError("MCP client dependencies not installed. Install with: pip install afd[client]") from exc

            self._exit_stack = AsyncExitStack()
            streams = await self._exit_stack.enter_async_context(
                sse_client(
                    self._url,
                    headers=self._headers,
                    timeout=self._timeout,
                )
            )
            self._session = await self._exit_stack.enter_async_context(
                ClientSession(*streams)
            )

            init_result = await self._session.initialize()
            self._server_info = (
                init_result.serverInfo.model_dump(mode="json")
                if getattr(init_result, "serverInfo", None) is not None
                else None
            )
            self._capabilities = (
                init_result.capabilities.model_dump(mode="json", exclude_none=True)
                if getattr(init_result, "capabilities", None) is not None
                else None
            )
            self._state = TransportState.CONNECTED

        except Exception as exc:
            self._state = TransportState.ERROR
            await self._cleanup()
            self._report_error(exc)
            if isinstance(exc, TransportError):
                raise
            raise TransportError(str(exc), cause=exc) from exc

    async def disconnect(self) -> None:
        """Close the MCP client session and its underlying streams."""
        await self._cleanup()
        self._state = TransportState.DISCONNECTED
        if self._on_close:
            self._on_close()

    async def call_tool(
        self,
        name: str,
        arguments: Optional[Dict[str, Any]] = None,
    ) -> Any:
        """Call a tool through the live MCP session."""
        if self._session is None:
            raise RuntimeError("Transport not connected. Call connect() first.")

        try:
            result = await self._session.call_tool(name, arguments or {})
            payload = result.model_dump(by_alias=True, mode="json", exclude_none=True)
            return self._extract_content(payload)
        except Exception as exc:
            self._report_error(exc)
            if isinstance(exc, TransportError):
                raise
            raise TransportError(str(exc), cause=exc) from exc

    async def list_tools(self) -> List[ToolInfo]:
        """List tools through the live MCP session."""
        if self._session is None:
            raise RuntimeError("Transport not connected. Call connect() first.")

        try:
            result = await self._session.list_tools()
            tools: List[ToolInfo] = []
            for tool in result.tools:
                payload = tool.model_dump(by_alias=True, mode="json", exclude_none=True)
                tools.append(ToolInfo(
                    name=payload["name"],
                    description=payload.get("description", ""),
                    input_schema=payload.get("inputSchema"),
                    meta=payload.get("_meta"),
                ))
            return tools
        except Exception as exc:
            self._report_error(exc)
            if isinstance(exc, TransportError):
                raise
            raise TransportError(str(exc), cause=exc) from exc

    async def _cleanup(self) -> None:
        """Close any active session resources."""
        if self._exit_stack is not None:
            await self._exit_stack.aclose()
        self._exit_stack = None
        self._session = None

    def _report_error(self, exc: Exception) -> None:
        """Notify the optional error callback."""
        if self._on_error:
            self._on_error(exc)
