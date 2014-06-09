"use strict";

var formidable = require('formidable'),
    crypto = require('crypto'),
    uuid = require('uuid'),
    mongodb = require('mongodb'),
    moment = require('moment'),
    zlib = require('zlib'),
    tar = require('tar'),
    mkdirp = require('mkdirp'),
    fs = require('fs'),
    schedule = require('node-schedule'),
    MongoClient = mongodb.MongoClient,
    LocalStrategy = require('passport-local').Strategy,
    scheduler = require('./scheduler').scheduler;

var util = {};

util.uuid = exports.uuid = {
    toMongo: function(data) {
        var buffer = data ? uuid.parse(data) : new Buffer(16);
        
        if (!data) uuid.v4(null, buffer);

        return mongodb.Binary(buffer, 4);
    },

    fromMongo: function(obj) {
        return uuid.unparse(obj.read(0, 16));
    },

    addDashes: function(str) {
        if (str.length != 32) {
            throw TypeError('str must be 32 chars');
        }

        return str.substring(0, 8) + '-' +
               str.substring(8, 12) + '-' +
               str.substring(12, 16) + '-' +
               str.substring(16, 20) + '-' +
               str.substring(20);
    },

    stripDashes: function(str) {
        return str.replace(/-/g, '');
    }
};

util.elections = exports.elections = {
    sendEmails: function(election, callback) {
        // TODO: implement sending

        election.participants.forEach(function(r) {
            if (!r.sent) {
                console.log("Emailing: " + r.email);
            }
        });
    },

    checkParams: function(slug, id, callback) {
        MongoClient.connect('mongodb://localhost:27017/stopgap', function(err, db) {
            if (err) return callback(err, null);

            var elections = db.collection('elections');
            var ballots = db.collection('ballots');

            elections.findOne({slug: slug}, function(err, election) {
                if (err) return callback(err, null);

                if (election == null) {
                    return callback(new Error('No election found.'), null);
                }

                var time = Date.now();

                if (election.startTime == null || election.startTime < time) {
                    return callback(new Error('Election has not begun yet.'), null);
                }

                if (election.endTime != null && election.endTime < time) {
                    return callback(new Error('Election has ended.'), null);
                }

                var token = util.uuid.toMongo(id);
                
                if (!(token in election.tokens)) {
                    return callback(new Error('Invalid token.'), null);
                }

                ballots.findOne({election_id: election._id, token: token}, function(err, ballot) {
                    if (err) return callback(err, null);

                    if (ballot != null) {
                        return callback(new Error('A ballot has already been submitted."'), null);
                    }

                    return callback(null, { election: election, token: token }); 
                });

            });
        });
    },

    storeElectionFiles: function(slug, zipFile, callback) {
        // TODO less hardcoded paths

        // Let's get out the relevant files!
        var path = __dirname + '/data/' + slug;
        mkdirp(path, function(err) {
            if (err) callback(err);

            var fileStream = fs.createReadStream(zipFile.path);

            fileStream.pipe(zlib.createUnzip()).pipe(tar.Extract({
                path: path
            })).on('error', function(err) {
                callback(err);
            }).on("end", function() {
                callback(null);
            });
        });
    },

    getElection: function(slug, callback) {
        MongoClient.connect('mongodb://localhost:27017/stopgap', function(err, db) {
            if (err) return callback(err, null);
            
            var elections = db.collection('elections');
            elections.findOne({slug: slug}, function(err, election) {
                if (err) callback(err, null);

                callback(null, election);
            });
        });
    },

    createElection: function(req, res, fields, files) {
        MongoClient.connect('mongodb://localhost:27017/stopgap', function(err, db) {
            if (err) return callback(err, null);
            
            var elections = db.collection('elections');
            var ballots = db.collection('ballots');

            elections.findOne({slug: fields.slug}, function(err, election) {
                if (err) callback(err, null);

                if (election != null) {
                    res.send(400, "already exists!");
                    return;
                }
                
                var startTime = moment(fields.startDate + "T" + fields.startTime).toDate(),
                    endTime = moment(fields.endDate + "T" + fields.endTime).toDate(),
                    o, i, ii, emails;

                o = {
                    slug: fields.slug,
                    title: fields.title,
                    email: {
                        from: fields.emailFrom,
                        subject: fields.emailSubject,
                        content: fields.emailBody
                    },
                    participants: [],
                    tokens: [],
                    startTime: startTime,
                    endTime: endTime
                };

                emails = fields.emailRecipients.replace(/\r/g, '').split('\n');
                for (i = 0, ii = emails.length; i < ii; ++i) {
                    o.participants.push({ email: emails[i].trim(), sent: false }); 
                }

                util.elections.storeElectionFiles(o.slug, files.tgzFile, function(err) {
                    if (err) throw err;                                
                    elections.insert(o, {w:1}, function(err) {
                        if (err) throw err;

                        scheduler.add(o.startTime, function() {
                            util.elections.sendEmails(o);
                        });
                        res.redirect('/admin/election/' + o.slug);
                    });
                });
            });
        });
    }
};

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
