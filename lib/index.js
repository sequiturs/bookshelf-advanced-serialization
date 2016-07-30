'use strict';

var BluebirdPromise = require('bluebird');
var _ = require('lodash');

var errors = require('./errors.js');
var AppSanityError = errors.AppSanityError;
var publicErrMessages = errors.publicErrMessages;

var getEvaluatorArguments = function() {
  if (this.tableName === 'arguments') {
    return [this.tableName, this._accessedAsRelationChain, this.id, this.get('parent')];
  } else if (this.tableName === 'groups') {
    return [this.tableName, this._accessedAsRelationChain, this.id, this.accessor.user];
  } else {
    return [this.tableName, this._accessedAsRelationChain, this.id];
  }
};

var getDesignation = function(evaluator) {
  var designation;
  if (evaluator) {
    if (typeof evaluator !== 'function') {
      throw new AppSanityError(
        publicErrMessages.c500.terse,
        'evaluator must be a function'
      );
    }

    // The purpose of this evaluator function is to specify the designation,
    // i.e. how to interpret or understand the `this` model that is currently
    // being serialized. In the case of an argument model, since arguments
    // have parent and children relations, this designation indicates
    // the relationship between the `this` model being serialized and the model
    // that kicked off the toJSON serialization--for instance, is the current model
    // the main argument model itself, or is it one of its children, or the parent?
    // Identifying how models relate to each other in this way can be useful
    // for preventing huge recursive and/or infinite looping of serialization
    // of models.
    // We wrap the return value of the evaluator function in a promise so that
    // evaluator functions can do async work and return a promise if they want to.

    designation = BluebirdPromise.resolve(
      evaluator.apply(this, getEvaluatorArguments.call(this))
    );
  } else {
    designation = BluebirdPromise.resolve(undefined);
  }
  return designation;
};

var filterUndefinedsAndEmptyObjects = function(list) {
  return _.filter(list, function(item) {
    return !(item === undefined ||
      (_.isPlainObject(item) && _.isEmpty(item)));
  });
};

var COUNT_PSEUDO_RELATION_SUFFIX = 'CountPseudoRelation';

