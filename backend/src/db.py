import os
from datetime import datetime, timezone

from redis import Redis
from sqlalchemy import URL, create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker


class Base(DeclarativeBase):
    pass


def utcnow():
    return datetime.now(timezone.utc).replace(tzinfo=None)


engine = create_engine(
    URL.create(
        'mysql+pymysql', username=os.getenv('MYSQL_USER', 'lab'),
        password=os.getenv('MYSQL_PASSWORD', 'local-lab-password'),
        host=os.getenv('DB_HOST', '127.0.0.1'), port=int(os.getenv('DB_PORT', '3306')),
        database=os.getenv('MYSQL_DATABASE', 'freeze_lab'), query={'charset': 'utf8mb4'},
    ),
    pool_pre_ping=True,
    hide_parameters=True,
    isolation_level='READ COMMITTED',
)
Session = sessionmaker(engine, expire_on_commit=False)
redis = Redis.from_url(os.getenv('REDIS_URL', 'redis://localhost:6379/0'), socket_timeout=6)
QUEUE = 'freeze:fit'


def session():
    with Session() as db:
        yield db
