const path = require("path");

const express = require("express");

const adminControllers = require("../controllers/home.js");

const router = express.Router();

router.get("/", adminControllers.getHomePage);

module.exports = router;
