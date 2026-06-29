from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    database_url: str = "postgresql+psycopg://agritwin:agritwin@localhost:5433/agritwin"
    flask_secret_key: str = "dev-secret-change-me"
    flask_debug: bool = False
    celery_broker_url: str = "redis://localhost:6379/0"
    celery_result_backend: str = "redis://localhost:6379/0"
    scenario_creation_enabled: bool = False

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")
