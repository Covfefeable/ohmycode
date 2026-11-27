from importlib import import_module
from types import SimpleNamespace

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import create_engine, text

from app.services.errors import ServiceError
from app.services.model_reasoning import reasoning_parameters, validate_reasoning_levels


@pytest.mark.parametrize(
    "levels",
    [
        None,
        {},
        [{"name": "Low", "key": ""}],
        [{"name": "Low", "key": "low"}, {"name": "Duplicate", "key": " low "}],
    ],
)
def test_invalid_reasoning_choices_are_rejected(levels):
    with pytest.raises(ServiceError):
        validate_reasoning_levels(levels)


def test_default_omits_parameter_and_custom_keys_are_supported():
    levels = validate_reasoning_levels([{"name": " Custom ", "key": " custom "}])
    configuration = SimpleNamespace(reasoning_levels=levels, reasoning_enabled=True)
    assert levels == [{"name": "Custom", "key": "custom"}]
    assert reasoning_parameters(configuration, "") == {}
    assert reasoning_parameters(configuration, None) == {}
    assert reasoning_parameters(configuration, "custom") == {"reasoning_effort": "custom"}
    configuration.reasoning_enabled = False
    assert reasoning_parameters(configuration, "custom") == {}


def test_reasoning_migration_preserves_existing_models():
    migration = import_module("migrations.versions.f03xb798zv17_add_model_reasoning_levels")
    engine = create_engine("sqlite://")
    with engine.begin() as connection:
        connection.execute(text("CREATE TABLE model_configurations (id INTEGER PRIMARY KEY)"))
        connection.execute(text("INSERT INTO model_configurations (id) VALUES (1)"))
        with Operations.context(MigrationContext.configure(connection)):
            migration.upgrade()
            assert (
                connection.execute(
                    text("SELECT reasoning_levels FROM model_configurations WHERE id = 1")
                ).scalar()
                == "[]"
            )
            migration.downgrade()
            assert connection.execute(text("SELECT id FROM model_configurations")).scalar() == 1
