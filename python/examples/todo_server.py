"""Example: Todo List MCP Server using AFD.

This example demonstrates a complete MCP server for managing todos,
following Agent-First Development principles.

Run:
    python -m examples.todo_server

Use with VS Code/Cursor by adding to .cursor/mcp.json:
    {
      "mcpServers": {
        "todo": {
          "command": "python",
          "args": ["-m", "examples.todo_server"],
          "cwd": "/path/to/this/directory"
        }
      }
    }
"""

import asyncio
from typing import List, Optional
from pydantic import BaseModel, Field

from afd import success, error, CommandResult
from afd.server import MCPServer


# ==============================================================================
# Domain Models
# ==============================================================================

class Todo(BaseModel):
    """A todo item."""
    id: str
    title: str
    done: bool = False
    priority: str = "medium"


class CreateTodoInput(BaseModel):
    """Input for creating a todo."""
    title: str = Field(..., description="Todo title")
    priority: str = Field("medium", description="Priority: low, medium, high")


class UpdateTodoInput(BaseModel):
    """Input for updating a todo."""
    id: str = Field(..., description="Todo ID")
    title: Optional[str] = Field(None, description="New title")
    done: Optional[bool] = Field(None, description="Mark done/undone")
    priority: Optional[str] = Field(None, description="New priority")


# ==============================================================================
# In-Memory Database
# ==============================================================================

todos: dict[str, Todo] = {}
next_id = 1


# ==============================================================================
# Server Setup
# ==============================================================================

server = MCPServer(
    name="todo-app",
    version="1.0.0",
    description="A simple todo list manager demonstrating AFD patterns",
)


# ==============================================================================
# Commands
# ==============================================================================

@server.command(
    name="todo.create",
    description="Create a new todo item",
)
async def create_todo(input: CreateTodoInput) -> CommandResult[Todo]:
    """Create a new todo item.
    
    Example:
        >>> await create_todo(CreateTodoInput(title="Buy groceries"))
    """
    global next_id
    
    # Validate priority
    if input.priority not in ["low", "medium", "high"]:
        return error(
            code="INVALID_PRIORITY",
            message=f"Invalid priority: {input.priority}",
            suggestion="Use one of: low, medium, high",
        )
    
    # Create todo
    todo = Todo(
        id=f"todo-{next_id}",
        title=input.title,
        priority=input.priority,
    )
    next_id += 1
    
    todos[todo.id] = todo
    
    return success(
        data=todo,
        reasoning=f"Created todo '{input.title}' with {input.priority} priority",
    )


@server.command(
    name="todo.list",
    description="List all todo items",
)
async def list_todos(input: dict = None) -> CommandResult[List[Todo]]:
    """List all todos."""
    todo_list = list(todos.values())
    
    return success(
        data=todo_list,
        reasoning=f"Found {len(todo_list)} todo(s)",
    )


@server.command(
    name="todo.get",
    description="Get a specific todo by ID",
)
async def get_todo(input: dict) -> CommandResult[Todo]:
    """Get a todo by ID."""
    todo_id = input.get("id")
    
    if not todo_id:
        return error(
            code="MISSING_ID",
            message="Todo ID is required",
            suggestion="Provide an 'id' parameter",
        )
    
    todo = todos.get(todo_id)
    if not todo:
        return error(
            code="NOT_FOUND",
            message=f"Todo '{todo_id}' not found",
            suggestion="Use 'todo.list' to see available todos",
        )
    
    return success(
        data=todo,
        reasoning=f"Retrieved todo '{todo.title}'",
    )


@server.command(
    name="todo.update",
    description="Update a todo item",
    mutation=True,
)
async def update_todo(input: UpdateTodoInput) -> CommandResult[Todo]:
    """Update a todo's title, status, or priority."""
    todo = todos.get(input.id)
    
    if not todo:
        return error(
            code="NOT_FOUND",
            message=f"Todo '{input.id}' not found",
            suggestion="Use 'todo.list' to see available todos",
        )
    
    # Apply updates
    changes = []
    if input.title is not None:
        todo.title = input.title
        changes.append(f"title='{input.title}'")
    if input.done is not None:
        todo.done = input.done
        changes.append(f"done={input.done}")
    if input.priority is not None:
        if input.priority not in ["low", "medium", "high"]:
            return error(
                code="INVALID_PRIORITY",
                message=f"Invalid priority: {input.priority}",
                suggestion="Use one of: low, medium, high",
            )
        todo.priority = input.priority
        changes.append(f"priority='{input.priority}'")
    
    return success(
        data=todo,
        reasoning=f"Updated todo: {', '.join(changes)}" if changes else "No changes made",
    )


@server.command(
    name="todo.delete",
    description="Delete a todo item",
    mutation=True,
)
async def delete_todo(input: dict) -> CommandResult[dict]:
    """Delete a todo by ID."""
    todo_id = input.get("id")
    
    if not todo_id:
        return error(
            code="MISSING_ID",
            message="Todo ID is required",
            suggestion="Provide an 'id' parameter",
        )
    
    if todo_id not in todos:
        return error(
            code="NOT_FOUND",
            message=f"Todo '{todo_id}' not found",
            suggestion="Use 'todo.list' to see available todos",
        )
    
    deleted = todos.pop(todo_id)
    
    return success(
        data={"deleted": todo_id, "title": deleted.title},
        reasoning=f"Deleted todo '{deleted.title}'",
    )


@server.command(
    name="todo.stats",
    description="Get statistics about todos",
)
async def todo_stats(input: dict = None) -> CommandResult[dict]:
    """Get todo statistics."""
    total = len(todos)
    done = sum(1 for t in todos.values() if t.done)
    pending = total - done
    
    by_priority = {}
    for t in todos.values():
        by_priority[t.priority] = by_priority.get(t.priority, 0) + 1
    
    return success(
        data={
            "total": total,
            "done": done,
            "pending": pending,
            "by_priority": by_priority,
        },
        reasoning=f"Stats: {done}/{total} done, {pending} pending",
        confidence=1.0,
    )


# ==============================================================================
# Main Entry Point
# ==============================================================================

async def main():
    """Start the MCP server."""
    # Print server info
    print(f"Starting {server.name} v{server.version}", file=__import__("sys").stderr)
    print(f"Commands: {[c.name for c in server.registry.list()]}", file=__import__("sys").stderr)
    
    # Run the server (stdio transport for VS Code/Cursor)
    await server.start()


if __name__ == "__main__":
    asyncio.run(main())
