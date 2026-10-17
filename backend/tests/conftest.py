import os

# Must be set before app modules read settings.
os.environ["BOT_TOKEN"] = "123456:TEST-token"
os.environ["ENV"] = "dev"
os.environ.setdefault(
    "TEST_DATABASE_URL", "postgresql+asyncpg://chordb:chordb@127.0.0.1:5432/chordb_test"
)
os.environ["DATABASE_URL"] = os.environ["TEST_DATABASE_URL"]
