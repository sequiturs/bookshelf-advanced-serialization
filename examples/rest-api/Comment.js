'use strict';

module.exports = function(bookshelf) {
  var Comment = bookshelf.Model.extend({
    tableName: 'comments',

    roleDeterminer: function(accessor) {
      return 'anyone';
    },
    rolesToVisibleFields: {
      anyone: [ 'id', 'author', 'content', 'parent', 'children' ]
    },

    parent: function() {
      return this.belongsTo('Comment', 'parent_id');
    },
    children: function() {
      return this.hasMany('Comment', 'parent_id');
    },
    author: function() {
      return this.belongsTo('User', 'author_id');
    }
  }, {});

  // Register model
  if (!bookshelf.model('Comment')) {
    bookshelf.model('Comment', Comment);
  }

  // Register model(s) depended on
  if (!bookshelf.model('User')) {
    require('./User.js')(bookshelf);
  }

  return bookshelf.model('Comment');
};
