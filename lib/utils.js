'use strict';

module.exports = {
  /**
   * @desc Utility
   * @returns
   */
  relationPromise: function(model, relationName) {
    return model.relations[relationName] ?
      BluebirdPromise.resolve(model.related(relationName)) :
      model.load([ relationName ]).then(function(modelLoadedWithRelation) {
        return modelLoadedWithRelation.related(relationName);
      });
  },
  /**
   * @desc Utility for removing `undefined` and `{}` from an array.
   */
  filterUndefinedsAndEmptyObjects: function(list) {
    return _.filter(list, function(item) {
      return !(item === undefined ||
        (_.isPlainObject(item) && _.isEmpty(item)));
    });
  };
};
