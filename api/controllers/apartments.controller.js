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

async function listApartments(req, res, next) {
  try {
    const {
      buildingId,
      apartmentNumber,
      search,
      occupancy,
      page,
      limit,
      sortBy,
      sortDir,
    } = req.query;
    const result = await store.listApartments({
      buildingId: buildingId ? Number(buildingId) : undefined,
      apartmentNumber,
      search,
      occupancy,
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

async function getApartment(req, res, next) {
  try {
    const buildingId = Number(req.params.buildingId);
    const apartmentNumber = String(req.params.apartmentNumber || "").trim();
    if (!buildingId || !apartmentNumber) {
      return res.status(400).json({
        error: "buildingId and apartmentNumber are required",
      });
    }
    const apartment = await store.getApartment(buildingId, apartmentNumber);
    if (!apartment) {
      return res.status(404).json({ error: "Apartment not found" });
    }
    return res.json({ apartment });
  } catch (err) {
    return next(err);
  }
}

async function getApartmentUnitHistory(req, res, next) {
  try {
    const buildingId = Number(req.params.buildingId);
    const apartmentNumber = String(req.params.apartmentNumber || "").trim();
    if (!buildingId || !apartmentNumber) {
      return res.status(400).json({
        error: "buildingId and apartmentNumber are required",
      });
    }
    const history = await store.getApartmentHistory(buildingId, apartmentNumber);
    return res.json({ history });
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

    const inspection = await store.inspectApartmentForMove(
      buildingId,
      apartmentNumber,
      req.query.excludeCustomerId ? Number(req.query.excludeCustomerId) : null
    );

    return res.json({
      available: inspection.available,
      apartmentKnown: inspection.apartmentKnown,
      lastIp: inspection.lastIp,
      needsIpInput: inspection.needsIpInput,
      ipSetup: inspection.ipSetup,
      tenant: inspection.tenant,
    });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  listApartmentHistoryRecords,
  listApartments,
  getApartment,
  getApartmentUnitHistory,
  checkApartmentOccupancy,
};
