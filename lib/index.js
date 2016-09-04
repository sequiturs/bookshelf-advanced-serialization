'use strict';

/***
 * (c) 2016 Ian Hinsdale
 * Distributed under the MIT license.
 *
 * This module was inspired by https://github.com/tgriesser/bookshelf/pull/187.
 */

var BluebirdPromise = require('bluebird');
var _ = require('lodash');

var errors = require('./errors.js');
var SanityError = errors.BookshelfAdvancedSerializationPluginSanityError;

var utils = require('./utils.js');
var filterUndefineds = utils.filterUndefineds;
var relationPromise = utils.relationPromise;

/**
 * @ignore
 * @desc A function for generating the default arguments that should be passed
 * to `evaluator`.
 * @returns {Array.<*>}
 */
var getDefaultEvaluatorArguments = function() {
  return [ this.tableName, this._accessedAsRelationChain, this.id ];
};

/**
 * @ignore
 * @param {function=} evaluator The evaluator function to use to determine the
 * contextDesignation
 * @param {function=} getEvaluatorArguments A function that returns the
 * arguments to pass to the evaluator function
 * @returns {Promise<string>} A promise resolving to the name for how to
 * interpret or understand `this` that is currently being serialized.
 * We refer to this as the contextDesignation. This is especially useful for
 * distinguishing `this` from the top-level model on which `toJSON`
 * was called when both models are of the same type, because then we can given
 * them appropriate contextSpecificVisibleFields to prevent infinite looping of
 * serialization.
 */
