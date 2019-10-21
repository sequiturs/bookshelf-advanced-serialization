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
var relationPromise = utils.relationPromise;

/**
 * @ignore
 * @desc A function for generating the default arguments that should be passed
 * to `contextDesignator`.
 * @returns {Array.<*>}
 */
var getDefaultEvaluatorArguments = function() {
  return [ this.tableName, this._accessedAsRelationChain, this.id ];
};

/**
 * @ignore
 * @param {function=} contextDesignator The contextDesignator function to use to determine the
 * contextDesignation
 * @param {function=} getEvaluatorArguments A function that returns the
 * arguments to pass to the contextDesignator function
 * @returns {Promise<string>} A promise resolving to the name for how to
 * interpret or understand `this` that is currently being serialized.
 * We refer to this as the contextDesignation. This is especially useful for
 * distinguishing `this` from the top-level model on which `toJSON`
 * was called when both models are of the same type, because then we can given
 * them appropriate contextSpecificVisibleProperties to prevent infinite looping of
 * serialization.
 */
var getContextDesignation = function(contextDesignator, getEvaluatorArguments) {
  var contextDesignation;
  if (contextDesignator) {
    if (typeof contextDesignator !== 'function') {
      throw new SanityError('contextDesignator must be a function');
    }
    contextDesignation = BluebirdPromise.resolve(
      contextDesignator.apply(this, getEvaluatorArguments.call(this))
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
 * the array of arguments that will be applied to the `contextDesignator` function. Its
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
 * @param {boolean=} options.defaultOmitNew A boolean which specifies a
 * default value for the `omitNew` option to `{model,collection}.toJSON(options)`. Specifying
 * this option as `true` is a performant way to address this Bookshelf bug
 * (https://github.com/tgriesser/bookshelf/issues/753)--though note that the
 * plugin will address that bug even without this option or with a value of `false`,
 * albeit in a less performant manner.
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

  if (
    options.hasOwnProperty('defaultOmitNew') &&
    (typeof options.defaultOmitNew !== 'boolean')
  ) {
    throw new SanityError('defaultOmitNew passed as plugin option must be a boolean.');
  }
  var defaultOmitNew = options.defaultOmitNew;

  return function(Bookshelf) {
    var modelProto  = Bookshelf.Model.prototype;
    var modelToJSON = modelProto.toJSON;
    var modelRelated = modelProto.related;
    var modelFetchAll = modelProto.fetchAll;

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
       * useful when serializing: the contextDesignator function can use it to determine
       * the contextDesignation. Specifically, it may be essential information
       * if a model can have multiple relations that are collections of the same
       * type of model. By default, this value is passed as the second argument
       * to the `contextDesignator` option passed to `toJSON`.
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
       * This role is then looked up in `rolesToVisibleProperties` to identify
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
       * `contextSpecificVisibleProperties` is also being used.
       */
      rolesToVisibleProperties: undefined,

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
        var result = modelFetchAll.apply(this, arguments);
        return result.then(function(collection) {
          _.each(collection.models, function(model) {
            model._accessor = modelThis._accessor;
          });
          return collection.models;
        });
        // TODO There must be a way to accomplish this by having Bookshelf use
        // an accessor option (derived from modelThis._accessor) when it invokes
        // the model constructor for each model it puts in the collection.
      },

      /**
       * @method
       * @memberof module:bookshelf-advanced-serialization.Model
       * @instance
       * @desc The method for serializing a model.
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
       * Note also that the behavior of this method diverges from the standard Bookshelf
       * behavior in that it does not remove `null` values for relations from the
       * final serialized result.
       *
       * @param {Object=} options An optional object specifying how to customize
       * the serialization result.
       * @param {Object=} options.contextSpecificVisibleProperties An optional object
       * specifying what properties of a model should be visible given the
       * application context in which `toJSON` is being invoked. The object should be
       * indexed first by table name, with values that are either (a) an array of
       * visible property names; or (b) an object indexed by the possible
       * context designations (i.e. the return values of `options.contextDesignator`),
       * with values that are an array of visible property names. This object,
       * potentially in combination with `options.contextDesignator`, is your
       * mechanism for preventing infinite-looping / cycling of serialization,
       * should your use case present that possibility.
       * @param {Object=} options.ensureRelationsLoaded An optional object
       * analogous in form to `options.contextSpecificVisibleProperties` but whose
       * values are arrays containing the relation names that it will be
       * ensured are loaded on a model before serializing. Such
       * relations will be loaded on the model if they are not
       * already present.
       * @param {function=} options.contextDesignator A function which returns the
       * context designation describing the context in which `toJSON` is being
       * called. Only required if `options.contextSpecificVisibleProperties` or
       * `options.ensureRelationsLoaded` index lists by context designation.
       * May return a promise--this supports asynchronously determining the
       * context designation. By default, the contextDesignator will be called with
       * `this.tableName`, `this._accessedAsRelationChain`, and `this.id`
       * as arguments. You may optionally customize these arguments by passing
       * `options.getEvaluatorArguments` to the plugin.
       * @param {Object=} options.accessor A value representing who the model is
       * being accessed by / whom it will be serialized for. Pass the accessor as
       * an option here as an alternative to setting the accessor when the
       * model is instantiated (see `constructor`) or using `.setAccessor()`.
       * A value provided for this option takes precedence over an accessor
       * value set on the model or any related models.
       * @param {boolean=} options.shallow Same as the standard Bookshelf option.
       * @param {boolean=} options.omitPivot Same as the standard Bookshelf option.
       * @param {boolean=} options.omitNew Same as the standard Bookshelf option.
       *
       * @returns {Promise<(Object|undefined)>} A promise resolving to the plain
       * javascript object representing the model.
       */
      toJSON: function(options) {
        options = options || {};

        // Determine value of `options.omitNew`. A value passed to `toJSON()`
        // takes priority, otherwise if a default was specified for the plugin
        // we use that, otherwise we do nothing special.
        if (options.hasOwnProperty('omitNew')) {
          // No op.
        } else if (typeof defaultOmitNew === 'boolean') {
          options.omitNew = defaultOmitNew;
        } else {
          // No op.
        }

        if (typeof this.roleDeterminer !== 'function') {
          throw new SanityError(
            'roleDeterminer function was not defined for models of table: ' + this.tableName);
        }

        if (!_.isPlainObject(this.rolesToVisibleProperties)) {
          throw new SanityError('rolesToVisibleProperties was not defined for models of table: ' + this.tableName);
        }

        // If `options.omitNew=true` and the model is new, we can exit early.
        // This prevents unsaved models from being serialized, including empty
        // models created by this Bookshelf bug (https://github.com/tgriesser/bookshelf/issues/753).
        // We explicitly check these conditions here, as opposed to relying on
        // the standard Bookshelf handling of the `omitNew` option further downstream,
        // so that we can avoid doing unnecessary work related to determining visible
        // properties and loading relations for such models.
        if (options.omitNew && this.isNew()) {
          return BluebirdPromise.resolve(modelToJSON.call(this, options));
        }

        // Determine visible properties based on role
        var accessor = options.accessor || this._accessor;
        return BluebirdPromise.resolve(this.roleDeterminer(accessor))
          .bind(this)
          .then(function(role) {

            var visibleProperties = this.rolesToVisibleProperties[role];

            if (!Array.isArray(visibleProperties)) {
              throw new SanityError('rolesToVisibleProperties for table ' + this.tableName +
                ' does not contain array of visible properties for role: ' + role);
            }

            if (!visibleProperties.length) {
              return BluebirdPromise.resolve(undefined);
            }

            // Determine contextDesignation.
            var contextDesignationPromise = getContextDesignation.call(this,
              options ? options.contextDesignator : undefined, getEvaluatorArguments);

            // Determine the properties that should be visible in final serialized result
            // based on application context in which `toJSON` is being called.
            // `contextSpecificVisibleProperties` should not be used to prune properties from
            // a model for permissions-logic-related reasons; the place for determining
            // what properties are visible for permissions reasons is in the roleDeterminer function.
            var contextSpecificVisiblePropertiesPromise;
            if (options && options.contextSpecificVisibleProperties) {

              if (!_.isPlainObject(options.contextSpecificVisibleProperties)) {
                throw new SanityError('contextSpecificVisibleProperties must be an object');
              }

              var tableContextSpecific = options.contextSpecificVisibleProperties[this.tableName];
              if (tableContextSpecific) {

                if (Array.isArray(tableContextSpecific)) {

                  contextSpecificVisiblePropertiesPromise = BluebirdPromise.resolve(tableContextSpecific);

                } else if (_.isPlainObject(tableContextSpecific)) {

                  if (!options.contextDesignator) {
                    throw new SanityError('options must contain an contextDesignator function if ' +
                      'options.contextSpecificVisibleProperties[this.tableName] is an object');
                  }

                  contextSpecificVisiblePropertiesPromise = contextDesignationPromise
                    .then(function(contextDesignation) {
                      var contextSpecificVisibleProperties = tableContextSpecific[contextDesignation];

                      if (!Array.isArray(contextSpecificVisibleProperties)) {
                        throw new SanityError('contextDesignator function did not successfully ' +
                          'identify array within contextSpecificVisibleProperties');
                      }

                      return contextSpecificVisibleProperties;
                    });

                } else {
                  throw new SanityError('contextSpecificVisibleProperties.' + this.tableName +
                    ' must be an array, or an object whose keys are strings returned ' +
                    'by the options.contextDesignator function and whose values are arrays.');
                }

              } else {
                contextSpecificVisiblePropertiesPromise = BluebirdPromise.resolve(undefined);
              }
            } else {
              contextSpecificVisiblePropertiesPromise = BluebirdPromise.resolve(undefined);
            }

            return contextSpecificVisiblePropertiesPromise.bind(this).then(function(contextSpecificVisibleProperties) {

              // Determine the visible properties in the final serialization result.
              var ultimatelyVisibleProperties =
                contextSpecificVisibleProperties ?
                _.intersection(visibleProperties, contextSpecificVisibleProperties) :
                visibleProperties;

              // If ultimatelyVisibleProperties has zero length, we're done.
              if (!ultimatelyVisibleProperties.length) {
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

                    if (!options.contextDesignator) {
                      throw new SanityError('options must contain an contextDesignator function if ' +
                        'options.ensureRelationsLoaded[this.tableName] is an object');
                    }

                    relationNamesToEnsurePromise = contextDesignationPromise
                      .then(function(contextDesignation) {
                        var relationNames = tableContextEnsureRelations[contextDesignation];

                        if (!Array.isArray(relationNames)) {
                          throw new SanityError('contextDesignator function did not successfully ' +
                            'identify array within ensureRelationsLoaded');
                        }

                        return relationNames;
                      });

                  } else {
                    throw new SanityError('ensureRelationsLoaded.' + this.tableName +
                      ' must be an array, or an object whose keys are strings returned ' +
                      'by the options.contextDesignator function and whose values are arrays.');
                  }

                  ensureRelationsPromise = relationNamesToEnsurePromise.bind(this)
                    .then(function(relationNamesToEnsure) {

                      // Load only those relationNamesToEnsure that are also in
                      // ultimatelyVisibleProperties, to avoid unnecessary work --
                      // unless caller has opted to force loading all relationNamesToEnsure.

                      var loadTheseRelations = ensureRelationsVisibleAndInvisible ?
                        relationNamesToEnsure :
                        _.intersection(relationNamesToEnsure, ultimatelyVisibleProperties);

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

                // Remove from the model relations that are not in ultimatelyVisibleProperties,
                // even if they were just loaded per `ensureRelationsVisibleAndInvisible`.
                // These don't need to be serialized, and removing them can be essential
                // to preventing cycling / infinite looping of serialization.
                var ultimatelyVisiblePropertiesDict = {};
                _.each(ultimatelyVisibleProperties, function(fieldName) {
                  ultimatelyVisiblePropertiesDict[fieldName] = true;
                });
                _.each(_.keys(this.relations), function(relationName) {
                  // Iterate over `this.relation`'s keys rather than `this.relations`
                  // itself, because I prefer not to mutate what I'm iterating over,
                  // even though ECMAScript abides such practices.

                  if (!ultimatelyVisiblePropertiesDict.hasOwnProperty(relationName)) {
                    delete this.relations[relationName];
                  }
                }.bind(this));

                // Finally, serialize the model

                var jsonPromises = modelToJSON.call(this, options);

                return BluebirdPromise.props(jsonPromises).bind(this).then(function(json) {

                  var result = _.pick.apply(_, [ json ].concat(ultimatelyVisibleProperties));

                  // Any empty objects at this point must be due to a Bookshelf
                  // bug (https://github.com/tgriesser/bookshelf/issues/753)
                  // and should become `null`. (The empty objects couldn't be objects
                  // with no visible properties, because we resolved those to `undefined`.)
                  result = _.mapValues(result, function(val) {
                    if (_.isPlainObject(val) && _.isEmpty(val)) {
                      return null;
                    } else {
                      return val;
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

        var result = modelRelated.apply(this, arguments);

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
    var collectionToJSON = collectionProto.toJSON;

    /**
     * @ignore
     * @class Collection
     * @memberof module:bookshelf-advanced-serialization
     * @classdesc The Bookshelf Collection class, extended to support plugin behavior
     */
    var Collection = Bookshelf.Collection.extend({
      /**
       * @method
       * @memberof module:bookshelf-advanced-serialization.Collection
       * @instance
       * @desc The method for serializing a collection. Analogous to `Model.toJSON`.
       * All models in a collection which serialize to `undefined` will be removed
       * from the serialized collection.
       *
       * Note that this method diverges from the standard Bookshelf behavior
       * in that it does not remove `null` values from arrays.
       *
       * @param {Object=} options An optional object specifying how to customize
       * the serialization result. Accepts the same options as `Model.toJSON`.

       * @returns {Promise<Array>} A promise resolving to the plain
       * javascript array representing the collection.
       */
      toJSON: function(options) {
        options = options || {};

        // Determine value of `options.omitNew`. A value passed to `toJSON()`
        // takes priority, otherwise if a default was specified for the plugin
        // we use that, otherwise we do nothing special.
        if (options.hasOwnProperty('omitNew')) {
          // No op.
        } else if (typeof defaultOmitNew === 'boolean') {
          options.omitNew = defaultOmitNew;
        } else {
          // No op.
        }

        return collectionToJSON.call(this, options);
      },
      /**
       * @ignore
       * @method
       * @memberof module:bookshelf-advanced-serialization.Collection
       * @desc Override `Collection.serialize` to support the fact that Model.toJSON
       * returns a promise. Otherwise we end up with an array of stringified
       * promises. (Note that overriding Collection.serialize here applies to
       * both top-level collections as well as models' relations that are
       * collections.) Remove `undefined` values from arrays, which represent
       * models with no visible properties, and which we'll assume the recipient
       * should therefore have no indication even exist.
       */
      serialize: function() {
        var modelPromisesArray = collectionSerialize.apply(this, arguments);
        return BluebirdPromise.all(modelPromisesArray)
          .then(function(list) {
            return _.filter(list, _.negate(_.isUndefined));
          });
      }
    });

    Bookshelf.Collection = Collection;
  };
};
