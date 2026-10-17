from importlib import import_module

from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import create_engine, inspect


def test_model_execution_upgrade_and_downgrade():
    migration = import_module("migrations.versions.y36qu021so40_add_model_executions")
    engine = create_engine("sqlite://")
    with engine.begin() as connection:
        with Operations.context(MigrationContext.configure(connection)):
            migration.upgrade()
            schema = inspect(connection)
            assert {"model_executions", "model_stream_events"} <= set(schema.get_table_names())
            assert schema.get_pk_constraint("model_stream_events")["constrained_columns"] == [
                "execution_id",
                "sequence",
            ]
            assert schema.get_unique_constraints("model_executions")[0]["column_names"] == [
                "run_id",
                "request_key",
            ]
            migration.downgrade()
            assert inspect(connection).get_table_names() == []
