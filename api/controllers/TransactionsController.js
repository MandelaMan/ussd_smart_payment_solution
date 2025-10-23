const { getPool } = require("../config/db");
const Account = require("../models/Account");
const Transaction = require("../models/Transaction");

const asCents = (n) => {
  if (typeof n === "string") n = n.trim();
  const v = Number(n);
  if (!Number.isFinite(v)) return NaN;
  // dollars to cents (or generic currency to minor unit)
  return Math.round(v * 100);
};

module.exports = {
  // POST /api/transactions/deposit
  async deposit(req, res, next) {
    const {
      accountId,
      amount,
      currency = "USD",
      description = null,
    } = req.body;
    try {
      const amountCents = asCents(amount);
      if (!accountId || !Number.isFinite(amountCents) || amountCents <= 0) {
        const err = new Error("accountId and positive amount are required");
        err.status = 400;
        throw err;
      }
      const pool = getPool();
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        const acct = await Account.getForUpdate(conn, accountId);
        if (!acct) {
          const err = new Error("Account not found");
          err.status = 404;
          throw err;
        }
        if (acct.currency !== currency) {
          const err = new Error("Currency mismatch");
          err.status = 400;
          throw err;
        }

        // update balance
        const newBal = Number(acct.balance_cents) + amountCents;
        await conn.query(
          "UPDATE accounts SET balance_cents = ? WHERE id = ?;",
          [newBal, accountId]
        );

        const tx = await Transaction.create(
          {
            type: "deposit",
            accountId,
            amountCents,
            currency,
            description,
          },
          conn
        );

        await conn.commit();
        res.status(201).json({ transaction: tx, balanceCents: newBal });
      } catch (e) {
        await conn.rollback();
        throw e;
      } finally {
        conn.release();
      }
    } catch (e) {
      next(e);
    }
  },

  // POST /api/transactions/withdraw
  async withdraw(req, res, next) {
    const {
      accountId,
      amount,
      currency = "USD",
      description = null,
    } = req.body;
    try {
      const amountCents = asCents(amount);
      if (!accountId || !Number.isFinite(amountCents) || amountCents <= 0) {
        const err = new Error("accountId and positive amount are required");
        err.status = 400;
        throw err;
      }
      const pool = getPool();
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        const acct = await Account.getForUpdate(conn, accountId);
        if (!acct) {
          const err = new Error("Account not found");
          err.status = 404;
          throw err;
        }
        if (acct.currency !== currency) {
          const err = new Error("Currency mismatch");
          err.status = 400;
          throw err;
        }
        if (Number(acct.balance_cents) < amountCents) {
          const err = new Error("Insufficient funds");
          err.status = 409;
          throw err;
        }

        const newBal = Number(acct.balance_cents) - amountCents;
        await conn.query(
          "UPDATE accounts SET balance_cents = ? WHERE id = ?;",
          [newBal, accountId]
        );

        const tx = await Transaction.create(
          {
            type: "withdrawal",
            accountId,
            amountCents,
            currency,
            description,
          },
          conn
        );

        await conn.commit();
        res.status(201).json({ transaction: tx, balanceCents: newBal });
      } catch (e) {
        await conn.rollback();
        throw e;
      } finally {
        conn.release();
      }
    } catch (e) {
      next(e);
    }
  },

  // POST /api/transactions/transfer
  async transfer(req, res, next) {
    const {
      fromAccountId,
      toAccountId,
      amount,
      currency = "USD",
      description = null,
    } = req.body;
    try {
      const amountCents = asCents(amount);
      if (!fromAccountId || !toAccountId || fromAccountId === toAccountId) {
        const err = new Error(
          "fromAccountId and toAccountId must be different and provided"
        );
        err.status = 400;
        throw err;
      }
      if (!Number.isFinite(amountCents) || amountCents <= 0) {
        const err = new Error("positive amount is required");
        err.status = 400;
        throw err;
      }

      const pool = getPool();
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();

        // Lock both accounts in stable order to avoid deadlocks
        const ids = [Number(fromAccountId), Number(toAccountId)].sort(
          (a, b) => a - b
        );
        const a1 = await Account.getForUpdate(conn, ids[0]);
        const a2 = await Account.getForUpdate(conn, ids[1]);

        const from = Number(fromAccountId) === ids[0] ? a1 : a2;
        const to = Number(toAccountId) === ids[0] ? a1 : a2;

        if (!from || !to) {
          const err = new Error("Account not found");
          err.status = 404;
          throw err;
        }
        if (from.currency !== to.currency || from.currency !== currency) {
          const err = new Error("Currency mismatch");
          err.status = 400;
          throw err;
        }
        if (Number(from.balance_cents) < amountCents) {
          const err = new Error("Insufficient funds");
          err.status = 409;
          throw err;
        }

        await conn.query(
          "UPDATE accounts SET balance_cents = balance_cents - ? WHERE id = ?;",
          [amountCents, from.id]
        );
        await conn.query(
          "UPDATE accounts SET balance_cents = balance_cents + ? WHERE id = ?;",
          [amountCents, to.id]
        );

        const txOut = await Transaction.create(
          {
            type: "transfer",
            accountId: from.id,
            counterpartyAccountId: to.id,
            amountCents,
            currency,
            description,
          },
          conn
        );

        const txIn = await Transaction.create(
          {
            type: "deposit",
            accountId: to.id,
            counterpartyAccountId: from.id,
            amountCents,
            currency,
            description: description
              ? `Transfer in: ${description}`
              : "Transfer in",
          },
          conn
        );

        await conn.commit();
        res.status(201).json({ debit: txOut, credit: txIn });
      } catch (e) {
        await conn.rollback();
        throw e;
      } finally {
        conn.release();
      }
    } catch (e) {
      next(e);
    }
  },

  // GET /api/transactions/account/:accountId
  async listByAccount(req, res, next) {
    try {
      const { accountId } = req.params;
      const { limit = 100, offset = 0 } = req.query;
      res.json(await Transaction.listByAccount(accountId, limit, offset));
    } catch (e) {
      next(e);
    }
  },
};
