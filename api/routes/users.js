const express = require("express");
const Users = require("../controllers/UsersController");
const router = express.Router();

router.get("/", Users.list);
router.post("/", Users.create);
router.get("/:id", Users.get);

module.exports = router;
