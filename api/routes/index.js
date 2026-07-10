const express = require("express");
const { authenticate } = require("../middleware/auth");
const router = express.Router();

router.get("/", (_req, res) =>
  res.json({ message: "Stalynx Utility API Application" })
);

router.use("/auth", require("./auth.routes"));
router.use("/public", require("./public.routes"));
router.use("/admin", require("./admin.routes"));

router.use("/ussd", require("./ussd.routes"));
router.use("/tisp", authenticate, require("./tisp.routes"));
router.use("/payment", require("./mpesa.routes"));
router.use("/zoho", authenticate, require("./zoho.routes"));
router.use("/xtream", authenticate, require("./xtream.routes"));

module.exports = router;
