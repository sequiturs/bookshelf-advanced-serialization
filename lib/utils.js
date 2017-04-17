'use strict';

var BluebirdPromise = require('bluebird');
var _ = require('lodash');

module.exports = {
  /**
   * @ignore
   * @desc Utility for ensuring a particular relation is loaded on a model
   * @param {object} model The model on which the relation should be loaded
   * @param {string} relationName The name of the relation that should be loaded
   * @returns {Promise<object>} A promise resolving with the relation specified
   * by `relationName`.
   */
  relationPromise: function(model, relationName) {
    return model.relations[relationName] ?
      BluebirdPromise.resolve(model.related(relationName)) :
      model.load([ relationName ]).then(function(modelLoadedWithRelation) {
        return modelLoadedWithRelation.related(relationName);
      });
  }
};
