from importlib import import_module

from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import Column, Integer, MetaData, Table, create_engine, inspect


def test_message_context_snapshot_upgrade_and_downgrade():
    migration = import_module("migrations.versions.a58sw243uq62_add_message_context_snapshot")
    engine = create_engine("sqlite://")
    with engine.begin() as connection:
        Table("messages", MetaData(), Column("id", Integer, primary_key=True)).create(connection)
        with Operations.context(MigrationContext.configure(connection)):
            migration.upgrade()
            columns = {column["name"] for column in inspect(connection).get_columns("messages")}
            assert "context_snapshot" in columns
            migration.downgrade()
            columns = {column["name"] for column in inspect(connection).get_columns("messages")}
            assert "context_snapshot" not in columns
