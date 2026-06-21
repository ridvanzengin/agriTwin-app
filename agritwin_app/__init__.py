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

    init_db(settings.database_url)

    from .api import bp as api_bp
    from .views import bp as views_bp

    app.register_blueprint(api_bp)
    app.register_blueprint(views_bp)

    return app
