var express = require('express'),
    passport = require('passport'),
    MongoClient = require('mongodb').MongoClient,
    util = require('../util.js'),
    UserUtil = util.UserUtil,
    isAdmin = util.middleware.isAdmin('/admin'),
    parseFormData = util.middleware.parseFormData,
    router = express.Router();

function parsePostData(data) {
    var out = {},
        prop, chunks, tmp,
        i, ii;

    for (prop in data) if (data.hasOwnProperty(prop)) {
        chunks = prop.replace(/\]*$/, "").split(/[\]\[\.]+/);
        tmp = out;

        for (i = 0, ii = chunks.length-1; i < ii; ++i) {
            if (tmp[chunks[i]] == null) {
                tmp[chunks[i]] = {};
            }
            tmp = tmp[chunks[i]];
        }

        tmp[chunks[chunks.length-1]] = data[prop];
    }

    return out;
}

// TODO: only allow if election has isPublic flag
router.get("/results/:slug", function(req, res) {
    /*
    util.elections.getBallots(req.params.slug, function(err, ballots) {
        if (ballots == null) {
            res.send(500, "It shouldn't be possible to get into this state.");
        }
       
        ballots.toArray(function(err, arr) {
            res.render('results-table', { title: "Results Table",
                       headers: arr[0].ballot, ballots: arr });
        });
    });
    */
    util.elections.getResults(req.params.slug, function(err, record) {
        if (err) {
            if (err.type == "RESULT" || err.type == "ELECTION") {
                return res.render('results-raw', { 
                    title: "Results",
                    alert: err.message });
            }
        }

        if (record == null) {
            return res.render('results-raw', { title: "Results", 
                                               alert: "Results are still generating. " + 
                                                      "Please refresh after about 10 seconds." });
        }

        return res.render('results-raw', { title: "Results", data: record.data });
    });

});

router.get('/:slug/static/*', util.elections.renderStatic);

router.get('/', function(req, res) {
    res.render('home');
});

router.route('/:slug/:id')
.get(function(req, res) {
    util.elections.checkParams(req.params.slug, req.params.id, function(err, data) {
        if (err) {
            if (err.type == "ELECTION") {
                res.render('403', { message: ""+err });
            } else {
                console.error(err.stack);
                res.render('403', { message: "Oops! The server did something weird. " +
                                             "Please let the administrator know." });
            }
            return;
        };
        
        var election = data.election,
            token = data.token;

        util.elections.render(req.params.slug, res);
    });
})
.post(function(req, res) {
    util.elections.checkParams(req.params.slug, req.params.id, function(err, data) {
        if (err) {
            if (err.type == "ELECTION") {
                res.render('403', { message: ""+err });
            } else {
                console.error(err.stack);
                res.render('403', { message: "Oops! The server did something weird. " +
                                             "Please let the administrator know." });
            }
            return;
        };
      
        var o = {
            election_id: data.election._id,
            token: data.token,
            ballot: parsePostData(req.body)
        };
        
        util.elections.insertBallot(o, function(err) {
            if (err) {
                if (err.type == "ELECTION") {
                    res.render('403', { message: ""+err });
                } else {
                    console.error(err.stack);
                    res.render('403', { message: "Oops! The server did something weird. " +
                                                 "Please let the administrator know." });
                }
                return;
            }

            util.elections.renderSuccess(req.params.slug, res);
        });
    });

});

exports.router = router;
