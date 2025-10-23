const express = require("express");
const router = express.Router();

router.get("/", (_req, res) =>
  res.json({ message: "Welcome to the App for testing" })
);

router.use("/users", require("./users"));
router.use("/accounts", require("./accounts"));
router.use("/transactions", require("./transactions"));

module.exports = router;
