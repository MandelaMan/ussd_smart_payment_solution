const store = require("../services/reportScheduleStore");

async function listReportSchedules(req, res, next) {
  try {
    const schedules = await store.listSchedules();
    return res.json({ schedules });
  } catch (err) {
    return next(err);
  }
}

async function createReportSchedule(req, res, next) {
  try {
    const schedule = await store.createSchedule(req.body || {}, req.user?.id);
    return res.status(201).json({ schedule });
  } catch (err) {
    if (err.message) return res.status(400).json({ error: err.message });
    return next(err);
  }
}

async function updateReportScheduleActive(req, res, next) {
  try {
    const active = req.body?.active !== false;
    const schedule = await store.setScheduleActive(Number(req.params.id), active);
    if (!schedule) return res.status(404).json({ error: "Schedule not found." });
    return res.json({ schedule });
  } catch (err) {
    return next(err);
  }
}

async function deleteReportSchedule(req, res, next) {
  try {
    await store.deleteSchedule(Number(req.params.id));
    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
}

async function runReportSchedule(req, res, next) {
  try {
    const result = await store.runScheduleNow(Number(req.params.id));
    return res.json(result);
  } catch (err) {
    if (err.message) return res.status(400).json({ error: err.message });
    return next(err);
  }
}

async function listReportScheduleRuns(req, res, next) {
  try {
    const runs = await store.listScheduleRuns(Number(req.params.id));
    return res.json({ runs });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  listReportSchedules,
  createReportSchedule,
  updateReportScheduleActive,
  deleteReportSchedule,
  runReportSchedule,
  listReportScheduleRuns,
};
