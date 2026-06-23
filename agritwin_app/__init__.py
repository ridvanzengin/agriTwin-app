from flask import Flask
from .config import Settings
from .db.session import init_db
from .celery_app import celery_init_app


def create_app(settings: Settings | None = None) -> Flask:
    app = Flask(__name__)

    if settings is None:
        settings = Settings()

    app.config["SECRET_KEY"] = settings.flask_secret_key
    app.config["DEBUG"] = settings.flask_debug
    app.config["DATABASE_URL"] = settings.database_url
    app.config["CELERY"] = dict(
        broker_url=settings.celery_broker_url,
        result_backend=settings.celery_result_backend,
        task_serializer="json",
        result_serializer="json",
        accept_content=["json"],
    )

    init_db(settings.database_url)
    celery_init_app(app)

    from .api import bp as api_bp
    from .api.score import bp as score_bp
    from .api.crops import bp as crops_bp
    from .views import bp as views_bp

    app.register_blueprint(api_bp)
    app.register_blueprint(score_bp)
    app.register_blueprint(crops_bp)
    app.register_blueprint(views_bp)

    return app
