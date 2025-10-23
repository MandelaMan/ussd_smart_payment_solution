const { query, getPool } = require("../config/db");

const toPublic = (row) => ({
  id: String(row.id),
  userId: String(row.user_id),
  name: row.name,
  currency: row.currency,
  balanceCents: Number(row.balance_cents),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const Account = {
  async create({ userId, name = "main", currency = "USD" }) {
    const result = await query(
      "INSERT INTO accounts (user_id, name, currency) VALUES (?, ?, ?);",
      [userId, name, currency]
    );
    const [row] = await query("SELECT * FROM accounts WHERE id = ?;", [
      result.insertId,
    ]);
    return toPublic(row);
  },

  async findById(id) {
    const rows = await query("SELECT * FROM accounts WHERE id = ? LIMIT 1;", [
      id,
    ]);
    return rows[0] ? toPublic(rows[0]) : null;
  },

  async findByUser(userId) {
    const rows = await query(
      "SELECT * FROM accounts WHERE user_id = ? ORDER BY id DESC;",
      [userId]
    );
    return rows.map(toPublic);
  },

  // For balance checks inside controllers, lock the row
  async getForUpdate(conn, id) {
    const [rows] = await conn.query(
      "SELECT * FROM accounts WHERE id = ? FOR UPDATE;",
      [id]
    );
    return rows[0] || null;
  },

  async listAll(limit = 100, offset = 0) {
    const rows = await query(
      "SELECT * FROM accounts ORDER BY id DESC LIMIT ? OFFSET ?;",
      [Number(limit), Number(offset)]
    );
    return rows.map(toPublic);
  },
};

module.exports = Account;
