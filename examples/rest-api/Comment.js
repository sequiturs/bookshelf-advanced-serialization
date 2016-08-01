'use strict';

var bookshelf = require('./db.js');

require('./User.js');

var Comment = bookshelf.Model.extend({
  tableName: 'comments',

  roleDeterminer: function(accessor) {
    return 'anyone';
  },
  rolesToVisibleFields: {
    anyone: [ 'id', 'author', 'content', 'parent', 'children' ]
  },

  parent: function() {
    return this.belongsTo('Argument', 'parent_id');
  },
  children: function() {
    return this.hasMany('Argument', 'parent_id');
  },
  author: function() {
    return this.belongsTo('User', 'author_id');
  }
}, {});

module.exports = bookshelf.model('Comment', Comment);