// Visibility plugin for Bookshelf, for hiding/showing particular attributes
// returned by `toJSON` based on provided roles / permission-levels.
//
// Adapted from https://github.com/tgriesser/bookshelf/pull/187
// -----
//
// N.B. Since the approach implemented in this plugin actually mutates the model(s)
// being serialized, either by loading relations in invoking roleDeterminer, or by
// loading relations via ensureRelationsLoaded, or by removing relations that
// are not in ultimatelyVisibleFields, it would be a best practice, i.e. safest,
// for server-side logic NOT TO USE THESE MODELS after serializing them, as
// their state, and what's loaded on them and what's not, may be difficult to reason
// about.
module.exports = function(Bookshelf) {
  var proto  = Bookshelf.Model.prototype;
  var toJSON = proto.toJSON;
  var serialize = proto.serialize;
  var related = proto.related;
  var fetchAll = proto.fetchAll;
  var collectionSerialize = Bookshelf.Collection.prototype.serialize;

  var Collection = Bookshelf.Collection.extend({
    serialize: function() {
      // Need to override the default Collection serialize method, because
      // we overrode models' toJSON to return a promise. We don't want to
      // stringify an array of promises.
      var modelPromisesArray = collectionSerialize.apply(this, arguments);
      return BluebirdPromise.all(modelPromisesArray);
    }
  });

  Bookshelf.Collection = Collection;

  var Model = Bookshelf.Model.extend({

    // An object containing details about the access:
    // user contains the user requesting access
    //     null for id should correspond to an unauthenticated user.
    accessor: {
      user: null
    },

    // A string representing how the model exists as a relation of another model,
    // or as a relation of indefinitely many relations of another model. This is
    // useful when serializing: the evaluator function can use it to determine which
    // fields should be visible and which relations should be loaded. This is a necessary
    // addition to the information available to the evaluator function because e.g.
    // when serializing an argument model, one of its children could also be used as
    // a counterargument, and we need to be able to serialize different fields for that
    // same child/counterargument model in the two different relation contexts. It
    // was not possible to distinguish those contexts based solely on the use of
    // the tableName, idOfModelBeingSerialized, and relatedId.
    //
    // Example: for a Comment model that is the comment relation of a Challenge model
    // that is the counterArgument relation of an Argument model, the value of
    // _accessedAsRelationChain would be ['counterArgument', 'comment'].
    //
    // This field is private and set via the monkey-patched .related() method below;
    // it should not be set directly by the user.
    _accessedAsRelationChain: [],

    // A function that determines the accessing user's role, e.g. by accessing
    // accessor.user.id.
    // This function may or may not assume that the accessing user has permission
    // to access the model at all.
    roleDeterminer: null,

    // An object mapping role names to an array of field names that are visible
    // for that role type. We use whitelisting of field names because it is stronger/safer
    // than blacklisting. Fields in the lists will not all necessarily be returned
    // when serializing models; rather they are the fields that are allowed to be
    // returned. In other words, the visibleFields list for a given role type defines
    // the maximal extent of what that role may see about a model. In the context of
    // any given access/serialization of a model, the actual fields returned to the
    // accessing user can be pruned relative to what's in visibleFields, via
    // contextSpecificVisibleFields provided as an option to toJSON().
    rolesToVisibleFields: {},

    // `accessor` can be specified in the `options`
    // hash in order to override the null default.
    constructor: function() {
      proto.constructor.apply(this, arguments);
      var options = arguments[1] || {};
      if (options.accessor) {
        this.accessor = options.accessor;
      }
    },

    /*
    * Monkey-patch fetchAll so that it returns a collection whose models all
    * contain the accessor set on the model used for querying.

    * The default behavior was such that the collection's models were not
    * inheriting the accessor option. The accessor is crucial for evaluating
    * visible fields correctly, and this is the best way to ensure all collections created via
    * bookshelf.model(ModelName).forge({ foo: bar }, { accessor: { user: req.user }}).fetchAll()
    * have the accessor set, rather than patching all such collections individually
    * before serializing.
    */
    fetchAll: function() {
      var _this = this;
      var result = fetchAll.apply(this, arguments);
      return result.then(function(collection) {
        _.each(collection.models, function(model) {
          model.accessor = _this.accessor;
        });
        return collection;
      });
    },
    toJSON: function(options) {
      if (typeof this.roleDeterminer !== 'function') {
        throw new AppSanityError(publicErrMessages.c500.terse,
          'roleDeterminer function was not defined for models of table ' + this.tableName);
      }

      // Copy arguments. Do it this way rather than with slice because this is V8-optimal.
      // Cf. https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Functions/arguments
      // http://stackoverflow.com/a/24011235
      // https://github.com/petkaantonov/bluebird/wiki/Optimization-killers#what-is-safe-arguments-usage
      var args = [];
      for (var i = 0, ii = arguments.length; i < ii; i++) {
        args.push(arguments[i]);
      }

      // Determine most generic/abstract role of accessing user in relation to the model being serialized
      return BluebirdPromise.resolve(this.roleDeterminer(this.accessor))
        .bind(this)
        .then(function(role) {
          // Identify visible fields that can be returned given the role.
          var visibleFields = this.rolesToVisibleFields[role];

          if (!Array.isArray(visibleFields)) {
            throw new AppSanityError(publicErrMessages.c500.terse,
              'rolesToVisibleFields for table ' + this.tableName +
                ' does not contain visible fields for role: ' + role);
          }

          if (!visibleFields.length) {
            return BluebirdPromise.resolve(undefined);
          }

          // Determine the more specific designation of the accessing user in relation to the model.
          // Compared to role, this designation takes account of context in which the model is
          // being accessed/serialized.
          var designationPromise = getDesignation.call(this, options ? options.evaluator : undefined);

          // With visible fields in hand, load any relations that have been specified
          // as relations that should be loaded before serializing the model.
          var ensureRelationsPromise;
          if (_.isPlainObject(this.attributes) && _.isEmpty(this.attributes)) {
            // If this model is empty, it must be due to this Bookshelf bug
            // (https://github.com/tgriesser/bookshelf/issues/753); we should never
            // have empty models. So in this case, don't worry about ensuring relations
            // are loaded for the model.

            ensureRelationsPromise = BluebirdPromise.resolve(undefined);
          } else if (options && options.ensureRelationsLoaded) {
            // ensureRelationsLoaded uses table names as keys, since Bookshelf models
            // don't themselves store their own name
            if (!_.isPlainObject(options.ensureRelationsLoaded)) {
              throw new AppSanityError(publicErrMessages.c500.terse,
                'ensureRelationsLoaded must be an object');
            }
            var relationNamesToEnsure = options.ensureRelationsLoaded[this.tableName];
            var relationNamesToEnsurePromise;
            if (relationNamesToEnsure) {
              if (Array.isArray(relationNamesToEnsure)) {
                relationNamesToEnsurePromise = BluebirdPromise.resolve(relationNamesToEnsure);
              } else if (_.isPlainObject(relationNamesToEnsure)) {
                // ensureRelationsLoaded can make use of designation (i.e. the return value
                // of the evaluator function) if conditional-determination of the
                // relations to be loaded is desired. That's what this branching is for.

                if (!options.evaluator) {
                  throw new AppSanityError(publicErrMessages.c500.terse,
                    'options must contain an evaluator function if ' +
                    'options.ensureRelationsLoaded[this.tableName] is an object');
                }

                relationNamesToEnsurePromise = designationPromise.bind(this)
                  .then(function(designation) {
                    return options.ensureRelationsLoaded[this.tableName][designation];
                  });
              } else {
                throw new AppSanityError(publicErrMessages.c500.terse,
                  'ensureRelationsLoaded.' + this.tableName + ' must be an array, ' +
                  'or an object whose keys are strings returned by the options.evaluator function.');
              }
              ensureRelationsPromise = relationNamesToEnsurePromise.then(function(relationNamesToEnsure) {
                return BluebirdPromise.all(
                  _.map(relationNamesToEnsure, function(relationName) {
                    if (relationName === null) {
                      return relationName;

                    // If relationName ends with 'CountPseudoRelation', handle specially: this is
                    // a pseudo-relation for which we'll use Bluebird's .count method
                    // and set the value as an attribute on the model. So this approach requires
                    // a relation defined as e.g. 'commentCountPseudoRelation', and yields an attribute
                    // of 'commentCount' being set on the model. This means 'commentCount' should
                    // be specified as a visible field in order for it to be serialized--but
                    // 'commentCountPseudoRelation' would be specified in ensureRelationsLoaded.
                    } else if (relationName.slice(-(COUNT_PSEUDO_RELATION_SUFFIX.length)) === COUNT_PSEUDO_RELATION_SUFFIX) {
                      var singularTableName = this.tableName.slice(0, -1);
                      var relationNameRoot = relationName.slice(0, -(COUNT_PSEUDO_RELATION_SUFFIX.length));

                      var whereQuery = {};
                      var relationNameToInvoke;

                      // First handle special cases that don't follow convention of
                      // making relation name plural by adding an 's' on the end, and
                      // for which the foreign key reference field is not the
                      // singularTableName + '_id'.
                      if (relationNameRoot === 'children' && this.tableName === 'arguments') {
                        relationNameToInvoke = relationNameRoot;
                        whereQuery['parent'] = this.id;

                      // Handle the conventional case
                      } else {
                        relationNameToInvoke = relationNameRoot + 's';
                        whereQuery[singularTableName + '_id'] = this.id; // This works
                        // where the pseudo-relation is hasMany. Would probably have to
                        // be modified to support other types of pseudo-relations, though
                        // not sure it will ever make sense for our application to do
                        // counts with other types.
                      }

                      return this[relationNameToInvoke]()
                        .count()
                        .then(function(count) {
                          this.set(relationNameRoot + 'Count', count);
                        }.bind(this));
                    } else {
                      return this.relations[relationName] ?
                        BluebirdPromise.resolve(this.related(relationName)) :
                        this.load([relationName]).then(function(model) {
                          return model.related(relationName);
                        });
                    }
                  }.bind(this))
                );
              }.bind(this));
            } else {
              ensureRelationsPromise = BluebirdPromise.resolve(undefined);
            }
          } else {
            ensureRelationsPromise = BluebirdPromise.resolve(undefined);
          }

          // Identify any fields that should be stripped from final serialized result
          // based on context, where
          // context can be either (1) the relationship of `this` model to the
          // original/top-level model that kicked off the
          // serialization, or (2) the app-level, e.g. route, context in which
          // the serialization is being done. In other words this context-based
          // visibility can be used in two ways. (We refer to these as
          // context-specific visible fields.)
          // contextSpecificVisibleFields should not be used to prune fields from
          // a model for permissions-logic-related reasons; the place for determining
          // what fields are visible for permissions reasons is in the roleDeterminer function.
          var contextSpecificVisibleFieldsPromise;
          if (options && options.contextSpecificVisibleFields) {
            if (!options.evaluator) {
              throw new AppSanityError(publicErrMessages.c500.terse,
                'options must contain an evaluator function if ' +
                'options.contextSpecificVisibleFields is provided');
            }
            var tableContextSpecific = options.contextSpecificVisibleFields[this.tableName];
            if (tableContextSpecific) {
              if (!_.isPlainObject(tableContextSpecific)) {
                throw new AppSanityError(publicErrMessages.c500.terse,
                  'contextSpecificVisibleFields must be an object whose values are objects whose values are arrays');
              }
              contextSpecificVisibleFieldsPromise = designationPromise.bind(this).then(function(designation) {
                var contextSpecificVisibleFields = tableContextSpecific[designation];
                if (!Array.isArray(contextSpecificVisibleFields)) {
                  throw new AppSanityError(publicErrMessages.c500.terse,
                    'evaluator function did not successfully identify context-specific ' +
                    'visible fields');
                }
                return contextSpecificVisibleFields;
              });
            }
          } else {
            contextSpecificVisibleFieldsPromise = BluebirdPromise.resolve(undefined);
          }

          return BluebirdPromise.join(ensureRelationsPromise, contextSpecificVisibleFieldsPromise,
            function(ensureRelationsResult, contextSpecificVisibleFields) {
              // Determine the fields that will be returned, as the intersection
              // of visibleFields and contextSpecificVisibleFields.
              var ultimatelyVisibleFields = contextSpecificVisibleFields ?
                _.intersection(visibleFields, contextSpecificVisibleFields) :
                visibleFields;

              // TODO If ultimatelyVisibleFields has zero length, we're done: return undefined.

              // Remove from the model relations that are not in ultimatelyVisibleFields. These
              // don't need to be serialized, and removing them can be essential
              // to preventing cycling / infinite looping of serialization.

              //  Create a dictionary out of ultimatelyVisibleFields
              var ultimatelyVisibleFieldsDict = {};
              _.each(ultimatelyVisibleFields, function(fieldName) {
                ultimatelyVisibleFieldsDict[fieldName] = true;
              });
              // Remove relations not in ultimatelyVisibleFieldsDict
              _.each(_.keys(this.relations), function(relationName) {
                if (!ultimatelyVisibleFieldsDict.hasOwnProperty(relationName)) {
                  delete this.relations[relationName];
                }
              }.bind(this));

              // At last do the serialization
              var jsonPromises = toJSON.apply(this, args);
              return BluebirdPromise.props(jsonPromises).then(function(json) {
                var result = _.pick.apply(_, [json].concat(ultimatelyVisibleFields));
                _.each(_.keys(result), function(key) {
                  var value = result[key];

                  // Do a final removal of any empty objects in arrays. (We'll assume such
                  // objects are objects the accessing user shouldn't even know existed,
                  // so they shouldn't even be an item in the array.) (TODO Could conceivably
                  // promisify all values within the serialize method and then do
                  // this filtering once in a then function for resolved values that were arrays.)
                  if (Array.isArray(value)) {
                    result[key] = filterUndefinedsAndEmptyObjects(value);
                  }

                  // We'll assume that empty objects are all due to this Bookshelf bug
                  // (https://github.com/tgriesser/bookshelf/issues/753) and should become
                  // null. (Can't think of any valid case of a completely empty object.)
                  if (_.isPlainObject(value) && _.isEmpty(value)) {
                    result[key] = null;
                  }
                });
                return result;
              }.bind(this));
            }.bind(this));
        });
    },
    serialize: function() {
      var attrs = serialize.apply(this, arguments);
      _.each(_.keys(attrs), function(key) { // Iterate over a copy of keys since we'll be mutating attrs
        var value = attrs[key];

        // Values in the attrs object returned by the prototype's
        // serialize method which are arrays need to themselves be promisified.
        // Otherwise toJSON will serialize arrays of promises.
        if (Array.isArray(value)) {
          attrs[key] = BluebirdPromise.all(value)
            .then(function(list) {
              // Also, undefineds and empty objects should not be returned
              // in arrays; we'll assume that such objects in an array represent
              // something the user is not allowed to access, and therefore
              // shouldn't even know whether it exists at all, so we remove it from the array.
              // This is used, for example, when returning arguments;
              // arguments which the accessing user doesn't have permission to access
              // should not have any indication that they exist in the array returned.
              return filterUndefinedsAndEmptyObjects(list);
            });
        }
      });
      return attrs;
    },
    related: function() {
      // In this patch of the .related() method, we do two things:
      // (1) Transfer the accessor of a model to its relations' models.
      // (2) Via _accessedAsRelationChain, we keep track of how a relation model
      // is related to its ancestor model(s) -- we transfer the parent's relation chain
      // and add to it. This is useful in serializing (see longer comments on
      // _accessedAsRelationChain above).
      var result = related.apply(this, arguments);
      if (result) {
        var relationName = arguments[0];

        // Collection
        if (result.hasOwnProperty('models')) {
          _.each(result.models, function(model) {
            model.accessor = this.accessor;
            model._accessedAsRelationChain = this._accessedAsRelationChain.concat([relationName]);
          }.bind(this));

        // Model
        } else {
          result.accessor = this.accessor;
          result._accessedAsRelationChain = this._accessedAsRelationChain.concat([relationName]);
        }
      }
      return result;
    }
  });

  Bookshelf.Model = Model;
};
