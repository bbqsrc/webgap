var baseConfig,
    crypto = require('crypto'),
    _ = require('underscore');

try {
    baseConfig = require('./config.json')
} catch(e) {
    if (e.code != "MODULE_NOT_FOUND") throw e;
    baseConfig = {};
}

var config = _.defaults(baseConfig, {
    production: false,
    host: "localhost",
    port: 3001,

    mongoHost: "localhost",
    mongoPort: 27017,
    mongoDB: "stopgap",
    mongoUsername: null,
    mongoPassword: null,
   
    mailerTransport: "sendmail",
    mailerConfig: {},

    cookieSecret: crypto.randomBytes(64).toString(),
    cookieName: "stopgap.id",
    cookieMaxAge: 900000,

    dataDir: __dirname + '/data',
    countgapPath: null,

    get mongoURL() {
        return "mongodb://" + this.mongoHost + ":" + this.mongoPort + "/" + this.mongoDB;
    }
});

module.exports = Object.freeze(config);
