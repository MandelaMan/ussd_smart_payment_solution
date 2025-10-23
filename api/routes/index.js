const express = require("express");
const router = express.Router();

router.get("/", (_req, res) =>
  res.json({ message: "Stalynx Utility API Application" })
);

// router.use("/users", require("./users"));
// router.use("/accounts", require("./accounts"));
// router.use("/transactions", require("./transactions"));

module.exports = router;
