'use strict';

module.exports = function(bookshelf) {
  var User = bookshelf.Model.extend({
    tableName: 'users',
    hasTimestamps: true,

    roleDeterminer: function(accessor) {
      return (accessor.user && accessor.user.id === this.id) ?
        'theUserHerself' :
        'someoneElse';
    },
    rolesToVisibleFields: {
      theUserHerself: [ 'id', 'username', 'created_at', 'email', 'groupsMemberOf', 'groupsAdminOf' ],
      someoneElse:    [ 'id', 'username', 'created_at' ]
      // User models might contain other attributes like hashed_password,
      // but these won't be serialized because they are not present in these lists
      // of visible properties.
    },

    groupsMemberOf: function() {
      return this.belongsToMany('Group', 'group_members', 'user_id', 'group_id');
    },
    groupsAdminOf: function() {
      return this.belongsToMany('Group', 'group_admins', 'user_id', 'group_id');
    }
  }, {});

  // Register model
  bookshelf.model('User', User);

  // Register model(s) depended on
  if (!bookshelf.model('Group')) {
    require('./Group.js')(bookshelf);
  }

  return bookshelf.model('User');
};