var getContextDesignation = function(evaluator, getEvaluatorArguments) {
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
 * @ignore
 * @desc Performs default handling for ensuring that a relation is loaded on the
 * `this` model.
 * @returns A promise resolving to the relation, either directly if the relation
 * was already present on `this`, or after loading the relation if it
 * was not present.
 */
var defaultHandleEnsureRelation = function(relationName) {
  return relationPromise(this, relationName);
};

/**
 * @module bookshelf-advanced-serialization
 */

/**
 * @desc Generates a configured plugin.
 *
 * @param {Object=} options An optional object optionally containing methods
 * for customizing plugin behavior.
 * @param {function=} options.getEvaluatorArguments A function which should return
 * the array of arguments that will be applied to the `evaluator` function. Its
 * `this` value is the model being serialized. See `getDefaultEvaluatorArguments`
 * in the source code for the example of the default behavior.
 * @param {function=} options.handleEnsureRelation A function which will be called
 * for each relation name in the `ensureRelationsLoaded` arrays. May return a
 * promise. See `defaultHandleEnsureRelation` in the source code for the example of the default
 * behavior, which, as you'd expect, simply loads the relation on the model if it
 * is not already present. This option was driven by the Sequiturs use case,
 * which special-cases relation names ending in `'CountPseudoRelation'` in order to
 * set on the model a `'Count'` attribute whose value is the count of rows of the
 * relation identified by the beginning of the relation name.
 * @param {boolean} [options.ensureRelationsVisibleAndInvisible=false] A boolean
 * which should be `true` only if you have also specified `options.handleEnsureRelation`.
 * It specifies whether the plugin should, before serializing, load all relations
 * listed in an `ensureRelationsLoaded` array--that is, whether it should call
 * `options.handleEnsureRelation` for each relation listed in an `ensureRelationsLoaded`
 * array--, regardless of whether the relations will be visible properties. Default
 * plugin behavior corresponds to a value of `false`, which avoids the work of
 * loading relations that will not be present in the serialization
 * result. Note that *even* if this option is `true`, relations that are not
 * visible properties will be removed from the model just before serializing--as
 * is documented for this plugin's `Model.toJSON`.
 *
 * @returns A function that should be passed to `bookshelf.plugin()`, to register this plugin.
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

  if (
    options.hasOwnProperty('ensureRelationsVisibleAndInvisible') &&
    (typeof options.ensureRelationsVisibleAndInvisible !== 'boolean')
  ) {
    throw new SanityError('ensureRelationsVisibleAndInvisible option must be a boolean.');
  }
  var ensureRelationsVisibleAndInvisible = !!options.ensureRelationsVisibleAndInvisible;

  return function(Bookshelf) {
    var modelProto  = Bookshelf.Model.prototype;
    var toJSON = modelProto.toJSON;
    var serialize = modelProto.serialize;
    var related = modelProto.related;
    var fetchAll = modelProto.fetchAll;

    /**
     * @ignore
     * @class Model
     * @memberof module:bookshelf-advanced-serialization
     * @classdesc The Bookshelf Model class, extended to support plugin behavior
     */
    var Model = Bookshelf.Model.extend({

      /**
       * @ignore
       * @member {*}
       * @memberof module:bookshelf-advanced-serialization.Model
       * @instance
       * @desc A value representing who the model is being accessed by / whom it
       * will be serialized for. Passed to `this.roleDeterminer()` to determine
       * the role of this person. You should not set this value directly; it is
       * set when creating a new model instance, or by `setAccessor()`.
       * @private
       */
      _accessor: undefined,

      /**
       * @method
       * @memberof module:bookshelf-advanced-serialization.Model
       * @instance
       * @desc Sets `this._accessor`. An alternative to setting the
       * accessor via the model constructor. Useful if you already have a model,
       * on which you want to set an accessor.
       * @param {*} accessor The accessor value to set
       */
      setAccessor: function(accessor) {
        this._accessor = accessor;
      },

      /**
       * @ignore
       * @member {Array.<string>}
       * @memberof module:bookshelf-advanced-serialization.Model
       * @instance
       * @desc Represents how `this` exists as a relation
       * related ultimately to some top-level model. This knowledge is
       * useful when serializing: the evaluator function can use it to determine
       * the contextDesignation. Specifically, it may be essential information
       * if a model can have multiple relations that are collections of the same
       * type of model. By default, this value is passed as the second argument
       * to the `evaluator` option passed to `toJSON`.
       *
       * @example Example from Sequiturs data model: for a Comment model that is the
       * `comment` relation of a Challenge model that is the `counterArgument`
       * relation of an Argument model, the value of `_accessedAsRelationChain`
       * would be `['counterArgument', 'comment']`.
       *
       * @private
       */
      _accessedAsRelationChain: [],

      /**
       * @method
       * @memberof module:bookshelf-advanced-serialization.Model
       * @instance
       * @desc A function called by `toJSON` with `this._accessor` as its argument,
       * to determine the accessor's role.
       * This role is then looked up in `rolesToVisibleFields` to identify
       * the visible properties of the model. May return a promise--this allows
       * asynchronously determining the role.
       * @param {*} accessor `this._accessor`
       * @returns {(string|Promise<string>)} The role or a promise resolving
       * to the role.
       */
      roleDeterminer: undefined,

      /**
       * @member {Object.<string, Array.<string>>}
       * @memberof module:bookshelf-advanced-serialization.Model
       * @instance
       * @desc An object that maps a role name to the array of properties of the
       * model that should be visible to that role type. Reflects a whitelisting
       * approach to serialization, as only properties listed in the array may be
       * present in the serialization result. Not all properties listed in the
       * array will necessarily be in the serialization result, however, if
       * `contextSpecificVisibleFields` is also being used.
       */
      rolesToVisibleFields: undefined,

      /**
       * @method
       * @memberof module:bookshelf-advanced-serialization.Model
       * @constructs module:bookshelf-advanced-serialization.Model
       * @desc The usual Bookshelf model constructor, but it accepts an
       * `accessor` option which will be set at `this._accessor` and passed to
       * `roleDeterminer()` when `toJSON` is called.
       * @param {Object} attributes
       * @param {Object=} options
       * @param {*} options.accessor The accessor value to set
       */
      constructor: function() {
        modelProto.constructor.apply(this, arguments);
        var options = arguments[1] || {};
        this._accessor = options.accessor;
      },

      /**
       * @ignore
       * @method
       * @memberof module:bookshelf-advanced-serialization.Model
       * @instance
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
       * @method
       * @memberof module:bookshelf-advanced-serialization.Model
       * @instance
       * @desc The method for serializing a model / collection.
       *
       * Note that this method mutates models, first by loading relations per
       * `options.ensureRelationsLoaded` and then by removing relations that are not
       * among the model's visible properties (the latter improves serialization
       * performance and helps to avoid infinite-looping / cycling of serialization).
       * Such mutating behavior is, admittedly, not obvious from the method's
       * name of `toJSON` alone. In using this plugin, you should therefore think of
       * `toJSON` not as merely converting the existing model to a serialized
       * form, but as *transforming* it according to your specifications,
       * and then converting it to serialized form.
       *
       * A model with no visible properties -- that is, where the list of properties
       * that should be visible to the caller evaluates to empty -- will be
       * serialized as `undefined`, and all such models in collections will be
       * removed from the corresponding arrays in the serialization result. (N.B. A model
       * with no visible properties is not the same as an empty model--the latter is a
       * model with no attributes and no relations. An empty model that exists as
       * a relation of another model is assumed to be due to [this Bookshelf
       * bug](https://github.com/tgriesser/bookshelf/issues/753) and is serialized
       * as `null`. An empty model that exists otherwise (e.g. standalone, or in a
       * standalone collection, or in a collection that exists as the relation of another
       * model) is serialized as `{}`.)
       *
       * @param {Object=} options An optional object specifying how to customize
       * the serialization result.
       * @param {Object=} options.contextSpecificVisibleFields An optional object
       * specifying what properties of a model should be visible given the
       * application context in which `toJSON` is being invoked. The object should be
       * indexed first by table name, with values that are either (a) an array of
       * visible property names; or (b) an object indexed by the possible
       * context designations (i.e. the return values of `options.evaluator`),
       * with values that are an array of visible property names. This object,
       * potentially in combination with `options.evaluator`, is your
       * mechanism for preventing infinite-looping / cycling of serialization,
       * should your use case present that possibility.
       * @param {Object=} options.ensureRelationsLoaded An optional object
       * analogous in form to `options.contextSpecificVisibleFields` but whose
       * values are arrays containing the relation names that it will be
       * ensured are loaded on a model / collection before serializing. Such
       * relations will be loaded on the model / collection if they are not
       * already present.
       * @param {function=} options.evaluator A function which returns the
       * context designation describing the context in which `toJSON` is being
       * called. Only required if `options.contextSpecificVisibleFields` or
       * `options.ensureRelationsLoaded` index lists by context designation.
       * May return a promise--this supports asynchronously determining the
       * context designation. By default, the evaluator will be called with
       * `this.tableName`, `this._accessedAsRelationChain`, and `this.id`
       * as arguments. You may optionally customize these arguments by passing
       * `options.getEvaluatorArguments` to the plugin.
       *
       * @returns {Promise<(Object|Array|undefined)>} A promise resolving to the plain
       * javascript object (array) representing the model (collection).
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
            'roleDeterminer function was not defined for models of table: ' + this.tableName);
        }

        if (!_.isPlainObject(this.rolesToVisibleFields)) {
          throw new SanityError('rolesToVisibleFields was not defined for models of table: ' + this.tableName);
        }

        // Determine visible properties based on role
        return BluebirdPromise.resolve(this.roleDeterminer(this._accessor))
          .bind(this)
          .then(function(role) {

            var visibleFields = this.rolesToVisibleFields[role];

            if (!Array.isArray(visibleFields)) {
              throw new SanityError('rolesToVisibleFields for table ' + this.tableName +
                ' does not contain array of visible fields for role: ' + role);
            }

            if (!visibleFields.length) {
              return BluebirdPromise.resolve(undefined);
            }

            // Determine contextDesignation.
            var contextDesignationPromise = getContextDesignation.call(this,
              options ? options.evaluator : undefined, getEvaluatorArguments);

            // Determine the properties that should be visible in final serialized result
            // based on application context in which `toJSON` is being called.
            // `contextSpecificVisibleFields` should not be used to prune fields from
            // a model for permissions-logic-related reasons; the place for determining
            // what fields are visible for permissions reasons is in the roleDeterminer function.
            var contextSpecificVisibleFieldsPromise;
            if (options && options.contextSpecificVisibleFields) {

              if (!_.isPlainObject(options.contextSpecificVisibleFields)) {
                throw new SanityError('contextSpecificVisibleFields must be an object');
              }

              var tableContextSpecific = options.contextSpecificVisibleFields[this.tableName];
              if (tableContextSpecific) {

                if (Array.isArray(tableContextSpecific)) {

                  contextSpecificVisibleFieldsPromise = BluebirdPromise.resolve(tableContextSpecific);

                } else if (_.isPlainObject(tableContextSpecific)) {

                  if (!options.evaluator) {
                    throw new SanityError('options must contain an evaluator function if ' +
                      'options.contextSpecificVisibleFields[this.tableName] is an object');
                  }

                  contextSpecificVisibleFieldsPromise = contextDesignationPromise
                    .then(function(contextDesignation) {
                      var contextSpecificVisibleFields = tableContextSpecific[contextDesignation];

                      if (!Array.isArray(contextSpecificVisibleFields)) {
                        throw new SanityError('evaluator function did not successfully ' +
                          'identify array within contextSpecificVisibleFields');
                      }

                      return contextSpecificVisibleFields;
                    });

                } else {
                  throw new SanityError('contextSpecificVisibleFields.' + this.tableName +
                    ' must be an array, or an object whose keys are strings returned ' +
                    'by the options.evaluator function and whose values are arrays.');
                }

              } else {
                contextSpecificVisibleFieldsPromise = BluebirdPromise.resolve(undefined);
              }
            } else {
              contextSpecificVisibleFieldsPromise = BluebirdPromise.resolve(undefined);
            }

            return contextSpecificVisibleFieldsPromise.bind(this).then(function(contextSpecificVisibleFields) {

              // Determine the visible properties in the final serialization result.
              var ultimatelyVisibleFields =
                contextSpecificVisibleFields ?
                _.intersection(visibleFields, contextSpecificVisibleFields) :
                visibleFields;

              // If ultimatelyVisibleFields has zero length, we're done.
              if (!ultimatelyVisibleFields.length) {
                return BluebirdPromise.resolve(undefined);
              }

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

                var tableContextEnsureRelations = options.ensureRelationsLoaded[this.tableName];
                // Bookshelf provides no way to identify a model's type except by looking at its
                // `tableName`. We can't, for instance, access the name with which
                // the model class was registered with the registry.
                var relationNamesToEnsurePromise;
                if (tableContextEnsureRelations) {
                  if (Array.isArray(tableContextEnsureRelations)) {

                    relationNamesToEnsurePromise = BluebirdPromise.resolve(tableContextEnsureRelations);

                  } else if (_.isPlainObject(tableContextEnsureRelations)) {

                    if (!options.evaluator) {
                      throw new SanityError('options must contain an evaluator function if ' +
                        'options.ensureRelationsLoaded[this.tableName] is an object');
                    }

                    relationNamesToEnsurePromise = contextDesignationPromise
                      .then(function(contextDesignation) {
                        var relationNames = tableContextEnsureRelations[contextDesignation];

                        if (!Array.isArray(relationNames)) {
                          throw new SanityError('evaluator function did not successfully ' +
                            'identify array within ensureRelationsLoaded');
                        }

                        return relationNames;
                      });

                  } else {
                    throw new SanityError('ensureRelationsLoaded.' + this.tableName +
                      ' must be an array, or an object whose keys are strings returned ' +
                      'by the options.evaluator function and whose values are arrays.');
                  }

                  ensureRelationsPromise = relationNamesToEnsurePromise.bind(this)
                    .then(function(relationNamesToEnsure) {

                      // Load only those relationNamesToEnsure that are also in
                      // ultimatelyVisibleFields, to avoid unnecessary work --
                      // unless caller has opted to force loading all relationNamesToEnsure.

                      var loadTheseRelations = ensureRelationsVisibleAndInvisible ?
                        relationNamesToEnsure :
                        _.intersection(relationNamesToEnsure, ultimatelyVisibleFields);

                      if (process.env.NODE_ENV !== 'production') {
                        if (loadTheseRelations.length !== relationNamesToEnsure.length) {
                          console.log(
                            'bookshelf-advanced-serialization plugin: You have ' +
                            'specified relation names in `ensureRelationsLoaded` ' +
                            'which are not visible properties: ' +
                            _.difference(relationNamesToEnsure, loadTheseRelations) +
                            '. These relations will ' +
                            (ensureRelationsVisibleAndInvisible ? 'nevertheless' : 'not') +
                            ' be loaded, because option ensureRelationsVisibleAndInvisible is `' +
                            ensureRelationsVisibleAndInvisible + '`.'
                          );
                        }
                      }

                      return BluebirdPromise.map(loadTheseRelations, handleEnsureRelation.bind(this));
                    });

                } else {
                  ensureRelationsPromise = BluebirdPromise.resolve(undefined);
                }
              } else {
                ensureRelationsPromise = BluebirdPromise.resolve(undefined);
              }

              return ensureRelationsPromise.bind(this).then(function(ensuredRelations) {

                // Remove from the model relations that are not in ultimatelyVisibleFields,
                // even if they were just loaded per `ensureRelationsVisibleAndInvisible`.
                // These don't need to be serialized, and removing them can be essential
                // to preventing cycling / infinite looping of serialization.
                var ultimatelyVisibleFieldsDict = {};
                _.each(ultimatelyVisibleFields, function(fieldName) {
                  ultimatelyVisibleFieldsDict[fieldName] = true;
                });
                _.each(_.keys(this.relations), function(relationName) {
                  // Iterate over `this.relation`'s keys rather than `this.relations`
                  // itself, because I prefer not to mutate what I'm iterating over,
                  // even though ECMAScript abides such practices.

                  if (!ultimatelyVisibleFieldsDict.hasOwnProperty(relationName)) {
                    delete this.relations[relationName];
                  }
                }.bind(this));

                // Finally, serialize the model

                var jsonPromises = toJSON.apply(this, args);

                return BluebirdPromise.props(jsonPromises).bind(this).then(function(json) {

                  var result = _.pick.apply(_, [ json ].concat(ultimatelyVisibleFields));

                  // Any empty objects at this point must be due to a Bookshelf
                  // bug (https://github.com/tgriesser/bookshelf/issues/753)
                  // and should become null. (The empty objects couldn't be objects
                  // with no visible properties, because we resolved those to `undefined`.)

                  _.each(_.keys(result), function(key) {
                    var value = result[key];
                    if (_.isPlainObject(value) && _.isEmpty(value)) {
                      result[key] = null;
                    }
                  });

                  return result;
                });
              });
            });
          });
      },

      /**
       * @ignore
       * @method
       * @memberof module:bookshelf-advanced-serialization.Model
       * @instance
       * @desc Override the prototype's `related` method in order to (1) transfer
       * `this._accessor` of a model to its relations' models, and (2) populate
       * `this._accessedAsRelationChain`. With (2) we keep track of how a relation
       * model is related to its ancestor models(s). To do this, we make a copy of
       * the parent model's `_accessedAsRelationChain`, add to this copy the
       * relation name being accessed, and set this value on the related model /
       * collection.
       */
      related: function() {
        // TODO Ideally these values should be populated at the time of instantiation
        // of the relation model / collection, rather than relying on the user
        // to access the relation via .related() as we do currently.

        var result = related.apply(this, arguments);

        if (result) {
          var relationName = arguments[0];

          // Collection
          if (result.hasOwnProperty('models')) {
            _.each(result.models, function(model) {
              model._accessor = this._accessor;
              model._accessedAsRelationChain = this._accessedAsRelationChain.concat([ relationName ]);
            }.bind(this));

          // Model
          } else {
            result._accessor = this._accessor;
            result._accessedAsRelationChain = this._accessedAsRelationChain.concat([ relationName ]);
          }
        }

        return result;
      }
    });

    Bookshelf.Model = Model;

    var collectionProto = Bookshelf.Collection.prototype;
    var collectionSerialize = collectionProto.serialize;

    /**
     * @ignore
     * @class Collection
     * @memberof module:bookshelf-advanced-serialization
     * @classdesc The Bookshelf Collection class, extended to support plugin behavior
     */
    var Collection = Bookshelf.Collection.extend({
      /**
       * @ignore
       * @method
       * @memberof module:bookshelf-advanced-serialization.Collection
       * @desc Override Collection.serialize to support the fact that Model.toJSON
       * returns a promise. Otherwise we end up with an array of stringified
       * promises. (Note that overriding Collection.serialize here applies to
       * both top-level collections as well as models' relations that are
       * collections.) Also, remove `undefined` values from arrays, which represent
       * models with no visible properties, and which we'll assume the recipient
       * should therefore have no indication even exist.
       */
      serialize: function() {
        var modelPromisesArray = collectionSerialize.apply(this, arguments);
        return BluebirdPromise.all(modelPromisesArray)
          .then(function(list) {
            return filterUndefineds(list);
          });
      }
    });

    Bookshelf.Collection = Collection;
  };
};
