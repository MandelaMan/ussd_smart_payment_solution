const Account = require("../models/Account");

module.exports = {
  async create(req, res, next) {
    try {
      const { userId, name = "main", currency = "USD" } = req.body;
      if (!userId) {
        const err = new Error("userId is required");
        err.status = 400;
        throw err;
      }
      const account = await Account.create({ userId, name, currency });
      res.status(201).json(account);
    } catch (e) {
      next(e);
    }
  },

  async listByUser(req, res, next) {
    try {
      res.json(await Account.findByUser(req.params.userId));
    } catch (e) {
      next(e);
    }
  },

  async get(req, res, next) {
    try {
      const acct = await Account.findById(req.params.id);
      if (!acct) {
        const err = new Error("Account not found");
        err.status = 404;
        throw err;
      }
      res.json(acct);
    } catch (e) {
      next(e);
    }
  },
};
