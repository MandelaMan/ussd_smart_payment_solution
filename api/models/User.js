const { query } = require("../config/db");

const toPublic = (row) => ({
  id: String(row.id),
  name: row.name,
  email: row.email,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const User = {
  async findAll() {
    const rows = await query(
      "SELECT id, name, email, created_at, updated_at FROM users ORDER BY id DESC;"
    );
    return rows.map(toPublic);
  },
  async findById(id) {
    const rows = await query(
      "SELECT id, name, email, created_at, updated_at FROM users WHERE id = ? LIMIT 1;",
      [id]
    );
    return rows[0] ? toPublic(rows[0]) : null;
  },
  async findByEmail(email) {
    const rows = await query(
      "SELECT id, name, email, created_at, updated_at FROM users WHERE email = ? LIMIT 1;",
      [email]
    );
    return rows[0] ? toPublic(rows[0]) : null;
  },
  async create({ name, email }) {
    const result = await query(
      "INSERT INTO users (name, email) VALUES (?, ?);",
      [name, email]
    );
    return this.findById(result.insertId);
  },
};

module.exports = User;
