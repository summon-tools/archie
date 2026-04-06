# Flask Seed Skill

## SQLAlchemy User Creation

```python
from werkzeug.security import generate_password_hash
from app.models import User, db  # adjust import path

existing = User.query.filter_by(email="alice@example.com").first()
if not existing:
    user = User(
        email="alice@example.com",
        name="Alice Johnson",
        password=generate_password_hash("password123"),
    )
    db.session.add(user)
    db.session.commit()
```

## Password Hashing

```python
# werkzeug (Flask default)
from werkzeug.security import generate_password_hash
hashed = generate_password_hash("password123")

# flask-bcrypt
from flask_bcrypt import generate_password_hash
hashed = generate_password_hash("password123").decode("utf-8")

# passlib
from passlib.hash import pbkdf2_sha256
hashed = pbkdf2_sha256.hash("password123")
```

## Common Patterns

```python
# Idempotent creation
def get_or_create(model, defaults=None, **kwargs):
    instance = model.query.filter_by(**kwargs).first()
    if instance:
        return instance, False
    instance = model(**kwargs, **(defaults or {}))
    db.session.add(instance)
    db.session.commit()
    return instance, True

user, created = get_or_create(User, email="alice@example.com",
    defaults={"name": "Alice", "password": generate_password_hash("password123")})
```

## Flask-Login / Flask-Security

```python
# Flask-Security uses its own user creation
from flask_security import hash_password
user_datastore.find_or_create_user(
    email="alice@example.com",
    password=hash_password("password123"),
)
db.session.commit()
```

## Script Structure

```bash
#!/bin/bash
set -e
source venv/bin/activate 2>/dev/null || true

python -c '
import sys, os
sys.path.insert(0, os.getcwd())

# For Flask app factory pattern
from app import create_app, db
app = create_app()

with app.app_context():
    from werkzeug.security import generate_password_hash
    from app.models import User
    # seed code here
    db.session.commit()
'
```

## Gotchas
- NEVER run `flask db upgrade`, `db.create_all()`, or create/drop the database — it is already set up
- Check if the app uses app factory pattern (`create_app()`) — need app context
- Check for `flask-sqlalchemy` vs plain `sqlalchemy` session management
- Check model for `__tablename__`, `unique=True` constraints, and `nullable=False` columns
- `db.session.commit()` is required — SQLAlchemy doesn't auto-commit
- For Flask-Migrate apps, schema is defined in models, not a separate schema file
- Check `__init__.py` or `app.py` for the Flask app instance name
