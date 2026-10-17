from datetime import UTC, datetime
from importlib import import_module

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations


def test_timestamp_migration_repairs_nulls_and_can_be_reversed(database_schema):
    migration = import_module("migrations.versions.z47rv132tp51_require_metadata_timestamps")
    previous = datetime(2025, 1, 1, tzinfo=UTC)
    with database_schema.engine.begin() as connection:
        connection.execute(sa.text(f'SET LOCAL search_path TO "{database_schema.name}"'))
        tables = []
        for name in migration.TABLES:
            table = sa.Table(
                name,
                sa.MetaData(),
                sa.Column("id", sa.Integer(), primary_key=True),
                sa.Column("created_at", sa.DateTime(timezone=True)),
                sa.Column("updated_at", sa.DateTime(timezone=True)),
            )
            table.create(connection)
            connection.execute(
                table.insert(),
                [
                    {"id": 1, "created_at": None, "updated_at": None},
                    {"id": 2, "created_at": previous, "updated_at": None},
                ],
            )
            tables.append(table)
        with Operations.context(MigrationContext.configure(connection)):
            migration.upgrade()
            for table in tables:
                rows = connection.execute(sa.select(table).order_by(table.c.id)).all()
                assert rows[0].created_at is not None and rows[0].updated_at is not None
                assert rows[1].created_at == previous and rows[1].updated_at == previous
                columns = sa.inspect(connection).get_columns(table.name)
                assert all(not column["nullable"] for column in columns if column["name"] != "id")
            migration.downgrade()
            for table in tables:
                columns = sa.inspect(connection).get_columns(table.name)
                assert all(column["nullable"] for column in columns if column["name"] != "id")
            migration.upgrade()
