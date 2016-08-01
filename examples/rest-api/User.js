'use strict';

var bookshelf = require('./db.js');

require('./Group.js');

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

module.exports = bookshelf.model('User', User);
