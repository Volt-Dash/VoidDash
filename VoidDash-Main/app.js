"use strict";

const path = require("path");
const fs = require("fs");
const fetch = require("node-fetch");
const chalk = require("chalk");
const axios = require("axios");
const arciotext = require("./misc/afk.js");
const Keyv = require("keyv");
const ejs = require("ejs");
const session = require("express-session");
const express = require("express");
require("express-ws")(express);

global.Buffer = global.Buffer || require("buffer").Buffer;

if (typeof btoa === "undefined") {
  global.btoa = (str) => Buffer.from(str, "binary").toString("base64");
}

if (typeof atob === "undefined") {
  global.atob = (b64Encoded) => Buffer.from(b64Encoded, "base64").toString("binary");
}

const settings = require("./settings.json");
const db = new Keyv(settings.database);

db.on("error", (err) => {
  console.error(chalk.red("Database ― An error occurred when accessing the SQLite database."), err);
});

module.exports.db = db;

const app = express();

app.use(
  session({
    secret: settings.website.secret,
    resave: false,
    saveUninitialized: false,
  })
);

app.use(
  express.json({
    inflate: true,
    limit: "500kb",
    strict: true,
    type: "application/json",
  })
);

const listener = app.listen(settings.website.port, () => {
  console.clear();
  console.log(chalk.white("Application is online at ") + chalk.gray(chalk.underline(settings.api.client.oauth2.link + "/")));
});

const apiFiles = fs.readdirSync("./api").filter((file) => file.endsWith(".js"));
apiFiles.forEach((file) => {
  const apiFile = require(`./api/${file}`);
  apiFile.load(app, db);
});

let cache = false;
app.use((req, res, next) => {
  const rateLimitConfig = JSON.parse(fs.readFileSync("./settings.json")).api.client.ratelimits;
  if (rateLimitConfig[req._parsedUrl.pathname]) {
    if (cache) {
      setTimeout(() => {
        let querystring = Object.entries(req.query)
          .map(([key, value]) => `${key}=${value}`)
          .join("&");
        querystring = `?${querystring}`;
        res.redirect(`${req._parsedUrl.pathname}${querystring}`);
      }, 1000);
      return;
    } else {
      cache = true;
      setTimeout(() => {
        cache = false;
      }, 1000 * rateLimitConfig[req._parsedUrl.pathname]);
    }
  }
  next();
});

app.all("*", async (req, res) => {
  const theme = require("./app.js").get(req);
  const newSettings = JSON.parse(fs.readFileSync("./settings.json"));

  if (newSettings.api.afk.enabled) {
    req.session.arcsessiontoken = Math.random().toString(36).substring(2, 15);
  }

  if (theme.settings.mustbeloggedin.includes(req._parsedUrl.pathname) && (!req.session.userinfo || !req.session.pterodactyl)) {
    return res.redirect(`/login?redirect=${req._parsedUrl.pathname.slice(1)}`);
  }

  if (theme.settings.mustbeadmin.includes(req._parsedUrl.pathname)) {
    return handleAdminPage(req, res, theme);
  }

  await renderPage(req, res, theme);
});

async function handleAdminPage(req, res, theme) {
  ejs.renderFile(
    `./views/${theme.settings.notfound}`,
    await eval(require("./app.js").renderdataeval),
    null,
    async (err, str) => {
      if (err) {
        console.error(err);
        return res.render("500.ejs", { err });
      }

      const userAccount = await fetchUserAccount(req);
      if (userAccount && !userAccount.attributes.root_admin) {
        return res.send(str);
      }

      ejs.renderFile(
        `./views/${theme.settings.pages[req._parsedUrl.pathname.slice(1)] || theme.settings.notfound}`,
        await eval(require("./app.js").renderdataeval),
        null,
        (err, str) => {
          if (err) {
            console.error(err);
            return res.render("500.ejs", { err });
          }
          res.status(200).send(str);
        }
      );
    }
  );
}

async function fetchUserAccount(req) {
  const response = await fetch(
    `${settings.pterodactyl.domain}/api/application/users/${await db.get("users-" + req.session.userinfo.id)}?include=servers`,
    {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${settings.pterodactyl.key}`,
      },
    }
  );
  if (response.statusText === "Not Found") return null;
  return await response.json();
}

async function renderPage(req, res, theme) {
  const data = await eval(require("./app.js").renderdataeval);
  ejs.renderFile(
    `./views/${theme.settings.pages[req._parsedUrl.pathname.slice(1)] || theme.settings.notfound}`,
    data,
    null,
    (err, str) => {
      if (err) {
        console.error(err);
        return res.render("500.ejs", { err });
      }
      res.status(200).send(str);
    }
  );
}

module.exports.get = function (req) {
  const themeSettingsPath = "./views/pages.json";
  const defaultSettings = {
    index: "index.ejs",
    notfound: "index.ejs",
    redirect: {},
    pages: {},
    mustbeloggedin: [],
    mustbeadmin: [],
    variables: {},
  };
  return {
    settings: fs.existsSync(themeSettingsPath)
      ? JSON.parse(fs.readFileSync(themeSettingsPath).toString())
      : defaultSettings,
  };
};

module.exports.islimited = async function () {
  return !cache;
};

module.exports.ratelimits = async function (length) {
  if (cache) return setTimeout(() => indexjs.ratelimits(length), 1);
  cache = true;
  setTimeout(() => {
    cache = false;
  }, length * 1000);
};
