'use strict';

// This module was inspired by https://github.com/tgriesser/bookshelf/pull/187.

var BluebirdPromise = require('bluebird');
var _ = require('lodash');

var errors = require('./errors.js');
var SanityError = errors.BookshelfAdvancedSerializationPluginSanityError;

var utils = require('./utils.js');
var filterUndefinedsAndEmptyObjects = utils.filterUndefinedsAndEmptyObjects;
var relationPromise = utils.relationPromise;

/**
 * @desc A function for generating the default arguments that should be passed
 * to `evaluator`.
 * @returns {Array.<*>}
 */
var getDefaultEvaluatorArguments = function() {
  return [ this.tableName, this._accessedAsRelationChain, this.id ];
};

/**
 * @returns {Promise<string>} A promise resolving to the name for how to
 * interpret or understand the `this` model that is currently being serialized.
 * We refer to this as the contextDesignation. This is especially useful for
 * distinguishing the `this` model from the top-level model on which `toJSON`
 * was called when both models are of the same type, because then we can given
 * them appropriate contextSpecificVisibleFields to prevent infinite looping of
 * serialization.
 */
var getContextDesignation = function(evaluator) {
  var contextDesignation;
  if (evaluator) {
    if (typeof evaluator !== 'function') {
      throw new SanityError('evaluator must be a function');
    }
    contextDesignation = BluebirdPromise.resolve(
      evaluator.apply(this, getEvaluatorArguments.call(this))
    );
  } else {
    contextDesignation = BluebirdPromise.resolve(undefined);
  }
  return contextDesignation;
};

/**
 * @desc Performs default handling for ensuring that a relation is loaded on the
 * `this` model.
 * @returns A promise resolving to the relation, either directly if the relation
 * was already present on the `this` model, or after loading the relation if it
 * was not present.
 */
var defaultHandleEnsureRelation = function(relationName) {
  return relationPromise(this, relationName);
};

/**
 * @param {object=} options An optional object optionally containing methods
 * for customizing plugin behavior.
 * @param {function=} options.getEvaluatorArguments A function which should return
 * the array of arguments that will be applied to the `evaluator` function. Its
 * `this` value is the model being serialized. See `getDefaultEvaluatorArguments`
 * for the example of the default behavior.
 * @param {function=} options.handleEnsureRelation A function which will be called
 * for each relation name in the `ensureRelationsLoaded` arrays. May return a
 * promise. See `defaultHandleEnsureRelation` for the example of the default
 * behavior, which, as you'd expect, simply loads the relation on the model if it
 * is not already present.
 * @returns A function that can be passed to bookshelf.plugin(), to register this plugin.
 */
