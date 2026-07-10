const store = require("../services/packageCatalogStore");

async function getPackageCatalog(req, res, next) {
  try {
    const categories = await store.listPackageCatalog();
    return res.json({ categories });
  } catch (err) {
    return next(err);
  }
}

module.exports = { getPackageCatalog };
