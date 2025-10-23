const Account = require("../models/Account");
const User = require("../models/user");

module.exports = {
  async create(req, res, next) {
    try {
      const { name, email } = req.body;
      if (!name || !email) {
        const err = new Error("name and email are required");
        err.status = 400;
        throw err;
      }
      const existing = await User.findByEmail(email);
      if (existing) {
        const err = new Error("email already exists");
        err.status = 409;
        throw err;
      }
      const user = await User.create({ name, email });
      // Auto-create a "main" account for convenience
      const account = await Account.create({
        userId: user.id,
        name: "main",
        currency: "USD",
      });
      res.status(201).json({ user, defaultAccount: account });
    } catch (e) {
      next(e);
    }
  },

  async list(req, res, next) {
    try {
      res.json(await User.findAll());
    } catch (e) {
      next(e);
    }
  },

  async get(req, res, next) {
    try {
      const user = await User.findById(req.params.id);
      if (!user) {
        const err = new Error("User not found");
        err.status = 404;
        throw err;
      }
      res.json(user);
    } catch (e) {
      next(e);
    }
  },
};
