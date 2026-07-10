const express = require("express");
const { authenticate, requireRole } = require("../middleware/auth");
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
router.use(requireRole("admin", "cfo", "support"));

router.get("/overview", getOverview);
router.get("/jobs", listJobs);
router.get("/jobs/:id", getJob);
router.get("/running", getRunning);
router.post("/:integration/trigger", triggerSync);
router.post("/:integration/retry", retryJob);

module.exports = router;
