"""Tests for afd.core.metadata module."""

import pytest

from afd.core.metadata import (
    Alternative,
    PlanStep,
    PlanStepStatus,
    Source,
    Warning,
    WarningSeverity,
    create_source,
    create_step,
    create_warning,
    update_step_status,
)


class TestSource:
    """Tests for Source type."""

    def test_basic_source(self):
        source = Source(type="document")
        assert source.type == "document"
        assert source.id is None

    def test_full_source(self):
        source = Source(
            type="document",
            id="doc-123",
            title="Style Guide",
            url="https://example.com/guide",
            location="Chapter 3.2",
            accessed_at="2024-01-15T10:30:00Z",
            relevance=0.92,
        )
        assert source.type == "document"
        assert source.id == "doc-123"
        assert source.title == "Style Guide"
        assert source.url == "https://example.com/guide"
        assert source.location == "Chapter 3.2"
        assert source.relevance == 0.92

    def test_relevance_validation(self):
        # Valid
        source = Source(type="api", relevance=0.5)
        assert source.relevance == 0.5

        # Boundary values
        source = Source(type="api", relevance=0.0)
        assert source.relevance == 0.0

        source = Source(type="api", relevance=1.0)
        assert source.relevance == 1.0

        # Invalid
        with pytest.raises(ValueError):
            Source(type="api", relevance=1.5)

        with pytest.raises(ValueError):
            Source(type="api", relevance=-0.1)


class TestPlanStep:
    """Tests for PlanStep type."""

    def test_basic_step(self):
        step = PlanStep(id="step-1", action="fetch")
        assert step.id == "step-1"
        assert step.action == "fetch"
        assert step.status == PlanStepStatus.PENDING

    def test_full_step(self):
        step = PlanStep(
            id="validate",
            action="validate",
            status=PlanStepStatus.IN_PROGRESS,
            description="Validate input data",
            depends_on=["fetch"],
            progress=50,
            estimated_time_remaining_ms=5000,
        )
        assert step.status == PlanStepStatus.IN_PROGRESS
        assert step.description == "Validate input data"
        assert step.depends_on == ["fetch"]
        assert step.progress == 50

    def test_completed_step_with_result(self):
        step = PlanStep(
            id="complete-step",
            action="process",
            status=PlanStepStatus.COMPLETE,
            result={"processed": True},
        )
        assert step.status == PlanStepStatus.COMPLETE
        assert step.result == {"processed": True}

    def test_failed_step_with_error(self):
        step = PlanStep(
            id="failed-step",
            action="connect",
            status=PlanStepStatus.FAILED,
            error={"code": "CONNECTION_ERROR", "message": "Failed to connect"},
        )
        assert step.status == PlanStepStatus.FAILED
        assert step.error["code"] == "CONNECTION_ERROR"

    def test_progress_validation(self):
        # Valid
        step = PlanStep(id="s", action="a", progress=50)
        assert step.progress == 50

        # Boundary values
        step = PlanStep(id="s", action="a", progress=0)
        assert step.progress == 0

        step = PlanStep(id="s", action="a", progress=100)
        assert step.progress == 100

        # Invalid
        with pytest.raises(ValueError):
            PlanStep(id="s", action="a", progress=101)

        with pytest.raises(ValueError):
            PlanStep(id="s", action="a", progress=-1)


class TestPlanStepStatus:
    """Tests for PlanStepStatus enum."""

    def test_all_statuses(self):
        assert PlanStepStatus.PENDING == "pending"
        assert PlanStepStatus.IN_PROGRESS == "in_progress"
        assert PlanStepStatus.COMPLETE == "complete"
        assert PlanStepStatus.FAILED == "failed"
        assert PlanStepStatus.SKIPPED == "skipped"


class TestAlternative:
    """Tests for Alternative type."""

    def test_basic_alternative(self):
        alt: Alternative[str] = Alternative(
            data="Alternative result",
            reason="More concise version",
        )
        assert alt.data == "Alternative result"
        assert alt.reason == "More concise version"

    def test_full_alternative(self):
        alt: Alternative[dict] = Alternative(
            data={"style": "formal"},
            reason="More appropriate for business context",
            confidence=0.85,
            label="Formal",
        )
        assert alt.confidence == 0.85
        assert alt.label == "Formal"

    def test_confidence_validation(self):
        # Valid
        alt: Alternative[str] = Alternative(data="x", reason="y", confidence=0.5)
        assert alt.confidence == 0.5

        # Invalid
        with pytest.raises(ValueError):
            Alternative(data="x", reason="y", confidence=1.5)


