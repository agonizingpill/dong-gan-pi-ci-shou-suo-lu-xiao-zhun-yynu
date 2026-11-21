"""Install the initial laboratory schema on an empty MySQL database."""
from src import models
from src.db import engine

if __name__ == '__main__':
    models.Base.metadata.create_all(engine)
