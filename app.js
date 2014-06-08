"use strict";

var express = require('express'),
    passport = require('passport'),
    crypto = require('crypto'),
    LocalStrategy = require('passport-local').Strategy,
    MongoClient = require('mongodb').MongoClient,
    app = express();

app.set('views', __dirname + '/views');
app.set('view engine', 'jade');

app.use(express.static(__dirname + '/public'));
app.use(require('body-parser')());
app.use(require('cookie-parser')());
app.use(require('connect-flash')());
app.use(require('express-session')({ secret: 'such webgap oh my' }));
app.use(passport.initialize());
app.use(passport.session());

passport.use(new LocalStrategy(
    function(username, password, done) {
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
    }
));

passport.serializeUser(function(user, done) {
    done(null, user);
});

passport.deserializeUser(function(user, done) {
    done(null, user);
});

function isAuthed(req, res, next) {
    if (req.user) {
        return next();
    } else {
        return res.redirect('/login');
    }
}

function isAdmin(req, res, next) {
    if (req.user) {
        if (req.user.admin) {
            return next();
        }
        return res.send(403);
    } else {
        return res.redirect('/login');
    }
}

var UserUtil = {
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

app.get('/', isAdmin, function(req, res) {
    res.render('index', { title: "Index" }); 
});

app.get('/elections', isAdmin, function(req, res) {

    MongoClient.connect('mongodb://localhost:27017/stopgap', function(err, db) {
        if (err) throw err;
        
        var parsed = [];
        var elections = db.collection('elections');
        var ballots = db.collection('ballots');
        
        elections.find().each(function(err, doc) {
            if (err) throw err;

            if (doc == null) {
                res.render('elections', { title: "All Elections", elections: parsed });
                return;
            }

            if (doc.tokens == null) {
                return;
            }
            
            parsed.push({
                slug: doc.slug,
                title: doc.title || doc.slug,
                tokens: doc.tokens.length,
                startTime: doc.startTime,
                endTime: doc.endTime
            });
        });
    });
});

app.get("/elections/create", isAdmin, function(req, res) {
    res.render('create-election', { title: "Create Election" });
});

app.get("/election/:slug", isAdmin, function(req, res) {
    var slug = req.params.slug;

    res.render('election', { title: "TODO: set the title", slug: slug });
});

app.get("/ballots/:slug", isAdmin, function(req, res) {
    var slug = req.params.slug;
    
    MongoClient.connect('mongodb://localhost:27017/stopgap', function(err, db) {
        if (err) throw err;

        var elections = db.collection('elections'),
            ballots = db.collection('ballots');

        elections.findOne({slug: slug}, function(err, item) {
            if (err) throw err;
            
            ballots.find({election_id: item._id}).toArray(function(err, data) {
                if (err) throw err;
                res.render('ballots', { ballots: data, count: data.length });
            });
        });
    });
});

app.route("/login")
.get(function(req, res) {
    res.render('create-account', {
        title: "Login",
        submit: "Sign in"
    });
})
.post(passport.authenticate('local', {
    successRedirect: '/',
    failureRedirect: '/login',
    failureFlash: true
}));

app.get('/logout', function(req, res) {
    req.logout();
    res.redirect('/login');
});

app.route('/create-account')
.get(function(req, res) {
    if (req.user && req.user.admin) {
        res.render('create-account', {
            'flash': req.flash(),
            title: "Create Account",
            submit: "Create Account"
        });
    } else { 
        MongoClient.connect('mongodb://localhost:27017/stopgap', function(err, db) {
            if (err) throw err;

            var users = db.collection('users');

            users.findOne({admin: true}, function(err, item) {
                if (err) throw err;
                
                if (item == null) {
                    res.render('create-account', {
                        'flash': "No auth due to first admin account!",
                        title: "Create Account",
                        submit: "Create Account"
                    });
                } else {
                    res.redirect('/login');
                }
            });
        });
    }
})
.post(function(req, res) {
    if (req.user && req.user.admin) {
        if (!req.body.username || !req.body.password) {
            res.send(400, "You broke it.");
        }
        
        MongoClient.connect('mongodb://localhost:27017/stopgap', function(err, db) {
            if (err) throw err;

            var users = db.collection('users');
            // Check for username existing
            users.findOne({username: req.body.username}, function(err, item) {
                if (err) throw err;
                
                if (item != null) {
                    res.render('create-account', {
                        flash: "Account already exists.",
                        title: "Create Account",
                        submit: "Create Account"
                    });
                }

                UserUtil.generatePassword(req.body.password, function(password) {
                    users.insert({username: req.body.username,
                                  password: password,
                                  admin: true}, function(err) {
                        if (err) throw err;

                        res.redirect('/login');
                    })
                });
            });
        });
    } else {
        MongoClient.connect('mongodb://localhost:27017/stopgap', function(err, db) {
            if (err) throw err;

            var users = db.collection('users');

            users.findOne({admin: true}, function(err, item) {
                if (err) throw err;
                
                if (item != null) {
                    res.redirect('/login');
                }

                // Check for username existing
                users.findOne({username: req.body.username}, function(err, item) {
                    if (err) throw err;
                    
                    if (item != null) {
                        res.render('create-account', {
                            flash: "Account already exists.",
                            title: "Create Account",
                            submit: "Create Account"
                        });
                    }

                    UserUtil.generatePassword(req.body.password, function(password) {
                        users.insert({username: req.body.username,
                                      password: password,
                                      admin: true}, {w:1}, function(err) {
                            if (err) throw err;

                            res.redirect('/login');
                        })
                    });
                });
            });
        });
    }
});

var server = app.listen(3001, function() {
    console.log('Listening on port %d', server.address().port);
});

