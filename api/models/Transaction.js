const { query } = require("../config/db");

const toPublic = (row) => ({
  id: String(row.id),
  type: row.type,
  accountId: String(row.account_id),
  counterpartyAccountId: row.counterparty_account_id
    ? String(row.counterparty_account_id)
    : null,
  amountCents: Number(row.amount_cents),
  currency: row.currency,
  description: row.description,
  createdAt: row.created_at,
});

const Transaction = {
  async create(
    {
      type,
      accountId,
      counterpartyAccountId = null,
      amountCents,
      currency,
      description = null,
    },
    connOrPool = null
  ) {
    const runner = connOrPool || { query };
    const [result] = await (connOrPool
      ? connOrPool.query(
          "INSERT INTO transactions (type, account_id, counterparty_account_id, amount_cents, currency, description) VALUES (?, ?, ?, ?, ?, ?);",
          [
            type,
            accountId,
            counterpartyAccountId,
            amountCents,
            currency,
            description,
          ]
        )
      : query(
          "INSERT INTO transactions (type, account_id, counterparty_account_id, amount_cents, currency, description) VALUES (?, ?, ?, ?, ?, ?);",
          [
            type,
            accountId,
            counterpartyAccountId,
            amountCents,
            currency,
            description,
          ]
        ));

    const rows = await (connOrPool
      ? connOrPool
          .query("SELECT * FROM transactions WHERE id = ?;", [result.insertId])
          .then(([r]) => r)
      : query("SELECT * FROM transactions WHERE id = ?;", [result.insertId]));
    return toPublic(rows[0]);
  },

  async listByAccount(accountId, limit = 100, offset = 0) {
    const rows = await query(
      "SELECT * FROM transactions WHERE account_id = ? ORDER BY id DESC LIMIT ? OFFSET ?;",
      [accountId, Number(limit), Number(offset)]
    );
    return rows.map(toPublic);
  },
};

module.exports = Transaction;
