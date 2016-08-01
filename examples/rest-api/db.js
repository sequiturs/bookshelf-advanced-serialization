'use strict';

var advancedSerialization = require('bookshelf-advanced-serialization');

var knex = require('knex')({ ... });
var bookshelf = require('bookshelf')(knex);

bookshelf.plugin('registry');

var genCustomEvaluatorArguments = function() {
  if (this.tableName === 'comments') {
    return [this.tableName, this._accessedAsRelationChain, this.id, this.get('parent_id')];
  } else {
    return [this.tableName, this._accessedAsRelationChain, this.id];
  }
};

bookshelf.plugin(advancedSerialization(genCustomEvaluatorArguments));

module.exports = bookshelf;
