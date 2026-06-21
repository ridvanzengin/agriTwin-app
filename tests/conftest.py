import os
import pytest
from agritwin_app import create_app
from agritwin_app.config import Settings


@pytest.fixture(scope="session")
def app():
    settings = Settings(
        database_url=os.environ.get(
            "DATABASE_URL",
            "postgresql+psycopg://agritwin:agritwin@localhost:5433/agritwin",
        ),
        flask_secret_key="test-secret",
        flask_debug=False,
    )
    app = create_app(settings)
    app.config["TESTING"] = True
    return app


@pytest.fixture()
def client(app):
    return app.test_client()
