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

var scheduler = new Scheduler;

Object.defineProperty(module, 'exports', { get: function() { return scheduler; }, enumerable: true});
