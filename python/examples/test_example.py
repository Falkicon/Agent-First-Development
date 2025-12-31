"""Example: Testing AFD Commands.

This example demonstrates how to use AFD testing utilities
to write comprehensive tests for your commands.
"""

import pytest
from afd import success, error, CommandResult
from afd.core import Source, PlanStep, Warning, Alternative
from afd.testing import (
    assert_success,
    assert_error,
    assert_has_confidence,
    assert_has_reasoning,
    assert_has_sources,
    assert_has_plan,
    assert_has_warnings,
    assert_has_alternatives,
)


# ==============================================================================
# Example Command Under Test
# ==============================================================================

async def search_documents(query: str, limit: int = 10) -> CommandResult:
    """Search for documents matching a query.
    
    This is an example command that returns rich metadata.
    """
    # In a real application, this would query a database
    results = [
        {"id": "doc-1", "title": "Getting Started Guide", "score": 0.95},
        {"id": "doc-2", "title": "API Reference", "score": 0.87},
    ]
    
    return CommandResult(
        success=True,
        data=results,
        confidence=0.91,
        reasoning=f"Found 2 documents matching '{query}'",
        sources=[
            Source(type="database", id="docs-db", title="Documentation Database"),
            Source(type="index", id="search-idx", title="Search Index"),
        ],
    )


async def create_user(name: str, email: str) -> CommandResult:
    """Create a new user account."""
    if not name or not email:
        return error(
            code="VALIDATION_ERROR",
            message="Name and email are required",
            suggestion="Provide both name and email parameters",
        )
    
    if "@" not in email:
        return error(
            code="INVALID_EMAIL",
            message="Invalid email format",
            suggestion="Use a valid email address like user@example.com",
        )
    
    return success(
        data={"id": "user-123", "name": name, "email": email},
        reasoning=f"Created user '{name}' with email '{email}'",
        confidence=1.0,
    )


async def deploy_application(env: str) -> CommandResult:
    """Deploy application to an environment."""
    return CommandResult(
        success=True,
        data={"deployment_id": "deploy-456", "environment": env},
        plan=[
            PlanStep(id="1", action="validate", status="complete"),
            PlanStep(id="2", action="build", status="complete"),
            PlanStep(id="3", action="deploy", status="in_progress"),
            PlanStep(id="4", action="verify", status="pending"),
        ],
        warnings=[
            Warning(code="SLOW_DEPLOY", message="Deployment may take longer during peak hours"),
        ],
        alternatives=[
            Alternative(
                data={"deployment_id": "deploy-alt", "environment": "staging"},
                reason="Consider deploying to staging first for safety",
            ),
        ],
    )


# ==============================================================================
# Tests
# ==============================================================================

class TestAssertSuccess:
    """Tests demonstrating assert_success usage."""
    
    @pytest.mark.asyncio
    async def test_basic_success_assertion(self):
        """assert_success returns the data from a successful result."""
        result = await create_user(name="Alice", email="alice@example.com")
        
        # assert_success raises if result is not successful
        # and returns the data for further assertions
        data = assert_success(result)
        
        assert data["name"] == "Alice"
        assert data["email"] == "alice@example.com"
    
    @pytest.mark.asyncio
    async def test_custom_error_message(self):
        """Custom messages help identify test failures."""
        result = await create_user(name="", email="bad")
        
        # The custom message appears in test output on failure
        with pytest.raises(AssertionError) as exc_info:
            assert_success(result, message="User creation should succeed")
        
        assert "User creation should succeed" in str(exc_info.value)


class TestAssertError:
    """Tests demonstrating assert_error usage."""
    
    @pytest.mark.asyncio
    async def test_basic_error_assertion(self):
        """assert_error returns the error from a failed result."""
        result = await create_user(name="", email="")
        
        err = assert_error(result)
        
        assert err.code == "VALIDATION_ERROR"
    
    @pytest.mark.asyncio
    async def test_expected_error_code(self):
        """Can validate a specific error code."""
        result = await create_user(name="Bob", email="invalid-email")
        
        # Validates that the error has the expected code
        err = assert_error(result, expected_code="INVALID_EMAIL")
        
        assert "Invalid email" in err.message


