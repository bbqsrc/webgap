var baseConfig,
    _ = require('underscore');

try {
    baseConfig = require('./config.json')
} catch(e) {
    if (e.code != "MODULE_NOT_FOUND") throw e;
    baseConfig = {};
}

var config = _.defaults(baseConfig, {
    mongoHost: "localhost",
    mongoPort: 27017,
    mongoDB: "stopgap",
    mongoUsername: null,
    mongoPassword: null,
    
    SMTPHost: "localhost",
    SMTPPort: 53,
    SMTPUsername: null,
    SMTPPassword: null,

    dataDir: __dirname + '/data',

    get mongoURL() {
        return "mongodb://" + this.mongoHost + ":" + this.mongoPort + "/" + this.mongoDB;
    }
});

module.exports = Object.freeze(config);
