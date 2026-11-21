"""Install the initial laboratory schema on an empty MySQL database.

Running again is safe: new tables are created with ``create_all`` and columns
added after the first release are back-filled when missing.
"""
from sqlalchemy import inspect, text

from src import models
from src.db import engine

ADDED_COLUMNS = {
    'recipe_lots': [
        ('model_strategy', "VARCHAR(32) NOT NULL DEFAULT 'batch_loo'"),
        ('model_version', 'INTEGER NOT NULL DEFAULT 1'),
    ],
}


def add_missing_columns(connection):
    existing = {column['name'] for column in inspect(connection).get_columns('recipe_lots')}
    for name, ddl in ADDED_COLUMNS['recipe_lots']:
        if name not in existing:
            connection.execute(text(f'ALTER TABLE recipe_lots ADD COLUMN {name} {ddl}'))


def main():
    models.Base.metadata.create_all(engine)
    with engine.begin() as connection:
        add_missing_columns(connection)


if __name__ == '__main__':
    main()
