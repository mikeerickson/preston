"use strict";

var utils = require('./utils');

exports.query = function(thiz, Mod) {
  return function(req, res) {
    var query = Mod.find();
    var reqQuery = req.query;

    // Parse the query
    // Ensure empty params are treated as null
    Object.keys(reqQuery).map(function(param) {
      if (reqQuery[param] === '') {
        reqQuery[param] = null;
      }
    });

    // Parse comma-delimited params and trim them
    if (reqQuery.populate) {
      reqQuery.populate = reqQuery.populate.split(',');
      reqQuery.populate = reqQuery.populate.map(Function.prototype.call, String.prototype.trim);
    }
    if (reqQuery.sort) {
      reqQuery.sort = reqQuery.sort.split(',');
      reqQuery.sort = reqQuery.sort.map(Function.prototype.call, String.prototype.trim);
      var newVal = {};
      reqQuery.sort.map(function(param) {
        if (param.lastIndexOf('-', 0) === 0) {
          newVal[param.substring(1)] = -1;
        } else {
          newVal[param] = 1;
        }
      });
      reqQuery.sort = newVal;
    }

    // Apply modifiers
    // The try/catch allows us to throw errors in modifiers, if we're
    // doing something like auth.
    try {
      thiz.modifiers.filter(function(mod) {
        reqQuery[mod.param] = mod.fn(req, reqQuery[mod.param]);
        if (reqQuery[mod.param] === false) {
          delete reqQuery[mod.param];
        }
      });
    } catch (err) {
      if (!err.code) {
        throw err;
      }
      return;
    }

    // Apply limit parameter
    if (reqQuery.limit) {
      try {
        if (isNaN(reqQuery.limit)) {
          throw res.error(400, 'Limit must be a number.');
        }
        query.limit(reqQuery.limit);
      } catch (err) {
        if (!err.code) {
          throw err;
        }
        return;
      }
    }

    // Apply skip parameter
    if (reqQuery.skip) {
      try {
        if (isNaN(reqQuery.skip)) {
          throw res.error(400, 'Skip must be a number.');
        }
        query.skip(reqQuery.skip);
      } catch (err) {
        if (!err.code) {
          throw err;
        }
        return;
      }
    }

    if (reqQuery.populate) {
      try {
        reqQuery.populate.filter(function(toPopulate) {
          if (!Mod.schema.paths.hasOwnProperty(toPopulate)) {
            throw res.error(400, 'Field "' + toPopulate + '" does not exist.');
          }
          if (thiz.restricted.indexOf(toPopulate) !== -1) {
            throw res.error(401, 'Cannot populate restricted field "' + toPopulate + '".');
          }
          query.populate(toPopulate);
        });
      } catch (err) {
        if (!err.code) {
          throw err;
        }
        return;
      }
    }

    if (reqQuery.sort) {
      try {
        Object.keys(reqQuery.sort).filter(function(toSort) {
          if (!Mod.schema.paths.hasOwnProperty(toSort)) {
            throw res.error(400, 'Field "' + toSort + '" does not exist.');
          }
          if (thiz.restricted.indexOf(toSort) !== -1) {
            throw res.error(401, 'Cannot sort restricted field "' + toSort + '".');
          }
        });
        query.sort(reqQuery.sort);
      } catch (err) {
        if (!err.code) {
          throw err;
        }
        return;
      }
    }

    // Filters
    if (reqQuery.filter) {
      try {
        var filters = utils.parseFilterString(reqQuery.filter);
        filters.filter(function(filter) {
          if (!thiz.filters.hasOwnProperty(filter[0])) {
            throw res.error(400, 'The filter "' + filter + '" does not exist.');
          }
          var filterFn = thiz.filters[filter[0]];

          // Construct our filter arguments
          var args = [];
          args.push(req);
          args.push(query);
          args.push.apply(args, filter.slice(1));

          try {
            filterFn.apply(thiz, args);
          } catch (err) {
            throw res.error(400, 'Could not apply filter "' + filter + '" due to error: ' + err.message);
          }
        });
      } catch (err) {
        if (!err.code) {
          throw err;
        }
        return;
      }
    }

    // Fields
    try {
      Mod.schema.eachPath(function(name) {
        if (!reqQuery.hasOwnProperty(name)) {
          return;
        }
        var val = reqQuery[name];

        if (thiz.restricted.indexOf(name) !== -1) {
          throw res.error(401, 'Cannot access restricted field "' + name + '".');
        }
        query.where(name).equals(val);
      });
    } catch (err) {
      if (!err.code) {
        throw err;
      }
      return;
    }

    query.exec(function(err, docs) {
      if (err) {
        throw err;
      }
      res.json(docs.map(function(doc) {
        return thiz.applyTransforms(req, doc);
      }));
    });
  };
};