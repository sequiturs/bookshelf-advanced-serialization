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

      /**
       * @desc An object that maps a role name to the array of properties of the
       * model that should be visible to that role type. Reflects a whitelisting
       * approach to serialization, as only properties listed in the array may be
       * present in the serialization result. Not all properties listed in the
       * array will necessarily be in the serialization result, however, if
       * `contextSpecificVisibleFields` is also being used.
       * @type {Object.<string, string[]>}
       */
      rolesToVisibleFields: undefined,

      /**
       * @desc Override the default model constructor, setting an optional
       * `accessor` on the model.
       */
      constructor: function() {
        modelProto.constructor.apply(this, arguments);
        var options = arguments[1] || {};
        if (options.accessor) {
          this._accessor = options.accessor;
        }
      },

      /**
       * @desc Override the prototype's `fetchAll` so that this._accessor is set on all
       * models in a collection fetched by `fetchAll`.
       */
      fetchAll: function() {
        var modelThis = this;
        var result = fetchAll.apply(this, arguments);
        return result.then(function(collection) {
          collection.each(function(model) {
            model._accessor = modelThis._accessor;
          });
          return collection;
        });
        // TODO There must be a way to accomplish this by having Bookshelf use
        // an accessor option (derived from modelThis._accessor) when it invokes
        // the model constructor for each model it puts in the collection.
      },

      /**
       * @desc The method for serializing a model/collection.
       *
       * Currently `toJSON` mutates models, by loading relations per ensureRelationsLoaded
       * and by removing relations that are not among visible properties. This is
       * admittedly not obvious behavior given the method's name of `toJSON`. Using
       * this plugin means thinking of `toJSON` not as merely converting the existing
       * model to JSON, but as transforming it according to the user's specifications,
       * and then converting it to JSON.
       *
       * @param {object=} options An optional object specifying how to customize
       * the serialization result.
       * @param {object=} options.contextSpecificVisibleFields TODO
       * @param {object=} options.ensureRelationsLoaded TODO
       * @param {function=} options.evaluator A function which returns the
       * context designation in which `toJSON` is being called. Only required if
       * `contextSpecificVisibleFields` or `ensureRelationsLoaded` index lists
       * by context designation.
       * @returns {Promise<*>} A promise resolving to the plain javascript object
       * (or array) representing the model/collection.
       */
      toJSON: function(options) {
        // Copy arguments, V8-optimally.
        // Cf. https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Functions/arguments,
        // http://stackoverflow.com/a/24011235,
        // https://github.com/petkaantonov/bluebird/wiki/Optimization-killers#what-is-safe-arguments-usage
        var args = [];
        for (var i = 0, ii = arguments.length; i < ii; i++) {
          args.push(arguments[i]);
        }

        if (typeof this.roleDeterminer !== 'function') {
          throw new SanityError(
            'roleDeterminer function was not defined for models of table ' + this.tableName);
        }

        // Determine visible properties based on role
        return BluebirdPromise.resolve(this.roleDeterminer(this._accessor))
          .bind(this)
          .then(function(role) {

            var visibleFields = this.rolesToVisibleFields[role];

            if (!Array.isArray(visibleFields)) {
              throw new SanityError('rolesToVisibleFields for table ' + this.tableName +
                ' does not contain visible fields for role: ' + role);
            }

            if (!visibleFields.length) {
              return BluebirdPromise.resolve(undefined);
            }

            // Determine contextDesignation.
            var contextDesignationPromise = getContextDesignation.call(this,
              options ? options.evaluator : undefined);

            // Load relations that should be loaded before serializing the model.
            var ensureRelationsPromise;
            if (_.isPlainObject(this.attributes) && _.isEmpty(this.attributes)) {
              // If `this` model is empty, it must be due to this Bookshelf bug
              // (https://github.com/tgriesser/bookshelf/issues/753); we should never
              // have empty models. So in this case, don't worry about ensuring relations
              // are loaded for the model.

              ensureRelationsPromise = BluebirdPromise.resolve(undefined);

            } else if (options && options.ensureRelationsLoaded) {

              if (!_.isPlainObject(options.ensureRelationsLoaded)) {
                throw new SanityError('ensureRelationsLoaded must be an object');
              }

              var relationNamesToEnsure = options.ensureRelationsLoaded[this.tableName]; // Bookshelf
              // provides no way to identify a model's type except by looking at its
              // `tableName`. We can't, for instance, access the name with which
              // the model class was registered with the registry.
              var relationNamesToEnsurePromise;
              if (relationNamesToEnsure) {
                if (Array.isArray(relationNamesToEnsure)) {

                  relationNamesToEnsurePromise = BluebirdPromise.resolve(relationNamesToEnsure);

                } else if (_.isPlainObject(relationNamesToEnsure)) {

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

            // Determine the properties that should be visible in final serialized result
            // based on application context in which `toJSON` is being called.
            // `contextSpecificVisibleFields` should not be used to prune fields from
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

                contextSpecificVisibleFieldsPromise = contextDesignationPromise
                  .then(function(contextDesignation) {

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

            return BluebirdPromise.join(ensureRelationsPromise,
              contextSpecificVisibleFieldsPromise,
              function(ensureRelationsResult, contextSpecificVisibleFields) {

                // Determine the visible properties in the final serialization result.
                var ultimatelyVisibleFields =
                  contextSpecificVisibleFields ?
                  _.intersection(visibleFields, contextSpecificVisibleFields) :
                  visibleFields;

                // TODO If ultimatelyVisibleFields has zero length, we're done: return undefined.

                // Remove from the model relations that are not in ultimatelyVisibleFields.
                // These don't need to be serialized, and removing them can be essential
                // to preventing cycling / infinite looping of serialization.

                var ultimatelyVisibleFieldsDict = {};
                _.each(ultimatelyVisibleFields, function(fieldName) {
                  ultimatelyVisibleFieldsDict[fieldName] = true;
                });

                _.each(_.keys(this.relations), function(relationName) {
                  if (!ultimatelyVisibleFieldsDict.hasOwnProperty(relationName)) {
                    delete this.relations[relationName];
                  }
                }.bind(this));

                // At last, do the serialization

                var jsonPromises = toJSON.apply(this, args);

                return BluebirdPromise.props(jsonPromises).then(function(json) {

                  var result = _.pick.apply(_, [ json ].concat(ultimatelyVisibleFields));

                  _.each(_.keys(result), function(key) {
                    var value = result[key];

                    // Do a final removal of any `undefined`s or `{}` empty objects
                    // in arrays. We assume such objects are objects the accessing
                    // user shouldn't even know existed, so they shouldn't even be
                    // an item in the array.
                    if (Array.isArray(value)) {
                      result[key] = filterUndefinedsAndEmptyObjects(value);
                    }

                    // Because we earlier resolved objects with no visible properties
                    // to `undefined`, any empty objects at this point must be due
                    // to a Bookshelf bug (https://github.com/tgriesser/bookshelf/issues/753)
                    // and should become null.
                    if (_.isPlainObject(value) && _.isEmpty(value)) {
                      result[key] = null;
                    }
                  });

                  return result;
                }.bind(this));
              }.bind(this));
          });
      },
      /**
       * @desc Override the prototype's `serialize` method in order to promisify
       * properties whose values are arrays, so that we wait for the promises
       * inside the arrays to resolve. Otherwise we'll end up with
       * arrays of stringified promises.
       */
      serialize: function() {
        var result = serialize.apply(this, arguments);

        _.each(_.keys(result), function(key) {
          var value = result[key];

          if (Array.isArray(value)) {
            result[key] = BluebirdPromise.all(value) // TODO Is this redundant
              // since we do this .all() in Collection.serialize?
              .then(function(list) {
                // Also, undefineds and empty objects should not be returned
                // in arrays; we'll assume that such objects in an array represent
                // something the user is not allowed to access, and therefore
                // shouldn't even know whether it exists at all, so we remove it from the array.
                // TODO Is this redundant?
                return filterUndefinedsAndEmptyObjects(list);
              });
          }
        });

        return result;
      },

      /**
       * @desc Override the prototype's `related` method in order to (1) transfer
       * `this._accessor` of a model to its relations' models, and (2) populate
       * `this._accessedAsRelationChain`. With (2) we keep track of how a relation
       * model is related to its ancestor models(s). To do this, we transfer the
       * parent model's `_accessedAsRelationChain` and add to it.
       */
      related: function() {
        var result = related.apply(this, arguments);

        if (result) {
          var relationName = arguments[0];

          // Collection
          if (result.hasOwnProperty('models')) {
            _.each(result.models, function(model) {
              model._accessor = this._accessor;
              model._accessedAsRelationChain = this._accessedAsRelationChain.concat([relationName]);
            }.bind(this));

          // Model
          } else {
            result._accessor = this._accessor;
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