class TestWarning:
    """Tests for Warning type."""

    def test_basic_warning(self):
        warning = Warning(code="TEST_WARNING", message="Test message")
        assert warning.code == "TEST_WARNING"
        assert warning.message == "Test message"
        assert warning.severity == WarningSeverity.WARNING

    def test_full_warning(self):
        warning = Warning(
            code="OUTDATED_SOURCE",
            message="Source is 6 months old",
            severity=WarningSeverity.CAUTION,
            details={"source_age_days": 180},
        )
        assert warning.severity == WarningSeverity.CAUTION
        assert warning.details == {"source_age_days": 180}


class TestWarningSeverity:
    """Tests for WarningSeverity enum."""

    def test_all_severities(self):
        assert WarningSeverity.INFO == "info"
        assert WarningSeverity.WARNING == "warning"
        assert WarningSeverity.CAUTION == "caution"


class TestCreateSource:
    """Tests for create_source() helper function."""

    def test_basic_create(self):
        source = create_source("database")
        assert source.type == "database"

    def test_full_create(self):
        source = create_source(
            "api",
            id="api-123",
            title="Weather API",
            url="https://api.example.com",
            relevance=0.9,
        )
        assert source.type == "api"
        assert source.id == "api-123"
        assert source.title == "Weather API"


class TestCreateStep:
    """Tests for create_step() helper function."""

    def test_basic_create(self):
        step = create_step("fetch-data", "fetch")
        assert step.id == "fetch-data"
        assert step.action == "fetch"
        assert step.status == PlanStepStatus.PENDING

    def test_create_with_description(self):
        step = create_step("validate", "validate", "Validate user input")
        assert step.description == "Validate user input"


class TestUpdateStepStatus:
    """Tests for update_step_status() helper function."""

    def test_update_to_in_progress(self):
        step = create_step("fetch", "fetch")
        updated = update_step_status(step, PlanStepStatus.IN_PROGRESS, progress=25)
        assert updated.status == PlanStepStatus.IN_PROGRESS
        assert updated.progress == 25
        assert updated.id == "fetch"

    def test_update_to_complete(self):
        step = create_step("process", "process")
        result = {"data": "processed"}
        updated = update_step_status(step, PlanStepStatus.COMPLETE, result=result)
        assert updated.status == PlanStepStatus.COMPLETE
        assert updated.result == result

    def test_update_to_failed(self):
        step = create_step("connect", "connect")
        error = {"code": "ERROR", "message": "Failed"}
        updated = update_step_status(step, PlanStepStatus.FAILED, error=error)
        assert updated.status == PlanStepStatus.FAILED
        assert updated.error == error

    def test_preserves_other_fields(self):
        step = PlanStep(
            id="test",
            action="test",
            description="Test step",
            depends_on=["other"],
        )
        updated = update_step_status(step, PlanStepStatus.COMPLETE, result={})
        assert updated.description == "Test step"
        assert updated.depends_on == ["other"]


class TestCreateWarning:
    """Tests for create_warning() helper function."""

    def test_basic_create(self):
        warning = create_warning("DEPRECATED", "Feature is deprecated")
        assert warning.code == "DEPRECATED"
        assert warning.message == "Feature is deprecated"
        assert warning.severity == WarningSeverity.WARNING

    def test_create_with_severity(self):
        warning = create_warning(
            "INFO_CODE",
            "Info message",
            WarningSeverity.INFO,
        )
        assert warning.severity == WarningSeverity.INFO

    def test_create_with_details(self):
        warning = create_warning(
            "LIMIT_APPROACHING",
            "Rate limit at 80%",
            WarningSeverity.CAUTION,
            details={"current": 80, "limit": 100},
        )
        assert warning.details == {"current": 80, "limit": 100}
