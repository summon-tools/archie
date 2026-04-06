# Rails Seed Skill

## User Creation (Devise)

```ruby
# Always use find_or_initialize_by + save! to surface validation errors
user = User.find_or_initialize_by(email: "alice@example.com")
user.assign_attributes(
  password: "password123",
  password_confirmation: "password123",
  name: "Alice Johnson"
)
# Skip Devise confirmation email if confirmable is enabled
user.skip_confirmation! if user.respond_to?(:skip_confirmation!)
user.save!
```

## Password Hashing

Devise handles bcrypt automatically — just set `password` and `password_confirmation`.
Never set `encrypted_password` directly.

**IMPORTANT:** Check the User model for custom password validators (e.g. `validate :password_complexity`).
Many apps require uppercase + lowercase + digit. Use `Password123` as the default password
instead of `password123` to satisfy common complexity requirements.

## Enum Handling

```ruby
# ALWAYS check the model for valid enum values before using them
# e.g. enum role: { admin: 0, member: 1 } — only use :admin or :member
# e.g. enum status: { draft: 0, published: 1 } — only use :draft or :published
user.role = :admin  # Use symbol, not string integer
```

## Acceptance Validators

```ruby
# validates :terms, acceptance: true — only checked on create via forms
# For seeds, set the virtual attribute:
user.terms = "1"
```

## Common Patterns

```ruby
# Idempotent record creation
record = Model.find_or_initialize_by(unique_field: value)
record.assign_attributes(field1: val1, field2: val2)
record.save!

# Has-many associations
project = Project.find_or_create_by!(name: "Demo Project", user: user)
3.times do |i|
  project.tasks.find_or_create_by!(title: "Task #{i + 1}")
end
```

## Script Structure

CRITICAL: NEVER pass Ruby code inline to `rails runner '...'` — single quotes in the Ruby code WILL break bash quoting.
Instead, write Ruby to a temp file and pass the file path to `rails runner`:

```bash
#!/bin/bash
set -e
export PATH="$HOME/.rbenv/bin:$HOME/.rbenv/shims:$PATH"
eval "$(rbenv init - 2>/dev/null)" || true

cd "$(dirname "$0")/.." 2>/dev/null || true

cat > .archie/seed.rb << 'RUBY'
# seed code here — single quotes are safe inside a heredoc
RUBY

bundle exec rails runner .archie/seed.rb
```

## Gotchas
- NEVER use `rails runner 'inline code'` — single quotes in Ruby code break bash quoting. Always write to a `.rb` file and pass the file path.
- NEVER call `rails db:create`, `rails db:drop`, or `rails db:reset` — the database is already created and managed externally
- NEVER set `RAILS_ENV` or `DATABASE_URL` — the environment is already configured
- Always check `db/schema.rb` for NOT NULL columns and add them to seeds
- Check model files for `validates :field, presence: true` and custom validations
- Use `save!` not `save` — bang version raises on failure so errors are visible
- For polymorphic associations, set both `_type` and `_id`
- For file attachments (ActiveStorage), skip them in seeds
