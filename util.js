"use strict";

var formidable = require('formidable'),
    async = require('async'),
    crypto = require('crypto'),
    uuid = require('uuid'),
    mongodb = require('mongodb'),
    cheerio = require('cheerio'),
    moment = require('moment'),
    zlib = require('zlib'),
    tar = require('tar'),
    mkdirp = require('mkdirp'),
    fs = require('fs'),
    path = require('path'),
    schedule = require('node-schedule'),
    MongoClient = mongodb.MongoClient,
    LocalStrategy = require('passport-local').Strategy,
    scheduler = require('./scheduler'),
    config = require('./config'),
    util = {},
    MAX_UINT32 = Math.pow(2, 32) - 1;

exports.fromMongo = function(obj) {
    // TODO: generic handler for mongo objects that does what we want.
    // eg handling UUIDs automatically, handling dates, etc
};

exports.crypto = util.crypto = {
    shuffle: function(list) {
        // TODO: Fisher-Yates with strong RNG
        // Unbiased range of numbers as well
    },

    randomInsert: function(list, item) {
        // Fisher-Yates insertion!
        list.splice(util.crypto.range(0, list.length), 0, item);
        return list;
    },

    range: function(min, max) {
        var n = max - min + 1,
            remainder = MAX_UINT32 % n,
            x;

        do {
            x = crypto.randomBytes(4).readUInt32LE(0);
        } while (x >= MAX_UINT32 - remainder);

        return min + x % n;
    },

    testRange: function(iterations, min, max) {
        var i, ii, c = {};

        for (i = min; i <= max; ++i) {
            c[i] = 0;
        }

        for (i = 0; i < iterations; ++i) {
            c[util.crypto.range(min, max)]++;
        }

        return c;
    }
}

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

exports.startScheduler = function() {
    MongoClient.connect(config.mongoURL, function(err, db) {
        if (err) throw err;

        var elections = db.collection('elections');

        elections.find({ endTime: { $gte: new Date }}).each(function(err, item) {
            if (err) throw err;

            if (item == null) {
                return;
            }
            
            scheduler.add(item.startTime, function() {
                console.log("- Sending emails for " + item.slug);
                util.elections.sendEmails(item.slug);
            });

            scheduler.add(item.endTime, function() {
                // Do something here?
                console.log(item.slug + " has ended.");
            });
        });
    });
};

util.path = exports.path = {
    data: function() {
        var joinedPath = path.join(config.dataDir, path.join.apply(null, arguments));

        if (joinedPath.substring(0, config.dataDir.length) != config.dataDir) {
            throw Error("This path is dodgy.");
        }

        console.log(joinedPath);
        return joinedPath;
    }
}

util.mongo = {
    collection: function(collection, callback) {
        MongoClient.connect(config.mongoURL, function(err, db) {
            if (err) return callback(err, null);

            var coll = db.collection(collection);
            callback(null, coll);
        });
    }
};

util.elections = exports.elections = {
    render: function(slug, res) {
        var dir = util.path.data(slug);

        res.sendfile("index.html", { root: dir });
    },

    renderStatic: function(req, res) {
        var dir = util.path.data(req.params.slug, "static");

        if (!req.params[0]) res.send(403, 'bad.');

        res.sendfile(req.params[0], { root: dir });
    },

    find: function(slug, callback) {
        util.mongo.collection('elections', function(err, elections) {
            if (err) return callback(err, null);

            elections.findOne({ slug: slug }, function(err, item) {
                return callback(err, item);
            });
        });
    },
    
    sendEmails: function(slug) {
        util.mongo.collection('elections', function(err, elections) {
            if (err) throw err;

            elections.findOne({slug: slug}, function(err, election) {
                if (err) throw err;

                var len = election.tokens.length;

                async.eachSeries(election.participants, function(r, done) {
                    var token;
                    
                    if (r.sent) return done();

                    token = util.uuid.toMongo();
                    
                    console.log("Emailing: " + r.email);
                    
                    // XXX: send code goes here
                    
                    // Safely insert token and toggle sent trigger.
                    elections.update({
                        slug: slug,
                        "participants.email": r.email
                    }, {
                        $set: { "participants.$.sent": true },
                        $push: { tokens: {
                            $each: [token],
                            $position: util.crypto.range(0, len++)
                        }}
                    }, {w:1}, function(err) {
                        if (err) throw err;
                        return done();
                    });

                }, function(err) {
                    if (err) throw err;
                    console.log("- All emails sent for " + slug);
                });
            });
        });
    },

    checkParams: function(slug, id, callback) {
        MongoClient.connect(config.mongoURL, function(err, db) {
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

    addBaseTag: function(slug, callback) {
        var path = util.path.data(slug, 'index.html');

        fs.readFile(path, { encoding: 'utf-8' }, function(err, file) {
            if (err) callback(err);
            
            var $ = cheerio.load(file, { decodeEntities: false }),
                base = $("base"),
                href = "/" + slug  + "/static/";
            
            if (base.length) {
                base.attr('href', href);
            } else {
                $("head").prepend("<base href='" + href + "'>");
            }

            fs.writeFile(path, $.html(), function(err) {
                callback(err || null);
            });
        });
    },

    storeElectionFiles: function(slug, zipFile, callback) {
        // Let's get out the relevant files!
        var path = util.path.data(slug);

        mkdirp(path, function(err) {
            if (err) callback(err);

            var fileStream = fs.createReadStream(zipFile.path);

            fileStream.pipe(zlib.createUnzip()).pipe(tar.Extract({
                path: path
            })).on('error', function(err) {
                callback(err);
            }).on("end", function() {
                util.elections.addBaseTag(slug, callback);
            });
        });
    },

    getElection: function(slug, callback) {
        MongoClient.connect(config.mongoURL, function(err, db) {
            if (err) return callback(err, null);
            
            var elections = db.collection('elections');
            elections.findOne({slug: slug}, function(err, election) {
                if (err) callback(err, null);

                callback(null, election);
            });
        });
    },

    // TODO
    removeElection: function() {},

    createElection: function(req, res, fields, files) {
        MongoClient.connect(config.mongoURL, function(err, db) {
            if (err) return callback(err, null);
            
            var slug = fields.slug;
            var elections = db.collection('elections');
            var ballots = db.collection('ballots');

            elections.findOne({slug: slug}, function(err, election) {
                if (err) callback(err, null);

                if (election != null) {
                    res.send(400, "already exists!");
                    return;
                }
                
                var startTime = moment(fields.startDate + "T" + fields.startTime + ":00.000Z").toDate(),
                    endTime = moment(fields.endDate + "T" + fields.endTime + ":00.000Z").toDate(),
                    o, i, ii, emails;

                o = {
                    slug: slug,
                    title: fields.title,
                    email: {
                        from: fields.emailFrom,
                        subject: fields.emailSubject,
                        content: fields.emailBody
                    },
                    participants: [],
                    tokens: [],
                    startTime: startTime,
                    endTime: endTime,
                    testToken: util.uuid.toMongo()
                };

                emails = fields.emailRecipients.replace(/\r/g, '').split('\n');
                for (i = 0, ii = emails.length; i < ii; ++i) {
                    o.participants.push({ email: emails[i].trim(), sent: false }); 
                }

                util.elections.storeElectionFiles(slug, files.tgzFile, function(err) {
                    if (err) throw err;                                
                    
                    elections.insert(o, {w:1}, function(err) {
                        if (err) throw err;

                        scheduler.add(o.startTime, function() {
                            util.elections.sendEmails(slug);
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
    MongoClient.connect(config.mongoURL, function(err, db) {
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