module.exports = function(options) {
  if (options && !_.isPlainObject(options)) {
    throw new SanityError('Truthy options argument passed to plugin must be an object.');
  }
  options = options || {};

  if (options.getEvaluatorArguments && typeof options.getEvaluatorArguments !== 'function') {
    throw new SanityError('Truthy getEvaluatorArguments passed as plugin option must be a function.');
  }
  var getEvaluatorArguments = options.getEvaluatorArguments || getDefaultEvaluatorArguments;

  if (options.handleEnsureRelation && typeof options.handleEnsureRelation !== 'function') {
    throw new SanityError('Truthy handleEnsureRelation passed as plugin option must be a function.');
  }
  var handleEnsureRelation = options.handleEnsureRelation || defaultHandleEnsureRelation;

  return function(Bookshelf) {
    var modelProto  = Bookshelf.Model.prototype;
    var toJSON = modelProto.toJSON;
    var serialize = modelProto.serialize;
    var related = modelProto.related;
    var fetchAll = modelProto.fetchAll;

    var Model = Bookshelf.Model.extend({

      /**
       * @desc A value representing who the model is being accessed by / whom it
       * will be serialized for. Passed to `this.roleDeterminer()` to determine
       * the role of this person.
       *
       * @type {*}
       * @private
       */
      _accessor: undefined,

      /**
       * @desc Represents how the `this` model exists as a relation
       * related ultimately to some top-level model. This knowledge is
       * useful when serializing: the evaluator function can use it to determine
       * the contextDesignation. Specifically, it may be essential information
       * if a model can have multiple relations that are collections of the same
       * type of model.
       *
       * @example Example from Sequiturs data model: for a Comment model that is the
       * `comment` relation of a Challenge model that is the `counterArgument`
       * relation of an Argument model, the value of `_accessedAsRelationChain`
       * would be `['counterArgument', 'comment']`.
       *
       * @type string[]
       * @private
       */
      _accessedAsRelationChain: [],

      /**
       * @returns {Promise<string>} A promise resolving to the role that is
       * used to determine the visible properties of the model.
       * @param {*} accessor `this.accessor`
       * @type {function}
       */
      roleDeterminer: undefined,

      // An object mapping role names to an array of field names that are visible
      // for that role type. We use whitelisting of field names because it is stronger/safer
      // than blacklisting. Fields in the lists will not all necessarily be returned
      // when serializing models; rather they are the fields that are allowed to be
      // returned. In other words, the visibleFields list for a given role type defines
      // the maximal extent of what that role may see about a model. In the context of
      // any given access/serialization of a model, the actual fields returned to the
      // accessing user can be pruned relative to what's in visibleFields, via
      // contextSpecificVisibleFields provided as an option to toJSON().
      /**
       *
       */
      rolesToVisibleFields: undefined,

      // `accessor` can be specified in the `options`
      // hash in order to override the null default.
      constructor: function() {
        modelProto.constructor.apply(this, arguments);
        var options = arguments[1] || {};
        if (options.accessor) {
          this._accessor = options.accessor;
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
      /**
       * Currently `toJSON` mutates models, by loading relations per ensureRelationsLoaded
       * and by removing relations that are not among visible properties. This is
       * admittedly not obvious behavior given the method's name of `toJSON`. Using
       * this plugin means thinking of `toJSON` not as merely converting the existing
       * model to JSON, but as transforming it according to the user's specifications,
       * and then converting it to JSON.
       */
      toJSON: function(options) {
        if (typeof this.roleDeterminer !== 'function') {
          throw new SanityError(
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
              throw new SanityError('rolesToVisibleFields for table ' + this.tableName +
                ' does not contain visible fields for role: ' + role);
            }

            if (!visibleFields.length) {
              return BluebirdPromise.resolve(undefined);
            }

            // Determine the more specific contextDesignation of the accessing user in relation to the model.
            // Compared to role, this contextDesignation takes account of context in which the model is
            // being accessed/serialized.
            var contextDesignationPromise = getContextDesignation.call(this, options ? options.evaluator : undefined);

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
                throw new SanityError('ensureRelationsLoaded must be an object');
              }
              var relationNamesToEnsure = options.ensureRelationsLoaded[this.tableName];
              var relationNamesToEnsurePromise;
              if (relationNamesToEnsure) {
                if (Array.isArray(relationNamesToEnsure)) {
                  relationNamesToEnsurePromise = BluebirdPromise.resolve(relationNamesToEnsure);
                } else if (_.isPlainObject(relationNamesToEnsure)) {
                  // ensureRelationsLoaded can make use of contextDesignation (i.e. the return value
                  // of the evaluator function) if conditional-determination of the
                  // relations to be loaded is desired. That's what this branching is for.

                  if (!options.evaluator) {
                    throw new SanityError('options must contain an evaluator function if ' +
                      'options.ensureRelationsLoaded[this.tableName] is an object');
                  }

                  relationNamesToEnsurePromise = contextDesignationPromise.bind(this)
                    .then(function(contextDesignation) {
                      return options.ensureRelationsLoaded[this.tableName][contextDesignation];
                    });
                } else {
                  throw new SanityError('ensureRelationsLoaded.' + this.tableName +
                    ' must be an array, or an object whose keys are strings returned ' +
                    'by the options.evaluator function.');
                }
                ensureRelationsPromise = BluebirdPromise.map(relationNamesToEnsurePromise,
                  handleEnsureRelation.bind(this));
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
                throw new SanityError('options must contain an evaluator function if ' +
                  'options.contextSpecificVisibleFields is provided');
              }
              var tableContextSpecific = options.contextSpecificVisibleFields[this.tableName];
              if (tableContextSpecific) {
                if (!_.isPlainObject(tableContextSpecific)) {
                  throw new SanityError('contextSpecificVisibleFields must be an ' +
                    'object whose values are objects whose values are arrays');
                }
                contextSpecificVisibleFieldsPromise = contextDesignationPromise.bind(this).then(function(contextDesignation) {
                  var contextSpecificVisibleFields = tableContextSpecific[contextDesignation];
                  if (!Array.isArray(contextSpecificVisibleFields)) {
                    throw new SanityError('evaluator function did not successfully ' +
                      'identify context-specific visible fields');
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

    var collectionProto = Bookshelf.Collection.prototype;
    var collectionSerialize = collectionProto.serialize;

    var Collection = Bookshelf.Collection.extend({
      /**
       * Override Collection.serialize to support the fact that Model.toJSON
       * returns a promise. Otherwise we end up with an array of stringified
       * promises.
       */
      serialize: function() {
        var modelPromisesArray = collectionSerialize.apply(this, arguments);
        return BluebirdPromise.all(modelPromisesArray);
      }
    });

    Bookshelf.Collection = Collection;
  };
};
