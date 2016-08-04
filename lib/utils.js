'use strict';

var _ = require('lodash');

module.exports = {
  /**
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
  },
  /**
   * @desc Utility for removing `undefined` values from an array
   */
  filterUndefineds: function(list) {
    return _.filter(list, function(item) {
      return item !== undefined;
    });
  }
};
