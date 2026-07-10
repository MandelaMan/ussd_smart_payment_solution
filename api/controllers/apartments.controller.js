const store = require("../services/customerModuleStore");

async function listApartmentHistoryRecords(req, res, next) {
  try {
    const { buildingId, apartmentNumber, search, currentOnly, page, limit, sortBy, sortDir } =
      req.query;
    const result = await store.listApartmentHistory({
      buildingId: buildingId ? Number(buildingId) : undefined,
      apartmentNumber,
      search,
      currentOnly,
      page,
      limit,
      sortBy,
      sortDir,
    });
    return res.json(result);
  } catch (err) {
    return next(err);
  }
}

async function checkApartmentOccupancy(req, res, next) {
  try {
    const buildingId = Number(req.query.buildingId);
    const apartmentNumber = String(req.query.apartmentNumber || "").trim();
    if (!buildingId || !apartmentNumber) {
      return res.status(400).json({
        error: "buildingId and apartmentNumber are required",
      });
    }

    const tenant = await store.findActiveTenantInApartment(
      buildingId,
      apartmentNumber,
      req.query.excludeCustomerId ? Number(req.query.excludeCustomerId) : null
    );

    if (!tenant) {
      return res.json({ available: true, tenant: null });
    }

    const tenantName = [
      tenant.first_name,
      tenant.middle_name,
      tenant.last_name,
    ]
      .filter(Boolean)
      .join(" ");

    return res.json({
      available: false,
      tenant: {
        id: tenant.id,
        customerNumber: tenant.customer_number,
        customerName: tenantName,
        apartmentNumber: tenant.apartment_number,
      },
    });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  listApartmentHistoryRecords,
  checkApartmentOccupancy,
};
