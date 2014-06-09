var express = require('express'),
    passport = require('passport'),
    uuid = require('uuid'),
    MongoClient = require('mongodb').MongoClient,
    util = require('../util.js'),
    UserUtil = util.UserUtil,
    isAdmin = util.middleware.isAdmin('/admin'),
    parseFormData = util.middleware.parseFormData,
    router = express.Router();

router.get('/', isAdmin, function(req, res) {
    res.render('index', { title: "Index" }); 
});

router.get('/elections', isAdmin, function(req, res) {
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
                tokens: doc.participants.length,
                startTime: doc.startTime,
                endTime: doc.endTime
            });
        });
    });
});

router.route("/elections/create")
.get(isAdmin, function(req, res) {
    res.render('create-election', { title: "Create Election" });
})
.post(isAdmin, parseFormData, function(req, res) {
    util.elections.createElection(req, res, req.body, req.files);
});


router.get("/election/:slug", isAdmin, function(req, res) {
    var slug = req.params.slug;

    util.elections.getElection(slug, function(err, election) {
        if (err) throw err;
        
        res.render('election', { election: election });
    });
});

router.get("/ballots/:slug", isAdmin, function(req, res) {
    var slug = req.params.slug;
    
    MongoClient.connect('mongodb://localhost:27017/stopgap', function(err, db) {
        if (err) throw err;

        var elections = db.collection('elections'),
            ballots = db.collection('ballots');

        elections.findOne({slug: slug}, function(err, item) {
            if (err) throw err;
            
            ballots.find({election_id: item._id}).toArray(function(err, data) {
                if (err) throw err;
                res.render('ballots', { util: util, ballots: data, count: data.length });
            });
        });
    });
});

router.route("/login")
.get(function(req, res) {
    res.render('create-account', {
        title: "Login",
        submit: "Sign in"
    });
})
.post(passport.authenticate('local', {
    successRedirect: '/admin',
    failureRedirect: '/admin/login',
    failureFlash: true
}));

router.get('/logout', function(req, res) {
    req.logout();
    res.redirect('/admin/login');
});

router.route('/create-account')
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
                    res.redirect('/admin/login');
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

                    return;
                }

                UserUtil.generatePassword(req.body.password, function(password) {
                    users.insert({username: req.body.username,
                                  password: password,
                                  uuid: uuid.v4(),
                                  admin: true}, function(err) {
                        if (err) throw err;

                        res.redirect('/admin/create-account');
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
                    res.redirect('/admin/login');
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

                            res.redirect('/admin/login');
                        })
                    });
                });
            });
        });
    }
});

exports.router = router;
