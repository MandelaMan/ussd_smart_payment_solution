const express = require("express");
const { authenticate } = require("../middleware/auth");
const { attachPermissions, requirePermission } = require("../middleware/permissions");
const {
  getOverview,
  listJobs,
  getJob,
  triggerSync,
  retryJob,
  getRunning,
} = require("../controllers/sync.controller");

const router = express.Router();

router.use(authenticate);
router.use(attachPermissions);
router.use(requirePermission("settings.sync", "billing.sync"));

router.get("/overview", getOverview);
router.get("/jobs", listJobs);
router.get("/jobs/:id", getJob);
router.get("/running", getRunning);
router.post("/:integration/trigger", triggerSync);
router.post("/:integration/retry", retryJob);

module.exports = router;
