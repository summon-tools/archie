# Django Seed Skill

## User Creation

```python
from django.contrib.auth import get_user_model
User = get_user_model()

# create_user handles password hashing automatically
user, created = User.objects.get_or_create(
    email="alice@example.com",
    defaults={
        "username": "alice",
        "first_name": "Alice",
        "last_name": "Johnson",
    }
)
if created:
    user.set_password("password123")
    user.save()

# For superuser
admin, created = User.objects.get_or_create(
    email="admin@example.com",
    defaults={"username": "admin", "is_staff": True, "is_superuser": True}
)
if created:
    admin.set_password("password123")
    admin.save()
```

## Password Hashing

Always use `set_password()` or `User.objects.create_user()`. Never set `password` directly.

## Common Patterns

```python
# Idempotent creation
obj, created = Model.objects.get_or_create(
    unique_field=value,
    defaults={"field1": val1, "field2": val2}
)

# Update existing
obj, created = Model.objects.update_or_create(
    unique_field=value,
    defaults={"field1": val1}
)

# Bulk create (not idempotent)
Model.objects.bulk_create([
    Model(field=val) for val in values
], ignore_conflicts=True)
```

## Script Structure

```bash
#!/bin/bash
set -e
source venv/bin/activate 2>/dev/null || true

python manage.py shell -c '
from django.contrib.auth import get_user_model
User = get_user_model()
# seed code here
'
```

## Gotchas
- NEVER run `manage.py migrate`, `manage.py flush`, or create/drop the database — it is already set up
- Check `models.py` for `choices=` on fields — only use defined choice values
- Check for custom user models (`AUTH_USER_MODEL` in settings)
- `get_or_create` returns a tuple `(obj, created)` — don't forget to unpack
- For ForeignKey fields, pass the related object or use `field_id=value`
- For ManyToManyField, use `.add()` after creating the object
- Check for `unique_together` and `UniqueConstraint` in Meta
