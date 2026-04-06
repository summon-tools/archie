# Next.js Seed Skill

## Prisma User Creation

```typescript
const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcrypt");  // or bcryptjs

const prisma = new PrismaClient();

const hashedPassword = await bcrypt.hash("password123", 10);

await prisma.user.upsert({
  where: { email: "alice@example.com" },
  update: {},
  create: {
    email: "alice@example.com",
    name: "Alice Johnson",
    password: hashedPassword,  // or hashedPassword field name from schema
  },
});
```

## Password Hashing

```typescript
// bcrypt (most common)
const bcrypt = require("bcrypt");
const hash = await bcrypt.hash("password123", 10);

// bcryptjs (pure JS alternative)
const bcrypt = require("bcryptjs");
const hash = bcrypt.hashSync("password123", 10);
```

## Common Patterns

```typescript
// Prisma upsert (idempotent)
await prisma.model.upsert({
  where: { uniqueField: value },
  update: {},
  create: { field1: val1, field2: val2 },
});

// Prisma createMany (skip duplicates)
await prisma.model.createMany({
  data: items,
  skipDuplicates: true,
});

// With relations
const user = await prisma.user.upsert({
  where: { email: "alice@example.com" },
  update: {},
  create: {
    email: "alice@example.com",
    posts: {
      create: [
        { title: "First Post", content: "Hello world" },
      ],
    },
  },
});
```

## NextAuth User Tables

```typescript
// NextAuth uses specific table structure — check schema.prisma
// Common fields: name, email, emailVerified, image
// Accounts table links OAuth providers
// For credentials provider, password is usually on User model
```

## Script Structure

```bash
#!/bin/bash
set -e
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

node -e '
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  // seed code here
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
'
```

## Gotchas
- NEVER run `prisma migrate`, `prisma db push`, or create/drop the database — it is already set up
- Check `prisma/schema.prisma` for required fields, `@unique` constraints, and enums
- Prisma enums are TypeScript enums — use exact values from schema
- For `@default(cuid())` or `@default(uuid())` fields, don't provide values
- Check if `bcrypt` or `bcryptjs` is in package.json
- For Drizzle ORM, use `db.insert().values().onConflictDoNothing()`
