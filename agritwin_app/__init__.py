from flask import Flask
from .config import Settings
from .db.session import init_db


def create_app(settings: Settings | None = None) -> Flask:
    app = Flask(__name__)

    if settings is None:
        settings = Settings()

    app.config["SECRET_KEY"] = settings.flask_secret_key
    app.config["DEBUG"] = settings.flask_debug
    app.config["DATABASE_URL"] = settings.database_url
    app.config["CELERY_BROKER_URL"] = settings.celery_broker_url
    app.config["CELERY_RESULT_BACKEND"] = settings.celery_result_backend
    app.config["SCENARIO_CREATION_ENABLED"] = settings.scenario_creation_enabled

    init_db(settings.database_url)

    from .tasks import init_celery
    init_celery(settings.celery_broker_url, settings.celery_result_backend)

    from .api import bp as api_bp
    from .views import bp as views_bp

    app.register_blueprint(api_bp)
    app.register_blueprint(views_bp)

    return app
