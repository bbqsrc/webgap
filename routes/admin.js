"use strict";

var express = require('express'),
    passport = require('passport'),
    uuid = require('uuid'),
    MongoClient = require('mongodb').MongoClient,
    util = require('../util.js'),
    config = require('../config.js'),
    UserUtil = util.UserUtil,
    isAdmin = util.middleware.isAdmin('/admin'),
    parseFormData = util.middleware.parseFormData,
    router = express.Router();

router.get('/', isAdmin, function(req, res) {
    res.render('index', { title: "Index" }); 
});

// Email groups: eg Taswegia has all taswegians
router.get('/participants', isAdmin, function(req, res) {
    util.participantGroups.all(function(err, data) {
        //TODO
        if (err) throw err;

        res.render('participants', { participants: data });
    });
});

router.route('/participants/create')
.get(isAdmin, function(req, res) {
    res.render('add-participants');
})
.post(isAdmin, function(req, res) {
    var emails = req.body.emails.trim().split('\n').map(function(em) { return em.trim(); });

    util.participantGroups.create(req.body.name, emails, function(err) {
        res.render('add-participants', { 
            alert: "Successfully added group '" + req.body.name + "'."
        });
    });
});

/*
router.route('/participant/:slug')
.get(isAdmin, function(req, res) {

})
.put(isAdmin, function(req, res) {
    
})
.delete(isAdmin, function(req, res) {
    
});

// For handling combined elections
router.get('/views', isAdmin, function(req, res) {

});

router.route('/views/create', isAdmin, function(req, res) {

});
*/

router.get('/elections', isAdmin, function(req, res) {
    util.getDB(function(err, db) {
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
                tokens: (doc.participants || {}).length,
                startTime: doc.startTime,
                endTime: doc.endTime
            });
        });
    });
});

router.route("/elections/create")
.get(isAdmin, function(req, res) {
    util.participantGroups.all(function(err, participants) {
        //TODO
        if (err) throw err;
        res.render('create-election', { title: "Create Election", participants: participants });
    });
})
.post(isAdmin, parseFormData, function(req, res) {
    util.elections.createElection(req, res, req.body, req.files);
});


router.get("/election/:slug", isAdmin, function(req, res) {
    var slug = req.params.slug;

    util.elections.getElection(slug, function(err, election) {
        if (err) throw err;
        
        res.render('election', { election: election, util: util });
    });
});

router.get("/ballots/:slug", isAdmin, function(req, res) {
    var slug = req.params.slug;
    
    util.getDB(function(err, db) {
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

/*
router.get("/results/:slug/count", isAdmin, function(req, res) {
    var slug = req.params.slug,
        data = {};

    util.elections.getBallots(slug, function(err, ballots) {
        if (ballots == null) {
            res.send(500, "It shouldn't be possible to get into this state.");
        }
        
        ballots.each(function(err, item) {
            var prop;
            
            if (err) throw err;

            for (prop in item) {
                if (prop == "_id" || prop == "elections") {
                    continue;
                }

                if (prop == "motions") {
                    // one day
                    continue;
                }

            }
        });
    });
});
*/

router.route("/login")
.get(function(req, res) {
    res.render('create-account', {
        title: "Login",
        submit: "Sign in"
    });
})
.post(passport.authenticate('local'), function(req, res) {
    if (req.query.r != null) {
        res.redirect(req.query.r);
    } else {
        res.redirect('/admin');
    }
});

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
        util.getDB(function(err, db) {
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
    // TODO: refactor, this method is just stupid and repetitive
    if (req.user && req.user.admin) {
        if (!req.body.username || !req.body.password) {
            res.send(400, "You broke it.");
        }
        
        util.getDB(function(err, db) {
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

                UserUtil.generatePassword(req.body.password, function(err, password) {
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
        util.getDB(function(err, db) {
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

                    UserUtil.generatePassword(req.body.password, function(err, password) {
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
