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
    spawn = require('child_process').spawn,
    schedule = require('node-schedule'),
    nodemailer = require('nodemailer'),
    MongoClient = mongodb.MongoClient,
    LocalStrategy = require('passport-local').Strategy,
    scheduler = require('./scheduler'),
    config = require('./config'),
    util = {},
    MAX_UINT32 = Math.pow(2, 32) - 1;

function newError(message, name) {
    var err = new Error(message);
    err.type = name;
    return err;
}

exports.fromMongo = function(obj) {
    // TODO: generic handler for mongo objects that does what we want.
    // eg handling UUIDs automatically, handling dates, etc
};

util.Counter = exports.Counter = function() {
    this._data = {};
};

exports.Counter.prototype = {
    inc: function(key, x) {
        x = x || 1;
        this._data[key] == null ? 
            this._data[key] = x : 
            this._data[key] += x;

        return this._data[key];
    },

    dec: function(key, x) {
        return this.inc(key, -x|0);
    },

    get: function(key) {
        var v = this._data[key];
        return v == null ? 0 : v;
    }
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
        var buffer = new Buffer(data ? uuid.parse(data) : 16);
        
        if (!data) uuid.v4(null, buffer);

        return mongodb.Binary(buffer, 4);
    },

    fromMongo: function(obj) {
        return util.uuid.stripDashes(uuid.unparse(obj.read(0, 16)));
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

util.participantGroups = exports.participantGroups = {
    create: function(name, emails, callback) {
        util.mongo.collection('participants', function(err, participants) {
            if (err) { return callback(err); }
            
            participants.findOne({name: name}, function(err, alreadyHas) {
                if (err) { return callback(err); }

                if (alreadyHas) { callback(new Error("Duplicate entry.")) }
                
                participants.insert({
                    name: name,
                    emails: emails
                }, {w:1}, function(err) {
                    return callback(err);
                });
            });
        });
    },

    all: function(callback) {
        util.mongo.collection('participants', function(err, participants) {
            if (err) { return callback(err); }
            
            participants.find({}, function(err, all) {
                if (err) { return callback(err); }
                         
                all.toArray(function(err, data) {
                    if (err) { return callback(err); }
                    
                    callback(null, data);
                });
            })
        });
    },

    find: function(query, callback) {
        util.mongo.collection('participants', function(err, participants) {
            if (err) return callback(err);

            return participants.find(query, callback);
        });
    }
};

util.results = exports.results = {
    get: function(slug, callback) {
        util.mongo.collection('results', function(err, results) {
            if (err) return callback(err);

            results.findOne({slug: slug}, function(err, record) {
                if (err) return callback(err);

                return callback(null, record);
            });
        });
    },

    countMotions: function(slug, callback) {
        util.elections.getBallots(slug, function(err, ballots) {
            var data = "= Motions =\n\n",
                items,
                counter = new util.Counter;

            ballots.each(function(err, ballot) {
                if (err) return callback(err);

                if (ballot == null) { // Done!
                    items.forEach(function(key) {
                        var ayes = counter.get(key + "aye"),
                            nays = counter.get(key + "nay"),
                            abstains = counter.get(key + "abstain"),
                            total = ayes + nays,
                            absoluteTotal = ayes + nays + abstains,
                            majorityReq = ((total / 2) | 0) + 1,
                            twoThirdsReq = ((total / 3 * 2) | 0) + 1,
                            ayePercent = (ayes / total * 100).toFixed(2);

                        data += "== " + key + " ==\n" +
                                "Ayes: " + ayes + " (" + ayePercent + "%) " +
                                "Nays: " + nays + " " +
                                "Abstains: " + abstains + "\n" +
                                "Ayes + Nays: " + total + "\n" +
                                "Simple Majority: " + (ayes >= majorityReq) + "\n" +
                                "Two-thirds Majority: " + (ayes >= twoThirdsReq) + "\n" +
                                "\n";
                    });

                    return callback(err, data);
                }

                if (!ballot.ballot.motions) {
                    // TODO this is an error case, log it
                    return; // continue
                }
                
                if (items == null) {
                    items = Object.keys(ballot.ballot.motions);
                }

                items.forEach(function(key) {
                    var v = ballot.ballot.motions[key];

                    if (v == null) {
                        return; // TODO: this is an error case
                    }

                    v = v.toLowerCase();

                    // Compatibility with old data
                    if (v == "yes") { v = "aye" }
                    if (v == "no") { v = "nay" }

                    counter.inc(key + v.toLowerCase());
                });
            });
        });
    },

    generate: function(slug, callback) {
        // TODO: store a list of subelections on the election itself.
        // TODO: store a list of candidates there too.
        if (config.countgapPath == null) {
            return callback(newError("The result counting software has not yet been configured.", 
                                     "ELECTION"));
        }

        // TODO: this is a quick hack so we can finish Piratecon2014.
        // - Ideally, we can handle different counting methods, outputs etc
        // - We should look at a standard schema for defining elections going forward.
        util.mongo.collection('results', function(err, results) {
            if (err) return callback(err);
       
            util.elections.getElection(slug, function(err, election) {
                if (err) return callback(err);

                if (election == null) {
                    return callback(newError("No election found.", "ELECTION"));
                }

                util.results.countMotions(slug, function(err, data) {
    
                    results.update({slug: slug}, {
                        slug: slug,
                        isComplete: false
                    }, {w: 1, upsert: true}, function(err) {
                        var proc = spawn('python', [config.countgapPath, slug]);

                        data += "= Elections =\n";

                        proc.stdout.on('data', function(chunk) {
                            data += chunk;
                        });

                        proc.on('close', function(code) {
                            callback(code == 0 ? null : 
                                     newError("Result counting failed. Code: " + code),
                                              data);
                        });
                    });
                });
                // Count motions!

            });
        });
    },

    add: function(slug, data, callback) {
        // Do an upsert.
        util.mongo.collection('results', function(err, results) {
            if (err) return callback(err);

            results.update({slug: slug}, {
                $set: { data: data, isComplete: true }
            }, {w: 1, upsert: true}, function(err) {
                return callback(err);
            });
        });
    }
}

util.elections = exports.elections = {
    render: function(slug, res) {
        var dir = util.path.data(slug);

        res.sendfile("index.html", { root: dir });
    },

    renderSuccess: function(slug, res) {
        var dir = util.path.data(slug);

        res.sendfile("success.html", { root: dir });
    },

    renderStatic: function(req, res) {
        var dir = util.path.data(req.params.slug, "static");

        if (!req.params[0]) res.send(403, 'bad.');

        res.sendfile(req.params[0], { root: dir }, function(err) {
            if (err) {
                res.status(404).end();
            }
        });
    },

    find: function(slug, callback) {
        util.mongo.collection('elections', function(err, elections) {
            if (err) return callback(err, null);

            elections.findOne({ slug: slug }, function(err, item) {
                return callback(err, item);
            });
        });
    },

    getBallots: function(slug, callback) {
        MongoClient.connect(config.mongoURL, function(err, db) {
            if (err) return callback(err, null);

            var elections = db.collection('elections'),
                ballots = db.collection('ballots');

            elections.findOne({slug: slug}, function(err, election) {
                if (err) return callback(err, null);

                if (election == null) {
                    return callback(null, null);
                }

                return callback(null, ballots.find({election_id: election._id}))
            });
        });
    },
    
    sendEmails: function(slug) {
        util.mongo.collection('elections', function(err, elections) {
            if (err) throw err;

            elections.findOne({slug: slug}, function(err, election) {
                if (err) throw err;

                var len = election.tokens.length,
                    mailer = nodemailer.createTransport(config.mailerTransport(
                                                        config.mailerConfig));

                async.eachSeries(election.participants, function(r, done) {
                    var token;
                    
                    if (r.sent) return done();

                    token = util.uuid.toMongo();
                    
                    console.log("Emailing: " + r.email);
                    
                    mailer.sendMail({
                        from: election.email.from,
                        to: r.email,
                        subject: election.email.subject,
                        text: election.email.content.replace("{url}",
                                                             "https://" +
                                                             config.host + "/" +
                                                             slug + "/" + 
                                                             util.uuid.fromMongo(token))
                    }, function(err, resp) {
                        if (err) {
                            console.error("Error emailing '" + r.email + "'!");
                            console.error(err.stack);
                            
                            // Don't do anything, basically rollback.
                            return done();
                        }

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
                    });

                }, function(err) {
                    mailer.close();
                    if (err) return console.error(err.stack);
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
                    return callback(newError('No election found.', 'ELECTION'), null);
                }

                var time = Date.now();

                // Election should continue unless it hasn't started or there is no start time.
                if (election.startTime == null || +election.startTime > time) {
                    return callback(newError('Election has not begun yet.', 'ELECTION'), null);
                }

                // Election should continue if endTime is null or time limit hasn't been met
                if (election.endTime != null && +election.endTime < time) {
                    return callback(newError('Election has ended.', 'ELECTION'), null);
                }

                var token = util.uuid.toMongo(id);
                elections.findOne({slug: slug, tokens: token}, function(err, hasToken) {
                    if (err) return callback(err, null);

                    // This is purposely checked after the elections begin and end to limit the
                    // potential to bruteforce a token successfully (even though it's impossible*)
                    if (!hasToken && id != util.uuid.fromMongo(election.testToken)) {
                        return callback(newError('Invalid token.', 'ELECTION'), null);
                    }
                    
                    ballots.findOne({election_id: election._id, token: token}, function(err, ballot) {
                        if (err) return callback(err, null);

                        if (ballot != null) {
                            return callback(newError('A ballot has already been submitted.', 'ELECTION'), null);
                        }

                        return callback(null, { election: election, token: token }); 
                    });
                });
            });
        });
    },

    addBaseTag: function(slug, fn, callback) {
        var path = util.path.data(slug, fn);

        fs.readFile(path, { encoding: 'utf-8' }, function(err, file) {
            if (err) callback(err);
            
            var $ = cheerio.load(file, { decodeEntities: false }),
                base = $("base"),
                href = "/" + slug  + "/static/";
            
            if (base.length) {
                base.attr('href', href);
            } else {
                $("head").prepend("<base href='" + href + "' target='_blank'>");
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
                util.elections.addBaseTag(slug, 'index.html', function() {
                    util.elections.addBaseTag(slug, 'success.html', callback);
                });
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

    insertBallot: function(ballot, callback) {
        MongoClient.connect(config.mongoURL, function(err, db) {
            if (err) return callback(err);

            var elections = db.collection('elections');
            var ballots = db.collection('ballots');

            // Check that token exists in election
            elections.findOne({_id: ballot.election_id, tokens: ballot.token}, function(err, election) {
                if (err) return callback(err);
                
                if (election == null) {
                    return callback(newError("Specified token is not valid " +
                                             "for specified election.", "ELECTION"));
                } else {
                    // Check that a ballot doesn't already exist
                    ballots.findOne({election_id: ballot.election_id,
                                    token: ballot.token}, function(err, ballotAlreadyExists) {
                        if (err) return callback(err, null);

                        if (!ballotAlreadyExists) {
                            ballots.insert(ballot, {w:1}, function(err) {
                                if (err) return callback(err);
                                
                                return callback(null);
                            });
                        } else {
                            return callback(newError("A ballot has already been submitted for this token.", "ELECTION"));
                        }
                    });
                    
                }
            });
        });
    },

    getResults: function(slug, callback) {
        util.elections.getElection(slug, function(err, election) {
            if (err) return callback(err);

            if (election == null) {
                return callback(newError("No election found.", "ELECTION"));
            }

            if (+election.endTime <= +Date.now()) {
                util.results.get(slug, function(err, record) {
                    if (err) return callback(err);

                    // No record? Trigger generation.
                    if (record == null) {
                        util.results.generate(slug, function(err, data) {
                            if (err || !data) {
                                console.error("Results for '" + slug + "' generation failed.");
                                console.error(err);
                                return;
                            }

                            util.results.add(slug, data, function(err) {
                                if (err || !data) {
                                    console.error("Results for '" + slug + "' generation failed.");
                                    console.error(err);
                                    return;
                                }

                                console.log("Results for '" + slug + "' added successfully.");
                                return;
                            });
                        });
                    }

                    if (record == null || record.isComplete != true) {
                        // Means they are still generating.
                        return callback(newError("Results still being generated.", "RESULTS"));
                    }

                    return callback(err, record);
                });
            }

            return callback(newError("Election has not ended yet!", "ELECTION")); 
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
                
                var dateFormat = "YYYY-MM-DDhh:mmZ",
                    timezone = (parseInt(fields.timezone, 10) >= 0 ? "+" : "-") + fields.timezone,
                    startTime = moment(fields.startDate + fields.startTime + 
                                       timezone, dateFormat).toDate(),
                    endTime = moment(fields.endDate + fields.endTime + 
                                     timezone, dateFormat).toDate(),
                    participants = fields.participants,
                    o, i, ii, emails;
                    
                if (typeof participants == "string") {
                    participants = [participants];
                }

                o = {
                    slug: slug,
                    title: fields.title,
                    type: "election", // TODO: introduce type survey
                    isPublic: !!fields.isPublic,
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

                //XXX: we should probably validate ballot content to ensure it is accurate
                // at some point. 

                util.mongo.collection('participants', function(err, p) {
                    if (err) return callback(err);

                    p.find({name: { $in: participants }}).each(function(err, data) {
                        if (err) return res.end(err);
                        
                        if (data == null) { // Done!
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
                        } else {
                            data.emails.forEach(function(em) {
                                o.participants.push({ email: em, sent: false });
                            });
                        }
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
                return res.redirect(mountPoint + '/login?r=' + encodeURIComponent(req.originalUrl));
            }
        }   
    },

    parseFormData: function(req, res, next) {
        var form = new formidable.IncomingForm(),
            fields = Object.create(null),
            files = Object.create(null);

        // Bug in the library means we had to manually do this.
        // It doesn't support select:multiple !
        form.on('field', function(name, value) {
            if (typeof fields[name] == "string") {
                fields[name] = [fields[name]];
            }

            if (Array.isArray(fields[name])) {
                fields[name].push(value);
            } else {
                fields[name] = value;
            }
        }).on('file', function(name, file) {
            if (this.multiples) {
                if (files[name]) {
                    if (!Array.isArray(files[name])) {
                        files[name] = [files[name]];
                    }
                    files[name].push(file);
                } else {
                    files[name] = file;
                }
            } else {
                files[name] = file;
            }
        }).on('error', function(err) {
            return res.send(500);
        }).on('end', function() {
            req.body = fields;
            req.files = files;

            return next();
        });
        
        form.parse(req);
    }
};

var UserUtil = exports.UserUtil = {
    _iterations: 10000,
    _keylen: 256,

    generatePassword: function(password, callback) {
        crypto.randomBytes(128, function(err, buf) {
            crypto.pbkdf2(password, buf, UserUtil._iterations, UserUtil._keylen, function(err, data) {
                if (err) throw err;

                callback(null, {
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

            callback(err, diff === 0);
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
                key: user.password.key.read(0),
                iterations: user.password.iterations,
                salt: user.password.salt.read(0)
            }

            UserUtil.checkPassword(password, dbPassword, function(err, success) {
                if (success) {
                    return done(null, {username: username, admin: user.admin});
                } else {
                    return done(null, false, { message: "Invalid password." });
                }
            });
        });
    });
})
