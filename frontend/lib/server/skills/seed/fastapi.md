# FastAPI Seed Skill

## SQLAlchemy Session Pattern

```python
from passlib.context import CryptContext
from app.database import SessionLocal
from app import models

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

db = SessionLocal()
try:
    user = db.query(models.User).filter_by(email="alice@example.com").one_or_none()
    if not user:
        user = models.User(
            email="alice@example.com",
            name="Alice Johnson",
            hashed_password=pwd_context.hash("Password123"),
        )
        db.add(user)
    db.commit()
finally:
    db.close()
```

## Async SQLAlchemy Pattern

```python
import asyncio
from sqlalchemy import select
from app.database import async_session
from app import models

async def main():
    async with async_session() as session:
        existing = await session.scalar(select(models.User).where(models.User.email == "alice@example.com"))
        if not existing:
            session.add(models.User(email="alice@example.com", name="Alice Johnson"))
        await session.commit()

asyncio.run(main())
```

## Script Structure

```bash
#!/bin/bash
set -e
source .venv/bin/activate 2>/dev/null || source venv/bin/activate 2>/dev/null || true

cat > .archie/seed_fastapi.py <<'PY'
# seed code here
PY

python .archie/seed_fastapi.py
```

## Gotchas
- NEVER run `alembic upgrade`, create/drop the database, or modify the schema — it is already set up
- Check whether the project uses sync SQLAlchemy sessions, async SQLAlchemy sessions, SQLModel, Tortoise, or raw SQL
- Check auth password hashing before creating users; common libraries are passlib, bcrypt, argon2, and pwdlib
- Use idempotent lookups before inserts
- If models use Pydantic schemas, create ORM model instances, not request schema instances
