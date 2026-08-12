const campaignStore = require("../services/campaignStore");
const {
  processReferralRewardMaintenance,
} = require("../services/referralRewardService");

async function listCampaigns(req, res, next) {
  try {
    const status = req.query.status || null;
    const includeMetrics =
      req.query.metrics === "1" || req.query.metrics === "true";
    const campaigns = await campaignStore.listCampaigns({
      status,
      includeMetrics,
    });
    return res.json({ ok: true, campaigns });
  } catch (e) {
    return next(e);
  }
}

async function getActiveCampaign(req, res, next) {
  try {
    const campaigns = await campaignStore.listActiveCampaigns();
    return res.json({
      ok: true,
      campaign: campaigns[0] || null,
      campaigns,
    });
  } catch (e) {
    return next(e);
  }
}

async function getCampaign(req, res, next) {
  try {
    const campaign = await campaignStore.getCampaignById(req.params.id);
    if (!campaign) {
      return res.status(404).json({ error: "Campaign not found" });
    }
    const metrics = await campaignStore.getCampaignMetrics(campaign.id);
    return res.json({ ok: true, campaign: { ...campaign, metrics } });
  } catch (e) {
    return next(e);
  }
}

async function getCampaignMetrics(req, res, next) {
  try {
    const campaign = await campaignStore.getCampaignById(req.params.id);
    if (!campaign) {
      return res.status(404).json({ error: "Campaign not found" });
    }
    const metrics = await campaignStore.getCampaignMetrics(campaign.id);
    return res.json({ ok: true, campaignId: campaign.id, metrics });
  } catch (e) {
    return next(e);
  }
}

async function createCampaign(req, res, next) {
  try {
    const campaign = await campaignStore.createCampaign(req.body || {});
    return res.status(201).json({ ok: true, campaign });
  } catch (e) {
    if (
      /required|Duplicate|ER_DUP|CAMPAIGN_/i.test(e.code || "") ||
      /required|Duplicate|ER_DUP|End date|Start date|dates/i.test(e.message || "")
    ) {
      return res.status(400).json({ error: e.message, code: e.code });
    }
    return next(e);
  }
}

async function updateCampaign(req, res, next) {
  try {
    const campaign = await campaignStore.updateCampaign(
      req.params.id,
      req.body || {}
    );
    if (!campaign) {
      return res.status(404).json({ error: "Campaign not found" });
    }
    return res.json({ ok: true, campaign });
  } catch (e) {
    if (
      /required|CAMPAIGN_/i.test(e.code || "") ||
      /required|End date|Start date|dates/i.test(e.message || "")
    ) {
      return res.status(400).json({ error: e.message, code: e.code });
    }
    return next(e);
  }
}

async function deleteCampaign(req, res, next) {
  try {
    const campaign = await campaignStore.deleteCampaign(req.params.id);
    if (!campaign) {
      return res.status(404).json({ error: "Campaign not found" });
    }
    return res.json({ ok: true, campaign });
  } catch (e) {
    if (e.code === "CAMPAIGN_HAS_HISTORY") {
      return res.status(409).json({ error: e.message, code: e.code });
    }
    return next(e);
  }
}

async function runReferralMaintenance(req, res, next) {
  try {
    const result = await processReferralRewardMaintenance({
      limit: Number(req.body?.limit) || 50,
    });
    return res.json(result);
  } catch (e) {
    return next(e);
  }
}

module.exports = {
  listCampaigns,
  getActiveCampaign,
  getCampaign,
  getCampaignMetrics,
  createCampaign,
  updateCampaign,
  deleteCampaign,
  runReferralMaintenance,
};
