var formidable = require('formidable'),
    crypto = require('crypto'),
    MongoClient = require('mongodb').MongoClient,
    LocalStrategy = require('passport-local').Strategy;

exports.middleware = {
    isAuthed: function(req, res, next) {
        if (req.user) {
            return next();
        } else {
            return res.redirect('/login');
        }
    },

    isAdmin: function(mountPoint) {
        mountPoint = mountPoint || '';

        return function(req, res, next) {
            if (req.user) {
                if (req.user.admin) {
                    return next();
                }
                return res.send(403);
            } else {
                return res.redirect(mountPoint + '/login');
            }
        }   
    },

    parseFormData: function(req, res, next) {
        var form = new formidable.IncomingForm();

        form.parse(req, function(err, fields, files) {
            if (err) throw err;

            req.body = fields;
            req.files = files;

            return next();
        });
    }
};

var UserUtil = exports.UserUtil = {
    _iterations: 10000,
    _keylen: 256,

    generatePassword: function(password, callback) {
        crypto.randomBytes(128, function(err, buf) {
            crypto.pbkdf2(password, buf, UserUtil._iterations, UserUtil._keylen, function(err, data) {
                if (err) throw err;

                callback({
                    algorithm: "sha1",
                    salt: buf,
                    iterations: UserUtil._iterations,
                    key: data
                });
            });
        });
    },

    checkPassword: function(attempt, password, callback) {
        var key = password.key,
            salt = password.salt,
            iterations = password.iterations;

        crypto.pbkdf2(attempt, salt, iterations, key.length, function(err, newKey) {
            if (err) throw err;

            // Constant time equality check!
            var i, 
                kl1 = key.length,
                kl2 = newKey.length,
                diff = kl1 ^ kl2;

            for (i = 0; i < kl1 && i < kl2; ++i) {
                diff |= key[i] ^ newKey[i];
            }

            callback(diff === 0);
        });
    }
};

exports.localStrategy = new LocalStrategy(function(username, password, done) {
    MongoClient.connect('mongodb://localhost:27017/stopgap', function(err, db) {
        var users = db.collection('users');
        users.findOne({username: username}, function(err, user) {
            if (err) return done(err);

            if (user == null) {
                return done(null, false, { message: "Invalid password." });
            }

            var dbPassword = {
                key: user.password.key.read(),
                iterations: user.password.iterations,
                salt: user.password.salt.read()
            }

            UserUtil.checkPassword(password, dbPassword, function(success) {
                if (success) {
                    return done(null, {username: username, admin: user.admin});
                } else {
                    return done(null, false, { message: "Invalid password." });
                }
            });
        });
    });
})
