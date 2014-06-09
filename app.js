"use strict";

var express = require('express'),
    connect = require('connect'),
    passport = require('passport'),
    moment = require('moment'),
    app = express();

app.set('views', __dirname + '/views');
app.set('view engine', 'jade');

app.use(express.static(__dirname + '/public'));
app.use(connect.logger('dev'));
app.use(require('body-parser')());
app.use(require('cookie-parser')());
app.use(require('connect-flash')());
app.use(require('express-session')({ secret: 'such webgap oh my' }));
app.use(passport.initialize());
app.use(passport.session());

passport.use(require('./util.js').localStrategy);

passport.serializeUser(function(user, done) {
    done(null, user);
});

passport.deserializeUser(function(user, done) {
    done(null, user);
});

app.use('/admin', require('./routes/admin').router);

var server = app.listen(3001, function() {
    console.log('Listening on port %d', server.address().port);
});

