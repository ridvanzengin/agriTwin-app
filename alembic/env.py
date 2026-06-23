from logging.config import fileConfig
from alembic import context
from sqlalchemy import engine_from_config, pool
from agritwin_app.config import Settings
from agritwin_app.db.models import Base

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

settings = Settings()
config.set_main_option("sqlalchemy.url", settings.database_url)

target_metadata = Base.metadata

# Tables owned by the ETL Alembic chain. The app chain must never generate DDL
# for these — autogenerate would see model/schema drift and emit ALTER TABLEs
# that corrupt ETL-owned data.
_ETL_TABLES = {
    "data_source", "spatial_cell", "feature", "observation",
    "crop", "crop_requirement", "commodity_price", "production_cost",
    "ingestion_run", "crop_statistics",
}


def _include_object(obj, name, type_, reflected, compare_to):
    if type_ == "table" and name in _ETL_TABLES:
        return False
    return True


def run_migrations_offline() -> None:
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        version_table="alembic_version_app",
        include_object=_include_object,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            version_table="alembic_version_app",
            include_object=_include_object,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
