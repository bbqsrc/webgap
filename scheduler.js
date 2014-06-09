"use strict";

var MongoClient = require('mongodb').MongoClient,
    schedule = require('node-schedule'),
    util = require("./util");

var Scheduler = exports.Scheduler = function() {
    this._items = {};
}

Scheduler.prototype = {
    add: function(date, callback) {
        var self = this,
            job,
            func = function() {
                callback.apply(this, arguments);
                self.remove(date, job);
            };

        job = schedule.scheduleJob(date, func);

        if (this._items[+date] == null) {
            this._items[+date] = [];
        }

        this._items[+date].push(job);
    },

    remove: function(date, job) {
        var idx;

        if (this._items[+date] == null) {
            return;
        }

        idx = this._items[+date].indexOf(job);
        if (idx > -1) {
            this._items[+date].splice(idx, 1);
        }

        if (this._items[+date].length == 0) {
            delete this._items[+date];
        }
    }
};

var startScheduler = function() {
    var sch = new Scheduler;

    MongoClient.connect('mongodb://localhost:27017/stopgap', function(err, db) {
        if (err) throw err;

        var elections = db.collection('elections');

        elections.find({ endTime: { $gte: new Date }}).each(function(err, item) {
            if (err) throw err;

            console.log(item);

            if (item == null) {
                return;
            }
            
            sch.add(item.startTime, function() {
                console.log("Sending emails for " + item.slug);
                util.elections.sendEmails(item);
            });

            sch.add(item.endTime, function() {
                // Do something here?
                console.log(item.slug + " has ended.");
            });
        });
    });

    return sch;
};

exports.scheduler = startScheduler();
