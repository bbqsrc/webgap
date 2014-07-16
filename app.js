"use strict";

var express = require('express'),
    connect = require('connect'),
    passport = require('passport'),
    moment = require('moment'),
    util = require('./util'),
    config = require('./config'),
    app = express(),
    server;

app.set('views', __dirname + '/views');
app.set('view engine', 'jade');

app.use(express.static(__dirname + '/public'));
app.use(connect.logger('dev'));
app.use(require('body-parser')());
app.use(require('cookie-parser')());
app.use(require('express-session')({
    name: config.cookieName,
    secret: config.cookieSecret,
    cookie: {
        maxAge: config.cookieMaxAge,
        secure: config.production
    },
    proxy: true
}));
app.use(require('connect-flash')());
app.use(passport.initialize());
app.use(passport.session());
passport.use(util.localStrategy);
passport.serializeUser(function(user, done) { done(null, user); });
passport.deserializeUser(function(user, done) { done(null, user); });

// Schedule start events!
util.startScheduler();

// Routes
app.use('/admin', require('./routes/admin').router);
//app.use('/results', require('./routes/results').router);
app.use('/', require('./routes/main').router);

// Error handling
app.use(function(err, req, res, next) {
    if (!err) return next();

    console.error(err.stack);
    res.send(500, "The server broke. Sorry!");
});

// 404 fallback
app.use(function(req, res, next) {
    res.status(404).render('404');
});

server = app.listen(config.port, function() {
    console.log('Listening on port %d', server.address().port);
});

