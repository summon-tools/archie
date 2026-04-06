# Express Seed Skill

## Sequelize User Creation

```typescript
const bcrypt = require("bcrypt");
const { User } = require("./models");

const hash = await bcrypt.hash("password123", 10);
await User.findOrCreate({
  where: { email: "alice@example.com" },
  defaults: {
    name: "Alice Johnson",
    password: hash,
  },
});
```

## Knex User Creation

```typescript
const bcrypt = require("bcrypt");
const knex = require("./db");  // or require("knex")(config)

const hash = await bcrypt.hash("password123", 10);
await knex("users")
  .insert({ email: "alice@example.com", name: "Alice Johnson", password: hash })
  .onConflict("email")
  .ignore();
```

## Mongoose User Creation

```typescript
const bcrypt = require("bcrypt");
const User = require("./models/User");

const hash = await bcrypt.hash("password123", 10);
await User.findOneAndUpdate(
  { email: "alice@example.com" },
  { name: "Alice Johnson", password: hash },
  { upsert: true, new: true }
);
```

## Password Hashing

```typescript
// bcrypt (most common)
const bcrypt = require("bcrypt");
const hash = await bcrypt.hash("password123", 10);

// argon2
const argon2 = require("argon2");
const hash = await argon2.hash("password123");
```

## Script Structure

```bash
#!/bin/bash
set -e
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

node -e '
// For Sequelize
const { sequelize, User } = require("./models");

async function main() {
  // seed code here
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => sequelize?.close());
'
```

## Raw SQL Fallback (SQLite)

```bash
sqlite3 path/to/db.sqlite3 "INSERT OR IGNORE INTO users (email, name, password) VALUES ('alice@example.com', 'Alice', '\$hash');"
```

## Gotchas
- NEVER run migrations, create/drop the database, or modify the schema — it is already set up
- Check which ORM is used: Sequelize, Knex, Prisma, Mongoose, TypeORM, or raw SQL
- Check `package.json` for `bcrypt` vs `bcryptjs` vs `argon2`
- Sequelize `findOrCreate` returns `[instance, created]` tuple
- For TypeORM, use `Repository.upsert()` or `save()` with existing entity
- Mongoose `findOneAndUpdate` with `upsert: true` is idempotent