class TestAssertHasConfidence:
    """Tests demonstrating confidence assertions."""
    
    @pytest.mark.asyncio
    async def test_basic_confidence(self):
        """assert_has_confidence returns the confidence value."""
        result = await search_documents("getting started")
        
        confidence = assert_has_confidence(result)
        
        assert confidence == 0.91
    
    @pytest.mark.asyncio
    async def test_minimum_confidence(self):
        """Can validate minimum confidence threshold."""
        result = await search_documents("getting started")
        
        # Validates confidence is at least 0.8
        confidence = assert_has_confidence(result, min_confidence=0.8)
        
        assert confidence >= 0.8
    
    @pytest.mark.asyncio
    async def test_confidence_range(self):
        """Can validate confidence is within a range."""
        result = await search_documents("getting started")
        
        # Validates confidence is between 0.8 and 1.0
        confidence = assert_has_confidence(
            result,
            min_confidence=0.8,
            max_confidence=1.0,
        )
        
        assert 0.8 <= confidence <= 1.0


class TestAssertHasReasoning:
    """Tests demonstrating reasoning assertions."""
    
    @pytest.mark.asyncio
    async def test_basic_reasoning(self):
        """assert_has_reasoning returns the reasoning string."""
        result = await create_user(name="Alice", email="alice@example.com")
        
        reasoning = assert_has_reasoning(result)
        
        assert "Alice" in reasoning
    
    @pytest.mark.asyncio
    async def test_reasoning_contains(self):
        """Can validate reasoning contains specific text."""
        result = await search_documents("getting started")
        
        # Validates reasoning contains the expected substring
        reasoning = assert_has_reasoning(result, contains="2 documents")
        
        assert "2 documents" in reasoning


class TestAssertHasSources:
    """Tests demonstrating source attribution assertions."""
    
    @pytest.mark.asyncio
    async def test_basic_sources(self):
        """assert_has_sources returns the list of sources."""
        result = await search_documents("api reference")
        
        sources = assert_has_sources(result)
        
        assert len(sources) == 2
        assert sources[0].type == "database"
    
    @pytest.mark.asyncio
    async def test_minimum_sources(self):
        """Can validate minimum number of sources."""
        result = await search_documents("api reference")
        
        # Validates at least 2 sources are provided
        sources = assert_has_sources(result, min_count=2)
        
        assert len(sources) >= 2


class TestAssertHasPlan:
    """Tests demonstrating plan/progress assertions."""
    
    @pytest.mark.asyncio
    async def test_basic_plan(self):
        """assert_has_plan returns the list of steps."""
        result = await deploy_application("production")
        
        steps = assert_has_plan(result)
        
        assert len(steps) == 4
        assert steps[0].action == "validate"
    
    @pytest.mark.asyncio
    async def test_minimum_steps(self):
        """Can validate minimum number of steps."""
        result = await deploy_application("production")
        
        # Validates at least 3 steps in the plan
        steps = assert_has_plan(result, min_steps=3)
        
        assert len(steps) >= 3


class TestAssertHasWarnings:
    """Tests demonstrating warning assertions."""
    
    @pytest.mark.asyncio
    async def test_basic_warnings(self):
        """assert_has_warnings returns the list of warnings."""
        result = await deploy_application("production")
        
        warnings = assert_has_warnings(result)
        
        assert len(warnings) == 1
        assert "peak hours" in warnings[0].message


class TestAssertHasAlternatives:
    """Tests demonstrating alternative assertions."""
    
    @pytest.mark.asyncio
    async def test_basic_alternatives(self):
        """assert_has_alternatives returns the list of alternatives."""
        result = await deploy_application("production")
        
        alternatives = assert_has_alternatives(result)
        
        assert len(alternatives) == 1
        assert alternatives[0].data["environment"] == "staging"
        assert "staging" in alternatives[0].reason
