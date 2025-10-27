const express = require("express");
const router = express.Router();

router.get("/", (_req, res) =>
  res.json({ message: "Stalynx Utility API Application" })
);

router.use("/ussd", require("./ussd.routes"));
router.use("/tisp", require("./tisp.routes"));
router.use("/payment", require("./mpesa.routes"));
//Add other routes below

module.exports = router;
